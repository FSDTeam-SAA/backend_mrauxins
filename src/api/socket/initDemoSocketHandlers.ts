import { Server, Socket } from 'socket.io';
import mongoose from 'mongoose';
import messageSchema, { IDeliveryStatus } from '../domain/schema/message.schema';
import chatSchema, { ChatType } from '../domain/schema/chat.schema';
import { loggerMsg } from '../lib/logger';
import { fileSchema } from '../domain/schema/file.schema';
import userSchema from '../domain/schema/user.schema';
import { callAccepted, callEnded, initiateCall, rejectCall } from '../domain/models/callhistory.model';
import { decryptMessage, decryptMessage_1, descryptedContent, encryptMessage_1, generateAgoraToken } from '../helper/helper';
import { env } from 'process';
// import { User } from '../domain/schema/user.schema';
import {v4 as uuidv4} from "uuid"
import { sentPushNotificationToUser } from '../domain/models/device.token.model';
import { savedMessageOneToOne } from '../domain/models/messages.model';
import { createNewStoryLogic, createNewStoryLogicNew } from '../domain/models/stories.model';
import { join } from 'path';
import savedmessagesSchema from '../domain/schema/savedmessages.schema';
import { callHistory, CallStatus, CallType } from '../domain/schema/callhistory.schema';
import notificationSchema, { CLICK_NOTIFICATION_TYPE, NotificationType } from '../domain/schema/notification.schema';
import { deviceToken } from '../domain/schema/devicetoken.schema';
import chatParticipantSchema from '../domain/schema/chat.participant.schema';
import { saveMediaMessageAsync } from '../domain/models/chat.model';


interface UserSocketMap {
  [userId: string]: string;
}

interface UserOnlineStatusMap {
  [userId: string]: boolean
}
interface UserIsInCall {
  [userId: string]: boolean
}
interface ReceiverOpenChatMap {
  [userId: string]: {
    [chatId: string]: boolean;
  }
}
export const userSocketMap: UserSocketMap = {};
export const userOnlineStatusMap: UserOnlineStatusMap = {}
export const userSocketInCall: UserIsInCall = {}
export const receiverOpenChat: ReceiverOpenChatMap = {}

const activeCalls = new Map() // Stores ongoing calls with user participation

export async function getNickNameDetails(participantId:string, senderId:string){
  const receiver = await userSchema.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(participantId) } },
    { $project: {
        _id: 1,
        matchedNickname: {
          $filter: {
            input: "$nicknames",
            as: "nickname",
            cond: {
              $and: [
                { $eq: ["$$nickname.contactUserId", new mongoose.Types.ObjectId(senderId)] },
                // { $eq: ["$$nickname.isActiveNickname", true] }
              ]
            }
          }
        }
      }
    }
  ]);
  return receiver;
}

