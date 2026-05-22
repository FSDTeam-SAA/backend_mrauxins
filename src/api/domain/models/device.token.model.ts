import mongoose from "mongoose";
import { saveDeviceToken } from "../../helper/helper";
import { loggerMsg } from "../../lib/logger";
import admin from "../../services/firebase";
import { deviceToken } from "../schema/devicetoken.schema";
import notificationSchema, { NotificationType } from "../schema/notification.schema";
import { ChatType } from "../schema/chat.schema";
import { CallType } from "../schema/callhistory.schema";
import { getIo } from "../../../infrastructure/webserver/express/v1";
import { userSocketMap } from "../../socket/initDemoSocketHandlers";


export const saveDeviceTokenLogic = async(
    userId:string, 
    deviceToken: string,
    deviceType: string,
    callback:(error:any,result: any) => void
) => {
    try {
        await saveDeviceToken(userId, deviceToken, deviceType);
        return callback(null, "Token Saved successfully.")
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        },null)
    }
}

export const deleteDeviceTokenApiLogic = async(
    userId: string,
    token: string,
    callback:(error:any,result: any) => void
)=>{
    try {
        // If deviceToken is provided, find and delete it.
        const deleteCriteria:{deviceToken?: string, userId?: mongoose.Types.ObjectId} = {};
        if(deviceToken) deleteCriteria.deviceToken = token
        if(userId) deleteCriteria.userId = new mongoose.Types.ObjectId(userId);

        // Attempt to delete the device token from the database.
        const deletedToken = await deviceToken.findOneAndDelete(deleteCriteria);

        // if(!deletedToken){
        //     return callback({
        //         status:404,
        //         code:"DEVICE_TOKEN_NOT_FOUND",
        //         message:"Device token not found"
        //     },null)
        // }

        return callback(null,"Device token deleted successfully")
    } catch (error) {
        return callback(null,"Device token deleted successfully")
        // return callback({
        //     status: 500,
        //     code: "INTERNAL_SERVER_ERROR",
        //     message: error instanceof Error ? error.message : "An unexpected error occurred."
        // },null)
    }
}

export const replaceFcmToken = async(
    userId: string,
    token: string,
    deviceType: string,
    callback:(error:any,result: any) => void
) => {
    try {
        await saveDeviceToken(userId,token,deviceType)
        return callback(null, "Update successfully.")
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        },null)
    }
}
export const getUserTokens = async(userId: string) => {
    const tokens = await deviceToken.find({userId})
    return tokens.map((token) => token.deviceToken)
}

interface notificationPayload {
    title: string;
    body: string;
    click_action?: string;
    type?:string;
    chat_id?:string;
    story_id?:string;
    sender?:string;
    channel_name?:string,
    token?:string,
    call_type?:string
    sender_id?:string
    receiver_id?:string
    content?:string
    temp_message_id?:string;
    groupInfo?:any,
    chatType?:string,
    groupName?:string,
    groupImage?:string,
    receiverId?:string,
    senderId?:string,
    callId?:string,
    encryptedAESKey?:string,
    deviceType?: string,
    isInComeingCall?:boolean,
    isMuteNotification?:boolean
}

