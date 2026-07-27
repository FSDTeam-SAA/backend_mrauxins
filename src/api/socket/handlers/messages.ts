import { Socket, Server } from 'socket.io';
import mongoose from 'mongoose';
import messageSchema, { IDeliveryStatus } from '../../domain/schema/message.schema';
import chatSchema, { ChatType } from '../../domain/schema/chat.schema';
import { loggerMsg } from '../../lib/logger';
import userSchema from '../../domain/schema/user.schema';
import { sentPushNotificationToUser } from '../../domain/models/device.token.model';
import notificationSchema, { CLICK_NOTIFICATION_TYPE, NotificationType } from '../../domain/schema/notification.schema';
import { deviceToken } from '../../domain/schema/devicetoken.schema';
import chatParticipantSchema from '../../domain/schema/chat.participant.schema';
import { saveMediaMessageAsync } from '../../domain/models/chat.model';
import { descryptedContent } from '../../helper/helper';
import { userSocketMap, receiverOpenChat, getNickNameDetails } from '../initDemoSocketHandlers';
import { buildGroupInfoPayload, buildSenderPayload } from '../../helper/notificationPayload';

interface SendMessageData {
  chatId: string;
  content: string;
  type: string;
  sender: mongoose.Types.ObjectId;
  isGroup: boolean;
  fileUrls?: string[];
  files?: Express.Multer.File[];
  messageId?: string;
  replyToMessageId?: string;
  createdAt?: string;
  senderIdOfReplyMsg?: string;
}

