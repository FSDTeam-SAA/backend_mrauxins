import { Socket, Server } from 'socket.io';
import mongoose from 'mongoose';
import savedmessagesSchema from '../../domain/schema/savedmessages.schema';
import chatSchema from '../../domain/schema/chat.schema';
import messageSchema from '../../domain/schema/message.schema';
import { loggerMsg } from '../../lib/logger';
import userSchema from '../../domain/schema/user.schema';
import { userSocketMap } from '../initDemoSocketHandlers';

export const registerSavedMessagesHandlers = (io: Server, socket: Socket) => {
  // Send saved messages
  socket.on("sendSavedMessages", async (data: { sender: string, messageId: string, content: string, type: string, replyToMessageId: string }) => {
    try {
      console.log("================> Send saved message.......", JSON.stringify(data));
      const { sender, messageId, content, type, replyToMessageId } = data;
      const tempMessageId = messageId || new mongoose.Types.ObjectId().toString();
      if (!sender || !tempMessageId || !content || !type) {
        socket.emit("error_message", {
          status: 404,
          code: "FIELD_ARE_REQUIRED",
          message: "some fields are missing.",
        });
        return;
      }

      let repliedMessage = null;
      if (replyToMessageId) {
        repliedMessage = await savedmessagesSchema.findOne({ messageId: replyToMessageId })
          .populate({
            path: "sender",
            select: "name userName profilePicture countryCode phone countryISOCode isOnline lastSeen email"
          });
      }

      const existingSavedMessage = await savedmessagesSchema.findOne({ sender: sender, messageId: tempMessageId.toString() });
      if (existingSavedMessage) {
        socket.emit("message_already_saved", {
          status: 404,
          code: "ALREADY_EXISTS",
          message: "Message is already saved.",
        });
        return;
      }

      const newSavedMessage = new savedmessagesSchema({
        messageId: tempMessageId.toString(),
        content: content !== null ? content : "",
        fileIds: [],
        files: [],
        userId: sender,
        sender: sender,
        savedAt: new Date(),
        replyTo: replyToMessageId
      });
      await newSavedMessage.save();

      const senderDetails = await userSchema.findById(sender).select("userName name profilePicture lastSeen bio email isOnline countryCode countryISOCode");

      const response = {
        _id: newSavedMessage._id,
        messageId: messageId,
        senderDetails: {
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
        },
        messageDetails: {
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
          messageId: tempMessageId,
          type: newSavedMessage.type,
          fileIds: [],
          files: [],
          content: newSavedMessage.content,
          replyTo: repliedMessage ? {
            _id: repliedMessage._id,
            chatId: repliedMessage.chatId,
            content: repliedMessage.content,
            type: repliedMessage.type,
            sender: repliedMessage.sender,
            files: repliedMessage.files,
            fileIds: repliedMessage.fileIds,
            messageId: repliedMessage.messageId,
          } : null,
          reactions: newSavedMessage.reactions,
          reactOnMessage: newSavedMessage.reactOnMessage.map(r => r.emoji) || [],
          pinned: newSavedMessage.pinned,
          isEditedMessage: newSavedMessage.isEditedMessage,
          createdAt: newSavedMessage.savedAt
        }
      };

      console.log("------------------------->response", JSON.stringify(response));

      const userSocketId = userSocketMap[sender.toString()];
      if (userSocketId) {
        io.to(userSocketId).emit("messageSaved", { messageId: tempMessageId, message: response });
      }
    } catch (error) {
      console.error("Error in savedMessages:", error);
      loggerMsg(`Error in savedMessages: ${error}`, "debug");
      socket.emit("error_message", {
        status: 500,
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      });
    }
  });

  // Edit saved message
  socket.on("edit_saved_message", async ({ messageId, editedContent, userId }, callback) => {
    try {
      const message = await savedmessagesSchema.findOne({ messageId: messageId });
      if (!message) {
        return socket.emit("error_message", { message: "Message not found." });
      }

      if (message.sender.toString() !== userId) {
        return socket.emit("error_message", { message: "You can only edit your own messages." });
      }

      const messageTimestamp: any = new Date(message.savedAt);
      const currentTime: any = new Date();
      const timeDifference = (currentTime - messageTimestamp) / (1000 * 60 * 60);

      if (timeDifference > 24) {
        return socket.emit("error_message", { message: "You cannot edit messages after 24 hours." });
      }

      message.content = editedContent;
      message.isEditedMessage = true;
      await message.save();

      const senderDetails = await userSchema.findById(userId).select("userName name profilePicture lastSeen bio email isOnline countryCode countryISOCode");

      let repliedMessage;
      if (message.replyTo) {
        repliedMessage = await savedmessagesSchema.findOne({ messageId: message.replyTo})
          .populate({
            path: "sender",
            select: "name userName profilePicture countryCode phone countryISOCode isOnline lastSeen email"
          });
      }

      const response = {
        _id: message._id,
        messageId: messageId,
        senderDetails: {
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
        messageDetails: {
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
          type: message.type,
          fileIds: [],
          files: [],
          content: message.content,
          replyTo: repliedMessage ? {
            _id: repliedMessage._id,
            chatId: repliedMessage.chatId,
            content: repliedMessage.content,
            type: repliedMessage.type,
            sender: repliedMessage.sender,
            files: repliedMessage.files,
            fileIds: repliedMessage.fileIds,
            messageId: repliedMessage.messageId,
          } : null,
          reactions: message.reactions,
          reactOnMessage: message.reactOnMessage.map(r => r.emoji) || [],
          pinned: message.pinned,
          isEditedMessage: message.isEditedMessage,
          createdAt: message.savedAt
        }
      };

      const socketId = userSocketMap[userId.toString()];
      if (socketId) {
        loggerMsg(`receiverSocketId is online...!`, "debug");
        io.to(socketId).emit("receive_saved_edit_message", {
          ...response,
          status: "read",
          isRead: true,
          encryptedAESKey: ""
        });
      }
    } catch (error) {
      console.error("Error in editMessage:", error);
      return socket.emit("error_message", { message: "Edit message error." });
    }
  });

  // React to saved message
  socket.on("react_saved_message", async ({ messageId, reactions, userId }, callback) => {
    try {
      const message = await savedmessagesSchema.findOne({ messageId: messageId });
      if (!message) {
        return socket.emit("error_message", { message: "Message not found." });
      }

      if (message.sender.toString() !== userId) {
        return socket.emit("error_message", { message: "You can only edit your own messages." });
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

      let repliedMessage;
      if (message.replyTo) {
        repliedMessage = await savedmessagesSchema.findOne({ messageId: message.replyTo })
          .populate({
            path: "sender",
            select: "name userName profilePicture countryCode phone countryISOCode isOnline lastSeen email"
          });
      }

      const response = {
        _id: message._id,
        messageId: messageId,
        senderDetails: {
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
        },
        messageDetails: {
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
          type: message.type,
          fileIds: [],
          files: [],
          content: message.content,
          replyTo: repliedMessage ? {
            _id: repliedMessage._id,
            chatId: repliedMessage.chatId,
            content: repliedMessage.content,
            type: repliedMessage.type,
            sender: repliedMessage.sender,
            files: repliedMessage.files,
            fileIds: repliedMessage.fileIds,
            messageId: repliedMessage.messageId,
          } : null,
          reactions: message.reactions,
          reactOnMessage: message.reactOnMessage.map(r => r.emoji) || [],
          pinned: message.pinned,
          isEditedMessage: message.isEditedMessage,
          createdAt: message.savedAt
        }
      };

      const socketId = userSocketMap[userId.toString()];
      if (socketId) {
        io.to(socketId).emit("react_saved_message", {
          ...response,
          status: "read",
          isRead: true,
          encryptedAESKey: ""
        });
      }
    } catch (error) {
      console.error("Error in editMessage:", error);
      return socket.emit("error_message", { message: "Edit message error." });
    }
  });

  // Pin saved message
  socket.on("pin_saved_message", async (data, callback) => {
    try {
      const { messageId, userId } = data;
      const message = await savedmessagesSchema.findOne({ messageId });
      if (!message) {
        return socket.emit("error_message", { message: "Message not found." });
      }
      message.pinned = true;
      await message.save();
      const senderDetails = await userSchema.findById(userId).select("userName name profilePicture lastSeen bio email isOnline countryCode countryISOCode");

      let repliedMessage;
      if (message.replyTo) {
        repliedMessage = await savedmessagesSchema.findOne({ messageId: message.replyTo })
          .populate({
            path: "sender",
            select: "name userName profilePicture countryCode phone countryISOCode isOnline lastSeen email"
          });
      }

      const response = {
        _id: message._id,
        messageId: messageId,
        senderDetails: {
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
        },
        messageDetails: {
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
          type: message.type,
          fileIds: [],
          files: [],
          content: message.content,
          replyTo: repliedMessage ? {
            _id: repliedMessage._id,
            chatId: repliedMessage.chatId,
            content: repliedMessage.content,
            type: repliedMessage.type,
            sender: repliedMessage.sender,
            files: repliedMessage.files,
            fileIds: repliedMessage.fileIds,
            messageId: repliedMessage.messageId,
          } : null,
          reactions: message.reactions,
          reactOnMessage: message.reactOnMessage.map(r => r.emoji) || [],
          pinned: message.pinned,
          isEditedMessage: message.isEditedMessage,
          createdAt: message.savedAt
        }
      };
      const socketId = userSocketMap[userId.toString()];
      if (socketId) {
        io.to(socketId).emit("saved_message_pinned", { pinMessage: response });
      }
    } catch (error) {
      return socket.emit("error_message", { message: "Error from pinMessage" });
    }
  });

  // Unpin saved message
  socket.on("saved_message_unpin", async (data) => {
    try {
      const { messageId, userId } = data;
      const message = await savedmessagesSchema.findOne({ messageId: messageId });
      if (!message) {
        return socket.emit("error_message", { message: "Message not found." });
      }
      message.pinned = false;
      await message.save();

      const senderDetails = await userSchema.findById(userId).select("userName name profilePicture lastSeen bio email isOnline countryCode countryISOCode");

      let repliedMessage;
      if (message.replyTo) {
        repliedMessage = await savedmessagesSchema.findOne({ messageId: message.replyTo })
          .populate({
            path: "sender",
            select: "name userName profilePicture countryCode phone countryISOCode isOnline lastSeen email"
          });
      }

      const response = {
        _id: message._id,
        messageId: messageId,
        senderDetails: {
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
        },
        messageDetails: {
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
          type: message.type,
          fileIds: [],
          files: [],
          content: message.content,
          replyTo: repliedMessage ? {
            _id: repliedMessage._id,
            chatId: repliedMessage.chatId,
            content: repliedMessage.content,
            type: repliedMessage.type,
            sender: repliedMessage.sender,
            files: repliedMessage.files,
            fileIds: repliedMessage.fileIds,
            messageId: repliedMessage.messageId,
          } : null,
          reactions: message.reactions,
          reactOnMessage: message.reactOnMessage.map(r => r.emoji) || [],
          pinned: message.pinned,
          isEditedMessage: message.isEditedMessage,
          createdAt: message.savedAt
        }
      };
      const socketId = userSocketMap[userId.toString()];
      if (socketId) {
        io.to(socketId).emit("saved_message_unpin", { pinMessage: response });
      }
    } catch (error) {
      return socket.emit("error_message", { message: "Error message to unpinMessage" });
    }
  });

  // Saved forward message
  socket.on("saved_forward_message", async (data, callback) => {
    try {
      const { content, mediaContent, sender, messageId, targetChatId, currentChatId } = data;

      const senderDetails = await userSchema.findById(sender);
      const originalMessage = await savedmessagesSchema.findOne({ messageId: messageId });
      if (!originalMessage) {
        return socket.emit("error_message", { message: "Message not found." });
      }

      const forwardedMessages = [];
      const conversation = await chatSchema.findOne({ _id: targetChatId }).select("participants encryptedAESKey");

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

      if (mediaContent) {
        const newContentMessage = new messageSchema({
          chatId: targetChatId,
          sender,
          content: mediaContent,
          type: "text",
          fileIds: [],
          files: [],
          messageId: new mongoose.Types.ObjectId().toString(),
          forwarded: false,
          originalMessageId: null
        });
        await newContentMessage.save();
        forwardedMessages.push(newContentMessage);
      }

      const response = {
        targetChatId,
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
        fileIds: [],
        fileUrls: [],
        createdAt: new Date().toISOString(),
        messageId: messageId || new mongoose.Types.ObjectId().toString(),
        status: "sent",
        isRead: false,
      };

      for (const participant of conversation.participants) {
        const socketId = userSocketMap[participant.toString()];
        if (socketId) {
          io.to(socketId).emit("receive_message", {
            ...response,
            status: "read",
            isRead: true,
            encryptedAESKey: conversation.encryptedAESKey || ""
          });
        }
      }
    } catch (error) {
      return socket.emit("error_message", { message: "Error from forward message." });
    }
  });
};