// Sent Push Notification to all devices
export const sentPushNotificationToUser = async (userId: string, {
    title, body, click_action, type, chat_id, story_id, sender,channel_name,token,call_type,sender_id,receiver_id,content,temp_message_id, groupInfo,chatType,groupName, groupImage, senderId,receiverId, callId, encryptedAESKey, deviceType, isInComeingCall, isMuteNotification}: notificationPayload
):Promise<void> => {
    
    try {
        const io = getIo()
        const tokens = await getUserTokens(userId);
        
        if(tokens.length === 0){
            loggerMsg(`No devices tokens found for the user. \n${userId}`,"debug")
            return;
        }
        
        const message :any= {
            notification : {
                title,
                body
            },
            data: {
                click_action: click_action || "",
                type: type || "",
                encryptedAESKey: encryptedAESKey || "",
                chat_id: chat_id || "",
                story_id: story_id || "",
                sender: sender || "",
                channel_name:channel_name||"",
                token :token || "",
                call_type:call_type|| "",
                receiver_id:receiver_id || "",
                sender_id:sender_id || "",
                content:content || "",
                temp_message_id:temp_message_id || "",
                // isGroup : isGroup
                groupInfo: groupInfo || "",
                chatType: chatType || NotificationType.CHAT_MESSAGE,
                groupImage: groupImage || "",
                groupName: groupName || "",
                callId: callId || ""
            },
            android:{
                priority: "high" as "high",
                 notification: {
                    sound: isMuteNotification ? "" : "default", // mute: no sound, else default sound
                },
            },
            apns:{
                // headers: {
                //     "apns-priority": "10"
                // },
                payload: {
                    aps:{
                        "content-available": 1,
                        // "sound": deviceType === "ios" && isInComeingCall ? "bell_standard_call.caf" : "default",
                        "mutable-content": 1,
                        alert: {
                            title:title,
                            body:body
                        }
                    }
                }
            },
            tokens  // Array of device tokens
        }

        if (isMuteNotification) {
            message.notification = {
                title,
                body
            };
            message.android.notification = {
                sound: undefined,  // No sound
                defaultSound: false,
                // channelId: "silent_channel", // Optional: use a silent channel
            };
        } else {
            message.notification = {
                title,
                body
            };
            message.android.notification = {
                sound: "default"
            };
        }

        
        // Always send sound for ios incoming calls
        if(deviceType === "ios" && isInComeingCall){
            message.apns.payload.aps["sound"] = "bell_standard_call.caf"
        }else if(isMuteNotification === false){
            message.apns.payload.aps["sound"] = "default"
        }else{
            // Explicitly remove the sound key if notifications are muted
            if ("sound" in message.apns.payload.aps) {
                delete message.apns.payload.aps["sound"];
            }
        }
        // Add `notification` field only for Android
        // if (deviceType === "Android") {
        //     (message as any).notification = {
        //         title,
        //         body
        //     };
        // }
        const response = await admin.messaging().sendEachForMulticast(message);  
        if(type === NotificationType.NEW_GROUP_CREATED || type === NotificationType.CREATE_NEW_CHANNEL || type === NotificationType.ASSIGN_ADMIN || type === NotificationType.CHANNEL_INVITE || type === NotificationType.DELETE_GROUP || type === NotificationType.DELETE_CHANNEL || type === NotificationType.GROUP_INVITE || type === NotificationType.REMOVED_GROUP || type === NotificationType.REMOVED_CHANNEL || type === NotificationType.LEAVE_GROUP || type === NotificationType.LEAVE_CHANNEL || type === NotificationType.AGORA_END_CALL){
            const notification = new notificationSchema({
                receiverId:new mongoose.Types.ObjectId(receiverId),
                senderId:new mongoose.Types.ObjectId(senderId),
                chatId:chat_id,
                type: type === NotificationType.NEW_GROUP_CREATED 
                    ? NotificationType.CREATE_NEW_GROUP : type == NotificationType.CREATE_NEW_CHANNEL
                    ? NotificationType.CREATE_NEW_CHANNEL :  type === NotificationType.ASSIGN_ADMIN
                    ? NotificationType.ASSIGN_ADMIN : type === NotificationType.CHANNEL_INVITE
                    ? NotificationType.CHANNEL_INVITE : type === NotificationType.GROUP_INVITE
                    ? NotificationType.GROUP_INVITE: type === NotificationType.DELETE_GROUP
                    ? NotificationType.DELETE_GROUP : type === NotificationType.DELETE_CHANNEL
                    ? NotificationType.DELETE_CHANNEL : type === NotificationType.REMOVED_GROUP
                    ? NotificationType.REMOVED_GROUP : type === NotificationType.REMOVED_CHANNEL
                    ? NotificationType.REMOVED_CHANNEL : type === NotificationType.LEAVE_GROUP
                    ? NotificationType.LEAVE_GROUP : type === NotificationType.LEAVE_CHANNEL
                    ? NotificationType.LEAVE_CHANNEL : type === NotificationType.AGORA_END_CALL
                    ? NotificationType.AGORA_END_CALL : NotificationType.OTHER, 
                content:content
            });
            await notification.save();

            const unreadCount = await notificationSchema.countDocuments({
                        receiverId: receiverId,
                        isRead: false
                    });
                    const receiver = receiverId?.toString() || ""
                    const receiverSocketId = userSocketMap[receiver];
                    // Emit the unread count back to the user
                    io.to(receiverSocketId).emit("unread-notification-count-response", {
                        unreadCount
                    });
        }

        if(call_type === CallType.VOICE || call_type === CallType.VIDEO || call_type === CallType.VIDEO_GROUP_CALL || call_type === CallType.VOICE_GROUP_CALL){
            const notification = new notificationSchema({
                receiverId:new mongoose.Types.ObjectId(receiverId),
                senderId:new mongoose.Types.ObjectId(senderId),
                chatId:chat_id,
                type:call_type === CallType.VIDEO 
                    ? NotificationType.VIDEO : call_type === CallType.VOICE
                    ? NotificationType.VOICE : call_type === CallType.VIDEO_GROUP_CALL
                    ? NotificationType.VIDEO_GRPOP_CALL : NotificationType.VOICE_GRPOP_CALL,
                content:call_type === CallType.VIDEO 
                ? "Video Call Notification" : call_type === CallType.VOICE
                ? "Voice Call Notification" : call_type === CallType.VIDEO_GROUP_CALL
                ? "Group Video Call Notification" : type === CallType.VOICE_GROUP_CALL 
                ? "Group Voice Call Notification" : "Other Notification"
            });
            await notification.save();

            const unreadCount = await notificationSchema.countDocuments({
                        receiverId: receiverId,
                        isRead: false
                    });
                    
                    const receiver = receiverId?.toString() || ""
                    const receiverSocketId = userSocketMap[receiver];
                    if(receiverSocketId){
                        // Emit the unread count back to the user
                        io.to(receiverSocketId).emit("unread-notification-count-response", {
                            unreadCount
                        });
                        
                    }
        }
        loggerMsg(`Notification saved successfully..`,"debug");
      

        // Handle errors or failed tokens
        if (response.failureCount > 0) {
            const failedTokens: string[] = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failedTokens.push(tokens[idx]);
                }
            });

            loggerMsg(
                `Failed to send notifications to some tokens: ${JSON.stringify(failedTokens)}`,
                "error"
            );
            // console.error("Failed tokens:", failedTokens);
        }
    } catch (error) {
        console.error("Error sending notification: ",error)
    }
}