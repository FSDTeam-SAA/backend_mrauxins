import { Socket, Server } from 'socket.io';
import mongoose from 'mongoose';
import { callHistory, CallStatus, CallType } from '../../domain/schema/callhistory.schema';
import { loggerMsg } from '../../lib/logger';
import { sentPushNotificationToUser } from '../../domain/models/device.token.model';
import { CLICK_NOTIFICATION_TYPE, NotificationType } from '../../domain/schema/notification.schema';
import { userSocketMap } from '../initDemoSocketHandlers';

const activeCalls = new Map(); // Stores ongoing calls with user participation

export const registerCallHandlers = (io: Server, socket: Socket) => {
  // Join call
  socket.on("join-call", async ({ callId, userId }) => {
    try {
      const call = await callHistory.findOne({ callId });
      if (!call) {
        return socket.emit("error_message", { message: "Call not found" });
      }

      const participant = call.participants.find((p) => p.userId.toString() === userId);
      if (!participant) {
        return socket.emit("error_message", { message: "User not in call participants" });
      }

      if (participant.status === "joined") {
        return socket.emit("error_message", { message: "You have already joined the call" });
      }

      await callHistory.updateOne(
        { callId, "participants.userId": userId },
        { 
          $set: { 
            "participants.$.status": "joined", 
            "participants.$.joinTime": new Date(), 
            callStatus: "ongoing"
          }
        }
      );

      socket.join(callId);
      activeCalls.set(userId, callId);

      io.to(callId).emit("userJoined", { userId });
    } catch (error: any) {
      loggerMsg(`Error in join-call event: ${error}`, "debug");
      socket.emit("error_message", { message: error.message });
    }
  });

  // Leave call
  socket.on("leave-call", async ({ callId, userId }) => {
    try {
      const call = await callHistory.findOne({ callId });
      if (!call) {
        return socket.emit("error_message", { message: "Call not found" });
      }

      const participant = call.participants.find((p) => p.userId.toString() === userId);
      if (!participant) {
        return socket.emit("error_message", { message: "User not in call participants" });
      }

      if (participant.status !== "joined") {
        return socket.emit("error_message", { message: "You are not in an active call" });
      }

      await callHistory.updateOne(
        { callId, "participants.userId": userId },
        { 
          $set: { 
            "participants.$.status": "left", 
            "participants.$.leaveTime": new Date() 
          } 
        }
      );

      socket.leave(callId);

      const activeParticipants = call.participants.filter(p => p.status === "joined");

      if (activeParticipants.length === 1) {
        const remainingUserId = activeParticipants[0].userId.toString();

        await callHistory.updateOne(
          { callId },
          {
            $set: { 
              isEnded: true, 
              endTime: new Date(), 
              callStatus: "ended",
              endedBy: userId
            }
          }
        );

        io.to(remainingUserId).emit("call-ended", { 
          message: "Last participant left. Call ended.", 
          status: "completed" 
        });

        return;
      }

      io.to(callId).emit("userLeft", { userId });
    } catch (error: any) {
      loggerMsg(`Error in leave-call event: ${error}`, "debug");
      socket.emit("error_message", { message: error.message });
    }
  });

  // End call
  socket.on("end-call", async ({ user_id, callId, duration }) => {
    try {
      console.log("++++++++++++++++++++ END_CALL EVENT ++++++++++++++++++++++++++++++++");
      const call = await callHistory.findOne({ callId });

      if (!call) {
        return socket.emit("error_message", { message: "Call not found" });
      }

      const isGroupCall = call.participants.length > 2;

      if (!isGroupCall) {
        const user = call.participants.find(p => p.userId.toString() === user_id);
        if (user) {
          await callHistory.updateOne(
            { callId, "participants.userId": new mongoose.Types.ObjectId(user_id) },
            {
              $set: {
                "participants.$.status": "ended", 
                "participants.$.totalDuration": duration
              }
            }
          );
          const otherUser = call.participants.find(p => p.userId.toString() !== user_id);
          if (otherUser) {
            io.to(otherUser.userId.toString()).emit("call-ended", { user_id, duration, status: "missed" });

            const notificationPayload = {
              title: `Call End.`,
              body: `Call ended.`,
              click_action: CLICK_NOTIFICATION_TYPE,
              type: NotificationType.AGORA_END_CALL,
              isMuteNotification: false
            };

            await sentPushNotificationToUser(otherUser.userId.toString(), notificationPayload);
          }
        }
      }

      if (isGroupCall) {
        const participants = call.participants;
        const joinedUsers = participants.filter(p => p.status === "joined");
        const missedUsers = participants.filter(p => p.status === "missed");
        const missedAndJoinedUser = participants.filter(p => p.status !== "left");

        const notificationPayload = {
          title: `Call End.`,
          body: `Call ended.`,
          click_action: CLICK_NOTIFICATION_TYPE,
          type: NotificationType.AGORA_END_CALL,
          isMuteNotification: false
        };

        const sendNotifications = async (users: any) => {
          await Promise.all(
            users.map(async (c: any) => {
              const targetId = c?.userId?.toString();
              if (targetId && targetId !== user_id) {
                const socketId = userSocketMap[targetId];
                if (socketId) {
                  io.to(socketId).emit("call-ended", {
                    user_id,
                    duration: 0,
                    status: c.status === "joined" ? "completed" : "missed"
                  });
                }
                console.log("Sending notification to:", targetId);
                await sentPushNotificationToUser(targetId, notificationPayload);
              }
            })
          );
        };

        const rejectcall = missedUsers.some(u => u.userId.toString() === user_id);
        if (rejectcall && duration === 0) {
          await callHistory.updateOne(
            { callId },
            {
              $set: {
                "participants.$[elem].status": "left",
                "participants.$[elem].totalDuration": duration
              }
            },
            { arrayFilters: [{ "elem.userId": new mongoose.Types.ObjectId(user_id) }] }
          );

          const updatedCallDoc = await callHistory.findOne({ callId });
          if (!updatedCallDoc) return;
          const joinedUsersCount = updatedCallDoc.participants.filter(p => p.status === "joined");
          const missedUsersCount = updatedCallDoc.participants.filter(p => p.status === "missed");

          const total = joinedUsersCount.length + missedUsersCount.length;
          if (total <= 1) {
            call.participants.forEach(p => { p.status = "ended"; });
            await call.save();
            const socketId = userSocketMap[joinedUsersCount[0].userId.toString()];
            if (socketId) {
              io.to(socketId).emit("call-ended", {
                user_id,
                duration: 0,
                status: "ended"
              });
            }
          }
          return;
        }

        if (joinedUsers.length === 1 && missedUsers.length > 0) {
          participants.forEach(p => { p.status = "ended"; });
          await call.save();
          await sendNotifications(missedAndJoinedUser);
        } else if (joinedUsers.length === 2) {
          participants.forEach(p => { p.status = "ended"; });
          await call.save();
          await sendNotifications(missedAndJoinedUser);
        } else {
          if (joinedUsers.length > 2) {
            if (joinedUsers.length - 1 <= 1) {
              participants.forEach(p => { p.status = "ended"; });
              await call.save();
              await sendNotifications(missedAndJoinedUser);
            } else {
              await callHistory.updateOne(
                { callId },
                {
                  $set: {
                    "participants.$[elem].status": "left",
                    "participants.$[elem].totalDuration": duration
                  }
                },
                { arrayFilters: [{ "elem.userId": new mongoose.Types.ObjectId(user_id) }] }
              );
            }
          }
        }
      }

      const updateFields = { 
        isEnded: true, 
        endTime: new Date(), 
        callStatus: duration === 0 ? CallStatus.MISSED : CallStatus.ENDED,
        endedBy: user_id
      };

      if (call.callType === CallType.VIDEO || call.callType === CallType.VOICE) {
        // @ts-ignore
        updateFields.duration = duration;
      }

      await callHistory.findOneAndUpdate(
        { callId },
        { $set: updateFields },
        { new: true }
      );
    } catch (error: any) {
      loggerMsg(`Error in end-call event: ${error}`, "debug");
      socket.emit("error_message", { message: error.message });
    }
  });

  // Toggle audio
  socket.on("toggle-audio", ({ channelName, userId, isMuted }) => {
    const targetSocketId = userSocketMap[userId];
    if (!targetSocketId) {
      console.error(`No socket found for user ${userId}`);
      return;
    }
    const room = channelName || targetSocketId;
    socket.to(room).emit("audio-toggled", { userId, isMuted });
  });

  // Join group call
  socket.on("join-group-call", ({ channelName, userId }) => {
    socket.join(channelName);
    socket.to(channelName).emit("user-joined", { userId });
  });

  // Leave group call
  socket.on("leave-group-call", ({ channelName, userId }) => {
    socket.leave(channelName);
    socket.to(channelName).emit("user-left", { userId });
  });

  // Toggle audio in group
  socket.on("toggle-audio-group", ({ channelName, userId, isMuted }) => {
    if (!channelName) {
      console.error("Channel name is required for group audio toggling.");
      return;
    }
    socket.to(channelName).emit("audio-toggled-group", { userId, isMuted });
  });

  // Toggle video in group
  socket.on("toggle-video-group", ({ channelName, userId, isVideoEnabled }) => {
    if (!channelName) {
      console.error("Channel name is required for group video toggling.");
      return;
    }
    socket.to(channelName).emit("video-toggled-group", { userId, isVideoEnabled });
  });
};