export const initDemoSocketHandlers = (io:Server) => {
  io.on("connection", (socket) => {
  
  console.log(`New User Connected: ${socket.id}`)
  loggerMsg("connection done...","info")
  // Join chat room
  socket.on('joinChat', (data) => {
    loggerMsg(`joinChat....\n${JSON.stringify(data)}`,"debug")
    const {userId} = data
    socket.join(userId);
    userSocketMap[userId] = socket.id;
    socket.emit('joinChat',{userId});
    // socket.broadcast.emit('user-online',{userId});
    console.log(`User ${userId} logged in with socket ID ${socket.id}`);
    loggerMsg(`Conntected Socket User => \n${JSON.stringify(userSocketMap)}`,"debug")
  });

interface SendMessageData {
    chatId: string;
    content: string;
    type: string;
    sender: mongoose.Types.ObjectId;
    isGroup:boolean;
    fileUrls?: string[];
    files?: Express.Multer.File[];
    messageId?:string;
    replyToMessageId?:string;
    createdAt?: string;
    senderIdOfReplyMsg?:string 

}
// When the receiver comes online, send their unread message count.
socket.on("user-online-status", async (data: { userId: string; isOnline: boolean }) => {
  try {
    loggerMsg("user-online-status event call", "debug");

    const { userId, isOnline } = data;
    if(isOnline){
      const now = new Date();
      loggerMsg("user is online","debug")
      socket.broadcast.emit("user-online-success", { userOnline: "user_online_success_online",userId, isOnline, lastSeen: null, lastOnline: now });
      userOnlineStatusMap[userId] = true;

      // Update only the isOnline status in the database
      await userSchema.updateOne(
        { _id: new mongoose.Types.ObjectId(userId) },
        { $set: { isOnline: true, lastSeen: null, lastOnline: now } }
      );
      loggerMsg("User online status updated successfully", "debug");
    } else {

      loggerMsg("User is offline", "debug");

      // delete userSocketMap[userId.toString()]; // Ensure user is removed from socket map

      const lastSeen = new Date();

      socket.broadcast.emit("user-online-success", { userOnline: "user_online_status_offline",userId, isOnline, lastSeen , lastOnline: lastSeen});

      userOnlineStatusMap[userId] = false;

      // Update lastSeen only when the user goes offline
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
// working send_message code 01-07-2025
/*
socket.on("send_message", async (data: SendMessageData) => {
  loggerMsg("call event of send_message", "debug");
  const { chatId, content, type, sender, fileUrls = [], files = [], messageId, replyToMessageId } = data;

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
      if(chat.isFirstMessage === 0){
        await chatSchema.findByIdAndUpdate(chat._id,{$set:{isFirstMessage:1} } )
      }
      const removedUser = await chatParticipantSchema.findOne({userId:sender, chatId, isRemoved: true}).select("isRemoved");
      if(removedUser){
        return socket.emit("error_message",{message: "You can't send message because you are no longer a member of the group."})
      }

      const isRemoveUserList = await chatParticipantSchema.find({chatId})
      await Promise.all((isRemoveUserList.map(async (data) => {
        if(data.isRemoved === false){
          await chatParticipantSchema.updateMany(
            { chatId, userId: data.userId }, // Exclude the current user
            { $set: { lastClearedMessageId: null } }
          )
        }
      })))

    await Promise.all(isRemoveUserList.map(async(data) => {
      if(data.isDeleted){
        await chatParticipantSchema.updateMany({chatId, isDeleted: true}, {$set: {isDeleted: false, lastClearedMessageId: null} } )
      }
    }))

      
      loggerMsg(`Chat is found:=>\n${JSON.stringify(chat)}`,"debug")
      // Determine chat type
      const { type: chatType, participants, admins, groupName } = chat;

      let repliedMessage = null;
      if(replyToMessageId){
          repliedMessage = await messageSchema.findOne({messageId: replyToMessageId})
          .populate({
              path: "sender",
              select: "name userName profilePicture countryCode phone countryISOCode isOnline lastSeen email"
          });
      }

      // Check if sender is allowed to send messages
      if (chatType === ChatType.CHANNEL) {
          // const senderRole = participants?.find((p:any) => p._id.toString() === sender.toString())?.role;
          if (chat.createdBy.toString() !== sender.toString()) {
            loggerMsg("Only admins can send messages in this channel.","debug")
              socket.emit("error_message", {
                  status: 400,
                  code: "FORBIDDEN",
                  message: "Only admins can send messages in this channel.",
              });
              return;
          }
      }

      // Prepare media URLs if files are provided
      let preparedFileUrls = fileUrls;
      if (files.length > 0) {
          preparedFileUrls = files.map((file: Express.Multer.File) => `${file.filename}`);
      }

      // Get sender details
      const senderDetails = await userSchema.findById(sender).select("userName name profilePicture lastSeen bio email isOnline countryCode countryISOCode");

      // Generate a temporary message ID
      const tempMessageId = messageId || new mongoose.Types.ObjectId().toString();

      // Initial message response
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
          content,
          type,
          fileUrls: preparedFileUrls.map((url) => url.replace(/^(\w+)-.*$/, `$1/${url}`)),
          createdAt: new Date().toISOString(),
          messageId: tempMessageId,
          replyTo: repliedMessage ? {
              _id: repliedMessage._id,
              chatId: repliedMessage.chatId,
              content: repliedMessage.content,
              type: repliedMessage.type,
              sender: repliedMessage.sender,
              files: repliedMessage.files,
              fileIds: repliedMessage.fileIds,
              messageId: repliedMessage.messageId,
              disAppearingMessages: repliedMessage.disAppearingMessages,
              systemMessage: repliedMessage.systemMessage,
              createdAt: repliedMessage.createdAt,
          } : null,
          status: "sent",
          isRead: false,
      };

      let messageStatus = "sent";
      let isRead = false;
      const deliveryStatus: IDeliveryStatus = {};
      messageStatus = chatType === ChatType.ONE_TO_ONE ? "sent" : "read";
      isRead = chatType === ChatType.ONE_TO_ONE ? false : true;

      // Handle messaging based on chat type
      if (chatType === ChatType.ONE_TO_ONE || chatType === ChatType.GROUP) {
        loggerMsg("ChatType is ONE_TO_ONE & GROUP....","debug")
          await Promise.all(
              (participants || []).map(async (participant) => {
                 // Check if the participant is still in the group
                  const isParticipant = await chatParticipantSchema.findOne({
                      chatId,
                      userId: participant,
                      isRemoved: true 
                  });
                  
                  if (isParticipant) {
                    // Fetch the latest message ID for this chat
                    const latestMessage = await messageSchema.findOne({ chatId }).sort({ createdAt: -1 }).select("_id");
                 
                    if(latestMessage){
                      // If the user is removed, move the message to "deletedFor" for this user
                      await messageSchema.updateOne(
                        { _id: latestMessage._id }, // Assuming response contains the new message ID
                        { $addToSet: { deletedFor: isParticipant.userId } }
                      );
                    }

                      return socket.emit("error_message", {
                        message: null,
                      });
                  }

                  if (participant.toString() !== sender.toString()) {

                                   
                    // check if user has chat open
                    const isChatOpen = receiverOpenChat[participant.toString()]?.[chatId] ?? false;
          
  
                    if(!isChatOpen){
                      await chatParticipantSchema.updateMany(
                        {chatId,userId: new mongoose.Types.ObjectId(participant.toString())},
                        {$inc:{unreadCount: 1} }
                      )
  
                    }

                    
                      deliveryStatus[participant.toString()] = "sent";
                      // const participantId = participant instanceof mongoose.Types.ObjectId ? participant.toHexString() : participant.toString();
                      const receiverSocketId = userSocketMap[participant.toString()];
                      // const receiver = receiverOpenChat[participant._id.toString()] || null;

                      if (receiverSocketId) {
                        loggerMsg(`receiverSocketId is online...!${chatType}`,"debug")
                          io.to(receiverSocketId).emit("receive_message", {
                              ...response,
                              status: messageStatus,
                              isRead: isRead,
                              encryptedAESKey: chat.encryptedAESKey || ""
                          });
                      }
                      const senderSocketId = userSocketMap[sender.toString()];
                      // if(senderSocketId){
                      //   loggerMsg(`senderSocketId is online...!${chatType}`,"debug")
                      //     io.to(senderSocketId).emit("receive_message", {
                      //         ...response,
                      //         status: messageStatus,
                      //         isRead: isRead,
                      //         encryptedAESKey: chat.encryptedAESKey || ""
                      //     });
                      // }
                      const receiverDeviceType = await deviceToken.findOne({userId: new mongoose.Types.ObjectId(participant)}).select("deviceType");

                      loggerMsg(`receive_message event success ===> ${messageStatus}, ${isRead}`)
                      const descryptedMessage = descryptedContent(content,chat.encryptedAESKey)
                      
                      
                      const receiverDetails = await userSchema.findById(participant).select("isStopNotification isMuteNotification");
                      if(!receiverDetails?.isStopNotification){
                        
                       const notificationPayload = {
                          
                          title: `${senderDetails?.name}` || "New Message",
                          body: `${JSON.stringify(descryptedMessage)}` || "Plain Message!",
                          click_action: CLICK_NOTIFICATION_TYPE,
                          type: NotificationType.CHAT_MESSAGE,
                          chat_id: chatId,
                          sender: JSON.stringify(senderDetails),
                          temp_message_id: tempMessageId,
                          content,
                          groupInfo:JSON.stringify(chat),
                          chatType:chatType === ChatType.ONE_TO_ONE ? ChatType.ONE_TO_ONE : ChatType.GROUP,
                          receiverId:participant.toString(),
                          senderId:sender.toString(),
                          encryptedAESKey: chat.encryptedAESKey,
                          deviceType: `${receiverDeviceType?.deviceType}`,
                          isMuteNotification: receiverDetails?.isMuteNotification
                        };
                        try {
                          await sentPushNotificationToUser(participant.toString(), notificationPayload);
                          loggerMsg(`Push notification sent successfully!`,"debug")
                        } catch (error) {
                          console.error("Failed to push notification to send_message",error)
                        }
                       }
                  }
              })
          );
      }
      // Handle Channel Messaging
      else if (chatType === ChatType.CHANNEL) {
        loggerMsg("ChatType is CHANNEL....","debug")
          await Promise.all(
              (participants || []).map(async (participant) => {
                const isParticipant = await chatParticipantSchema.findOne({
                  chatId,
                  userId: participant,
                  isRemoved: true 
              });
              
              if (isParticipant) {
                // Fetch the latest message ID for this chat
                const latestMessage = await messageSchema.findOne({ chatId }).sort({ createdAt: -1 }).select("_id");
             
                if(latestMessage){
                  // If the user is removed, move the message to "deletedFor" for this user
                  await messageSchema.updateOne(
                    { _id: latestMessage._id }, // Assuming response contains the new message ID
                    { $addToSet: { deletedFor: isParticipant.userId } }
                  );
                }

                  return socket.emit("error_message", {
                    message: null,
                  });
              }
                 
             
                  if (participant.toString() !== sender.toString()) {

                   // check if user has chat open
                    const isChatOpen = receiverOpenChat[participant.toString()]?.[chatId] ?? false;
   
                    if(!isChatOpen){
                      await chatParticipantSchema.updateMany(
                        {chatId,userId: new mongoose.Types.ObjectId(participant.toString())},
                        {$inc:{unreadCount: 1} }
                      )
                   
                    }

                    

                    
                      deliveryStatus[participant.toString()] = "sent";
                      const receiverSocketId = userSocketMap[participant.toString()];
                      // const receiver = receiverOpenChat[participant.toString()] || null;

                      if (receiverSocketId) {
                        loggerMsg(`receiverSocketId is online...!`,"debug")
                          io.to(receiverSocketId).emit("receive_message", {
                              ...response,
                              status: "read",
                              isRead: true,
                              encryptedAESKey: chat.encryptedAESKey || ""
                          });
                      }
                      const senderSocketId = userSocketMap[sender.toString()];
                      // if(senderSocketId){
                      //   loggerMsg(`senderSocketId is online...!${chatType}`,"debug")
                      //     io.to(senderSocketId).emit("receive_message", {
                      //         ...response,
                      //         status: messageStatus,
                      //         isRead: isRead,
                      //         encryptedAESKey: chat.encryptedAESKey || ""
                      //     });
                      // }
                      const receiverDeviceType = await deviceToken.findOne({userId: new mongoose.Types.ObjectId(participant)}).select("deviceType");
                      const descryptedMessage = descryptedContent(content,chat.encryptedAESKey)
                      const receiverDetails = await userSchema.findById(participant).select("isStopNotification isMuteNotification");
                      if(!receiverDetails?.isStopNotification){

                        const notificationPayload = {
                          // title: `${senderDetails?.userName} in ${groupName || "Channel"}`,
                          // body: content || "New Channel Message!",

                          title: `${senderDetails?.userName}` || "New Message",
                          body: `${JSON.stringify(descryptedMessage)}` || "Plain Message!",                         
                          click_action: CLICK_NOTIFICATION_TYPE,
                          type: NotificationType.CHAT_MESSAGE,
                          chat_id: chatId,
                          sender: JSON.stringify(senderDetails),
                          temp_message_id: tempMessageId,
                          content,
                          groupInfo:JSON.stringify(chat),
                          chatType: ChatType.CHANNEL,
                          receiverId:participant.toString(),
                          senderId:sender.toString(),
                          encryptedAESKey: chat.encryptedAESKey,
                          deviceType: `${receiverDeviceType?.deviceType}`,
                          isMuteNotification: receiverDetails?.isMuteNotification
                      };
                        await sentPushNotificationToUser(participant.toString(), notificationPayload);
                        loggerMsg(`Push notification sent successfully!`,"debug")
                       

                      }
                  }
              })
          );
      }

      // Save message in database
      try {
          // await chatParticipantSchema.updateOne(
          //     { chatId },
          //     { $set: { lastClearedMessageId: null } } // Reset last cleared message when new message arrives
          // );
          const replyToMessage = String(replyToMessageId) ?? null
          let mediaDetails = {
            fileName: null,
            fileSize: null,
            mimeType: null
          }
          const savedMessage = await savedMessageOneToOne(
              chatId,
              sender,
              content,
              type,
              fileUrls,
              tempMessageId,
              deliveryStatus,
              isRead,
              messageStatus,
              replyToMessageId
              // mediaDetails,
          );

          // Update last message in chat
          chat.lastMessage = new mongoose.Types.ObjectId(String(savedMessage._id));
          await chat.save();
          
          
          // Notify sender that message is saved
          socket.emit("message_saved", { chatId, tempMessageId, _id: savedMessage._id });
          loggerMsg("Save in database successfully","debug")
      } catch (error) {
          console.error("Error while saving message:", error);
          socket.emit("message_save_failed", { chatId, messageId: tempMessageId, error: "Failed to save message" });
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
*/

// nickname changes, but sometime work and sometimes not 07-08-2024


socket.on("send_message", async (
  data: SendMessageData, 
  callback
) => {
  loggerMsg("call event of send_message", "debug");
  const { chatId, content, type, sender, fileUrls = [], files = [], messageId, replyToMessageId, createdAt, senderIdOfReplyMsg } = data;
  let messageCreatedAt = new Date()
  if(createdAt){
    messageCreatedAt = new Date(createdAt);
  }
  
  // Outer Map: receiverId => Map<senderId, nicknameObject>

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

      if(chat.isFirstMessage === 0){
        await chatSchema.findByIdAndUpdate(chat._id,{$set:{isFirstMessage:1} } )
      }
      
      const removedUser = await chatParticipantSchema.findOne({userId:sender, chatId, isRemoved: true}).select("isRemoved");
      if(removedUser){
        return socket.emit("error_message",{message: "You can't send message because you are no longer a member of the group."})
      }

      const isRemoveUserList = await chatParticipantSchema.find({chatId})
      const is_conversation_mute = isRemoveUserList.filter(c => c.userId.toString() !== sender.toString() && c.isNotificationMute === true);
      
      await Promise.all((isRemoveUserList.map(async (data) => {
        if(data.isRemoved === false){
          await chatParticipantSchema.updateMany(
            { chatId, userId: data.userId }, // Exclude the current user
            { $set: { lastClearedMessageId: null } }
          )
        }
      })))

      await Promise.all(isRemoveUserList.map(async(data) => {
        if(data.isDeleted){
          await chatParticipantSchema.updateMany({chatId, isDeleted: true}, {$set: {isDeleted: false, lastClearedMessageId: null} } )
        }
      }))

      
      loggerMsg(`Chat is found:=>\n${JSON.stringify(chat)}`,"debug")
      // Determine chat type
      const { type: chatType, participants, admins, groupName } = chat;

      let repliedMessage = null;
      let senderOfReplyMsg = null
      if(replyToMessageId){
          repliedMessage = await messageSchema.findOne({messageId: replyToMessageId})
          .populate({
              path: "sender",
              select: "name userName profilePicture countryCode phone countryISOCode isOnline lastSeen email",
              options: {lean: true}
            }).lean();
          console.log("-------------------> repliedMessage?.sender.toString()",JSON.stringify(repliedMessage?.sender), repliedMessage?.sender._id.toString(), sender.toString())
          if(repliedMessage){
            senderOfReplyMsg = await getNickNameDetails(repliedMessage?.sender._id.toString(),sender.toString())
          }
      }

      // Check if sender is allowed to send messages
      if (chatType === ChatType.CHANNEL) {
          // const senderRole = participants?.find((p:any) => p._id.toString() === sender.toString())?.role;
          if (chat.createdBy.toString() !== sender.toString()) {
            loggerMsg("Only admins can send messages in this channel.","debug")
              socket.emit("error_message", {
                  status: 400,
                  code: "FORBIDDEN",
                  message: "Only admins can send messages in this channel.",
              });
              return;
          }
      }

      // Prepare media URLs if files are provided
      let preparedFileUrls = fileUrls;
      if (files.length > 0) {
          preparedFileUrls = files.map((file: Express.Multer.File) => `${file.filename}`);
      }

      // Get sender details
      const senderDetails = await userSchema.findById(sender).select("userName name profilePicture lastSeen bio email isOnline countryCode countryISOCode nicknames").lean();
      
      // Generate a temporary message ID
      const tempMessageId = messageId || new mongoose.Types.ObjectId().toString();

      let messageStatus = "sent";
      let isRead = false;
      const deliveryStatus: IDeliveryStatus = {};
      messageStatus = chatType === ChatType.ONE_TO_ONE ? "sent" : "read";
      isRead = chatType === ChatType.ONE_TO_ONE ? false : true;

      // Initial message response
      // :SendMessageResponse
      let response:any = {
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
              // sender: repliedMessage.sender,
              sender: {
                ...repliedMessage.sender,
                nickName: senderOfReplyMsg && senderOfReplyMsg[0]?.matchedNickname?.[0]?.nickName?.trim() || undefined,
                isActiveNickname: senderOfReplyMsg && senderOfReplyMsg[0]?.matchedNickname?.[0]?.isActiveNickname || undefined              
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

        // Save message in database
        try {
            // await chatParticipantSchema.updateOne(
            //     { chatId },
            //     { $set: { lastClearedMessageId: null } } // Reset last cleared message when new message arrives
            // );
            const replyToMessage = String(replyToMessageId) ?? null
            // let mediaDetails = {
            //   fileName: null,
            //   fileSize: null,
            //   mimeType: null
            // }
            let mediaDetails: any[] = [];
            // const savedMessage = await savedMessageOneToOne(
            //     chatId,
            //     sender,
            //     content,
            //     type,
            //     fileUrls,
            //     tempMessageId,
            //     deliveryStatus,
            //     isRead,
            //     messageStatus,
            //     replyToMessageId,
            //     messageCreatedAt
            // );

              await saveMediaMessageAsync(
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

            // Update last message in chat
            // chat.lastMessage = new mongoose.Types.ObjectId(String(savedMessage._id));
            // await chat.save();
            
            
            // // Notify sender that message is saved
            // socket.emit("message_saved", { chatId, tempMessageId, _id: savedMessage._id });
            loggerMsg("Save in database successfully","debug")

            if(callback){
              callback({
                  ...response,
                  status: messageStatus,
                  isRead: false,
                  encryptedAESKey: chat.encryptedAESKey || "",
                  resStatus:"success"
              })
            }
        } catch (error) {
          if(callback){
            callback({
              resStatus:"failed"
            })
          }
          console.error("Error while saving message:", error);
          socket.emit("message_save_failed", { chatId, messageId: tempMessageId, error: "Failed to save message" });
        }
     
      

      // Handle messaging based on chat type
      if (chatType === ChatType.ONE_TO_ONE || chatType === ChatType.GROUP) {
        loggerMsg("ChatType is ONE_TO_ONE & GROUP....","debug")
          await Promise.all(
              (participants || []).map(async (participant) => {
                const receiverDetails = await userSchema.findById(participant).select("_id isStopNotification isMuteNotification nicknames");
                  
                 // Check if the participant is still in the group
                  const isParticipant = await chatParticipantSchema.findOne({
                      chatId,
                      userId: participant,
                      isRemoved: true 
                  });
                  
                  if (isParticipant) {
                    // Fetch the latest message ID for this chat
                    const latestMessage = await messageSchema.findOne({ chatId }).sort({ createdAt: -1 }).select("_id");
                 
                    if(latestMessage){
                      // If the user is removed, move the message to "deletedFor" for this user
                      await messageSchema.updateOne(
                        { _id: latestMessage._id }, // Assuming response contains the new message ID
                        { $addToSet: { deletedFor: isParticipant.userId } }
                      );
                    }

                      return socket.emit("error_message", {
                        message: null,
                      });
                  }

                  if (participant.toString() !== sender.toString()) {

                                   
                    // check if user has chat open
                    const isChatOpen = receiverOpenChat[participant.toString()]?.[chatId] ?? false;
  
                    if(!isChatOpen){
                      await chatParticipantSchema.updateMany(
                        {chatId,userId: new mongoose.Types.ObjectId(participant.toString())},
                        {$inc:{unreadCount: 1} }
                      )
                    }
                    
                      deliveryStatus[participant.toString()] = "sent";
                      const receiverSocketId = userSocketMap[participant.toString()];
                      
                      
                      let receiver:any;
                      if(participant.toString() !== sender.toString()){
                        receiver = await getNickNameDetails(participant.toString(),sender.toString())
                        console.log("=========================> ",JSON.stringify(receiver))
                      }
                      if (receiverSocketId) {
                        setTimeout(() => {
                            io.to(receiverSocketId).emit("receive_message", {
                                ...response,
                                sender: {
                                  ...response.sender,
                                  nickName: receiver && receiver[0]?.matchedNickname?.[0]?.nickName?.trim() || senderDetails?.name,
                                  isActiveNickname: receiver && receiver[0]?.matchedNickname?.[0]?.isActiveNickname || false
                                },
                                status: messageStatus,
                                isRead: isRead,
                                encryptedAESKey: chat.encryptedAESKey || ""
                            });
                        }, 200); // 200 milliseconds = 0.2 seconds
                      }
                      
                      const receiverDeviceType = await deviceToken.findOne({userId: new mongoose.Types.ObjectId(participant)}).select("deviceType");

                      const descryptedMessage = descryptedContent(content,chat.encryptedAESKey)
                      
                      
                      if(!receiverDetails?.isStopNotification){
                        if(is_conversation_mute.length === 0){
                          
                        const receiver = await getNickNameDetails(participant.toString(),sender.toString())
                        const matched = receiver[0]?.matchedNickname?.[0];
                          const notificationPayload = {
                              
                              title: `${matched?.isActiveNickname ? matched?.nickName : senderDetails?.userName}` || "New Message",
                              body: `${JSON.stringify(descryptedMessage).replace(/\\n/g, '\n')}` || "Plain Message!",
                              click_action: CLICK_NOTIFICATION_TYPE,
                              type: NotificationType.CHAT_MESSAGE,
                              chat_id: chatId,
                              sender: JSON.stringify({
                                isActiveNickname: matched?.isActiveNickname,
                                nickName: matched?.nickName,
                                ...senderDetails
                              }),
                              temp_message_id: tempMessageId,
                              content,
                              groupInfo:JSON.stringify(chat),
                              chatType:chatType === ChatType.ONE_TO_ONE ? ChatType.ONE_TO_ONE : ChatType.GROUP,
                              receiverId:participant.toString(),
                              senderId:sender.toString(),
                              encryptedAESKey: chat.encryptedAESKey,
                              deviceType: `${receiverDeviceType?.deviceType}`,
                              isMuteNotification: receiverDetails?.isMuteNotification
                            };
                            
                          try {
                            await sentPushNotificationToUser(participant.toString(), notificationPayload);
                            loggerMsg(`Push notification sent successfully!`,"debug")
                          } catch (error) {
                            console.error("Failed to push notification to send_message",error)
                          }
                        }
                       }
                  }
                })
          );
      }
      // Handle Channel Messaging
      else if (chatType === ChatType.CHANNEL) {
        loggerMsg("ChatType is CHANNEL....","debug")
          await Promise.all(
              (participants || []).map(async (participant) => {
                const isParticipant = await chatParticipantSchema.findOne({
                  chatId,
                  userId: participant,
                  isRemoved: true 
              });
              
              if (isParticipant) {
                // Fetch the latest message ID for this chat
                const latestMessage = await messageSchema.findOne({ chatId }).sort({ createdAt: -1 }).select("_id");
             
                if(latestMessage){
                  // If the user is removed, move the message to "deletedFor" for this user
                  await messageSchema.updateOne(
                    { _id: latestMessage._id }, // Assuming response contains the new message ID
                    { $addToSet: { deletedFor: isParticipant.userId } }
                  );
                }

                  return socket.emit("error_message", {
                    message: null,
                  });
              }
                 
             
                  if (participant.toString() !== sender.toString()) {

                   // check if user has chat open
                    const isChatOpen = receiverOpenChat[participant.toString()]?.[chatId] ?? false;
   
                    if(!isChatOpen){
                      await chatParticipantSchema.updateMany(
                        {chatId,userId: new mongoose.Types.ObjectId(participant.toString())},
                        {$inc:{unreadCount: 1} }
                      )
                   
                    }

                    

                    
                      deliveryStatus[participant.toString()] = "sent";
                      const receiverSocketId = userSocketMap[participant.toString()];
                      // const receiver = receiverOpenChat[participant.toString()] || null;

                      if (receiverSocketId) {
                        loggerMsg(`receiverSocketId is online...!`,"debug")
                          setTimeout(() => {
                            io.to(receiverSocketId).emit("receive_message", {
                                ...response,
                                status: "read",
                                isRead: true,
                                encryptedAESKey: chat.encryptedAESKey || ""
                            });
                          },200);
                      }
                      const senderSocketId = userSocketMap[sender.toString()];
                      // if(senderSocketId){
                      //   loggerMsg(`senderSocketId is online...!${chatType}`,"debug")
                      //     io.to(senderSocketId).emit("receive_message", {
                      //         ...response,
                      //         status: messageStatus,
                      //         isRead: isRead,
                      //         encryptedAESKey: chat.encryptedAESKey || ""
                      //     });
                      // }
                      const receiverDeviceType = await deviceToken.findOne({userId: new mongoose.Types.ObjectId(participant)}).select("deviceType");
                      const descryptedMessage = descryptedContent(content,chat.encryptedAESKey)
                      const receiverDetails = await userSchema.findById(participant).select("isStopNotification isMuteNotification");
                      if(!receiverDetails?.isStopNotification){
                        if(is_conversation_mute.length === 0){
                          const notificationPayload = {
                            // title: `${senderDetails?.userName} in ${groupName || "Channel"}`,
                            // body: content || "New Channel Message!",

                            title: `${senderDetails?.userName}` || "New Message",
                            body: `${JSON.stringify(descryptedMessage).replace(/\\n/g, '\n')}` || "Plain Message!",                         
                            click_action: CLICK_NOTIFICATION_TYPE,
                            type: NotificationType.CHAT_MESSAGE,
                            chat_id: chatId,
                            sender: JSON.stringify(senderDetails),
                            temp_message_id: tempMessageId,
                            content,
                            groupInfo:JSON.stringify(chat),
                            chatType: ChatType.CHANNEL,
                            receiverId:participant.toString(),
                            senderId:sender.toString(),
                            encryptedAESKey: chat.encryptedAESKey,
                            deviceType: `${receiverDeviceType?.deviceType}`,
                            isMuteNotification: receiverDetails?.isMuteNotification
                        };
                          await sentPushNotificationToUser(participant.toString(), notificationPayload);
                          loggerMsg(`Push notification sent successfully!`,"debug")
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


// originial code of send_message
/*
socket.on("send_message", async (
  data: SendMessageData, 
  callback
) => {
  loggerMsg("call event of send_message", "debug");
  const { chatId, content, type, sender, fileUrls = [], files = [], messageId, replyToMessageId, createdAt } = data;
  let messageCreatedAt = new Date()
  if(createdAt){
    messageCreatedAt = new Date(createdAt);
  }
  console.log("===========> messageCreatedAt <===================",messageCreatedAt)
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
      if(chat.isFirstMessage === 0){
        await chatSchema.findByIdAndUpdate(chat._id,{$set:{isFirstMessage:1} } )
      }
      const removedUser = await chatParticipantSchema.findOne({userId:sender, chatId, isRemoved: true}).select("isRemoved");
      if(removedUser){
        return socket.emit("error_message",{message: "You can't send message because you are no longer a member of the group."})
      }

      const isRemoveUserList = await chatParticipantSchema.find({chatId})
      const is_conversation_mute = isRemoveUserList.filter(c => c.userId.toString() !== sender.toString() && c.isNotificationMute === true);
      console.log("---------------> is_conversation_mute",is_conversation_mute.length)
      await Promise.all((isRemoveUserList.map(async (data) => {
        if(data.isRemoved === false){
          await chatParticipantSchema.updateMany(
            { chatId, userId: data.userId }, // Exclude the current user
            { $set: { lastClearedMessageId: null } }
          )
        }
      })))

    await Promise.all(isRemoveUserList.map(async(data) => {
      if(data.isDeleted){
        await chatParticipantSchema.updateMany({chatId, isDeleted: true}, {$set: {isDeleted: false, lastClearedMessageId: null} } )
      }
    }))

      
      loggerMsg(`Chat is found:=>\n${JSON.stringify(chat)}`,"debug")
      // Determine chat type
      const { type: chatType, participants, admins, groupName } = chat;

      let repliedMessage = null;
      if(replyToMessageId){
          repliedMessage = await messageSchema.findOne({messageId: replyToMessageId})
          .populate({
              path: "sender",
              select: "name userName profilePicture countryCode phone countryISOCode isOnline lastSeen email"
          });
      }

      // Check if sender is allowed to send messages
      if (chatType === ChatType.CHANNEL) {
          // const senderRole = participants?.find((p:any) => p._id.toString() === sender.toString())?.role;
          if (chat.createdBy.toString() !== sender.toString()) {
            loggerMsg("Only admins can send messages in this channel.","debug")
              socket.emit("error_message", {
                  status: 400,
                  code: "FORBIDDEN",
                  message: "Only admins can send messages in this channel.",
              });
              return;
          }
      }

      // Prepare media URLs if files are provided
      let preparedFileUrls = fileUrls;
      if (files.length > 0) {
          preparedFileUrls = files.map((file: Express.Multer.File) => `${file.filename}`);
      }

      // Get sender details
      const senderDetails = await userSchema.findById(sender).select("userName name profilePicture lastSeen bio email isOnline countryCode countryISOCode");

      // Generate a temporary message ID
      const tempMessageId = messageId || new mongoose.Types.ObjectId().toString();

      let messageStatus = "sent";
      let isRead = false;
      const deliveryStatus: IDeliveryStatus = {};
      messageStatus = chatType === ChatType.ONE_TO_ONE ? "sent" : "read";
      isRead = chatType === ChatType.ONE_TO_ONE ? false : true;

      // Initial message response
      // :SendMessageResponse
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
              sender: repliedMessage.sender,
              files: repliedMessage.files,
              fileIds: repliedMessage.fileIds,
              messageId: repliedMessage.messageId,
              disAppearingMessages: repliedMessage.disAppearingMessages,
              systemMessage: String(repliedMessage.systemMessage),
              createdAt: repliedMessage.createdAt,
          } : null,
          status: messageStatus,
          isRead: isRead,
      };

        // Save message in database
        try {
            // await chatParticipantSchema.updateOne(
            //     { chatId },
            //     { $set: { lastClearedMessageId: null } } // Reset last cleared message when new message arrives
            // );
            const replyToMessage = String(replyToMessageId) ?? null
            // let mediaDetails = {
            //   fileName: null,
            //   fileSize: null,
            //   mimeType: null
            // }
            let mediaDetails: any[] = [];
            // const savedMessage = await savedMessageOneToOne(
            //     chatId,
            //     sender,
            //     content,
            //     type,
            //     fileUrls,
            //     tempMessageId,
            //     deliveryStatus,
            //     isRead,
            //     messageStatus,
            //     replyToMessageId,
            //     messageCreatedAt
            // );

              await saveMediaMessageAsync(
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

            // Update last message in chat
            // chat.lastMessage = new mongoose.Types.ObjectId(String(savedMessage._id));
            // await chat.save();
            
            
            // // Notify sender that message is saved
            // socket.emit("message_saved", { chatId, tempMessageId, _id: savedMessage._id });
            loggerMsg("Save in database successfully","debug")

            if(callback){
              callback({
                  ...response,
                  status: messageStatus,
                  isRead: false,
                  encryptedAESKey: chat.encryptedAESKey || "",
                  resStatus:"success"
              })
            }
        } catch (error) {
          if(callback){
            callback({
              resStatus:"failed"
            })
          }
          console.error("Error while saving message:", error);
          socket.emit("message_save_failed", { chatId, messageId: tempMessageId, error: "Failed to save message" });
        }
     
      

      // Handle messaging based on chat type
      if (chatType === ChatType.ONE_TO_ONE || chatType === ChatType.GROUP) {
        loggerMsg("ChatType is ONE_TO_ONE & GROUP....","debug")
          await Promise.all(
              (participants || []).map(async (participant) => {
                 // Check if the participant is still in the group
                  const isParticipant = await chatParticipantSchema.findOne({
                      chatId,
                      userId: participant,
                      isRemoved: true 
                  });
                  
                  if (isParticipant) {
                    // Fetch the latest message ID for this chat
                    const latestMessage = await messageSchema.findOne({ chatId }).sort({ createdAt: -1 }).select("_id");
                 
                    if(latestMessage){
                      // If the user is removed, move the message to "deletedFor" for this user
                      await messageSchema.updateOne(
                        { _id: latestMessage._id }, // Assuming response contains the new message ID
                        { $addToSet: { deletedFor: isParticipant.userId } }
                      );
                    }

                      return socket.emit("error_message", {
                        message: null,
                      });
                  }

                  if (participant.toString() !== sender.toString()) {

                                   
                    // check if user has chat open
                    const isChatOpen = receiverOpenChat[participant.toString()]?.[chatId] ?? false;
          
  
                    if(!isChatOpen){
                      await chatParticipantSchema.updateMany(
                        {chatId,userId: new mongoose.Types.ObjectId(participant.toString())},
                        {$inc:{unreadCount: 1} }
                      )
  
                    }

                    
                      deliveryStatus[participant.toString()] = "sent";
                      // const participantId = participant instanceof mongoose.Types.ObjectId ? participant.toHexString() : participant.toString();
                      const receiverSocketId = userSocketMap[participant.toString()];
                      // const receiver = receiverOpenChat[participant._id.toString()] || null;

                      if (receiverSocketId) {
                        loggerMsg(`receiverSocketId is online...!${chatType}`,"debug")
                        setTimeout(() => {
                            io.to(receiverSocketId).emit("receive_message", {
                                ...response,
                                status: messageStatus,
                                isRead: isRead,
                                encryptedAESKey: chat.encryptedAESKey || ""
                            });
                        }, 200); // 200 milliseconds = 0.2 seconds
                      }
                      const senderSocketId = userSocketMap[sender.toString()];
                      // if(senderSocketId){
                      //   loggerMsg(`senderSocketId is online...!${chatType}`,"debug")
                      //     io.to(senderSocketId).emit("receive_message", {
                      //         ...response,
                      //         status: messageStatus,
                      //         isRead: isRead,
                      //         encryptedAESKey: chat.encryptedAESKey || ""
                      //     });
                      // }
                      const receiverDeviceType = await deviceToken.findOne({userId: new mongoose.Types.ObjectId(participant)}).select("deviceType");

                      loggerMsg(`receive_message event success ===> ${messageStatus}, ${isRead}`)
                      const descryptedMessage = descryptedContent(content,chat.encryptedAESKey)
                      
                      
                      const receiverDetails = await userSchema.findById(participant).select("isStopNotification isMuteNotification");
                      if(!receiverDetails?.isStopNotification){
                        if(is_conversation_mute.length === 0){
                          const notificationPayload = {
                              
                              title: `${senderDetails?.name}` || "New Message",
                              body: `${JSON.stringify(descryptedMessage)}` || "Plain Message!",
                              click_action: CLICK_NOTIFICATION_TYPE,
                              type: NotificationType.CHAT_MESSAGE,
                              chat_id: chatId,
                              sender: JSON.stringify(senderDetails),
                              temp_message_id: tempMessageId,
                              content,
                              groupInfo:JSON.stringify(chat),
                              chatType:chatType === ChatType.ONE_TO_ONE ? ChatType.ONE_TO_ONE : ChatType.GROUP,
                              receiverId:participant.toString(),
                              senderId:sender.toString(),
                              encryptedAESKey: chat.encryptedAESKey,
                              deviceType: `${receiverDeviceType?.deviceType}`,
                              isMuteNotification: receiverDetails?.isMuteNotification
                            };
                          try {
                            await sentPushNotificationToUser(participant.toString(), notificationPayload);
                            loggerMsg(`Push notification sent successfully!`,"debug")
                          } catch (error) {
                            console.error("Failed to push notification to send_message",error)
                          }
                        }
                       }
                  }
              })
          );
      }
      // Handle Channel Messaging
      else if (chatType === ChatType.CHANNEL) {
        loggerMsg("ChatType is CHANNEL....","debug")
          await Promise.all(
              (participants || []).map(async (participant) => {
                const isParticipant = await chatParticipantSchema.findOne({
                  chatId,
                  userId: participant,
                  isRemoved: true 
              });
              
              if (isParticipant) {
                // Fetch the latest message ID for this chat
                const latestMessage = await messageSchema.findOne({ chatId }).sort({ createdAt: -1 }).select("_id");
             
                if(latestMessage){
                  // If the user is removed, move the message to "deletedFor" for this user
                  await messageSchema.updateOne(
                    { _id: latestMessage._id }, // Assuming response contains the new message ID
                    { $addToSet: { deletedFor: isParticipant.userId } }
                  );
                }

                  return socket.emit("error_message", {
                    message: null,
                  });
              }
                 
             
                  if (participant.toString() !== sender.toString()) {

                   // check if user has chat open
                    const isChatOpen = receiverOpenChat[participant.toString()]?.[chatId] ?? false;
   
                    if(!isChatOpen){
                      await chatParticipantSchema.updateMany(
                        {chatId,userId: new mongoose.Types.ObjectId(participant.toString())},
                        {$inc:{unreadCount: 1} }
                      )
                   
                    }

                    

                    
                      deliveryStatus[participant.toString()] = "sent";
                      const receiverSocketId = userSocketMap[participant.toString()];
                      // const receiver = receiverOpenChat[participant.toString()] || null;

                      if (receiverSocketId) {
                        loggerMsg(`receiverSocketId is online...!`,"debug")
                          setTimeout(() => {
                            io.to(receiverSocketId).emit("receive_message", {
                                ...response,
                                status: "read",
                                isRead: true,
                                encryptedAESKey: chat.encryptedAESKey || ""
                            });
                          },200);
                      }
                      const senderSocketId = userSocketMap[sender.toString()];
                      // if(senderSocketId){
                      //   loggerMsg(`senderSocketId is online...!${chatType}`,"debug")
                      //     io.to(senderSocketId).emit("receive_message", {
                      //         ...response,
                      //         status: messageStatus,
                      //         isRead: isRead,
                      //         encryptedAESKey: chat.encryptedAESKey || ""
                      //     });
                      // }
                      const receiverDeviceType = await deviceToken.findOne({userId: new mongoose.Types.ObjectId(participant)}).select("deviceType");
                      const descryptedMessage = descryptedContent(content,chat.encryptedAESKey)
                      const receiverDetails = await userSchema.findById(participant).select("isStopNotification isMuteNotification");
                      if(!receiverDetails?.isStopNotification){
                        if(is_conversation_mute.length === 0){
                          const notificationPayload = {
                            // title: `${senderDetails?.userName} in ${groupName || "Channel"}`,
                            // body: content || "New Channel Message!",

                            title: `${senderDetails?.userName}` || "New Message",
                            body: `${JSON.stringify(descryptedMessage)}` || "Plain Message!",                         
                            click_action: CLICK_NOTIFICATION_TYPE,
                            type: NotificationType.CHAT_MESSAGE,
                            chat_id: chatId,
                            sender: JSON.stringify(senderDetails),
                            temp_message_id: tempMessageId,
                            content,
                            groupInfo:JSON.stringify(chat),
                            chatType: ChatType.CHANNEL,
                            receiverId:participant.toString(),
                            senderId:sender.toString(),
                            encryptedAESKey: chat.encryptedAESKey,
                            deviceType: `${receiverDeviceType?.deviceType}`,
                            isMuteNotification: receiverDetails?.isMuteNotification
                        };
                          await sentPushNotificationToUser(participant.toString(), notificationPayload);
                          loggerMsg(`Push notification sent successfully!`,"debug")
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
*/



socket.on("editMessage", async ({ messageId, editedContent, chatId, userId }, callback) => {
  try {
      if (!chatId) {
          return socket.emit("error_message",{message: "Invalid message or chat ID."})
      }

      const chat = await chatSchema.findById(chatId);
      if(!chat){
        return socket.emit("error_message",{message: "Chat not found."})
      }
      const participants = chat.participants;
      // Fetch the message
      const message = await messageSchema.findOne({messageId: messageId});
      if (!message) {
        return socket.emit("error_message",{message: "Message not found."})
      }

      // Check if the user is the sender
      if (message.sender.toString() !== userId) {
          return socket.emit("error_message",{message: "You can only edit your own messages."})
      }

       // Check if 24 hours have passed
       const messageTimestamp:any = new Date(message.createdAt); // Get message creation time
       const currentTime:any = new Date(); // Get current time
       const timeDifference = (currentTime - messageTimestamp) / (1000 * 60 * 60); // Convert milliseconds to hours

       if (timeDifference > 24) {
           return socket.emit("error_message", { message: "You cannot edit messages after 24 hours." });
       }

      // Update the message content
      message.content = editedContent;
      message.isEditedMessage = true;
      // message.updatedAt = new Date();
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
          content:editedContent,
          type: message.type,
          fileUrls: message.fileIds,
          createdAt: new Date().toISOString(),
          messageId: message.messageId,
          isEditedMessage: message.isEditedMessage,
          status: "read",
          isRead: true,
      };

      // Emit event to all chat participants
      await Promise.all(
        (participants || []).map(async (participant) => {
          const receiverSocketId = userSocketMap[participant.toString()];
          let receiver:any;
          if(participant.toString() !== userId.toString()){
            receiver = await getNickNameDetails(participant.toString(),userId.toString())
          }
          if (receiverSocketId) {
            loggerMsg(`receiverSocketId is online...!`,"debug")
              io.to(receiverSocketId).emit("receive_edit_message", {
                  ...response,
                  sender: {
                    ...response.sender,
                    nickName: receiver && receiver[0]?.matchedNickname?.[0]?.nickName?.trim() || senderDetails?.name,
                    isActiveNickname: receiver && receiver[0]?.matchedNickname?.[0]?.isActiveNickname || false
                  },
                  status: "read",
                  isRead: true,
                  encryptedAESKey: chat.encryptedAESKey || ""
              });
          }
                
          // const receiverDetails = await userSchema.findById(participant).select("isStopNotification isMuteNotification");
          // if(!receiverDetails?.isStopNotification){
          //   const notificationPayload = {
          //     title: `${senderDetails?.userName} in ${groupName || "Channel"}`,
          //     body: content || "New Channel Message!",
          //     click_action: CLICK_NOTIFICATION_TYPE,
          //     type: "group_message",
          //     chat_id: chatId,
          //     sender: JSON.stringify(senderDetails),
          //     temp_message_id: tempMessageId,
          //     content,
          //     groupInfo:JSON.stringify(chat),
          //     chatType: ChatType.CHANNEL,
          //     receiverId:participant.toString(),
          //     senderId:sender.toString(),
          //     isMuteNotification: receiverDetails?.isMuteNotification
          // };
          //   await sentPushNotificationToUser(participant.toString(), notificationPayload);
          //   loggerMsg(`Push notification sent successfully!`,"debug")
          // }
        })
    );

      // return callback(null, { status: 200, message: "Message updated successfully." });
  } catch (error) {
      console.error("Error in editMessage:", error);
      // return callback({ status: 500, message: "Internal server error." });
      return socket.emit("error_message",{message:"Edit message error."})
  }
});

socket.on("reactMessage", async ({ messageId, reactions, chatId, userId }, callback) => {
  try {
      if (!chatId || !messageId || !Array.isArray(reactions) || reactions.length === 0) {
        return socket.emit("error_message", { message: "Invalid input parameters." });
      }

      const chat = await chatSchema.findById(chatId);
      if(!chat){
        return socket.emit("error_message",{message: "Chat not found."})
      }
      const participants = chat.participants;
      // Fetch the message
      const message = await messageSchema.findOne({messageId: messageId});
      if (!message) {
        return socket.emit("error_message",{message: "Message not found."})
      }

      // Check if the user is the sender
      // if (message.sender.toString() !== userId) {
      //     return socket.emit("error_message",{message: "You can only edit your own messages."})
      // }

      interface Reaction {
        userId: mongoose.Types.ObjectId;
        emoji: string;
      }

      const existingReactions: Reaction[] = message.reactOnMessage || [];
      const updatedReactions: Reaction[] = [...existingReactions];

      // reaction is the new incoming array. You want to either replace or add the user’s reaction
      for (const newReact of reactions) {
        if (typeof newReact !== "string") continue;

        const userReactIndex = updatedReactions.findIndex(
          (r:any) => r.userId.toString() === userId.toString()
        );

        if(userReactIndex !== -1){
          // Replace the emoji for this user
          updatedReactions[userReactIndex].emoji = newReact;  // replace old emoji
        }else{
          updatedReactions.push({userId: new mongoose.Types.ObjectId(userId), emoji: newReact})
        }
      }
      message.reactOnMessage = updatedReactions;
            // Update the message content
      // message.content = editedContent;
      message.reactions = reactions;
      // message.updatedAt = new Date();
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
          content:message.content,
          reactOnMessage: updatedReactions.map(r => r.emoji) || [],
          reactions: reactions,
          type: message.type,
          fileUrls: message.fileIds,
          createdAt: new Date().toISOString(),
          messageId: message.messageId,
          status: "read",
          isRead: true,
      };

      // Emit event to all chat participants
      await Promise.all(
        (participants || []).map(async (participant) => {
          const receiverSocketId = userSocketMap[participant.toString()];
          let receiver:any;
          if(participant.toString() !== userId.toString()){
            receiver = await getNickNameDetails(participant.toString(),userId.toString())
          }
          if (receiverSocketId) {
            loggerMsg(`receiverSocketId is online...!`,"debug")
              io.to(receiverSocketId).emit("receive_react_message", {
                  ...response,
                  sender: {
                    ...response.sender,
                    nickName: receiver && receiver[0]?.matchedNickname?.[0]?.nickName?.trim() || senderDetails?.name,
                    isActiveNickname: receiver && receiver[0]?.matchedNickname?.[0]?.isActiveNickname || false
                  },
                  status: "read",
                  isRead: true,
                  encryptedAESKey: chat.encryptedAESKey || ""
              });
          }
        })
    );

    const receiverDetails = await userSchema.findById(message.sender).select("isStopNotification isMuteNotification");
          const receiverDeviceType = await deviceToken.findOne({userId: new mongoose.Types.ObjectId(message.sender.toString())}).select("deviceType");
          if(!receiverDetails?.isStopNotification){
                        
            const notificationPayload = {
              title: `${senderDetails?.name}` || "New Message",
              body: `${senderDetails?.name} reacted with ${reactions[0]} to a message.` || "React Message!",
              click_action: CLICK_NOTIFICATION_TYPE,
              type: NotificationType.CHAT_MESSAGE,
              chat_id: chatId,
              sender: JSON.stringify(senderDetails),
              temp_message_id: messageId,
              content: JSON.stringify(reactions),
              groupInfo:JSON.stringify(chat),
              chatType:chat.type === ChatType.ONE_TO_ONE ? ChatType.ONE_TO_ONE : ChatType.GROUP,
              receiverId: message.sender.toString(),
              senderId:userId.toString(),
              encryptedAESKey: chat.encryptedAESKey,
              deviceType: `${receiverDeviceType?.deviceType}`,
              isMuteNotification: receiverDetails?.isMuteNotification
            };
            try {
              await sentPushNotificationToUser(message.sender.toString(), notificationPayload);
              loggerMsg(`Push notification sent successfully!`,"debug")
            } catch (error) {
              console.error("Failed to push notification to send_message",error)
            }
          }

      // return callback(null, { status: 200, message: "Message updated successfully." });
  } catch (error) {
      console.error("Error in editMessage:", error);
      // return callback({ status: 500, message: "Internal server error." });
      return socket.emit("error_message",{message:"Edit message error."})
  }
});


socket.on("forwardMessage", async (data, callback) => {
  try {
    const {content,mediaContent, sender, messageId, targetChatId, currentChatId} = data;

    const senderDetails = await userSchema.findById(sender);
    // const removedUser = await chatParticipantSchema.findOne({userId:sender, chatId:currentChatId, isRemoved: true}).select("isRemoved");
    // if(removedUser){
    //   return socket.emit("error_message",{message: "You can't send message because you are no longer a member of the group."})
    // }
    
    // Fetch original message
    const originalMessage = await messageSchema.findOne({messageId: messageId});
    if(!originalMessage){
      return socket.emit("error_message",{message: "Message not found."})
    }

    // Fetch the AES key of the original chat
    const sourceChat = await chatSchema.findOne({ _id: originalMessage.chatId }).select("encryptedAESKey");
    if (!sourceChat || !sourceChat.encryptedAESKey) {
      return socket.emit("error_message", { message: "Source chat encryption key not found." });
    }
              
    const forwardedMessages = [];

  
      const conversation = await chatSchema.findOne({_id: targetChatId}).select("_id participants encryptedAESKey");

      
      if(!conversation) {
        return socket.emit("error_message",{message: "Chat not found."})
      } 
      
      const newMessageId = new mongoose.Types.ObjectId().toString();

      

      // Save the forwarded message
      const newForwardedMessage  = new messageSchema({
        chatId: targetChatId,
        sender,
        content: content,
        type: originalMessage.type,
        fileIds: originalMessage.fileIds,
        files: originalMessage.files,
        messageId: newMessageId,
        forwarded: true,
        originalMessageId:originalMessage.messageId
      })
      await newForwardedMessage.save()
      
      // forwardedMessages.push(newForwardedMessage)

      let mediaDetails: any[] = [];
      let fileUrls : any[] = [];

        if(originalMessage.files.length > 0){
            fileUrls = originalMessage.files.map((file:any) => file.key);
            mediaDetails = originalMessage.files.map((file:any) => ({
                url: file.key,
                mimeType: file.mimetype,
                fileName: file.originalname,
                fileSize: file.size,
            }));
        }

        const mediaContentMessagId = new mongoose.Types.ObjectId().toString();
      if(mediaContent){
        const newContentMessage  = new messageSchema({
          chatId: targetChatId,
          sender,
          content: mediaContent,
          type: "text",
          fileIds: [],
          files: [],
          messageId: mediaContentMessagId,
          forwarded: false,
          originalMessageId:null
        })
        await newContentMessage.save()
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
        fileIds:[],
        fileUrls: fileUrls,
        files:mediaDetails,
        createdAt: new Date().toISOString(),
        // messageId: messageId || new mongoose.Types.ObjectId().toString(),
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
        fileIds:[],
        fileUrls: fileUrls,
        files:mediaDetails,
        createdAt: new Date().toISOString(),
        // messageId: messageId || new mongoose.Types.ObjectId().toString(),
        messageId: mediaContentMessagId,
        status: "sent",
        isRead: false,
        forwarded: false
    };
    
      // Emit new message to users in this conversation
      for (const participant of conversation.participants) {
        console.log("+++++++++++++ participant ++++++++++++++",JSON.stringify(participant))
        const socketId = userSocketMap[participant.toString()]
        let receiver:any;
        if(participant.toString() !== sender.toString()){
          receiver = await getNickNameDetails(participant.toString(),sender.toString())
        }
        if(socketId){
          io.to(socketId).emit("receive_message",{
            ...response, 
            sender: {
              ...response.sender,
              nickName: receiver && receiver[0]?.matchedNickname?.[0]?.nickName?.trim() || senderDetails?.name,
              isActiveNickname: receiver && receiver[0]?.matchedNickname?.[0]?.isActiveNickname || false
            },
            status: "read",
            isRead: true,
            encryptedAESKey: conversation.encryptedAESKey || ""
          })

          if(mediaContent){
            io.to(socketId).emit("receive_message",{
              ...mediaContentResponse, 
              sender: {
                ...mediaContentResponse.sender,
                nickName: receiver && receiver[0]?.matchedNickname?.[0]?.nickName?.trim() || senderDetails?.name,
                isActiveNickname: receiver && receiver[0]?.matchedNickname?.[0]?.isActiveNickname || false
              },
              status: "read",
              isRead: true,
              encryptedAESKey: conversation.encryptedAESKey || ""
            })
          }
        }

        // const receiverDetails = await userSchema.findById(participant).select("isStopNotification isMuteNotification");
        // if(!receiverDetails?.isStopNotification){
        //   console.log("receiverDetails isStopNotification",receiverDetails?.isStopNotification, receiverDetails?.isMuteNotification)
        //   const notificationPayload = {
            
        //     title: `${senderDetails?.name}` || "New Message",
        //     body: `${content}` || "Plain Message!",
        //     click_action: CLICK_NOTIFICATION_TYPE,
        //     type: NotificationType.CHAT_MESSAGE,
        //     chat_id: targetChatId,
        //     sender: JSON.stringify(senderDetails),
        //     temp_message_id: tempMessageId,
        //     content,
        //     groupInfo:JSON.stringify(chat),
        //     chatType:chatType === ChatType.ONE_TO_ONE ? ChatType.ONE_TO_ONE : ChatType.GROUP,
        //     receiverId:participant.toString(),
        //     senderId:sender.toString(),
        //     encryptedAESKey: chat.encryptedAESKey,
        //     deviceType: `${receiverDeviceType?.deviceType}`,
        //     isMuteNotification: receiverDetails?.isMuteNotification
        //   };
        //   try {
        //     await sentPushNotificationToUser(participant.toString(), notificationPayload);
        //     loggerMsg(`Push notification sent successfully!`,"debug")
        //   } catch (error) {
        //     console.error("Failed to push notification to send_message",error)
        //   }
        //   }
      }
      
  } catch (error) {
    return socket.emit("error_message",{message: "Error from forward message."});
  }
})


socket.on("pinMessage", async(data, callback) =>{
  try {
    const {messageId, chatId} = data;

    // find the messages
    const message = await messageSchema.findOne({messageId, chatId});
    if(!message){
      return socket.emit("error_message",{message: "Message not found."})
    }
    // update message as pinned
    message.pinned = true;
    await message.save();

    // Get participants in the conversations
    const conversation = await chatSchema.findOne({_id: chatId}).select("participants");

    // Emit event all the participants
    // @ts-ignore
    for (const participant of conversation?.participants) {
      const socketId= userSocketMap[participant.toString()];
      io.to(socketId).emit("messagePinned",{chatId, pinMessage: message})
    }
    // return callback({success: true, pinMessage: message})
  } catch (error) {
    return socket.emit("error_message",{message: "Error from pinMessage"})
  }
})

socket.on("unpinMessage",async(data) => {
  try {
    const {messageId, chatId} = data;
    // find the message and update it.
    const message = await messageSchema.findOne({messageId: messageId, chatId: chatId});
    if(!message){
      return socket.emit("error_message",{message : "Message not found."})
    }
    message.pinned = false;
    await message.save();

    // Get participants in the conversations
    const conversation = await chatSchema.findOne({_id: chatId}).select("participants");

    // Emit event all the participants
    // @ts-ignore
    for (const participant of conversation?.participants) {
      const socketId= userSocketMap[participant.toString()];
      io.to(socketId).emit("messageUnPinned",{chatId, pinMessage: message})
    }
  } catch (error) {
    return socket.emit("error_message",{message: "Error message to unpinMessage"});
  }
})

socket.on("archiveChat",async(data) => {
  try {
    const {userId, chatId} = data;
    const participant = await chatParticipantSchema.findOneAndUpdate(
      {userId, chatId},
      {isArchived: true},
      {new: true}
    )

    if(!participant){
      return socket.emit("error_message",{message: "Chat not found."})
    }
 
    const socketId = userSocketMap[userId.toString()]
    if(socketId){
      io.to(socketId).emit("chatArchived",{chatId});
 
    }
  } catch (error) {
    return socket.emit("error_message",{message : "Error message to archiveChat."})
  }
})

socket.on("unarchiveChat",async(data) => {
  try {
    const {userId, chatId} = data;
    const participant = await chatParticipantSchema.findOneAndUpdate(
      {userId, chatId},
      {isArchived: false},
      {new: true}
    );

    if(!participant){
      return socket.emit("error_message",{message: "Chat not found."})
    }
    const socketId = userSocketMap[userId];
    io.to(socketId).emit("chatUnarchived",{chatId});
  } catch (error) {
    return socket.emit("error_message",{message: "Error from unarchiveChat."})
  }
})

socket.on("mark_message_as_read", async (data: { chatId: string; userId: string, isChatOpen: boolean, lastMessageId: string }) => {
    try {
      

        const { chatId, userId, isChatOpen, lastMessageId } = data;

        // update the receiver's chat status ( userId + chatId wise)
        if(!receiverOpenChat[userId]){
          receiverOpenChat[userId] = {} // Initialize user entry if do not exists
        }
        // Update receiver's chat status
        receiverOpenChat[userId][chatId] = isChatOpen;  // Store chat open status

        
        loggerMsg(`receiverOpenChat => \n${JSON.stringify(receiverOpenChat)}`, "debug");

        
        // Fetch the chat to get participants
        const chat = await chatSchema.findById(chatId);
        if (!chat) {
            socket.emit("error_message", {
                status: 404,
                code: "CHAT_NOT_FOUND",
                message: "Chat not found.",
            });
            return;
        }
       
        if(isChatOpen){
          // reset unread count when user opens the chat
          await chatParticipantSchema.updateOne(
            {chatId, userId: new mongoose.Types.ObjectId(userId)},
            {$set:{unreadCount: 0, markMessageAsUnread: false} }
          )
          loggerMsg(`Unread count reset for user ${userId} in chat ${chatId}`, "debug");
        }
        // Ensure participants exist before using them
        const senders = chat.participants?.filter((participant) => participant.toString() !== userId) || [];
    
        // Update messages before lastMessageId that are sent by others
        await messageSchema.updateMany(
            {
                chatId,
                messageId: { $lte: lastMessageId }, // Target messages before lastMessageId
                sender: { $ne: userId } // Exclude the current user's messages
            },
            { 
                $set: { [`deliveryStatus.${userId}`]: "read", isRead: true, status:"read" } // Update deliveryStatus for this user
            }
        );
        loggerMsg(`Updated deliveryStatus to 'read' for user ${userId} in messages before ${lastMessageId}`, "debug");

        // Notify senders that their messages have been read
        await Promise.all(
            senders.map(async (sender: any) => {
                const senderSocketId = userSocketMap[sender._id.toString()];
                if (senderSocketId) {
                    loggerMsg(`Notifying sender ${sender._id.toString()} (Socket ID: ${senderSocketId})`, "debug");

                    // Emit 'message_status' to sender
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

socket.on("mark_message_as_unread",async(data) => {
  const {chatId, userId} = data;
  try {
    await chatParticipantSchema.updateOne(
      {chatId, userId},
      {
        $set:{
          markMessageAsUnread: true
        }
      }
    )

    
    const socketId = userSocketMap[userId.toString()]
    if(socketId){
      io.to(socketId).emit("markMessageUnread",{userId, chatId});
    }
  } catch (error) {
    console.error("Error in mark_message_as_unread:", error);
    loggerMsg(`Error in mark_message_as_unread: ${error}`, "debug");
  }
});

socket.on("chatClosed",({userId, chatId}) => {
  if(receiverOpenChat[userId]){
    // delete receiverOpenChat[userId][chatId];  // remove the chatEntry
    // if(Object.keys(receiverOpenChat[userId]).length === 0){
      delete receiverOpenChat[userId] // Remove user if no chats open
    // }
  }
})
  
  
  
  

    

  socket.on("sendSavedMessages",async(data:{sender: string,messageId:string, content:string, type:string,replyToMessageId:string}) => {
    try {
      console.log("================> Send saved message.......",JSON.stringify(data));
     const {sender, messageId, content, type,replyToMessageId} = data;
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
      if(replyToMessageId){
          repliedMessage = await savedmessagesSchema.findOne({messageId: replyToMessageId})
          .populate({
              path: "sender",
              select: "name userName profilePicture countryCode phone countryISOCode isOnline lastSeen email"
          });
      }
      
        // Check if the message is already saved
        const existingSavedMessage = await savedmessagesSchema.findOne({ sender:sender, messageId:tempMessageId.toString() });
        if (existingSavedMessage) {
            socket.emit("message_already_saved", {
            status: 404,
            code: "ALREADY_EXISTS",
            message: "Message is already saved.",
          });
          return;
        }

    

                const newSavedMessage = new savedmessagesSchema({
                    messageId:tempMessageId.toString(),
                    content: content !== null ? content : "",
                    fileIds: [],
                    files: [],
                    userId: sender, // ✅ Fix: Store sender as a string (not ObjectId)
                    sender: sender,
                    savedAt: new Date(),
                    replyTo: replyToMessageId
                });
                // Save the text message
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
              bio:senderDetails?.bio, 
              email:senderDetails?.email, 
              isOnline:senderDetails?.isOnline, 
              countryCode:senderDetails?.countryCode, 
              countryISOCode:senderDetails?.countryISOCode,
              profilePrivacy: senderDetails?.profilePrivacy
          },
          messageId: tempMessageId,
          type: newSavedMessage.type,
          fileIds: [],
          files: [],
          content: newSavedMessage.content,
          // createdAt: "2025-03-20T10:39:18.682Z",
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
          reactOnMessage:newSavedMessage.reactOnMessage.map(r => r.emoji) || [],
          pinned: newSavedMessage.pinned,
          isEditedMessage: newSavedMessage.isEditedMessage,
          createdAt: newSavedMessage.savedAt
      }
  
  }

  console.log("------------------------->response", JSON.stringify(response));
      
      // Emit success response
      // Notify the user that a message has been saved (optional)
      const userSocketId = userSocketMap[sender.toString()]

      if(userSocketId){
        io.to(userSocketId).emit("messageSaved", { messageId:tempMessageId, message: response });
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
  })

  socket.on("edit_saved_message", async ({ messageId, editedContent, userId }, callback) => {
    try {
      
        // Fetch the message
        const message = await savedmessagesSchema.findOne({messageId: messageId});
        if (!message) {
          return socket.emit("error_message",{message: "Message not found."})
        }
  
        // Check if the user is the sender
        if (message.sender.toString() !== userId) {
            return socket.emit("error_message",{message: "You can only edit your own messages."})
        }
  
        // Check if 24 hours have passed
        const messageTimestamp:any = new Date(message.savedAt); // Get message creation time
        const currentTime:any = new Date(); // Get current time
        const timeDifference = (currentTime - messageTimestamp) / (1000 * 60 * 60); // Convert milliseconds to hours

        if (timeDifference > 24) {
            return socket.emit("error_message", { message: "You cannot edit messages after 24 hours." });
        }

        // Update the message content
        message.content = editedContent;
        message.isEditedMessage = true;
        // message.updatedAt = new Date();
        await message.save();
  
        const senderDetails = await userSchema.findById(userId).select("userName name profilePicture lastSeen bio email isOnline countryCode countryISOCode");
  
        
      let repliedMessage;
        if(message.replyTo){
          repliedMessage = await savedmessagesSchema.findOne({messageId: message.replyTo})
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
                    bio:senderDetails?.bio, 
                    email:senderDetails?.email, 
                    isOnline:senderDetails?.isOnline, 
                    countryCode:senderDetails?.countryCode, 
                    countryISOCode:senderDetails?.countryISOCode,
                    profilePrivacy: senderDetails?.profilePrivacy
                },
                type: message.type,
                fileIds: [],
                files: [],
                content: message.content,
                // createdAt: "2025-03-20T10:39:18.682Z",
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
                reactOnMessage:message.reactOnMessage.map(r => r.emoji) || [],
                pinned: message.pinned,
                isEditedMessage: message.isEditedMessage,
                createdAt: message.savedAt
            }
        
        }
  
        const socketId = userSocketMap[userId.toString()];
        
        if (socketId) {
          loggerMsg(`receiverSocketId is online...!`,"debug")
            io.to(socketId).emit("receive_saved_edit_message", {
                ...response,
                status: "read",
                isRead: true,
                encryptedAESKey: ""
            });
        }
  
        // return callback(null, { status: 200, message: "Message updated successfully." });
    } catch (error) {
        console.error("Error in editMessage:", error);
        // return callback({ status: 500, message: "Internal server error." });
        return socket.emit("error_message",{message:"Edit message error."})
    }
  });
  
  socket.on("react_saved_message", async ({ messageId, reactions, userId }, callback) => {
    try {  
      // Fetch the message
        const message = await savedmessagesSchema.findOne({messageId: messageId});
        if (!message) {
          return socket.emit("error_message",{message: "Message not found."})
        }
  
        // Check if the user is the sender
        if (message.sender.toString() !== userId) {
            return socket.emit("error_message",{message: "You can only edit your own messages."})
        }
        
        interface Reaction {
        userId: mongoose.Types.ObjectId;
        emoji: string;
      }

      const existingReactions: Reaction[] = message.reactOnMessage || [];
      const updatedReactions: Reaction[] = [...existingReactions];

      // reaction is the new incoming array. You want to either replace or add the user’s reaction
      for (const newReact of reactions) {
        if (typeof newReact !== "string") continue;

        const userReactIndex = updatedReactions.findIndex(
          (r:any) => r.userId.toString() === userId.toString()
        );

        if(userReactIndex !== -1){
          // Replace the emoji for this user
          updatedReactions[userReactIndex].emoji = newReact;  // replace old emoji
        }else{
          updatedReactions.push({userId: new mongoose.Types.ObjectId(userId), emoji: newReact})
        }
      }
      message.reactOnMessage = updatedReactions;

        // Update the message content
        // message.content = editedContent;
        message.reactions = reactions;
        // message.updatedAt = new Date();
        await message.save();
  
        const senderDetails = await userSchema.findById(userId).select("userName name profilePicture lastSeen bio email isOnline countryCode countryISOCode");

        let repliedMessage;
        if(message.replyTo){
          repliedMessage = await savedmessagesSchema.findOne({messageId: message.replyTo})
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
                  bio:senderDetails?.bio, 
                  email:senderDetails?.email, 
                  isOnline:senderDetails?.isOnline, 
                  countryCode:senderDetails?.countryCode, 
                  countryISOCode:senderDetails?.countryISOCode,
                  profilePrivacy: senderDetails?.profilePrivacy
              },
              type: message.type,
              fileIds: [],
              files: [],
              content: message.content,
              // createdAt: "2025-03-20T10:39:18.682Z",
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
              reactOnMessage:message.reactOnMessage.map(r => r.emoji) || [],
              pinned: message.pinned,
              isEditedMessage: message.isEditedMessage,
              createdAt: message.savedAt
          }
      
      }
  
        const socketId = userSocketMap[userId.toString()];
        
        if (socketId) {
            io.to(socketId).emit("react_saved_message", {
                ...response,
                status: "read",
                isRead: true,
                encryptedAESKey: ""
            });
        }
  
        // return callback(null, { status: 200, message: "Message updated successfully." });
    } catch (error) {
        console.error("Error in editMessage:", error);
        // return callback({ status: 500, message: "Internal server error." });
        return socket.emit("error_message",{message:"Edit message error."})
    }
  });
  
  socket.on("pin_saved_message", async(data, callback) =>{
    try {
      const {messageId,userId} = data;
  
      // find the messages
      const message = await savedmessagesSchema.findOne({messageId});
      if(!message){
        return socket.emit("error_message",{message: "Message not found."})
      }
      // update message as pinned
      message.pinned = true;
      await message.save();
      const senderDetails = await userSchema.findById(userId).select("userName name profilePicture lastSeen bio email isOnline countryCode countryISOCode");

      let repliedMessage;
        if(message.replyTo){
          repliedMessage = await savedmessagesSchema.findOne({messageId: message.replyTo})
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
                  bio:senderDetails?.bio, 
                  email:senderDetails?.email, 
                  isOnline:senderDetails?.isOnline, 
                  countryCode:senderDetails?.countryCode, 
                  countryISOCode:senderDetails?.countryISOCode,
                  profilePrivacy: senderDetails?.profilePrivacy
              },
              type: message.type,
              fileIds: [],
              files: [],
              content: message.content,
              // createdAt: "2025-03-20T10:39:18.682Z",
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
              reactOnMessage:message.reactOnMessage.map(r => r.emoji) || [],
              pinned: message.pinned,
              isEditedMessage: message.isEditedMessage,
              createdAt: message.savedAt
          }
      }
      const socketId= userSocketMap[userId.toString()];
      if(socketId){
        io.to(socketId).emit("saved_message_pinned",{pinMessage: response})
      }
     
    } catch (error) {
      return socket.emit("error_message",{message: "Error from pinMessage"})
    }
  })

  socket.on("saved_message_unpin",async(data) => {
    try {
      const {messageId, userId} = data;
      // find the message and update it.
      const message = await savedmessagesSchema.findOne({messageId: messageId});
      if(!message){
        return socket.emit("error_message",{message : "Message not found."})
      }
      message.pinned = false;
      await message.save();
  
      const senderDetails = await userSchema.findById(userId).select("userName name profilePicture lastSeen bio email isOnline countryCode countryISOCode");

      let repliedMessage;
        if(message.replyTo){
          repliedMessage = await savedmessagesSchema.findOne({messageId: message.replyTo})
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
                bio:senderDetails?.bio, 
                email:senderDetails?.email, 
                isOnline:senderDetails?.isOnline, 
                countryCode:senderDetails?.countryCode, 
                countryISOCode:senderDetails?.countryISOCode,
                profilePrivacy: senderDetails?.profilePrivacy
            },
            type: message.type,
            fileIds: [],
            files: [],
            content: message.content,
            // createdAt: "2025-03-20T10:39:18.682Z",
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
            reactOnMessage:message.reactOnMessage.map(r => r.emoji) || [],
            pinned: message.pinned,
            isEditedMessage: message.isEditedMessage,
            createdAt: message.savedAt
        }
      }
      // Emit event all the participants
      // @ts-ignore
        const socketId= userSocketMap[userId.toString()];
        if(socketId){
          io.to(socketId).emit("saved_message_unpin",{ pinMessage: response})
        }
      
    } catch (error) {
      return socket.emit("error_message",{message: "Error message to unpinMessage"});
    }
  })

  socket.on("saved_forward_message", async (data, callback) => {
  try {
    const {content,mediaContent, sender, messageId, targetChatId, currentChatId} = data;

    const senderDetails = await userSchema.findById(sender);
    // const removedUser = await chatParticipantSchema.findOne({userId:sender, chatId:currentChatId, isRemoved: true}).select("isRemoved");
    // if(removedUser){
    //   return socket.emit("error_message",{message: "You can't send message because you are no longer a member of the group."})
    // }
    
    // Fetch original message
    const originalMessage = await savedmessagesSchema.findOne({messageId: messageId});
    if(!originalMessage){
      return socket.emit("error_message",{message: "Message not found."})
    }

    // Fetch the AES key of the original chat
    // const sourceChat = await chatSchema.findOne({ _id: originalMessage.chatId }).select("encryptedAESKey");
    // if (!sourceChat || !sourceChat.encryptedAESKey) {
    //   return socket.emit("error_message", { message: "Source chat encryption key not found." });
    // }
              
    const forwardedMessages = [];

  
      const conversation = await chatSchema.findOne({_id: targetChatId}).select("participants encryptedAESKey");

      
      if(!conversation) {
        return socket.emit("error_message",{message: "Chat not found."})
      } 
      
      const newMessageId = new mongoose.Types.ObjectId().toString();

      

      // Save the forwarded message
      const newForwardedMessage  = new messageSchema({
        chatId: targetChatId,
        sender,
        content: content,
        type: originalMessage.type,
        fileIds: originalMessage.fileIds,
        files: originalMessage.files,
        messageId: newMessageId,
        forwarded: true,
        originalMessageId:originalMessage.messageId
      })
      await newForwardedMessage.save()
      
      // forwardedMessages.push(newForwardedMessage)

      if(mediaContent){
        const newContentMessage  = new messageSchema({
          chatId: targetChatId,
          sender,
          content: mediaContent,
          type: "text",
          fileIds: [],
          files: [],
          messageId: new mongoose.Types.ObjectId().toString(),
          forwarded: false,
          originalMessageId:null
        })
        await newContentMessage.save()
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
        // type,
        fileIds:[],
        fileUrls: [],
        createdAt: new Date().toISOString(),
        messageId: messageId || new mongoose.Types.ObjectId().toString(),
        status: "sent",
        isRead: false,
    };
      // Emit new message to users in this conversation
      for (const participant of conversation.participants) {
        const socketId = userSocketMap[participant.toString()]
        io.to(socketId).emit("receive_message",{
          ...response, 
          status: "read",
          isRead: true,
          encryptedAESKey: conversation.encryptedAESKey || ""
        })
      }
  } catch (error) {
    return socket.emit("error_message",{message: "Error from forward message."});
  }
})


  socket.on("unread-notification-count", async ({userId}) => {
    try {

        const unreadCount = await notificationSchema.countDocuments({
            receiverId: userId,
            isRead: false
        });

        // Emit the unread count back to the user
        socket.emit("unread-notification-count-response", {
            unreadCount
        });
    } catch (error) {
        socket.emit("unread-notification-count-response", {
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred.",
            unreadCount: 0
        });
    }
});
  
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

    // ✅ Update participant status to "joined"
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

    socket.join(callId);  // ✅ User joins Socket.IO room
    activeCalls.set(userId, callId);  // ✅ Store active call mapping

    // ✅ Notify all participants
    io.to(callId).emit("userJoined", { userId });

  } catch (error: any) {
    loggerMsg(`Error in join-call event: ${error}`, "debug");
    socket.emit("error_message", { message: error.message });
  }
});

// User leaves the group call
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

    // ✅ Update participant status to "left"
    await callHistory.updateOne(
      { callId, "participants.userId": userId },
      { 
        $set: { 
          "participants.$.status": "left", 
          "participants.$.leaveTime": new Date() 
        } 
      }
    );

    socket.leave(callId);  // ✅ Remove user from Socket.IO room

    // ✅ Check active participants
    const activeParticipants = call.participants.filter(p => p.status === "joined");

    if (activeParticipants.length === 1) {
      // ✅ Only 1 participant left → End Call
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

    // ✅ Notify all remaining participants
    io.to(callId).emit("userLeft", { userId });

  } catch (error: any) {
    loggerMsg(`Error in leave-call event: ${error}`, "debug");
    socket.emit("error_message", { message: error.message });
  }
});




// Call ends (host ends it)
// socket.on("end-call", async ({ user_id, callId, duration }) => {
//   try {
//     const call = await callHistory.findOne({ callId });

//     if (!call) {
//       return socket.emit("error_message", { message: "Call not found" });
//     }

    
//     // If it's a group call, only the startedBy user can end it
//     if (call.participants.length > 2 && call.startedBy.toString() !== user_id) {
//       return 
//       // socket.emit("error_message", { message: "Only the caller can end the group call" });
//     }

//     console.log("++++++++++++ call duration ++++++++++++++++++++=",duration)
//     const updateFields: any = { 
//       isEnded: true, 
//       endTime: new Date(), 
//       callStatus: duration === 0 ? CallStatus.MISSED : CallStatus.ENDED,
//       endedBy: user_id 
//     };

//     // Add duration field only for one-to-one calls
//     if (call.participants.length > 0 && 
//       (call.callType === CallType.VIDEO || call.callType === CallType.VOICE)) {
//       updateFields.duration = duration;
//     }

//     // Update the call history
//     const updatedCall = await callHistory.findOneAndUpdate(
//       { callId },
//       { $set: updateFields },
//       { new: true }
//     );

//     if (!updatedCall) {
//       return socket.emit("error_message", { message: "Failed to update call status" });
//     }

//     let callStatus = duration === 0 ? "missed" : "completed"; 
//     // Notify all participants that the call has ended
//     // 🚀 Exclude the user who ended the call
//     updatedCall.participants.forEach(async (p) => {
//       if (p.userId.toString() !== user_id) {
//         io.to(p.userId.toString()).emit("call-ended", { user_id, duration, status: callStatus });

//         // Sent Notification
//             const notificationPayload = {
//               title: `End call.`,
//               body: `212Messenger end call`,
//               click_action: CLICK_NOTIFICATION_TYPE,
//               type: "agora_end_call",
//               // chat_id: chatId,
//               // sender: JSON.stringify(userDetails),
//               // channel_name: channelName,
//               // token,
//               // call_type:
//               //     type === CallType.VOICE
//               //         ? CallType.VOICE
//               //         : type === CallType.VIDEO
//               //         ? CallType.VIDEO
//               //         : type === CallType.VIDEO_GROUP_CALL
//               //         ? CallType.VIDEO_GROUP_CALL
//               //         : CallType.VOICE_GROUP_CALL,
//               // groupImage,
//               // groupName,
//               // senderId: userId.toString(),
//               // receiverId: participantId.toString(),
//               // callId: newCallHistory.callId,
//               // deviceType: `${receiverDeviceType?.deviceType}`,
//               // isInComeingCall:isInComeingCall,
//               isMuteNotification: false
//           };

//           await sentPushNotificationToUser(p.userId.toString(), notificationPayload);
//           loggerMsg("Push notification sent successfully", "debug");
//       }
//     });
    
//     // Merge leave-call logic for all participants
//     const leaveTime = new Date();
//     const participantUpdates = updatedCall.participants.map((p) => ({
//       userId: p.userId,
//       leaveTime,
//       totalDuration: p.joinTime ? Math.floor((leaveTime.getTime() - p.joinTime.getTime()) / 1000) : 0
//     }));

//     // Update all participants' status to "left"
//     await Promise.all(
//       participantUpdates.map(({ userId, leaveTime, totalDuration }) =>
//         callHistory.updateOne(
//           { callId, "participants.userId": new mongoose.Types.ObjectId(userId) },
//           { $set: { 
//               "participants.$.status": "left", 
//               "participants.$.leaveTime": leaveTime,
//               "participants.$.totalDuration": totalDuration
//             } 
//           }
//         )
//       )
//     );

//     // Notify users and remove them from active calls
//     updatedCall.participants.forEach((p) => {
//       if (p.userId) {
//         io.to(callId).emit("userLeft", { userId: p.userId });
//         activeCalls.delete(p.userId.toString());
//       }
//     });

//   } catch (error: any) {
//     loggerMsg(`Error in end-call event: ${error}`, "debug");
//     socket.emit("error_message", { message: error.message });
//   }
// });

// ==============================================================
// socket.on("end-call", async ({ user_id, callId, duration }) => {
//   try {
    
//     const call = await callHistory.findOne({ callId });

//     if (!call) {
//       return socket.emit("error_message", { message: "Call not found" });
//     }

//     // 1. **One-to-One Call:**
//     // For one-to-one calls, when either user ends the call, the other user's call is automatically cut
//     if (call.participants.length === 2) {
//       const otherUser = call.participants.find(p => p.userId.toString() !== user_id);
//       if (otherUser) {
//         io.to(otherUser.userId.toString()).emit("call-ended", { user_id, duration, status: "missed" });
//       }
//     }

//     // 2. **Group Call:**
//     if (call.participants.length > 2) {
//       // If the user who ends the call is not the host (startedBy), return an error (only host can end the call)
//       if (call.startedBy.toString() !== user_id) {
//         // return socket.emit("error_message", { message: "Only the caller can end the group call" });
//         return
//       }

//       // Host (startedBy) can end the call for all participants
//       call.participants.forEach(async (p) => {
//         if (p.userId.toString() !== user_id) {
//           io.to(p.userId.toString()).emit("call-ended", { user_id, duration, status: "completed" });
          
//           // Send notification
//           const notificationPayload = {
//             title: `End call.`,
//             body: `Call has ended.`,
//             click_action: CLICK_NOTIFICATION_TYPE,
//             type: "agora_end_call",
//             isMuteNotification: false
//           };
//           await sentPushNotificationToUser(p.userId.toString(), notificationPayload);
//           loggerMsg("Push notification sent successfully", "debug");
//         }
//       });
//     }

//     // 3. **Group Call with Two Participants:**
//     if (call.participants.length === 2) {
//       const otherUser = call.participants.find(p => p.userId.toString() !== user_id);
//       if (otherUser) {
//         io.to(otherUser.userId.toString()).emit("call-ended", { user_id, duration, status: "missed" });
//       }
//     }

//     console.log("+++++++++++++++++++ duration ++++++++++++++++++",user_id, callId ,duration)
//     // Now, declare updatedCall here after logic execution
//     let updateFields: any = { 
//       isEnded: true, 
//       endTime: new Date(), 
//       callStatus: duration === 0 ? CallStatus.MISSED : CallStatus.ENDED,
//       endedBy: user_id 
//     };
//     console.log("++++++++++++++++++++++= Update Fields ++++++++++++++++",updateFields);
//     console.log("+++++++++++++ ")
//     // Add duration for voice/video calls
//     if (call.callType === CallType.VIDEO || call.callType === CallType.VOICE) {
//       updateFields.duration = duration;
//     }
//     console.log("++++++++++++++++++++++= Update Fields ++++++++++++++++",updateFields);

//     console.log("+++++++++++++= callId ++++++++++++++++++",callId)
//     // Update the call history
//     const updatedCall = await callHistory.findOneAndUpdate(
//       { callId },
//       { $set: updateFields },
//       { new: true }
//     );

//     if (!updatedCall) {
//       return socket.emit("error_message", { message: "Failed to update call status" });
//     }

//     let callStatus = duration === 0 ? "missed" : "completed"; 
//     updatedCall.participants.forEach(async (p) => {
//       if (p.userId.toString() !== user_id) {
//         io.to(p.userId.toString()).emit("call-ended", { user_id, duration, status: callStatus });

//         // Send Notification
//         const notificationPayload = {
//           title: `End call.`,
//           body: `212Messenger end call`,
//           click_action: CLICK_NOTIFICATION_TYPE,
//           type: "agora_end_call",
//           isMuteNotification: false
//         };

//         await sentPushNotificationToUser(p.userId.toString(), notificationPayload);
//         loggerMsg("Push notification sent successfully", "debug");
//       }
//     });

//     // Merge leave-call logic for all participants
//     const leaveTime = new Date();
//     const participantUpdates = updatedCall.participants.map((p) => ({
//       userId: p.userId,
//       leaveTime,
//       totalDuration: p.joinTime ? Math.floor((leaveTime.getTime() - p.joinTime.getTime()) / 1000) : 0
//     }));

//     // Update all participants' status to "left"
//     await Promise.all(
//       participantUpdates.map(({ userId, leaveTime, totalDuration }) =>
//         callHistory.updateOne(
//           { callId, "participants.userId": new mongoose.Types.ObjectId(userId) },
//           { $set: { 
//               "participants.$.status": "left", 
//               "participants.$.leaveTime": leaveTime,
//               "participants.$.totalDuration": totalDuration
//             } 
//           }
//         )
//       )
//     );

//     // Notify users and remove them from active calls
//     updatedCall.participants.forEach((p) => {
//       if (p.userId) {
//         io.to(callId).emit("userLeft", { userId: p.userId });
//         activeCalls.delete(p.userId.toString());
//       }
//     });

//   } catch (error: any) {
//     loggerMsg(`Error in end-call event: ${error}`, "debug");
//     socket.emit("error_message", { message: error.message });
//   }
// });


socket.on("end-call", async ({ user_id, callId, duration }) => {
  try {
    console.log("++++++++++++++++++++ END_CALL EVENT ++++++++++++++++++++++++++++++++")
    const call = await callHistory.findOne({ callId });

    if (!call) {
      return socket.emit("error_message", { message: "Call not found" });
    }

    const isGroupCall = call.participants.length > 2;

    // 🟢 **One-to-One Call End Logic**
    if (!isGroupCall) {
      // Update only the status and duration of the user who triggered the call end
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
        // Emit the call-ended event to the other participant (if exists)
        const otherUser = call.participants.find(p => p.userId.toString() !== user_id);
        if (otherUser) {
          io.to(otherUser.userId.toString()).emit("call-ended", { user_id, duration, status: "missed" });

            const notificationPayload = {
              title: `Call End.`,
              body: `Call ended.`,
              click_action: CLICK_NOTIFICATION_TYPE,
              type: NotificationType.AGORA_END_CALL,
              // chat_id: chatId,
              // sender: JSON.stringify(userDetails),
              // channel_name: channelName,
              // token,
              // call_type:
              //     type === CallType.VOICE
              //         ? CallType.VOICE
              //         : type === CallType.VIDEO
              //         ? CallType.VIDEO
              //         : type === CallType.VIDEO_GROUP_CALL
              //         ? CallType.VIDEO_GROUP_CALL
              //         : CallType.VOICE_GROUP_CALL,
              // groupImage,
              // groupName,
              // senderId: userId.toString(),
              // receiverId: participantId.toString(),
              // callId: newCallHistory.callId,
              // deviceType: `${receiverDeviceType?.deviceType}`,
              // isInComeingCall:isInComeingCall,
              isMuteNotification: false
          };

          await sentPushNotificationToUser(otherUser.userId.toString(), notificationPayload);
        }
      }
    }

    
  // console.log("activeP`articipants.........", activeParticipants.length);
  
  // if (isGroupCall) {
  //   const joinParticipant = call.participants.filter((p) => p.status === "joined");
  //   console.log("joinParticipant=============> outer",joinParticipant.length)
  //   const currentUser = joinParticipant.filter((e) => e.userId.toString() === user_id);

  //   if(currentUser[0].status === "joined"){
  //       console.log("joinParticipant=============> okay",joinParticipant.length)
  //       await callHistory.updateOne(
  //         { callId },
  //         {
  //           $set: {
  //             "participants.$[elem].status": "ended",
  //             "participants.$[elem].totalDuration": 0
  //           }
  //         },
  //         { arrayFilters: [{ "elem.userId": new mongoose.Types.ObjectId(user_id) }] }
  //       );

  //       // if(joinParticipant.length > 2){

  //       // }
  //         const notificationPayload = {
  //         title: `Call End.`,
  //         body: `Call ended.`,
  //         click_action: CLICK_NOTIFICATION_TYPE,
  //         type: NotificationType.AGORA_END_CALL,
  //         // chat_id: chatId,
  //         // sender: JSON.stringify(userDetails),
  //         // channel_name: channelName,
  //         // token,
  //         // call_type:
  //         //     type === CallType.VOICE
  //         //         ? CallType.VOICE
  //         //         : type === CallType.VIDEO
  //         //         ? CallType.VIDEO
  //         //         : type === CallType.VIDEO_GROUP_CALL
  //         //         ? CallType.VIDEO_GROUP_CALL
  //         //         : CallType.VOICE_GROUP_CALL,
  //         // groupImage,
  //         // groupName,
  //         // senderId: userId.toString(),
  //         // receiverId: participantId.toString(),
  //         // callId: newCallHistory.callId,
  //         // deviceType: `${receiverDeviceType?.deviceType}`,
  //         // isInComeingCall:isInComeingCall,
  //         isMuteNotification: false
  //         };
  //       await Promise.all(
  //       call.participants.map(async (c) => {
  //         const targetId = c?.userId?.toString();
  //         if (targetId && targetId !== user_id) {
  //           const socketId = userSocketMap[targetId];
  //           if(socketId){
  //             io.to(socketId).emit("call-ended", { user_id, duration: 0, status: c.status === "joined" ? "completed" : "missed" });
  //           }
  //           console.log("Sending notification to:", targetId);
  //           await sentPushNotificationToUser(targetId, notificationPayload);
  //         }
  //       })
  //     );

  //     return
  //   }else{
  //     console.log("------------------> moveing into else");
  //   await callHistory.updateOne(
  //     { callId },
  //     {
  //       $set: {
  //         "participants.$[elem].status": "left",
  //         "participants.$[elem].totalDuration": duration
  //       }
  //     },
  //     { arrayFilters: [{ "elem.userId": new mongoose.Types.ObjectId(user_id) }] }
  //   );
    
  //   const updatedCall = await callHistory.findOne({callId})
  //   if (!updatedCall) {
  //     return socket.emit("error_message", { message: "Call not found" });
  //   }
    
  //     const activeParticipants = updatedCall.participants.filter((p) => p.status !== "left");
  //     console.log("---------------------> activeParticipants",activeParticipants.length)
  //     if(activeParticipants.length < 2){
  //       if(activeParticipants.length === 0){
  //         return
  //       }
  //       const socketId = userSocketMap[activeParticipants[0].userId.toString()];
  //       if(socketId){
  //         io.to(socketId).emit("call-ended", { user_id, duration: 0, status: "completed" });
  //       }

  //       const notificationPayload = {
  //         title: `Call End.`,
  //         body: `Call ended.`,
  //         click_action: CLICK_NOTIFICATION_TYPE,
  //         type: NotificationType.AGORA_END_CALL,
  //         // chat_id: chatId,
  //         // sender: JSON.stringify(userDetails),
  //         // channel_name: channelName,
  //         // token,
  //         // call_type:
  //         //     type === CallType.VOICE
  //         //         ? CallType.VOICE
  //         //         : type === CallType.VIDEO
  //         //         ? CallType.VIDEO
  //         //         : type === CallType.VIDEO_GROUP_CALL
  //         //         ? CallType.VIDEO_GROUP_CALL
  //         //         : CallType.VOICE_GROUP_CALL,
  //         // groupImage,
  //         // groupName,
  //         // senderId: userId.toString(),
  //         // receiverId: participantId.toString(),
  //         // callId: newCallHistory.callId,
  //         // deviceType: `${receiverDeviceType?.deviceType}`,
  //         // isInComeingCall:isInComeingCall,
  //         isMuteNotification: false
  //     };

  //     await sentPushNotificationToUser(activeParticipants[0].userId.toString(), notificationPayload);
      
  //     }

  //   }

  //   // // ✅ Scenario 1: Only caller is left, auto-end the call
  //   // const isEveryoneDeclined = call.participants.every(p => p.status === "missed" || p.status === "left");

  //   // if (isEveryoneDeclined) {
  //   //   console.log("++++++++++++ Only caller left, auto-ending call +++++++++++++++", user_id);

  //   //   // ✅ Update call history for all users
  //   //   await callHistory.updateMany(
  //   //     { callId },
  //   //     {
  //   //       $set: {
  //   //         "participants.$[].status": "ended",
  //   //         "participants.$[].totalDuration": 0,
  //   //         isEnded: true,
  //   //         endTime: new Date(),
  //   //         callStatus: "ended",
  //   //         endedBy: user_id
  //   //       }
  //   //     }
  //   //   );

  //   //   // ✅ Notify caller that call is ended
  //   //   const socketId = userSocketMap[user_id.toString()];
  //   //   if (socketId) {
  //   //     io.to(socketId).emit("call-ended", { user_id, duration: 0, status: "completed" });
  //   //   }
  //   //   return;
  //   // }

  //   // // ✅ Scenario 2: Only one active participant is left, auto-end for them
  //   // if (activeParticipants.length === 1) {
  //   //   console.log("activeParticipants[0].userId.toString()........", activeParticipants[0].userId.toString(), user_id);

  //   //   // ✅ Ensure that the last participant gets the end event
  //   //   if (activeParticipants[0].userId.toString() !== user_id) {
  //   //     return; // ❌ Ignore if another participant is trying to end it
  //   //   }

  //   //   // ✅ Mark last participant as "ended" and store duration
  //   //   await callHistory.updateOne(
  //   //     { callId, "participants.userId": new mongoose.Types.ObjectId(user_id) },
  //   //     {
  //   //       $set: {
  //   //         "participants.$.status": "ended",
  //   //         "participants.$.totalDuration": duration
  //   //       }
  //   //     }
  //   //   );

  //   //   console.log("++++++++++++ Return call-ended 1 +++++++++++++++", user_id);
      
  //   //   // ✅ Notify the last user that the call has ended
  //   //   const socketId = userSocketMap[user_id.toString()];
  //   //   if (socketId) {
  //   //     io.to(socketId).emit("call-ended", { user_id, duration, status: "completed" });
  //   //   }

  //   //   return;
  //   // }
  // }

  if(isGroupCall){
    const participants = call.participants;
    const joinedUsers = participants.filter(p => p.status === "joined");
    const missedUsers = participants.filter(p => p.status === "missed");
    const missedAndJoinedUser = participants.filter(p => p.status !== "left");

    const sendNotifications = async (users:any) => {
        await Promise.all(
            users.map(async (c:any) => {
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
    if(rejectcall && duration === 0){
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

      // ✅ Now check how many joined users are left
      const updatedCallDoc = await callHistory.findOne({ callId });
      if(!updatedCallDoc) return
      const joinedUsers = updatedCallDoc.participants.filter(p => p.status === "joined");
      const missedUsers = updatedCallDoc.participants.filter(p => p.status === "missed");
      

      const total = joinedUsers.length + missedUsers.length;
      if (total <= 1) {
          // Only caller is left → End the call for everyone
          call.participants.forEach(p => {p.status = "ended";});
          await call.save();
          const socketId = userSocketMap[joinedUsers[0].userId.toString()];
          if (socketId) {
              io.to(socketId).emit("call-ended", {
                  user_id,
                  duration: 0,
                  status: "ended"
              });
          }
          // await sendNotifications(call.participants); // Notify all that call ended
      }
      return // Don't end the entire call
    }

    const notificationPayload = {
          title: `Call End.`,
          body: `Call ended.`,
          click_action: CLICK_NOTIFICATION_TYPE,
          type: NotificationType.AGORA_END_CALL,
          // chat_id: chatId,
          // sender: JSON.stringify(userDetails),
          // channel_name: channelName,
          // token,
          // call_type:
          //     type === CallType.VOICE
          //         ? CallType.VOICE
          //         : type === CallType.VIDEO
          //         ? CallType.VIDEO
          //         : type === CallType.VIDEO_GROUP_CALL
          //         ? CallType.VIDEO_GROUP_CALL
          //         : CallType.VOICE_GROUP_CALL,
          // groupImage,
          // groupName,
          // senderId: userId.toString(),
          // receiverId: participantId.toString(),
          // callId: newCallHistory.callId,
          // deviceType: `${receiverDeviceType?.deviceType}`,
          // isInComeingCall:isInComeingCall,
          isMuteNotification: false
    };

    if (joinedUsers.length === 1 && missedUsers.length > 0) {
    // Case 1: Caller joined, others missed
    participants.forEach(p => { p.status = "ended"; });
    await call.save();
    await sendNotifications(missedAndJoinedUser);

    } else if (joinedUsers.length === 2) {
        // Case 2: Two users joined
        participants.forEach(p => { p.status = "ended"; });
        await call.save();
        await sendNotifications(missedAndJoinedUser);

    } else {
        // Case 3: More than 2 joined
        if (joinedUsers.length > 2) {
            if (joinedUsers.length - 1 <= 1) {
                // After current user leaves, only 1 left → End call
                participants.forEach(p => { p.status = "ended"; });
                await call.save();
                await sendNotifications(missedAndJoinedUser);
            } else {
                // Just mark this user as left
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


    // ✅ Update Call History for the user who ended the call
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

      // Update auto-delete time
      chat.messageAutoDeleteTime = messageAutoDeleteTime > 0 ? Number(messageAutoDeleteTime) : null;
      chat.messageAutoDeleteStartTime = messageAutoDeleteTime > 0 ? new Date() : null;
      await chat.save();

      // Get sender details
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
              bio:senderDetails?.bio, 
              email:senderDetails?.email, 
              isOnline:senderDetails?.isOnline, 
              countryCode:senderDetails?.countryCode, 
              countryISOCode:senderDetails?.countryISOCode,
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

      // Send message to all participants
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

      // Save disappearing message in DB
      const newMessage = new messageSchema({
          chatId,
          sender: userId,
          content: null,
          type: "disappearing_messages",
          status: "read",
          isRead: true,
          messageId: tempMessageId,
          disAppearingMessages:messageAutoDeleteTime
      });

      await newMessage.save();

      // Call the callback to confirm success
      if (callback) callback({ success: true, message: "Disappearing messages updated successfully" });

  } catch (error) {
      console.error("Error in updateMessageAutoDeleteTime:", error);
      return socket.emit("error_message", { message: "Error from updateMessageAutoDeleteTime" });
  }
});

socket.on("pinUnpinConversation",async(data)=>{
  const {userId, chatId, isPin} = data
  try {
    if(isPin){
      await chatParticipantSchema.updateOne(
        {userId,chatId},
        {
          $set: {
            isPinned: true,
            pinnedAt: new Date()
          }
        }
      )
    }else{
      await chatParticipantSchema.updateOne(
        {userId,chatId},
        {
          $set: {
            isPinned: false,
            pinnedAt: null
          }
        }
      )
    }

    const socketId = userSocketMap[userId.toString()]
    if(socketId){
      io.to(socketId).emit("pinConvesation",{userId, chatId, isPin});
    }
  } catch (error) {
    console.error("Error in updateMessageAutoDeleteTime:", error);
    return socket.emit("error_message", { message: "Error from pinConversation" });
  }
})

socket.on("muteUnmuteConversation",async(data) => {
  const {chatId, userId, isMuted} = data
  try {
    if(isMuted){
      await chatParticipantSchema.updateOne(
        {chatId, userId},
        {
          $set: {
            isNotificationMute: true
          }
        }
      )
    }else{
      await chatParticipantSchema.updateOne(
        {chatId, userId},
        {
          $set: {
            isNotificationMute: false
          }
        }
      )
    }

    const socketId = userSocketMap[userId.toString()]
    if(socketId){
      io.to(socketId).emit("muteConvesation",{userId, chatId, isMuted});
    }
  } catch (error) {
    console.error("Error in muteUnmute Conversations:", error);
    return socket.emit("error_message", { message: "Error in muteUnmute Conversations:" });
  }
})



    // Toggle Mute/Unmute Audio
    socket.on("toggle-audio", ({channelName, userId, isMuted}) => {
      const targetSocketId = userSocketMap[userId];
      if(!targetSocketId){
        console.error(`No socket found for user ${userId}`);
        return
      }
      const room = channelName || targetSocketId;
      socket.to(room).emit("audio-toggled", { userId, isMuted})
    })



    // Toggle Enable/Disable Video
    // socket.on("toggle-video", ({channelName, userId, isVideoEnabled}) => {
    //   const targetSocketId = userSocketMap[userId];
    //   if(!targetSocketId){
    //     console.error(`No socket found for user ${userId}`);
    //     return
    //   }
    //   const room = channelName || targetSocketId;
    //   socket.to(room).emit("video-toggled", {userId, isVideoEnabled});
    // });



    // ========================== Group Call event ============================
    // Join Group Call
    socket.on("join-group-call", ({ channelName, userId }) => {
      socket.join(channelName);
      
      socket.to(channelName).emit("user-joined", { userId });
    });



    // Leave Group Call
    socket.on("leave-group-call", ({ channelName, userId }) => {
      socket.leave(channelName);
      
      socket.to(channelName).emit("user-left", { userId });
    });



    // Mute/Unmute in Group Call
    socket.on("toggle-audio-group", ({ channelName, userId, isMuted }) => {
      if (!channelName) {
        console.error("Channel name is required for group audio toggling.");
        return;
      }
      socket.to(channelName).emit("audio-toggled-group", { userId, isMuted });
    });



    // Enable/Disable Video in Group Call
    socket.on("toggle-video-group", ({ channelName, userId, isVideoEnabled }) => {
      if (!channelName) {
        console.error("Channel name is required for group video toggling.");
        return;
      }
      socket.to(channelName).emit("video-toggled-group", { userId, isVideoEnabled });
    });

    // typeing start/stop event
    socket.on("typing", async ({ chatType, chatId, sender, isTyping }) => {
      // console.log("============> typing event call",chatType, chatId, JSON.stringify(sender), isTyping)
      try {
          const chat = await chatSchema.findById(chatId);
          if (!chat || !chat.participants) {
              socket.emit("typing-error", { message: "Chat not found" });
              return;
          }
  
          // ✅ Fetch active participants (not removed)
          const activeParticipants = await chatParticipantSchema.find({
              chatId,
              userId: { $ne: sender._id },
              isRemoved: false, // 🚀 Removed members won't receive typing events
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
  
  socket.on("logout", async (data) => {
    const {userId} = data
    try {
        delete userSocketMap[userId.toString()]; // Ensure user is removed from socket map
                  
        const lastSeen = new Date();
    
        socket.broadcast.emit("user-online-success", { userOnline: "typing",userId, isOnline:false, lastSeen,lastOnline: lastSeen });
    
        userOnlineStatusMap[userId] = false;
    
        // Update lastSeen only when the user goes offline
          await userSchema.updateOne(
            { _id: userId },
            { $set: { lastSeen, isOnline: false, lastOnline: lastSeen } }
        );
    } catch (error) {
        console.error("Error in typing event:", error);
        socket.emit("logout-error", { message: "An error occurred" });
    }
  })
  
  socket.on("set_user_is_online",async (data) => {
    try {
      const now = new Date();
      const {userId} = data;
      
      const user = await userSchema.findById(userId).select('isOnline');
      await userSchema.updateOne(
        {_id: userId, isDeleted: false},
        {lastOnline: now, isOnline: true, lastSeen: null}
      )
      if(!user?.isOnline){
        socket.broadcast.emit("user-online-success",{userOnline: "set_user_is_online",userId,lastOnline: now, isOnline: true, lastSeen: null });
      }
    
    } catch (error) {
      console.error("Error in set_user_is_online event:", error);
      socket.emit("set_user_is_online_error", { message: "An error occurred" });
    }
  })
    

    socket.on("disconnect", (reason) => {
  
      // loggerMsg("disconnect event hit...", "debug");
      // console.log("disconnect event hit...");
      // console.log("Reason for disconnect:", reason); // 🔥 this shows why socket disconnected
      // console.log("==================>", JSON.stringify(userSocketMap));
      for (const userId in userSocketMap) {
          if (userSocketMap[userId] === socket.id) {
              //  console.log("+++++++++++++++++++++++++++ User Disconnected +++++++++++++++++++++++++++", userId.toString());
                // console.log(`Disconnected socket ID: ${socket.id}`);
                // console.log(`Disconnect reason: ${reason}`);
                // console.log(`Connected users before cleanup: \n${JSON.stringify(userSocketMap)}`);
              
                // Clean up
                // delete userSocketMap[userId];
                // socket.broadcast.emit("user-offline", { userId });

                // console.log(`Connected users after cleanup: \n${JSON.stringify(userSocketMap)}`);
                // break;
          }
      }
    });


  
    // socket.on("disconnect", () => {
    //     console.log("Client disconnected:", socket.id);
    // });
  });
}


// export const initDemoSocketHandlers = (io: Server) => {
//   io.on('connection', (socket: Socket) => {
//     console.log('A user connected:', socket.id);

//     // Handle user login and save socket ID
//     socket.on('login', (userId: string) => {
//       userSocketMap[userId] = socket.id;
//       console.log(`User ${userId} logged in with socket ID ${socket.id}`);
//     });

//     // Handle sending messages
//     // socket.on('send_message', async (data) => {
//     //   const { sender, receiver, message } = data;
//     //   const senderInfo = await User.findById(sender).select("_id firstName");
//     //   const receiverInfo = await User.findById(receiver).select("_id firstName");

//     //   // Check if a chat exists between the sender and receiver
//     //   let chat = await Chat.findOne({
//     //     type: 'single',
//     //     participants: {
//     //       $all: [
//     //         { $elemMatch: { user: sender } },
//     //         { $elemMatch: { user: receiver } },
//     //       ],
//     //     },
//     //   });
  
//     //   if (!chat) {
//     //     // Create a new chat if none exists
//     //     chat = new Chat({
//     //       type: 'single',
//     //       participants: [
//     //         { user: new mongoose.Types.ObjectId(sender), role: 'member' },
//     //         { user: new mongoose.Types.ObjectId(receiver), role: 'member' },
//     //       ],
//     //     });
//     //     await chat.save();
//     //   }

//     //   // Save message to the database
//     //   const chatMessage = new Message({
//     //     chat: chat._id,
//     //     sender: new mongoose.Types.ObjectId(sender),
//     //     content: message,
//     //   });
//     //   await chatMessage.save();

//     //   // Update the chat's lastMessage and increment unreadCount for the receiver
//     //   await Chat.findByIdAndUpdate(chat._id, {
//     //     lastMessage: chatMessage._id,
//     //     $inc: { unreadCount: 1 },
//     //   });

//     //   // Emit the message to the receiver if online
//     //   const receiverSocketId = userSocketMap[receiver];
//     //   if (receiverSocketId) {
//     //     io.to(receiverSocketId).emit('receive_message', {
//     //       senderInfo,
//     //       receiverInfo,
//     //       message,
//     //       chatId: chat._id,
//     //       messageId: chatMessage._id,
//     //       timestamp: chatMessage.createdAt,
//     //     });
//     //   }
//     // });

//     // Handle user disconnect
//     socket.on('disconnect', () => {
//       console.log('User disconnected:', socket.id);
//       for (const userId in userSocketMap) {
//         if (userSocketMap[userId] === socket.id) {
//           delete userSocketMap[userId];
//           break;
//         }
//       }
//     });
//   });
// };



