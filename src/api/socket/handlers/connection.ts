import { Socket, Server } from 'socket.io';
import mongoose from 'mongoose';
import { loggerMsg } from '../../lib/logger';
import userSchema from '../../domain/schema/user.schema';
import chatSchema, { ChatType } from '../../domain/schema/chat.schema';
import chatParticipantSchema from '../../domain/schema/chat.participant.schema';
import { userSocketMap, userOnlineStatusMap } from '../initDemoSocketHandlers';

export const registerConnectionHandlers = (io: Server, socket: Socket) => {
  // Join chat room
  socket.on('joinChat', (data) => {
    loggerMsg(`joinChat....\n${JSON.stringify(data)}`, "debug");
    const { userId } = data;
    socket.join(userId);
    userSocketMap[userId] = socket.id;
    socket.emit('joinChat', { userId });
    console.log(`User ${userId} logged in with socket ID ${socket.id}`);
    loggerMsg(`Connected Socket User => \n${JSON.stringify(userSocketMap)}`, "debug");
  });

  // User online status updates
  socket.on("user-online-status", async (data: { userId: string; isOnline: boolean }) => {
    try {
      loggerMsg("user-online-status event call", "debug");
      const { userId, isOnline } = data;
      if (isOnline) {
        const now = new Date();
        loggerMsg("user is online", "debug");
        socket.broadcast.emit("user-online-success", { userOnline: "user_online_success_online", userId, isOnline, lastSeen: null, lastOnline: now });
        userOnlineStatusMap[userId] = true;

        await userSchema.updateOne(
          { _id: new mongoose.Types.ObjectId(userId) },
          { $set: { isOnline: true, lastSeen: null, lastOnline: now } }
        );
        loggerMsg("User online status updated successfully", "debug");
      } else {
        loggerMsg("User is offline", "debug");
        const lastSeen = new Date();
        socket.broadcast.emit("user-online-success", { userOnline: "user_online_status_offline", userId, isOnline, lastSeen, lastOnline: lastSeen });
        userOnlineStatusMap[userId] = false;

        await userSchema.updateOne(
          { _id: new mongoose.Types.ObjectId(userId) },
          { $set: { lastSeen, isOnline: false, lastOnline: lastSeen } }
        );
        loggerMsg("User last seen updated successfully", "debug");
      }
    } catch (error) {
      console.error("Error in user-online-status handler:", error);
    }
  });

  // Typing start/stop event
  socket.on("typing", async ({ chatType, chatId, sender, isTyping }) => {
    try {
      const chat = await chatSchema.findById(chatId);
      if (!chat || !chat.participants) {
        socket.emit("typing-error", { message: "Chat not found" });
        return;
      }

      const activeParticipants = await chatParticipantSchema.find({
        chatId,
        userId: { $ne: sender._id },
        isRemoved: false,
      }).select("userId");
      
      if (chatType === ChatType.ONE_TO_ONE) {
        const recipient = activeParticipants.find(p => p.userId.toString() !== sender._id);
        if (recipient) {
          const recipientSocketId = userSocketMap[recipient.userId.toString()];
          if (recipientSocketId) {
            socket.to(recipientSocketId).emit("typing_status", { chatType, chatId, sender, isTyping });
          }
        }
      } else if (chatType === ChatType.GROUP || chatType === ChatType.CHANNEL) {
        activeParticipants.forEach(participant => {
          const participantSocketId = userSocketMap[participant.userId.toString()];
          if (participantSocketId) {
            socket.to(participantSocketId).emit("typing_status", { chatType, chatId, sender, isTyping });
          }
        });
      }
    } catch (error) {
      console.error("Error in typing event:", error);
      socket.emit("typing-error", { message: "An error occurred" });
    }
  });

  // Logout event
  socket.on("logout", async (data) => {
    const { userId } = data;
    try {
      delete userSocketMap[userId.toString()];
      const lastSeen = new Date();
      socket.broadcast.emit("user-online-success", { userOnline: "typing", userId, isOnline: false, lastSeen, lastOnline: lastSeen });
      userOnlineStatusMap[userId] = false;

      await userSchema.updateOne(
        { _id: userId },
        { $set: { lastSeen, isOnline: false, lastOnline: lastSeen } }
      );
    } catch (error) {
      console.error("Error in logout event:", error);
      socket.emit("logout-error", { message: "An error occurred" });
    }
  });

  // Set user is online
  socket.on("set_user_is_online", async (data) => {
    try {
      const now = new Date();
      const { userId } = data;
      const user = await userSchema.findById(userId).select('isOnline');
      await userSchema.updateOne(
        { _id: userId, isDeleted: false },
        { lastOnline: now, isOnline: true, lastSeen: null }
      );
      if (!user?.isOnline) {
        socket.broadcast.emit("user-online-success", { userOnline: "set_user_is_online", userId, lastOnline: now, isOnline: true, lastSeen: null });
      }
    } catch (error) {
      console.error("Error in set_user_is_online event:", error);
      socket.emit("set_user_is_online_error", { message: "An error occurred" });
    }
  });

  // Disconnect event
  socket.on("disconnect", (reason) => {
    for (const userId in userSocketMap) {
      if (userSocketMap[userId] === socket.id) {
        delete userSocketMap[userId];
      }
    }
  });
};