export const registerMessageHandlers = (io: Server, socket: Socket) => {
  // Send message
  socket.on("send_message", async (data: SendMessageData, callback) => {
    loggerMsg("call event of send_message", "debug");
    const { chatId, content, type, sender, fileUrls = [], files = [], messageId, replyToMessageId, createdAt } = data;
    let messageCreatedAt = new Date();
    if (createdAt) {
      messageCreatedAt = new Date(createdAt);
    }

    try {
      // Check if the chat exists
      const chat = await chatSchema.findById(chatId);
      if (!chat) {
        socket.emit("error_message", {
          status: 404,
          code: "CHAT_NOT_FOUND",
          message: "Chat not found.",
        });
        return;
      }

      if (chat.isFirstMessage === 0) {
        await chatSchema.findByIdAndUpdate(chat._id, { $set: { isFirstMessage: 1 } });
      }

      const removedUser = await chatParticipantSchema.findOne({ userId: sender, chatId, isRemoved: true }).select("isRemoved");
      if (removedUser) {
        return socket.emit("error_message", { message: "You can't send message because you are no longer a member of the group." });
      }

      const isRemoveUserList = await chatParticipantSchema.find({ chatId });
      const is_conversation_mute = isRemoveUserList.filter(c => c.userId.toString() !== sender.toString() && c.isNotificationMute === true);

      await Promise.all(
        isRemoveUserList.map(async (data) => {
          if (data.isRemoved === false) {
            await chatParticipantSchema.updateMany(
              { chatId, userId: data.userId },
              { $set: { lastClearedMessageId: null } }
            );
          }
        })
      );

      await Promise.all(
        isRemoveUserList.map(async (data) => {
          if (data.isDeleted) {
            await chatParticipantSchema.updateMany({ chatId, isDeleted: true }, { $set: { isDeleted: false, lastClearedMessageId: null } });
          }
        })
      );

      loggerMsg(`Chat is found:=>\n${JSON.stringify(chat)}`, "debug");
      const { type: chatType, participants } = chat;

      let repliedMessage = null;
      let senderOfReplyMsg = null;
      if (replyToMessageId) {
        repliedMessage = await messageSchema.findOne({ messageId: replyToMessageId })
          .populate({
            path: "sender",
            select: "name userName profilePicture countryCode phone countryISOCode isOnline lastSeen email",
            options: { lean: true }
          }).lean();
        if (repliedMessage) {
          senderOfReplyMsg = await getNickNameDetails(repliedMessage.sender._id.toString(), sender.toString());
        }
      }

      // Check if sender is allowed to send messages in channel
      if (chatType === ChatType.CHANNEL) {
        if (chat.createdBy.toString() !== sender.toString()) {
          loggerMsg("Only admins can send messages in this channel.", "debug");
          socket.emit("error_message", {
            status: 400,
            code: "FORBIDDEN",
            message: "Only admins can send messages in this channel.",
          });
          return;
        }
      }

      let preparedFileUrls = fileUrls;
      if (files.length > 0) {
        preparedFileUrls = files.map((file: Express.Multer.File) => `${file.filename}`);
      }

      const senderDetails = await userSchema.findById(sender).select("userName name profilePicture lastSeen bio email isOnline countryCode countryISOCode nicknames").lean();
      const tempMessageId = messageId || new mongoose.Types.ObjectId().toString();

      let messageStatus = "sent";
      let isRead = false;
      const deliveryStatus: IDeliveryStatus = {};
      messageStatus = chatType === ChatType.ONE_TO_ONE ? "sent" : "read";
      isRead = chatType === ChatType.ONE_TO_ONE ? false : true;

      let response: any = {
        chatId,
        sender: {
          _id: senderDetails?._id,
          userName: senderDetails?.userName,
          name: senderDetails?.name,
          profilePicture: senderDetails?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${senderDetails?.profilePicture}`),
          lastSeen: senderDetails?.lastSeen,
          bio: senderDetails?.bio,
          email: senderDetails?.email,
          isOnline: senderDetails?.isOnline,
          countryCode: senderDetails?.countryCode,
          countryISOCode: senderDetails?.countryISOCode,
          profilePrivacy: senderDetails?.profilePrivacy
        },
        content,
        type,
        fileUrls: preparedFileUrls.map((url) => url.replace(/^(\w+)-.*$/, `$1/${url}`)),
        createdAt: messageCreatedAt,
        messageId: tempMessageId,
        replyTo: repliedMessage ? {
          _id: repliedMessage._id,
          chatId: repliedMessage.chatId,
          content: repliedMessage.content,
          type: repliedMessage.type,
          sender: {
            ...repliedMessage.sender,
            nickName: (senderOfReplyMsg && senderOfReplyMsg[0]?.matchedNickname?.[0]?.nickName?.trim()) || undefined,
            isActiveNickname: (senderOfReplyMsg && senderOfReplyMsg[0]?.matchedNickname?.[0]?.isActiveNickname) || undefined
          },
          files: repliedMessage.files,
          fileIds: repliedMessage.fileIds,
          messageId: repliedMessage.messageId,
          disAppearingMessages: repliedMessage.disAppearingMessages,
          systemMessage: repliedMessage.systemMessage,
          createdAt: repliedMessage.createdAt,
        } : null,
        status: messageStatus,
        isRead: isRead,
      };

      let isDuplicateMessage = false;
      try {
        let mediaDetails: any[] = [];
        const saveResult = await saveMediaMessageAsync(
          chatId,
          sender.toString(),
          content,
          type,
          fileUrls,
          tempMessageId,
          deliveryStatus,
          isRead,
          messageStatus,
          mediaDetails,
          replyToMessageId,
          messageCreatedAt
        );
        isDuplicateMessage = saveResult?.isDuplicate ?? false;

        loggerMsg("Save in database successfully", "debug");

        if (callback) {
          callback({
            ...response,
            status: messageStatus,
            isRead: false,
            encryptedAESKey: chat.encryptedAESKey || "",
            resStatus: "success"
          });
        }
      } catch (error) {
        if (callback) {
          callback({
            resStatus: "failed"
          });
        }
        console.error("Error while saving message:", error);
        socket.emit("message_save_failed", { chatId, messageId: tempMessageId, error: "Failed to save message" });
      }

      if (!isDuplicateMessage && (chatType === ChatType.ONE_TO_ONE || chatType === ChatType.GROUP)) {
        loggerMsg("ChatType is ONE_TO_ONE & GROUP....", "debug");
        await Promise.all(
          (participants || []).map(async (participant) => {
            const receiverDetails = await userSchema.findById(participant).select("_id isStopNotification isMuteNotification nicknames");
            const isParticipant = await chatParticipantSchema.findOne({
              chatId,
              userId: participant,
              isRemoved: true
            });

            if (isParticipant) {
              const latestMessage = await messageSchema.findOne({ chatId }).sort({ createdAt: -1 }).select("_id");
              if (latestMessage) {
                await messageSchema.updateOne(
                  { _id: latestMessage._id },
                  { $addToSet: { deletedFor: isParticipant.userId } }
                );
              }
              return socket.emit("error_message", { message: null });
            }

            if (participant.toString() !== sender.toString()) {
              const isChatOpen = receiverOpenChat[participant.toString()]?.[chatId] ?? false;
              if (!isChatOpen) {
                await chatParticipantSchema.updateMany(
                  { chatId, userId: new mongoose.Types.ObjectId(participant.toString()) },
                  { $inc: { unreadCount: 1 } }
                );
              }

              deliveryStatus[participant.toString()] = "sent";
              const receiverSocketId = userSocketMap[participant.toString()];

              let receiver: any;
              if (participant.toString() !== sender.toString()) {
                receiver = await getNickNameDetails(participant.toString(), sender.toString());
              }

              if (receiverSocketId) {
                setTimeout(() => {
                  io.to(receiverSocketId).emit("receive_message", {
                    ...response,
                    sender: {
                      ...response.sender,
                      nickName: (receiver && receiver[0]?.matchedNickname?.[0]?.nickName?.trim()) || senderDetails?.name,
                      isActiveNickname: (receiver && receiver[0]?.matchedNickname?.[0]?.isActiveNickname) || false
                    },
                    status: messageStatus,
                    isRead: isRead,
                    encryptedAESKey: chat.encryptedAESKey || ""
                  });
                }, 200);
              }

              const receiverDeviceType = await deviceToken.findOne({ userId: new mongoose.Types.ObjectId(participant) }).select("deviceType");
              const descryptedMessage = descryptedContent(content, chat.encryptedAESKey);

              if (!receiverDetails?.isStopNotification) {
                if (is_conversation_mute.length === 0) {
                  const matched = receiver && receiver[0]?.matchedNickname?.[0];
                  const notificationPayload = {
                    title: (matched?.isActiveNickname ? matched?.nickName : senderDetails?.userName) || "New Message",
                    body: `${JSON.stringify(descryptedMessage).replace(/\\n/g, '\n')}` || "Plain Message!",
                    click_action: CLICK_NOTIFICATION_TYPE,
                    type: NotificationType.CHAT_MESSAGE,
                    chat_id: chatId,
                    sender: JSON.stringify(buildSenderPayload(senderDetails)),
                    temp_message_id: tempMessageId,
                    content,
                    groupInfo: JSON.stringify(buildGroupInfoPayload(chat)),
                    chatType: chatType === ChatType.ONE_TO_ONE ? ChatType.ONE_TO_ONE : ChatType.GROUP,
                    receiverId: participant.toString(),
                    senderId: sender.toString(),
                    encryptedAESKey: chat.encryptedAESKey,
                    deviceType: `${receiverDeviceType?.deviceType}`,
                    isMuteNotification: receiverDetails?.isMuteNotification
                  };

                  try {
                    await sentPushNotificationToUser(participant.toString(), notificationPayload);
                    loggerMsg(`Push notification sent successfully!`, "debug");
                  } catch (error) {
                    loggerMsg(`Failed to push notification to send_message: ${error instanceof Error ? error.message : error}`, "error");
                  }
                }
              }
            }
          })
        );
      } else if (!isDuplicateMessage && chatType === ChatType.CHANNEL) {
        loggerMsg("ChatType is CHANNEL....", "debug");
        await Promise.all(
          (participants || []).map(async (participant) => {
            const isParticipant = await chatParticipantSchema.findOne({
              chatId,
              userId: participant,
              isRemoved: true
            });

            if (isParticipant) {
              const latestMessage = await messageSchema.findOne({ chatId }).sort({ createdAt: -1 }).select("_id");
              if (latestMessage) {
                await messageSchema.updateOne(
                  { _id: latestMessage._id },
                  { $addToSet: { deletedFor: isParticipant.userId } }
                );
              }
              return socket.emit("error_message", { message: null });
            }

            if (participant.toString() !== sender.toString()) {
              const isChatOpen = receiverOpenChat[participant.toString()]?.[chatId] ?? false;
              if (!isChatOpen) {
                await chatParticipantSchema.updateMany(
                  { chatId, userId: new mongoose.Types.ObjectId(participant.toString()) },
                  { $inc: { unreadCount: 1 } }
                );
              }

              deliveryStatus[participant.toString()] = "sent";
              const receiverSocketId = userSocketMap[participant.toString()];

              if (receiverSocketId) {
                setTimeout(() => {
                  io.to(receiverSocketId).emit("receive_message", {
                    ...response,
                    status: "read",
                    isRead: true,
                    encryptedAESKey: chat.encryptedAESKey || ""
                  });
                }, 200);
              }

              const receiverDeviceType = await deviceToken.findOne({ userId: new mongoose.Types.ObjectId(participant) }).select("deviceType");
              const descryptedMessage = descryptedContent(content, chat.encryptedAESKey);
              const receiverDetails = await userSchema.findById(participant).select("isStopNotification isMuteNotification");

              if (!receiverDetails?.isStopNotification) {
                if (is_conversation_mute.length === 0) {
                  const notificationPayload = {
                    title: senderDetails?.userName || "New Message",
                    body: `${JSON.stringify(descryptedMessage).replace(/\\n/g, '\n')}` || "Plain Message!",
                    click_action: CLICK_NOTIFICATION_TYPE,
                    type: NotificationType.CHAT_MESSAGE,
                    chat_id: chatId,
                    sender: JSON.stringify(buildSenderPayload(senderDetails)),
                    temp_message_id: tempMessageId,
                    content,
                    groupInfo: JSON.stringify(buildGroupInfoPayload(chat)),
                    chatType: ChatType.CHANNEL,
                    receiverId: participant.toString(),
                    senderId: sender.toString(),
                    encryptedAESKey: chat.encryptedAESKey,
                    deviceType: `${receiverDeviceType?.deviceType}`,
                    isMuteNotification: receiverDetails?.isMuteNotification
                  };
                  await sentPushNotificationToUser(participant.toString(), notificationPayload);
                  loggerMsg(`Push notification sent successfully!`, "debug");
                }
              }
            }
          })
        );
      }
    } catch (error) {
      console.log("Error in send_message handler:", error);
      socket.emit("error_message", {
        status: 500,
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // Edit Message
  socket.on("editMessage", async ({ messageId, editedContent, chatId, userId }, callback) => {
    try {
      if (!chatId) {
        return socket.emit("error_message", { message: "Invalid message or chat ID." });
      }

      const chat = await chatSchema.findById(chatId);
      if (!chat) {
        return socket.emit("error_message", { message: "Chat not found." });
      }
      const participants = chat.participants;
      const message = await messageSchema.findOne({ messageId: messageId });
      if (!message) {
        return socket.emit("error_message", { message: "Message not found." });
      }

      if (message.sender.toString() !== userId) {
        return socket.emit("error_message", { message: "You can only edit your own messages." });
      }

      const messageTimestamp: any = new Date(message.createdAt);
      const currentTime: any = new Date();
      const timeDifference = (currentTime - messageTimestamp) / (1000 * 60 * 60);

      if (timeDifference > 24) {
        return socket.emit("error_message", { message: "You cannot edit messages after 24 hours." });
      }

      message.content = editedContent;
      message.isEditedMessage = true;
      await message.save();

      const senderDetails = await userSchema.findById(userId).select("userName name profilePicture lastSeen bio email isOnline countryCode countryISOCode");

      const response = {
        chatId,
        sender: {
          _id: senderDetails?._id,
          userName: senderDetails?.userName,
          name: senderDetails?.name,
          profilePicture: senderDetails?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${senderDetails?.profilePicture}`),
          lastSeen: senderDetails?.lastSeen,
          bio: senderDetails?.bio,
          email: senderDetails?.email,
          isOnline: senderDetails?.isOnline,
          countryCode: senderDetails?.countryCode,
          countryISOCode: senderDetails?.countryISOCode,
          profilePrivacy: senderDetails?.profilePrivacy,
        },
        content: editedContent,
        type: message.type,
        fileUrls: message.fileIds,
        createdAt: new Date().toISOString(),
        messageId: message.messageId,
        isEditedMessage: message.isEditedMessage,
        status: "read",
        isRead: true,
      };

      await Promise.all(
        (participants || []).map(async (participant) => {
          const receiverSocketId = userSocketMap[participant.toString()];
          let receiver: any;
          if (participant.toString() !== userId.toString()) {
            receiver = await getNickNameDetails(participant.toString(), userId.toString());
          }
          if (receiverSocketId) {
            loggerMsg(`receiverSocketId is online...!`, "debug");
            io.to(receiverSocketId).emit("receive_edit_message", {
              ...response,
              sender: {
                ...response.sender,
                nickName: (receiver && receiver[0]?.matchedNickname?.[0]?.nickName?.trim()) || senderDetails?.name,
                isActiveNickname: (receiver && receiver[0]?.matchedNickname?.[0]?.isActiveNickname) || false
              },
              status: "read",
              isRead: true,
              encryptedAESKey: chat.encryptedAESKey || ""
            });
          }
        })
      );
    } catch (error) {
      console.error("Error in editMessage:", error);
      return socket.emit("error_message", { message: "Edit message error." });
    }
  });

  // React Message
  socket.on("reactMessage", async ({ messageId, reactions, chatId, userId }, callback) => {
    try {
      if (!chatId || !messageId || !Array.isArray(reactions) || reactions.length === 0) {
        return socket.emit("error_message", { message: "Invalid input parameters." });
      }

      const chat = await chatSchema.findById(chatId);
      if (!chat) {
        return socket.emit("error_message", { message: "Chat not found." });
      }
      const participants = chat.participants;
      const message = await messageSchema.findOne({ messageId: messageId });
      if (!message) {
        return socket.emit("error_message", { message: "Message not found." });
      }

      interface Reaction {
        userId: mongoose.Types.ObjectId;
        emoji: string;
      }

      const existingReactions: Reaction[] = message.reactOnMessage || [];
      const updatedReactions: Reaction[] = [...existingReactions];

      for (const newReact of reactions) {
        if (typeof newReact !== "string") continue;

        const userReactIndex = updatedReactions.findIndex(
          (r: any) => r.userId.toString() === userId.toString()
        );

        if (userReactIndex !== -1) {
          updatedReactions[userReactIndex].emoji = newReact;
        } else {
          updatedReactions.push({ userId: new mongoose.Types.ObjectId(userId), emoji: newReact });
        }
      }
      message.reactOnMessage = updatedReactions;
      message.reactions = reactions;
      await message.save();

      const senderDetails = await userSchema.findById(userId).select("userName name profilePicture lastSeen bio email isOnline countryCode countryISOCode");

      const response = {
        chatId,
        sender: {
          _id: senderDetails?._id,
          userName: senderDetails?.userName,
          name: senderDetails?.name,
          profilePicture: senderDetails?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${senderDetails?.profilePicture}`),
          lastSeen: senderDetails?.lastSeen,
          bio: senderDetails?.bio,
          email: senderDetails?.email,
          isOnline: senderDetails?.isOnline,
          countryCode: senderDetails?.countryCode,
          countryISOCode: senderDetails?.countryISOCode,
          profilePrivacy: senderDetails?.profilePrivacy
        },
        content: message.content,
        reactOnMessage: updatedReactions.map(r => r.emoji) || [],
        reactions: reactions,
        type: message.type,
        fileUrls: message.fileIds,
        createdAt: new Date().toISOString(),
        messageId: message.messageId,
        status: "read",
        isRead: true,
      };

      await Promise.all(
        (participants || []).map(async (participant) => {
          const receiverSocketId = userSocketMap[participant.toString()];
          let receiver: any;
          if (participant.toString() !== userId.toString()) {
            receiver = await getNickNameDetails(participant.toString(), userId.toString());
          }
          if (receiverSocketId) {
            loggerMsg(`receiverSocketId is online...!`, "debug");
            io.to(receiverSocketId).emit("receive_react_message", {
              ...response,
              sender: {
                ...response.sender,
                nickName: (receiver && receiver[0]?.matchedNickname?.[0]?.nickName?.trim()) || senderDetails?.name,
                isActiveNickname: (receiver && receiver[0]?.matchedNickname?.[0]?.isActiveNickname) || false
              },
              status: "read",
              isRead: true,
              encryptedAESKey: chat.encryptedAESKey || ""
            });
          }
        })
      );

      const receiverDetails = await userSchema.findById(message.sender).select("isStopNotification isMuteNotification");
      const receiverDeviceType = await deviceToken.findOne({ userId: new mongoose.Types.ObjectId(message.sender.toString()) }).select("deviceType");
      if (!receiverDetails?.isStopNotification) {
        const notificationPayload = {
          title: senderDetails?.name || "New Message",
          body: `${senderDetails?.name} reacted with ${reactions[0]} to a message.` || "React Message!",
          click_action: CLICK_NOTIFICATION_TYPE,
          type: NotificationType.CHAT_MESSAGE,
          chat_id: chatId,
          sender: JSON.stringify(buildSenderPayload(senderDetails)),
          temp_message_id: messageId,
          content: JSON.stringify(reactions),
          groupInfo: JSON.stringify(buildGroupInfoPayload(chat)),
          chatType: chat.type === ChatType.ONE_TO_ONE ? ChatType.ONE_TO_ONE : ChatType.GROUP,
          receiverId: message.sender.toString(),
          senderId: userId.toString(),
          encryptedAESKey: chat.encryptedAESKey,
          deviceType: `${receiverDeviceType?.deviceType}`,
          isMuteNotification: receiverDetails?.isMuteNotification
        };
        try {
          await sentPushNotificationToUser(message.sender.toString(), notificationPayload);
          loggerMsg(`Push notification sent successfully!`, "debug");
        } catch (error) {
          loggerMsg(`Failed to push notification to send_message: ${error instanceof Error ? error.message : error}`, "error");
        }
      }
    } catch (error) {
      console.error("Error in reactMessage:", error);
      return socket.emit("error_message", { message: "React message error." });
    }
  });

  // Forward Message
  socket.on("forwardMessage", async (data, callback) => {
    try {
      const { content, mediaContent, sender, messageId, targetChatId, currentChatId } = data;

      const senderDetails = await userSchema.findById(sender);
      const originalMessage = await messageSchema.findOne({ messageId: messageId });
      if (!originalMessage) {
        return socket.emit("error_message", { message: "Message not found." });
      }

      const sourceChat = await chatSchema.findOne({ _id: originalMessage.chatId }).select("encryptedAESKey");
      if (!sourceChat || !sourceChat.encryptedAESKey) {
        return socket.emit("error_message", { message: "Source chat encryption key not found." });
      }

      const forwardedMessages = [];
      const conversation = await chatSchema.findOne({ _id: targetChatId }).select("_id participants encryptedAESKey");

      if (!conversation) {
        return socket.emit("error_message", { message: "Chat not found." });
      }

      const newMessageId = new mongoose.Types.ObjectId().toString();

      const newForwardedMessage = new messageSchema({
        chatId: targetChatId,
        sender,
        content: content,
        type: originalMessage.type,
        fileIds: originalMessage.fileIds,
        files: originalMessage.files,
        messageId: newMessageId,
        forwarded: true,
        originalMessageId: originalMessage.messageId
      });
      await newForwardedMessage.save();

      let mediaDetails: any[] = [];
      let fileUrls: any[] = [];

      if (originalMessage.files.length > 0) {
        fileUrls = originalMessage.files.map((file: any) => file.key);
        mediaDetails = originalMessage.files.map((file: any) => ({
          url: file.key,
          mimeType: file.mimetype,
          fileName: file.originalname,
          fileSize: file.size,
        }));
      }

      const mediaContentMessagId = new mongoose.Types.ObjectId().toString();
      if (mediaContent) {
        const newContentMessage = new messageSchema({
          chatId: targetChatId,
          sender,
          content: mediaContent,
          type: "text",
          fileIds: [],
          files: [],
          messageId: mediaContentMessagId,
          forwarded: false,
          originalMessageId: null
        });
        await newContentMessage.save();
        forwardedMessages.push(newContentMessage);
      }

      const response = {
        chatId: targetChatId,
        sender: {
          _id: senderDetails?._id,
          userName: senderDetails?.userName,
          name: senderDetails?.name,
          profilePicture: senderDetails?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${senderDetails?.profilePicture}`),
          lastSeen: senderDetails?.lastSeen,
          bio: senderDetails?.bio,
          email: senderDetails?.email,
          isOnline: senderDetails?.isOnline,
          countryCode: senderDetails?.countryCode,
          countryISOCode: senderDetails?.countryISOCode,
          profilePrivacy: senderDetails?.profilePrivacy
        },
        content,
        type: originalMessage.type,
        fileIds: [],
        fileUrls: fileUrls,
        files: mediaDetails,
        createdAt: new Date().toISOString(),
        messageId: newMessageId,
        status: "sent",
        isRead: false,
        forwarded: true
      };

      const mediaContentResponse = {
        chatId: targetChatId,
        sender: {
          _id: senderDetails?._id,
          userName: senderDetails?.userName,
          name: senderDetails?.name,
          profilePicture: senderDetails?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${senderDetails?.profilePicture}`),
          lastSeen: senderDetails?.lastSeen,
          bio: senderDetails?.bio,
          email: senderDetails?.email,
          isOnline: senderDetails?.isOnline,
          countryCode: senderDetails?.countryCode,
          countryISOCode: senderDetails?.countryISOCode,
          profilePrivacy: senderDetails?.profilePrivacy
        },
        content: mediaContent,
        type: 'text',
        fileIds: [],
        fileUrls: fileUrls,
        files: mediaDetails,
        createdAt: new Date().toISOString(),
        messageId: mediaContentMessagId,
        status: "sent",
        isRead: false,
        forwarded: false
      };

      for (const participant of conversation.participants) {
        const socketId = userSocketMap[participant.toString()];
        let receiver: any;
        if (participant.toString() !== sender.toString()) {
          receiver = await getNickNameDetails(participant.toString(), sender.toString());
        }
        if (socketId) {
          io.to(socketId).emit("receive_message", {
            ...response,
            sender: {
              ...response.sender,
              nickName: (receiver && receiver[0]?.matchedNickname?.[0]?.nickName?.trim()) || senderDetails?.name,
              isActiveNickname: (receiver && receiver[0]?.matchedNickname?.[0]?.isActiveNickname) || false
            },
            status: "read",
            isRead: true,
            encryptedAESKey: conversation.encryptedAESKey || ""
          });

          if (mediaContent) {
            io.to(socketId).emit("receive_message", {
              ...mediaContentResponse,
              sender: {
                ...mediaContentResponse.sender,
                nickName: (receiver && receiver[0]?.matchedNickname?.[0]?.nickName?.trim()) || senderDetails?.name,
                isActiveNickname: (receiver && receiver[0]?.matchedNickname?.[0]?.isActiveNickname) || false
              },
              status: "read",
              isRead: true,
              encryptedAESKey: conversation.encryptedAESKey || ""
            });
          }
        }
      }
    } catch (error) {
      return socket.emit("error_message", { message: "Error from forward message." });
    }
  });

  // Pin Message
  socket.on("pinMessage", async (data, callback) => {
    try {
      const { messageId, chatId } = data;

      const message = await messageSchema.findOne({ messageId, chatId });
      if (!message) {
        return socket.emit("error_message", { message: "Message not found." });
      }
      message.pinned = true;
      await message.save();

      const conversation = await chatSchema.findOne({ _id: chatId }).select("participants");

      for (const participant of conversation?.participants || []) {
        const socketId = userSocketMap[participant.toString()];
        if (socketId) {
          io.to(socketId).emit("messagePinned", { chatId, pinMessage: message });
        }
      }
    } catch (error) {
      return socket.emit("error_message", { message: "Error from pinMessage" });
    }
  });

  // Unpin Message
  socket.on("unpinMessage", async (data) => {
    try {
      const { messageId, chatId } = data;
      const message = await messageSchema.findOne({ messageId: messageId, chatId: chatId });
      if (!message) {
        return socket.emit("error_message", { message: "Message not found." });
      }
      message.pinned = false;
      await message.save();

      const conversation = await chatSchema.findOne({ _id: chatId }).select("participants");

      for (const participant of conversation?.participants || []) {
        const socketId = userSocketMap[participant.toString()];
        if (socketId) {
          io.to(socketId).emit("messageUnPinned", { chatId, pinMessage: message });
        }
      }
    } catch (error) {
      return socket.emit("error_message", { message: "Error message to unpinMessage" });
    }
  });

  // Mark Message as Read
  socket.on("mark_message_as_read", async (data: { chatId: string; userId: string, isChatOpen: boolean, lastMessageId: string }) => {
    try {
      const { chatId, userId, isChatOpen, lastMessageId } = data;

      if (!receiverOpenChat[userId]) {
        receiverOpenChat[userId] = {};
      }
      receiverOpenChat[userId][chatId] = isChatOpen;

      loggerMsg(`receiverOpenChat => \n${JSON.stringify(receiverOpenChat)}`, "debug");

      const chat = await chatSchema.findById(chatId);
      if (!chat) {
        socket.emit("error_message", {
          status: 404,
          code: "CHAT_NOT_FOUND",
          message: "Chat not found.",
        });
        return;
      }

      if (isChatOpen) {
        await chatParticipantSchema.updateOne(
          { chatId, userId: new mongoose.Types.ObjectId(userId) },
          { $set: { unreadCount: 0, markMessageAsUnread: false } }
        );
        loggerMsg(`Unread count reset for user ${userId} in chat ${chatId}`, "debug");
      }
      const senders = chat.participants?.filter((participant) => participant.toString() !== userId) || [];

      await messageSchema.updateMany(
        {
          chatId,
          messageId: { $lte: lastMessageId },
          sender: { $ne: userId }
        },
        {
          $set: { [`deliveryStatus.${userId}`]: "read", isRead: true, status: "read" }
        }
      );
      loggerMsg(`Updated deliveryStatus to 'read' for user ${userId} in messages before ${lastMessageId}`, "debug");

      await Promise.all(
        senders.map(async (sender: any) => {
          const senderSocketId = userSocketMap[sender._id.toString()];
          if (senderSocketId) {
            loggerMsg(`Notifying sender ${sender._id.toString()} (Socket ID: ${senderSocketId})`, "debug");
            io.to(senderSocketId).emit("message_status", {
              chatId,
              userId,
              status: "read",
              lastMessageId
            });
          }
        })
      );
    } catch (error) {
      console.error("Error in mark_message_as_read:", error);
      loggerMsg(`Error in mark_message_as_read: ${error}`, "debug");
    }
  });

  // Mark Message as Unread
  socket.on("mark_message_as_unread", async (data) => {
    const { chatId, userId } = data;
    try {
      await chatParticipantSchema.updateOne(
        { chatId, userId },
        {
          $set: {
            markMessageAsUnread: true
          }
        }
      );

      const socketId = userSocketMap[userId.toString()];
      if (socketId) {
        io.to(socketId).emit("markMessageUnread", { userId, chatId });
      }
    } catch (error) {
      console.error("Error in mark_message_as_unread:", error);
      loggerMsg(`Error in mark_message_as_unread: ${error}`, "debug");
    }
  });

  // Chat Closed
  socket.on("chatClosed", ({ userId, chatId }) => {
    if (receiverOpenChat[userId]) {
      delete receiverOpenChat[userId];
    }
  });

  // Unread Notification Count
  socket.on("unread-notification-count", async ({ userId }) => {
    try {
      const unreadCount = await notificationSchema.countDocuments({
        receiverId: userId,
        isRead: false
      });

      socket.emit("unread-notification-count-response", { unreadCount });
    } catch (error) {
      socket.emit("unread-notification-count-response", {
        status: 500,
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
        unreadCount: 0
      });
    }
  });
};
