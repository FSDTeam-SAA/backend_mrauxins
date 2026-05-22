import { Socket, Server } from 'socket.io';
import mongoose from 'mongoose';
import chatSchema, { ChatType } from '../../domain/schema/chat.schema';
import userSchema from '../../domain/schema/user.schema';
import messageSchema from '../../domain/schema/message.schema';
import chatParticipantSchema from '../../domain/schema/chat.participant.schema';
import { userSocketMap } from '../initDemoSocketHandlers';

export const registerSettingsHandlers = (io: Server, socket: Socket) => {
  // Update disappearing messages auto-delete time
  socket.on("updateMessageAutoDeleteTime", async ({ userId, chatId, messageAutoDeleteTime, messageId }, callback) => {
    try {
      const chat = await chatSchema.findOne({ _id: chatId });
      if (!chat) {
        return socket.emit("error_message", { message: "Chat not found" });
      }

      const { type: chatType, admins, participants } = chat;

      if (chatType === ChatType.CHANNEL && !admins?.includes(userId)) {
        return socket.emit("error_message", { message: "Only admins can update disappearing messages in groups or channels." });
      }

      chat.messageAutoDeleteTime = messageAutoDeleteTime > 0 ? Number(messageAutoDeleteTime) : null;
      chat.messageAutoDeleteStartTime = messageAutoDeleteTime > 0 ? new Date() : null;
      await chat.save();

      const senderDetails = await userSchema.findById(userId).select("userName name profilePicture");
      const tempMessageId = messageId || new mongoose.Types.ObjectId().toString();

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
        content: null,
        type: "disappearing_messages",
        createdAt: new Date().toISOString(),
        messageId: tempMessageId,
        status: "sent",
        isRead: false,
        disAppearingMessages: messageAutoDeleteTime
      };

      for (const participant of participants) {
        const receiverSocketId = userSocketMap[participant.toString()];
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("receive_message", {
            ...response,
            status: "read",
            isRead: true,
            encryptedAESKey: ""
          });
        }
      }

      const newMessage = new messageSchema({
        chatId,
        sender: userId,
        content: null,
        type: "disappearing_messages",
        status: "read",
        isRead: true,
        messageId: tempMessageId,
        disAppearingMessages: messageAutoDeleteTime
      });

      await newMessage.save();

      if (callback) callback({ success: true, message: "Disappearing messages updated successfully" });
    } catch (error) {
      console.error("Error in updateMessageAutoDeleteTime:", error);
      return socket.emit("error_message", { message: "Error from updateMessageAutoDeleteTime" });
    }
  });

  // Pin/Unpin conversation
  socket.on("pinUnpinConversation", async (data) => {
    const { userId, chatId, isPin } = data;
    try {
      if (isPin) {
        await chatParticipantSchema.updateOne(
          { userId, chatId },
          {
            $set: {
              isPinned: true,
              pinnedAt: new Date()
            }
          }
        );
      } else {
        await chatParticipantSchema.updateOne(
          { userId, chatId },
          {
            $set: {
              isPinned: false,
              pinnedAt: null
            }
          }
        );
      }

      const socketId = userSocketMap[userId.toString()];
      if (socketId) {
        io.to(socketId).emit("pinConvesation", { userId, chatId, isPin });
      }
    } catch (error) {
      console.error("Error in pinConversation:", error);
      return socket.emit("error_message", { message: "Error from pinConversation" });
    }
  });

  // Mute/Unmute conversation
  socket.on("muteUnmuteConversation", async (data) => {
    const { chatId, userId, isMuted } = data;
    try {
      if (isMuted) {
        await chatParticipantSchema.updateOne(
          { chatId, userId },
          {
            $set: {
              isNotificationMute: true
            }
          }
        );
      } else {
        await chatParticipantSchema.updateOne(
          { chatId, userId },
          {
            $set: {
              isNotificationMute: false
            }
          }
        );
      }

      const socketId = userSocketMap[userId.toString()];
      if (socketId) {
        io.to(socketId).emit("muteConvesation", { userId, chatId, isMuted });
      }
    } catch (error) {
      console.error("Error in muteUnmute Conversations:", error);
      return socket.emit("error_message", { message: "Error in muteUnmute Conversations:" });
    }
  });

  // Archive Chat
  socket.on("archiveChat", async (data) => {
    try {
      const { userId, chatId } = data;
      const participant = await chatParticipantSchema.findOneAndUpdate(
        { userId, chatId },
        { isArchived: true },
        { new: true }
      );

      if (!participant) {
        return socket.emit("error_message", { message: "Chat not found." });
      }

      const socketId = userSocketMap[userId.toString()];
      if (socketId) {
        io.to(socketId).emit("chatArchived", { chatId });
      }
    } catch (error) {
      return socket.emit("error_message", { message: "Error message to archiveChat." });
    }
  });

  // Unarchive Chat
  socket.on("unarchiveChat", async (data) => {
    try {
      const { userId, chatId } = data;
      const participant = await chatParticipantSchema.findOneAndUpdate(
        { userId, chatId },
        { isArchived: false },
        { new: true }
      );

      if (!participant) {
        return socket.emit("error_message", { message: "Chat not found." });
      }
      const socketId = userSocketMap[userId];
      io.to(socketId).emit("chatUnarchived", { chatId });
    } catch (error) {
      return socket.emit("error_message", { message: "Error from unarchiveChat." });
    }
  });
};
