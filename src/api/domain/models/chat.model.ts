import mongoose, { mongo } from "mongoose";
import chatSchema, { ChatType } from "../schema/chat.schema";
import messageSchema, { IDeliveryStatus } from "../schema/message.schema";
import { getIo } from "../../../infrastructure/webserver/express/v1";
import { getNickNameDetails, receiverOpenChat, userOnlineStatusMap, userSocketMap } from "../../socket/initDemoSocketHandlers";
import { fetchMessagesOfChat, fetchMessagesOfGroupQuery, pinnedMessagesOfChat, savedMessageOneToOne } from "./messages.model";
import userSchema from "../schema/user.schema";
import { sentPushNotificationToUser } from "./device.token.model";
import { loggerMsg } from "../../lib/logger";
import { descryptedContent, generateAESKeys, getFileSizeFromS3 } from "../../helper/helper";
import chatParticipantSchema from "../schema/chat.participant.schema";
import { BlockedUser } from "../schema/blockuser.schema";
import { TenantAwareAuth } from "firebase-admin/lib/auth/tenant-manager";
import {v4 as uuidv4} from "uuid"
import { CLICK_NOTIFICATION_TYPE, NotificationType } from "../schema/notification.schema";
import { env } from "../../../infrastructure/env";
import { buildGroupInfoPayload, buildSenderPayload } from "../../helper/notificationPayload";

interface SendMessageData {
    chatId: string;
    content: string;
    type: string;
    sender: mongoose.Types.ObjectId;
    fileUrls?: string[];
    files?: Express.Multer.File[];
    messageId?: string;
    replyToMessageId?:string;
    url?:string;
    size?:string;
    createdAt?: string
}

export const createNewChatLogic = async (
    userId1: string,
    userId2: string,
    callback: (error: any, result: any) => void
) => {
    try {
        // Check if chat already exists
        const existingChat = await chatSchema.findOne({
            type:ChatType.ONE_TO_ONE,
            "participants": { $all: [new mongoose.Types.ObjectId(userId1), new mongoose.Types.ObjectId(userId2)] }
        });

        if (existingChat) {
            return callback(null, existingChat);
        }

        // Fetch user details for participants
        const users = await userSchema.find(
            { _id: { $in: [userId1, userId2] } },
            "_id userName name profilePicture"
        );

        if (users.length !== 2) {
            return callback(
                {
                    status: 404,
                    code: "USER_NOT_FOUND",
                    message: "One or both users not found.",
                },
                null
            );
        }

        // Format participants array
        const participants = users.map(user => ({
            _id: user._id,
            userName: user.userName,
            profilePicture: user.profilePicture
        }));
        
        const aesKey = generateAESKeys()
        // Create a new chat
        const newChat = new chatSchema({
            isGroup: false,
            type: ChatType.ONE_TO_ONE,
            participants,
            encryptedAESKey: aesKey,
            isFirstMessage: 0
        });

        await newChat.save();

        // Insert both participants into chatParticipants Schema
        const chatParticipantsData = participants.map(participant => ({
            chatId: newChat._id,
            userId: participant._id,
            lastClearedMessageId: null // Initial value
        }));
        await chatParticipantSchema.insertMany(chatParticipantsData);
        
        return callback(null, newChat);
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
};


export const sendMessageLogic = async (
    { chatId, content, type, sender, fileUrls = [], files = [], messageId, replyToMessageId, url, size, createdAt }: SendMessageData,
    callback: (error: any, result: any) => void
) => {
    const io = getIo();
    
    let messageCreatedAt = new Date()
    if(createdAt){
        messageCreatedAt = new Date(createdAt)
    }
    console.log("===========> messageCreatedAt API <===================",messageCreatedAt)

    try {
        const chat = await chatSchema.findById(chatId);
        if (!chat) {
            return callback({ status: 404, code: "CHAT_NOT_FOUND", message: "Chat not found." }, null);
        }

        
        if(chat.isFirstMessage === 0){
            await chatSchema.findByIdAndUpdate(chat._id,{$set:{isFirstMessage:1} } )
        }
        const removedUser = await chatParticipantSchema.findOne({userId:sender, chatId, isRemoved: true}).select("isRemoved");
        if(removedUser){
            return callback({status: 400,code:"DELETED_USER",message: "You can't send message because you are no longer a member of the group."},null)
        }

        // await chatParticipantSchema.updateMany(
        //     { chatId, userId: { $ne: sender } }, // Exclude the current user
        //     { $set: { lastClearedMessageId: null } }
        // );
        // await chatParticipantSchema.updateMany({chatId, isDeleted: true}, {$set: {isDeleted: false, lastClearedMessageId: null} } )
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


        if (chat.type === ChatType.CHANNEL) {
            
            if (chat.createdBy.toString() !== sender.toString()) {
                return callback({ status: 400, code: "FORBIDDEN", message: "Only the channel creator can send messages." }, null);
            }
        } else {
            if (!chat.participants || !chat.participants.some((p:any) => p.toString() === sender.toString())) {
                return callback({ status: 400, code: "FORBIDDEN", message: "You are not a participant in this chat." }, null);
            }
        }

        let repliedMessage = null;
        let senderOfReplyMsg = null;
        if(replyToMessageId){
            repliedMessage = await messageSchema.findOne({messageId: replyToMessageId})
            .populate({
                path: "sender",
                select: "name userName profilePicture countryCode phone countryISOCode isOnline lastSeen email",
                options:{lean: true}
            });

            if(repliedMessage){
                senderOfReplyMsg = await getNickNameDetails(repliedMessage?.sender._id.toString(),sender.toString())
            }
        }

        let mediaDetails: any[] = [];
        if(type.toLowerCase() === "gif"){
            if(!url || !size){
                return callback({status:400, code: "INVALID_GIF_DATA", message:"GIF URL or size is missing."}, null)
            }

            mediaDetails = [{
                url: url,
                mimeType: "gif",
                fileName: "GIF",
                fileSize: Number(size),
            }]
        }else if(files.length > 0) {
            fileUrls = files.map((file:any) => file.key);
            
            // mediaDetails = files.map((file:any) => ({
            //     url: file.key,
            //     mimeType: file.mimetype,
            //     fileName: file.originalname,
            //     fileSize: file.size,
            // }));

             mediaDetails = await Promise.all(
                files.map(async (file:any) => ({
                url: file.key,
                mimeType: file.mimetype,
                fileName: file.originalname,
                fileSize: file.size && file.size > 0 
                    ? file.size 
                    : file.buffer
                    ? file.buffer.length
                    : await getFileSizeFromS3(String(env.AWS_S3_BUCKET_NAME), file.key),
            })));
        }

        const senderDetails = await userSchema.findById(sender).select("userName name profilePicture");
        const tempMessageId = messageId || new mongoose.Types.ObjectId().toString();

        let messageStatus = "sent";
        let isRead = false;
        const deliveryStatus: IDeliveryStatus = {};
        messageStatus = chat.type === ChatType.ONE_TO_ONE ? "sent" : "read";
        isRead = chat.type === ChatType.ONE_TO_ONE ? false : true;

        const response = {
            chatId,
            sender: {
                _id: senderDetails?._id,
                name: senderDetails?.name,
                userName: senderDetails?.userName,
                profilePicture: senderDetails?.profilePicture,
                lastSeen: senderDetails?.lastSeen,
                bio:senderDetails?.bio, 
                email:senderDetails?.email, 
                isOnline:senderDetails?.isOnline, 
                countryCode:senderDetails?.countryCode, 
                countryISOCode:senderDetails?.countryISOCode,
                profilePrivacy: senderDetails?.profilePrivacy
            },
            content: content,
            type,
            fileIds: fileUrls.map((file) => file.replace(/^(\w+)-.*$/, `$1/${file}`)),
            files: mediaDetails,
            createdAt: messageCreatedAt,
            messageId: tempMessageId,
            _id: tempMessageId,
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
            status:messageStatus,
            isRead: isRead
        };

        

        let isDuplicateMessage = false;
        try {
            if (["media", "image", "video", "audio", "document", "pdf", "mixed", "gif"].includes(type)) {
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
            }
        } catch (error) {
                console.error("Error while saving message:", error);
                io.emit("message_save_failed", { chatId, messageId: tempMessageId, error: "Failed to save message" });

        }
        const handleMessageDelivery = async (participant: any) => {
            if (participant.toString() !== sender.toString()) {
                deliveryStatus[participant.toString()] = "sent";
                const receiverSocketId = userSocketMap[participant.toString()];

                // check if user has chat open
                const isChatOpen = receiverOpenChat[participant.toString()]?.[chatId] ?? false;
                          
                  
                if(!isChatOpen){
                    await chatParticipantSchema.updateMany(
                    {chatId,userId: new mongoose.Types.ObjectId(participant.toString())},
                    {$inc:{unreadCount: 1} }
                    )
                }
                let receiver:any;
                
                receiver = await getNickNameDetails(participant.toString(),sender.toString())
                
                if (receiverSocketId) {
                    loggerMsg("receiverSocketId is online","debug")
                    messageStatus = "read";
                    isRead = true;
                    io.to(receiverSocketId).emit("receive_message", 
                        { 
                            ...response, 
                            sender: {
                                ...response.sender,
                                nickName: receiver && receiver[0]?.matchedNickname?.[0]?.nickName?.trim() || senderDetails?.name,
                                isActiveNickname: receiver && receiver[0]?.matchedNickname?.[0]?.isActiveNickname || false
                            },
                            // status: "sent", 
                            // isRead: false
                            status: chat.type === ChatType.ONE_TO_ONE ? "sent" : "read",
                            isRead: chat.type === ChatType.ONE_TO_ONE ? false : true, 
                            encryptedAESKey: chat.encryptedAESKey || ""
                        });
                    loggerMsg("receive_message success","debug")
                }
                const senderSocketId = userSocketMap[sender.toString()];
                                      
                if(senderSocketId){
                    io.to(senderSocketId).emit("receive_message", {
                        ...response,
                        sender: {
                            ...response.sender,
                            nickName: receiver && receiver[0]?.matchedNickname?.[0]?.nickName?.trim() || senderDetails?.name,
                            isActiveNickname: receiver && receiver[0]?.matchedNickname?.[0]?.isActiveNickname || false
                        },
                        status: chat.type === ChatType.ONE_TO_ONE ? "sent" : "read",
                        isRead: chat.type === ChatType.ONE_TO_ONE ? false : true, 
                        encryptedAESKey: chat.encryptedAESKey || ""
                    });
                }
                const descryptedMessage = descryptedContent(content,chat.encryptedAESKey)
                
                const receiverDetails = await userSchema.findById(participant);
                if(!receiverDetails?.isStopNotification){
                        if(is_conversation_mute.length === 0){
                            const receiver = await getNickNameDetails(participant.toString(),sender.toString())
                                                    const matched = receiver[0]?.matchedNickname?.[0];
                    const notificationPayload = {
                            title: `${senderDetails?.name}` || "New Message",
                            body: descryptedMessage || "Plain Message!",
                            click_action: CLICK_NOTIFICATION_TYPE,
                            type: NotificationType.CHAT_MESSAGE,
                            chat_id: chatId,
                            sender: JSON.stringify(buildSenderPayload(senderDetails)),
                            temp_message_id: tempMessageId,
                            content,
                            groupInfo:JSON.stringify(buildGroupInfoPayload(chat)),
                            chatType:chat.type === ChatType.ONE_TO_ONE 
                                ? ChatType.ONE_TO_ONE : chat.type === ChatType.GROUP 
                                ? ChatType.GROUP : ChatType.CHANNEL,
                            receiverId:participant.toString(),
                            senderId:sender.toString(),
                            encryptedAESKey: chat.encryptedAESKey,
                            isMuteNotification: receiverDetails?.isMuteNotification
                        };
                        await sentPushNotificationToUser(participant.toString(), notificationPayload);
                        loggerMsg(`Push notification sent successfully!`,"debug")
                    }
                }
            }
        };

        if (!isDuplicateMessage && Array.isArray(chat.participants) && chat.participants.length > 0) {
            await Promise.all(chat.participants.map(handleMessageDelivery));
        }

        // await chatParticipantSchema.updateOne(
        //     { chatId },
        //     { $set: { lastClearedMessageId: null } } // Reset last cleared message when new message arrives
        // );

        callback(null, response);

        
    } catch (error:any) {
        return callback({ status: 500, code: "INTERNAL_SERVER_ERROR", message: error.message || "An unexpected error occurred." }, null);
    }
};






// Asynchronous save function for media messages
export const saveMediaMessageAsync = async (
    chatId: string, 
    sender: string, 
    content: string, 
    type: string, 
    fileUrls: string[],
    tempMessageId: string,
    deliveryStatus:any,
    isRead:boolean,
    messageStatus:string,
    mediaDetails?:any,
    replyToMessageId?:string,
    messageCreatedAt?:Date
) => {
    try {
        const io = getIo()
        const savedMessage = await savedMessageOneToOne(
            chatId,
            new mongoose.Types.ObjectId(sender),
            content,
            type,
            fileUrls,
            tempMessageId,
            deliveryStatus,
            isRead,
            messageStatus,
            replyToMessageId,

            mediaDetails.map((file:any) => ({
                url: file.url,
                mimeType: file.mimeType,
                fileName: file.fileName,
                fileSize: file.fileSize  // ✅ Corrected `filesize` to `fileSize`
            })),
            messageCreatedAt,
        );

        if ((savedMessage as any).isDuplicate) {
            loggerMsg(`Duplicate message save skipped for messageId ${tempMessageId} — already saved`, "debug");
            return { savedMessage, isDuplicate: true };
        }

        const chat = await chatSchema.findById(chatId);
        if (chat) {
            chat.lastMessage = new mongoose.Types.ObjectId(String(savedMessage._id));
            await chat.save();
            await chatParticipantSchema.updateMany({chatId: chat._id}, {$set:{sortConversationDate: new Date()} })
            io.emit("message_saved", { chatId, tempMessageId, _id: savedMessage._id });

        }
        loggerMsg(`Media message saved to database: ${savedMessage._id}`, "debug");
        return { savedMessage, isDuplicate: false };
    } catch (error) {
        console.error("Error saving media message asynchronously:", error);
        return { savedMessage: null, isDuplicate: false };
    }
};

            
export const getMessagesOfChatIDLogic = async (
    chatId: string,
    userId: string,
    page:number,
    limit:number,
    skip:number,
    search:string,
    callback: (error: any, result: any) => void
) => {
    try {
        const isBlocked = await BlockedUser.exists({
            chatId,
            blockedId: userId
        });
        const youBlocked = await BlockedUser.exists({
            chatId,
            blockerId: userId
        });

        // Check if the logged-in user is removed from the chat
        const chatParticipant = await chatParticipantSchema.findOne({
            chatId,
            userId,
            isRemoved: true // Check if they were removed
        }).select("isRemoved");

        const currentUser = userOnlineStatusMap[userId.toString()];

        const chat = await chatSchema.findById(chatId).select("participants")
        
        if(!chat){
            return callback({
                code: "NOT_FOUND",
                status:404,
                message:"Chat not found"
            },null)
        }
            const otherParticipantsIds = chat?.participants.filter((ids:any) => userId.toString() !== ids.toString()) 
            // console.log("partici........",partici)
            const otherParticipantsDetails = await userSchema.findById(otherParticipantsIds).select("_id isOnline lastSeen")

            const otherChatParticipant = await chatParticipantSchema.findOne({
                chatId,
                userId: otherParticipantsDetails?._id,
                isRemoved: true // Check if they were removed
            }).select("isRemoved");

        // Fetch messages based on chatId and user-specific deletion logic
        const messages = await fetchMessagesOfChat(chatId, userId, page, limit, skip, search)
        const pinned_message = await pinnedMessagesOfChat(chatId, userId, page, limit, skip, search);
        // const pinnedMessages = await messages.filter((msg:any) => msg.pinned);
        const pinnedMessages = pinned_message;
        const totalMessages = await messageSchema.countDocuments({
            chatId,
            $or: [
                { isDeleted: { $exists: false } },
                { isDeleted: false },
                {
                    isDeleted: true,
                    deletedFor: { $ne: new mongoose.Types.ObjectId(userId) },
                },
            ],
            ...(search ? {content:{$regex: search, $options:"i"} } : {} )
        });
        
        
        async function fetchNickname(sender:any, loggedInUserId: any){    
            const senderData = sender.toObject()
            if(senderData._id.toString() === loggedInUserId.toString()) return senderData;
         
            const nicknameData = await getNickNameDetails(loggedInUserId.toString(),senderData._id.toString());
            
            const matchedNick = nicknameData?.[0]?.matchedNickname?.[0];
            return {
                ...senderData,
                nickName: matchedNick?.nickName,
                isActiveNickname: matchedNick?.isActiveNickname
                // name: nick ?? p.name
            }
        }

        // Check if messages exist
        if (messages.length > 0) {
            const updatedMessages = await Promise.all(messages.map(async (msg:any) => {
                
                let repliedMessage = null;
                if (msg.replyTo) {
                    repliedMessage = await messageSchema.findOne({messageId: msg.replyTo})
                    .populate({
                        path: "sender",
                        select: "name userName profilePicture countryCode phone countryISOCode isOnline lastSeen email",
                        // match:{isDeleted: false}
                    });
                }
                const senderDetails = await fetchNickname(msg.sender,userId);
                
                return {
                    "chatId": msg.chatId,
                    "sender":senderDetails,
                    // "sender": {
                    //     _id: msg.sender?._id,
                    //     userName: msg.sender?.userName,
                    //     name: msg.sender?.name,
                    //     profilePicture: msg.sender?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${msg.sender?.profilePicture}`)
                    // },
                    "content": msg.content,
                    "type": msg.type,
                    "isDeleted": msg.isDeleted,
                    "deletedFor": msg.deletedFor,
                    "isRead": msg.isRead,
                    "_id": msg._id,
                    "createdAt": msg.createdAt,
                    fileIds: msg.fileIds?.map((file:any) => file),
                    files: msg.files,
                    messageId: msg.messageId,
                    disAppearingMessages: msg?.disAppearingMessages,
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
                        reactions: repliedMessage.reactions,
                        reactOnMessage: repliedMessage.reactOnMessage.map(r => r.emoji) || []

                    } : null, // Include reply details if available

                    forwarded:msg?.forwarded,
                    originalMessageId: msg?.originalMessageId,
                    pinned: msg?.pinned,
                    reactions:msg?.reactions,
                    reactOnMessage: msg?.reactOnMessage.map((r:any) => r.emoji) || [],
                    systemMessage: msg?.systemMessage,
                    isEditedMessage: msg?.isEditedMessage
                };
            }));
            
            const totalPages = Math.ceil(totalMessages / limit);
            const response = {
                messages : updatedMessages,
                pinnedMessages:pinnedMessages,
                lastSeen:otherParticipantsDetails?.lastSeen,
                isOnline: otherParticipantsDetails?.isOnline ?? false,
                isBlocked: !!isBlocked,
                youBlocked: !!youBlocked,
                removeFromChat: !!chatParticipant, // Return true if user is removed
                otherUserRemoveFromChat: !!otherChatParticipant?.isRemoved,  // Return true if other user is removed
                pagination:{
                    totalMessages,
                    totalPages,
                    page,
                    limit
                }
            }

            return callback(null, response);
        } else {
            const response = {
                messages : [],
                pinnedMessages:[],
                lastSeen: otherParticipantsDetails?.lastSeen ?? null,
                isOnline: otherParticipantsDetails?.isOnline ?? false,
                isBlocked: !!isBlocked,
                youBlocked: !!youBlocked,
                removeFromChat: !!chatParticipant, // Return true if user is removed
                otherUserRemoveFromChat: !!otherChatParticipant?.isRemoved, // Return true if other user is removed

            }
            return callback(
                null,
                // {
                //     status: 1,
                //     code: "NOT_FOUND",
                //     message: "No messages found.",
                //     data:[],
                //     isBlocked: !!isBlocked,
                //     removeFromChat: !!chatParticipant,
                // }

                response
            );
        }
    } catch (error) {
        console.error("Error in getMessagesOfChatIDLogic:", error);
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
};


async function fetchNickname(conversations:any, loggedInUserId: any){
    const updatedConversations = await Promise.all(conversations.map(async (chat:any) =>{
   
        chat.participantDetails = await Promise.all(chat.participantDetails.map(async (p:any) => {
            
            if(p._id.toString() === loggedInUserId.toHexString()) return p;
            const nicknameData = await getNickNameDetails(loggedInUserId.toHexString(), p._id.toString());
            
            const matchedNick = nicknameData?.[0]?.matchedNickname?.[0];
            return {
                ...p,
                nickName: matchedNick?.nickName,
                isActiveNickname: matchedNick?.isActiveNickname
                // name: nick ?? p.name
            }
        }));
        return chat;
    }))
    return updatedConversations;
}

export const getConversationsLogic = async (
    userId: string,
    searchTerm: string,
    archived: string,
    callback: (error: any, result: any) => void
) => {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return callback(
            {
                status: 400,
                code: "INVALID_USER_ID",
                message: "Invalid User ID format.",
            },
            null
        );
    }
  
    const userObjectId = new mongoose.Types.ObjectId(userId);
    if (searchTerm === undefined) searchTerm = "";

    try {
        
       // Fetch blocked users where the logged-in user is the blocker
        const blockedUsers = await BlockedUser.find({ blockerId: userObjectId });

        const blockedUserIds = blockedUsers.map((b) => b.blockedId.toString());

       
        const conversations = await chatSchema.aggregate([
            {
                $match: {
                    isFirstMessage:1,
                    $or: [
                        { participants: userObjectId }, // Matches user in one-to-one chats
                        { admins: userObjectId }, // Matches groups/channels where the user is an admin
                    ],
                },
            },
            {
                $lookup: {
                    from: "users",
                    localField: "participants",
                    foreignField: "_id",
                    as: "participantDetails",
                },
            },
             // 🔹 Get nickname mappings for the logged-in user
            {
                $lookup: {
                    from: "users",
                    let: { participantIds: "$participants", currentUserId: userObjectId },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$_id", "$$currentUserId"] } } },
                        { $unwind: "$nicknames" },
                        {
                            $match: {
                                $expr: { $in: ["$nicknames.contactUserId", "$$participantIds"] }
                            }
                        },
                        {
                            $project: {
                                _id: 0,
                                contactUserId: "$nicknames.contactUserId",
                                nickName: "$nicknames.nickName"
                            }
                        }
                    ],
                    as: "nicknameDetails"
                }
            },
            // 🔹 Merge nickname into participantDetails
            {
                $addFields: {
                    participantDetails: {
                        $map: {
                            input: "$participantDetails",
                            as: "p",
                            in: {
                                $mergeObjects: [
                                    "$$p",
                                    {
                                        nickName: {
                                            $let: {
                                                vars: {
                                                    matchNick: {
                                                        $arrayElemAt: [
                                                            {
                                                                $filter: {
                                                                    input: "$nicknameDetails",
                                                                    as: "n",
                                                                    cond: { $eq: ["$$n.contactUserId", "$$p._id"] }
                                                                }
                                                            },
                                                            0
                                                        ]
                                                    }
                                                },
                                                in: "$$matchNick.nickName"
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }
            },

            {
                $match: {
                    "participantDetails._id": { $nin: blockedUserIds }, // Hide only for the blocker
                }
            },
            {
                $lookup: {
                    from: "chatparticipants",  // Make sure collection name is lowercase and plural
                    let: { conversationId: "$_id", userId: userObjectId },  
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$chatId", "$$conversationId"] },  
                                        { $eq: ["$userId", "$$userId"] },  // Filter by logged-in user
                                    ]
                                } 
                            }
                        },
                        {
                            $project: {
                                _id: 0,  
                                chatId: 1,  // Explicitly include chatId
                                userId: 1,  // Explicitly include userId
                                lastClearedMessageId: 1,
                                isArchived:1,
                                isDeleted:1,
                                unreadCount:1,
                                isPinned:1,
                                pinnedAt:1,
                                isNotificationMute: 1,
                                sortConversationDate:1,
                                markMessageAsUnread:1
                            }
                        }
                    ],
                    as: "chatParticipantsDetails"
                }
            },
            {
                $match: {
                    "chatParticipantsDetails.isArchived": { $ne: true } // Exclude archived chats
                }
            },
            {
                $match: {
                    "chatParticipantsDetails.isDeleted": { $ne: true }  // Exclude deleted chats
                }
            },
            {
                $lookup: {
                    from: "messages",
                    let: { 
                        conversationId: "$_id",
                        // new code
                        // lastClearedMsgId: { $arrayElemAt: ["$chatParticipantsDetails.lastClearedMessageId", 0] }
                    },
                    pipeline: [
                        { $match: { $expr: { 
                            // new code
                            // $cond: [
                            //     {$ne: ["$$lastClearedMsgId", null]},
                            //     {$eq: ["$_id", "$$lastClearedMsgId"]},
                            //     {$eq: ["$chatId", "$$conversationId"]} 
                            // ]
                            // old code
                            $eq: ["$chatId", "$$conversationId"]
                        } 
                    } },
                        { $sort: { createdAt: -1 } },
                        { $limit: 1 },
                    ],
                    as: "lastMessageDetails",
                },
            },
            { $unwind: { path: "$lastMessageDetails", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: "users",
                    localField: "lastMessageDetails.sender",
                    foreignField: "_id",
                    as: "senderDetails",
                },
            },
            { $unwind: { path: "$senderDetails", preserveNullAndEmptyArrays: true } },
            
            {
                $addFields: {
                    lastMessageDetails: {
                        $cond: {
                            if: {
                                $or: [
                                    { $eq: [{ $size: "$chatParticipantsDetails" }, 0] }, // No participant data
                                    {
                                        $ne: [{ $arrayElemAt: ["$chatParticipantsDetails.lastClearedMessageId", 0] }, null] // User cleared chat
                                    }
                                ]
                            },
                            then: null, // Hide lastMessageDetails if user cleared chat
                            else: "$lastMessageDetails" // Otherwise, return last message
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField:"createdBy",
                    foreignField:"_id",
                    as : "createdByDetails"
                },
            },
            {$unwind: {path:"$createdByDetails", preserveNullAndEmptyArrays: true} },
            {
                $lookup: {
                    from: "messages",
                    let: { conversationId: "$_id", userId: userObjectId },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$chatId", "$$conversationId"] },
                                        { $ne: ["$sender", "$$userId"] },
                                        { $eq: ["$isRead", false] },
                                    ],
                                },
                            },
                        },
                    ],
                    as: "unreadMessages",
                },
            },
                         
            {
                $addFields: {
                    chatUnreadCount: {
                        $arrayElemAt: ["$chatParticipantsDetails.unreadCount",0]
                    },
                    
                    participantDetails: {
                        $cond: {
                            if: { $in: ["$type", ["group", "channel"]] }, // Check if it's a group/channel chat
                            then: {
                                $cond: {
                                    if: {
                                        $and: [
                                            { $eq: ["$hideMembersInfo", true] },
                                            { $not: [{ $in: [userObjectId, "$admins"] }] },
                                        ],
                                    },
                                    then: [], // Hide members from non-admins when hideMembersInfo is set
                                    else: "$participantDetails", // Keep all participants otherwise
                                },
                            },
                            else: {
                                $filter: {
                                    input: "$participantDetails",
                                    as: "participant",
                                    cond: { $ne: ["$$participant", userObjectId] }, // Exclude current user for one-on-one
                                },
                            },
                        },
                    },
                    isProfilePhoto: {
                        $cond: {
                            if: { $in: [userObjectId, "$admins"] },
                            then: true,
                            else: "$isProfilePhoto",
                        },
                    },
                    isSendMessage: {
                        $cond: {
                            if: { $in: [userObjectId, "$admins"] },
                            then: true,
                            else: "$isSendMessage",
                        },
                    },
                    isGroupProfilePhoto: {
                        $cond: {
                            if: { $in: [userObjectId, "$admins"] },
                            then: true,
                            else: "$isGroupProfilePhoto",
                        },
                    },
                    createdBy:{
                        $cond:{
                            if:{$in:["$type", ["group","channel"]] },
                            then: {
                                _id: "$createdByDetails._id",
                                userName: "$createdByDetails.userName",
                                profilePicture: "$createdByDetails.profilePicture",
                                name:"$createdByDetails.name"
                            },
                            else:"$$REMOVE"
                        }
                    },
                    
                    isPinned: {
                    $ifNull: [{ $arrayElemAt: ["$chatParticipantsDetails.isPinned", 0] }, false]
                    },
                    pinnedAt: {
                    $ifNull: [{ $arrayElemAt: ["$chatParticipantsDetails.pinnedAt", 0] }, new Date(0)]
                    },
                    sortConversationDate:{
                        $ifNull:[{ $arrayElemAt: ["$chatParticipantsDetails.sortConversationDate",0]}, new Date(0)]
                    },
                    isNotificationMute:{
                        $ifNull:[{$arrayElemAt: ["$chatParticipantsDetails.isNotificationMute",0]}, false]
                    },
                    markMessageAsUnread:{
                        $ifNull: [{$arrayElemAt: ["$chatParticipantsDetails.markMessageAsUnread",0]}, false]
                    }
                },
            },
            // 🔹 Updated search to include nickname
            {
                $match: {
                    $or: [
                        { groupName: { $regex: searchTerm, $options: "i" } },
                        // {
                        //     participantDetails: {
                        //         $elemMatch: { name: { $regex: searchTerm, $options: "i" } },
                        //     },
                        // },
                        { "participantDetails.name": { $regex: searchTerm, $options: "i" } },
                        { "participantDetails.nickName": { $regex: searchTerm, $options: "i" } }

                    ],
                },
            },
            {
                $project: {
                    _id: 1,
                    type: 1,
                    groupName: 1,
                    groupImage: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    privacy:1,
                    inviteLink:1,
                    hideMembersInfo:1,
                    hideNewMembersMessage:1,
                    restrictContentSharing:1,
                    createdBy: 1,
                    encryptedAESKey: 1,
                    isProfilePhoto: 1,
                    isGroupProfilePhoto: 1,
                    isSendMessage: 1,
                    sortIndex:1,
                    isPinned:1,
                    pinnedAt:1,
                    sortConversationDate:1,
                    isNotificationMute:1,
                    markMessageAsUnread:1,
                    messageAutoDeleteTime:1,
                    messageAutoDeleteStartTime:1,
                    participantDetails: {
                        _id: 1,
                        userName: 1,
                        profilePicture: 1,
                        name:1,
                        lastSeen: 1,
                        bio:1, 
                        email:1, 
                        isOnline:1, 
                        countryCode:1, 
                        countryISOCode:1,
                        profilePrivacy:1,
                    },
                    
                    chatParticipantsDetails:1,
                    lastMessageDetails:1,
                    lastMessage: {
                        $cond: {
                            if: { $eq: ["$lastMessageDetails", null] }, // If lastMessageDetails is null, return null
                            then: null,
                            else: {
                                _id: "$lastMessageDetails._id",
                                content: "$lastMessageDetails.content",
                                files: "$lastMessageDetails.files",
                                messageId: "$lastMessageDetails.messageId",
                                systemMessage: "$lastMessageDetails.systemMessage",
                                sender: {
                                    _id: "$senderDetails._id",
                                    name: "$senderDetails.name",
                                    userName: "$senderDetails.userName",
                                    profilePicture: "$senderDetails.profilePicture",
                                    lastSeen: "$senderDetails.lastSeen",
                                    bio:"$senderDetails.bio", 
                                    email:"$senderDetails.email", 
                                    isOnline:"$senderDetails.isOnline", 
                                    countryCode:"$senderDetails.countryCode", 
                                    countryISOCode:"$senderDetails.countryISOCode",
                                    profilePrivacy: "$senderDetails.profilePrivacy"        
                                },
                                createdAt: "$lastMessageDetails.createdAt",
                            }
                        }
                    },                
    
                    chatUnreadCount:1,
                    unreadMessageCount: "$chatUnreadCount",

                },
            },
            
            {
                $sort:{
                    isPinned: -1,
                    pinnedAt: -1,
                    sortConversationDate: -1,
                    "lastMessage.createdAt": -1
                } 
            }
        ]);
         
        
        const archivedChats = await chatSchema.aggregate([
            {
                $match: {
                    isFirstMessage:1,
                    $or: [
                        { participants: userObjectId }, // Matches user in one-to-one chats
                        { admins: userObjectId }, // Matches groups/channels where the user is an admin
                    ],
                },
            },
            {
                $lookup: {
                    from: "users",
                    localField: "participants",
                    foreignField: "_id",
                    as: "participantDetails",
                },
            },
             // 🔹 Get nickname mappings for the logged-in user
            {
                $lookup: {
                    from: "users",
                    let: { participantIds: "$participants", currentUserId: userObjectId },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$_id", "$$currentUserId"] } } },
                        { $unwind: "$nicknames" },
                        {
                            $match: {
                                $expr: { $in: ["$nicknames.contactUserId", "$$participantIds"] }
                            }
                        },
                        {
                            $project: {
                                _id: 0,
                                contactUserId: "$nicknames.contactUserId",
                                nickName: "$nicknames.nickName"
                            }
                        }
                    ],
                    as: "nicknameDetails"
                }
            },
            // 🔹 Merge nickname into participantDetails
            {
                $addFields: {
                    participantDetails: {
                        $map: {
                            input: "$participantDetails",
                            as: "p",
                            in: {
                                $mergeObjects: [
                                    "$$p",
                                    {
                                        nickName: {
                                            $let: {
                                                vars: {
                                                    matchNick: {
                                                        $arrayElemAt: [
                                                            {
                                                                $filter: {
                                                                    input: "$nicknameDetails",
                                                                    as: "n",
                                                                    cond: { $eq: ["$$n.contactUserId", "$$p._id"] }
                                                                }
                                                            },
                                                            0
                                                        ]
                                                    }
                                                },
                                                in: "$$matchNick.nickName"
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }
            },
            {
                $match: {
                    "participantDetails._id": { $nin: blockedUserIds }, // Hide only for the blocker
                }
            },
            {
                $lookup: {
                    from: "chatparticipants",  // Make sure collection name is lowercase and plural
                    let: { conversationId: "$_id", userId: userObjectId },  
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$chatId", "$$conversationId"] },  
                                        { $eq: ["$userId", "$$userId"] }  // Filter by logged-in user
                                    ]
                                } 
                            }
                        },
                        {
                            $project: {
                                _id: 0,  
                                chatId: 1,  // Explicitly include chatId
                                userId: 1,  // Explicitly include userId
                                lastClearedMessageId: 1,
                                isArchived:1,
                                isDeleted:1
                            }
                        }
                    ],
                    as: "chatParticipantsDetails"
                }
            },
            {
                $match: {
                    "chatParticipantsDetails.isArchived": { $ne: false } // Exclude archived chats
                }
            },
            {
                $match: {
                    "chatParticipantsDetails.isDeleted": { $ne: true } // Exclude archived chats
                }
            },
            {
                $lookup: {
                    from: "messages",
                    let: { conversationId: "$_id" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$chatId", "$$conversationId"] } } },
                        { $sort: { createdAt: -1 } },
                        { $limit: 1 },
                    ],
                    as: "lastMessageDetails",
                },
            },
            { $unwind: { path: "$lastMessageDetails", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: "users",
                    localField: "lastMessageDetails.sender",
                    foreignField: "_id",
                    as: "senderDetails",
                },
            },
            { $unwind: { path: "$senderDetails", preserveNullAndEmptyArrays: true } },
            
            {
                $addFields: {
                    lastMessageDetails: {
                        $cond: {
                            if: {
                                $or: [
                                    { $eq: [{ $size: "$chatParticipantsDetails" }, 0] }, // No participant data
                                    {
                                        $ne: [{ $arrayElemAt: ["$chatParticipantsDetails.lastClearedMessageId", 0] }, null] // User cleared chat
                                    }
                                ]
                            },
                            then: null, // Hide lastMessageDetails if user cleared chat
                            else: "$lastMessageDetails" // Otherwise, return last message
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField:"createdBy",
                    foreignField:"_id",
                    as : "createdByDetails"
                },
            },
            {$unwind: {path:"$createdByDetails", preserveNullAndEmptyArrays: true} },
            {
                $lookup: {
                    from: "messages",
                    let: { conversationId: "$_id", userId: userObjectId },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$chatId", "$$conversationId"] },
                                        { $ne: ["$sender", "$$userId"] },
                                        { $eq: ["$isRead", false] },
                                    ],
                                },
                            },
                        },
                    ],
                    as: "unreadMessages",
                },
            },
                         
            {
                $addFields: {
                    participantDetails: {
                        $cond: {
                            if: { $in: ["$type", ["group", "channel"]] }, // Check if it's a group/channel chat
                            then: {
                                $cond: {
                                    if: {
                                        $and: [
                                            { $eq: ["$hideMembersInfo", true] },
                                            { $not: [{ $in: [userObjectId, "$admins"] }] },
                                        ],
                                    },
                                    then: [], // Hide members from non-admins when hideMembersInfo is set
                                    else: "$participantDetails", // Keep all participants otherwise
                                },
                            },
                            else: {
                                $filter: {
                                    input: "$participantDetails",
                                    as: "participant",
                                    cond: { $ne: ["$$participant", userObjectId] }, // Exclude current user for one-on-one
                                },
                            },
                        },
                    },
                    isProfilePhoto: {
                        $cond: {
                            if: { $in: [userObjectId, "$admins"] },
                            then: true,
                            else: "$isProfilePhoto",
                        },
                    },
                    isSendMessage: {
                        $cond: {
                            if: { $in: [userObjectId, "$admins"] },
                            then: true,
                            else: "$isSendMessage",
                        },
                    },
                    isGroupProfilePhoto: {
                        $cond: {
                            if: { $in: [userObjectId, "$admins"] },
                            then: true,
                            else: "$isGroupProfilePhoto",
                        },
                    },
                    createdBy:{
                        $cond:{
                            if:{$in:["$type", ["group","channel"]] },
                            then: {
                                _id: "$createdByDetails._id",
                                userName: "$createdByDetails.userName",
                                profilePicture: "$createdByDetails.profilePicture",
                                name:"$createdByDetails.name"
                            },
                            else:"$$REMOVE"
                        }
                    },
                },
            },
            {
                $match: {
                    $or: [
                        { groupName: { $regex: searchTerm, $options: "i" } },
                        // {
                        //     participantDetails: {
                        //         $elemMatch: { name: { $regex: searchTerm, $options: "i" } },
                        //     },
                        // },
                        { "participantDetails.name": { $regex: searchTerm, $options: "i" } },
                        { "participantDetails.nickName": { $regex: searchTerm, $options: "i" } }
                    ],
                },
            },
            {
                $project: {
                    _id: 1,
                    type: 1,
                    groupName: 1,
                    groupImage: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    privacy:1,
                    inviteLink:1,
                    hideMembersInfo:1,
                    hideNewMembersMessage:1,
                    restrictContentSharing:1,
                    createdBy: 1,
                    encryptedAESKey: 1,
                    isProfilePhoto: 1,
                    isGroupProfilePhoto: 1,
                    isSendMessage: 1,
                    
                    participantDetails: {
                        _id: 1,
                        userName: 1,
                        profilePicture: 1,
                        name:1,
                        lastSeen: 1,
                        bio:1, 
                        email:1, 
                        isOnline:1, 
                        countryCode:1, 
                        countryISOCode:1,
                    },
                    chatParticipantsDetails:1,
                    lastMessageDetails:1,
                    lastMessage: {
                        $cond: {
                            if: { $eq: ["$lastMessageDetails", null] }, // If lastMessageDetails is null, return null
                            then: null,
                            else: {
                                _id: "$lastMessageDetails._id",
                                content: "$lastMessageDetails.content",
                                files: "$lastMessageDetails.files",
                                messageId: "$lastMessageDetails.messageId",
                                sender: {
                                    _id: "$senderDetails._id",
                                    name: "$senderDetails.name",
                                    userName: "$senderDetails.userName",
                                    profilePicture: "$senderDetails.profilePicture",
                                    lastSeen: "$senderDetails.lastSeen",
                                    bio:"$senderDetails.bio", 
                                    email:"$senderDetails.email", 
                                    isOnline:"$senderDetails.isOnline", 
                                    countryCode:"$senderDetails.countryCode", 
                                    countryISOCode:"$senderDetails.countryISOCode",
                                    profilePrivacy: "$senderDetails.profilePrivacy"        
                                },
                                createdAt: "$lastMessageDetails.createdAt",
                            }
                        }
                    },                
                    unreadMessageCount: { $size: "$unreadMessages" },
                },
            },
            {$sort:{"lastMessage.createdAt": -1} }
        ]);

        // Fetch logged-in user's nicknames
        const user = await userSchema.findById(userObjectId).select("nicknames");
        
        // user?.nicknames.forEach(n => {
        //     if(n.contactUserId && n.nickName){
        //         nicknamesMap.set(n.contactUserId.toString(), {
        //             nickName: n.nickName,
        //             isActiveNickname: n.isActiveNickname ?? false
        //         })
        //     }
        // })

        
        // Loop through conversations and patch participantDetails
        
        const updatedConversations = await fetchNickname(conversations, userObjectId)
        const updatedArchivedChats = await fetchNickname(archivedChats, userObjectId);
        if (updatedConversations.length > 0 || updatedArchivedChats.length > 0) {
            return callback(null, {
                chats: updatedConversations,
                archivedChats: updatedArchivedChats
            });
        } else {
            return callback(null, {
                status: 200,
                code: "NOT_FOUND",
                message: "No conversations found.",
                data: [],
            });
        }
    } catch (error) {
        console.error("Error in getConversationsLogic:", error);
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
};

export const getForwardedConversationsLogic = async (
    userId: string,
    searchTerm: string,
    archived: string,
    callback: (error: any, result: any) => void
) => {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return callback(
            {
                status: 400,
                code: "INVALID_USER_ID",
                message: "Invalid User ID format.",
            },
            null
        );
    }
  
    const userObjectId = new mongoose.Types.ObjectId(userId);
    if (searchTerm === undefined) searchTerm = "";

    try {
        
       // Fetch blocked users where the logged-in user is the blocker
        const blockedUsers = await BlockedUser.find({ blockerId: userObjectId });

        const blockedUserIds = blockedUsers.map((b) => b.blockedId.toString());

        
        const conversations = await chatSchema.aggregate([
            {
                $match: {
                    isFirstMessage:1,
                    $or: [
                        { participants: userObjectId }, // Matches user in one-to-one chats
                        { admins: userObjectId }, // Matches groups/channels where the user is an admin
                    ],
                },
            },
            {
                $match: {
                    $or: [
                        {type:{$ne : "channel"} },  // Include all groups & one-to-one chats
                        {createdBy: userObjectId}   // If it's a channel, include only if user is the creator
                    ]
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "participants",
                    foreignField: "_id",
                    as: "participantDetails",
                },
            },
             // 🔹 Get nickname mappings for the logged-in user
            {
                $lookup: {
                    from: "users",
                    let: { participantIds: "$participants", currentUserId: userObjectId },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$_id", "$$currentUserId"] } } },
                        { $unwind: "$nicknames" },
                        {
                            $match: {
                                $expr: { $in: ["$nicknames.contactUserId", "$$participantIds"] }
                            }
                        },
                        {
                            $project: {
                                _id: 0,
                                contactUserId: "$nicknames.contactUserId",
                                nickName: "$nicknames.nickName"
                            }
                        }
                    ],
                    as: "nicknameDetails"
                }
            },
            // 🔹 Merge nickname into participantDetails
            {
                $addFields: {
                    participantDetails: {
                        $map: {
                            input: "$participantDetails",
                            as: "p",
                            in: {
                                $mergeObjects: [
                                    "$$p",
                                    {
                                        nickName: {
                                            $let: {
                                                vars: {
                                                    matchNick: {
                                                        $arrayElemAt: [
                                                            {
                                                                $filter: {
                                                                    input: "$nicknameDetails",
                                                                    as: "n",
                                                                    cond: { $eq: ["$$n.contactUserId", "$$p._id"] }
                                                                }
                                                            },
                                                            0
                                                        ]
                                                    }
                                                },
                                                in: "$$matchNick.nickName"
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }
            },
            {
                $match: {
                    "participantDetails._id": { $nin: blockedUserIds }, // Hide only for the blocker
                }
            },
            {
                $match: {
                    "participantDetails.isDeleted": { $ne: true }, // Hide only for the blocker
                }
            },
            {
                $lookup: {
                    from: "chatparticipants",  // Make sure collection name is lowercase and plural
                    let: { conversationId: "$_id", userId: userObjectId },  
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$chatId", "$$conversationId"] },  
                                        { $eq: ["$userId", "$$userId"] },  // Filter by logged-in user
                                        // { $ne: ["$isRemoved", true]}
                                    ]
                                } 
                            }
                        },
                        {
                            $project: {
                                _id: 0,  
                                chatId: 1,  // Explicitly include chatId
                                userId: 1,  // Explicitly include userId
                                lastClearedMessageId: 1,
                                isArchived:1,
                                isDeleted:1,
                                isRemoved:1
                            }
                        }
                    ],
                    as: "chatParticipantsDetails"
                }
            },
            {
                $match: {
                    "chatParticipantsDetails.isArchived": { $ne: true } // Exclude archived chats
                }
            },
            {
                $match: {
                    "chatParticipantsDetails.isDeleted": { $ne: true }  // Exclude deleted chats
                }
            },
            {
                $match: {
                    "chatParticipantsDetails.isRemoved": false  // Exclude removed chats
                }
            },
            {
                $lookup: {
                    from: "messages",
                    let: { conversationId: "$_id" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$chatId", "$$conversationId"] } } },
                        { $sort: { createdAt: -1 } },
                        { $limit: 1 },
                    ],
                    as: "lastMessageDetails",
                },
            },
            { $unwind: { path: "$lastMessageDetails", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: "users",
                    localField: "lastMessageDetails.sender",
                    foreignField: "_id",
                    as: "senderDetails",
                },
            },
            { $unwind: { path: "$senderDetails", preserveNullAndEmptyArrays: true } },
            
            {
                $addFields: {
                    lastMessageDetails: {
                        $cond: {
                            if: {
                                $or: [
                                    { $eq: [{ $size: "$chatParticipantsDetails" }, 0] }, // No participant data
                                    {
                                        $ne: [{ $arrayElemAt: ["$chatParticipantsDetails.lastClearedMessageId", 0] }, null] // User cleared chat
                                    }
                                ]
                            },
                            then: null, // Hide lastMessageDetails if user cleared chat
                            else: "$lastMessageDetails" // Otherwise, return last message
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField:"createdBy",
                    foreignField:"_id",
                    as : "createdByDetails"
                },
            },
            {$unwind: {path:"$createdByDetails", preserveNullAndEmptyArrays: true} },
            {
                $lookup: {
                    from: "messages",
                    let: { conversationId: "$_id", userId: userObjectId },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$chatId", "$$conversationId"] },
                                        { $ne: ["$sender", "$$userId"] },
                                        { $eq: ["$isRead", false] },
                                    ],
                                },
                            },
                        },
                    ],
                    as: "unreadMessages",
                },
            },
                         
            {
                $addFields: {
                    participantDetails: {
                        $cond: {
                            if: { $in: ["$type", ["group", "channel"]] }, // Check if it's a group/channel chat
                            then: {
                                $cond: {
                                    if: {
                                        $and: [
                                            { $eq: ["$hideMembersInfo", true] },
                                            { $not: [{ $in: [userObjectId, "$admins"] }] },
                                        ],
                                    },
                                    then: [], // Hide members from non-admins when hideMembersInfo is set
                                    else: "$participantDetails", // Keep all participants otherwise
                                },
                            },
                            else: {
                                $filter: {
                                    input: "$participantDetails",
                                    as: "participant",
                                    cond: { $ne: ["$$participant", userObjectId] }, // Exclude current user for one-on-one
                                },
                            },
                        },
                    },
                    isProfilePhoto: {
                        $cond: {
                            if: { $in: [userObjectId, "$admins"] },
                            then: true,
                            else: "$isProfilePhoto",
                        },
                    },
                    isSendMessage: {
                        $cond: {
                            if: { $in: [userObjectId, "$admins"] },
                            then: true,
                            else: "$isSendMessage",
                        },
                    },
                    isGroupProfilePhoto: {
                        $cond: {
                            if: { $in: [userObjectId, "$admins"] },
                            then: true,
                            else: "$isGroupProfilePhoto",
                        },
                    },
                    createdBy:{
                        $cond:{
                            if:{$in:["$type", ["group","channel"]] },
                            then: {
                                _id: "$createdByDetails._id",
                                userName: "$createdByDetails.userName",
                                profilePicture: "$createdByDetails.profilePicture",
                                name:"$createdByDetails.name"
                            },
                            else:"$$REMOVE"
                        }
                    },
                },
            },
            {
                $match: {
                    $or: [
                        { groupName: { $regex: searchTerm, $options: "i" } },
                        // {
                        //     participantDetails: {
                        //         $elemMatch: { name: { $regex: searchTerm, $options: "i" } },
                        //     },
                        // },
                        { "participantDetails.name": { $regex: searchTerm, $options: "i" } },
                        { "participantDetails.nickName": { $regex: searchTerm, $options: "i" } }
                    ],
                },
            },
            {
                $project: {
                    _id: 1,
                    type: 1,
                    groupName: 1,
                    groupImage: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    privacy:1,
                    inviteLink:1,
                    hideMembersInfo:1,
                    hideNewMembersMessage:1,
                    restrictContentSharing:1,
                    createdBy: 1,
                    encryptedAESKey: 1,
                    isProfilePhoto: 1,
                    isGroupProfilePhoto: 1,
                    isSendMessage: 1,
                    participantDetails: {
                        _id: 1,
                        userName: 1,
                        profilePicture: 1,
                        name:1,
                        lastSeen: 1,
                        bio:1, 
                        email:1, 
                        isOnline:1, 
                        countryCode:1, 
                        countryISOCode:1
                    },
                    // isBlocked:1,
                    chatParticipantsDetails:1,
                    lastMessageDetails:1,
                    lastMessage: {
                        $cond: {
                            if: { $eq: ["$lastMessageDetails", null] }, // If lastMessageDetails is null, return null
                            then: null,
                            else: {
                                _id: "$lastMessageDetails._id",
                                content: "$lastMessageDetails.content",
                                files: "$lastMessageDetails.files",
                                messageId: "$lastMessageDetails.messageId",
                                sender: {
                                    _id: "$senderDetails._id",
                                    name: "$senderDetails.name",
                                    userName: "$senderDetails.userName",
                                    profilePicture: "$senderDetails.profilePicture",
                                    lastSeen: "$senderDetails.lastSeen",
                                    bio:"$senderDetails.bio", 
                                    email:"$senderDetails.email", 
                                    isOnline:"$senderDetails.isOnline", 
                                    countryCode:"$senderDetails.countryCode", 
                                    countryISOCode:"$senderDetails.countryISOCode",
                                    profilePrivacy: "$senderDetails.profilePrivacy"
                                    
                                },
                                createdAt: "$lastMessageDetails.createdAt",
                            }
                        }
                    },                
                    unreadMessageCount: { $size: "$unreadMessages" },
                    
                },
            },
            // { $sort: { updatedAt: -1 } },
            {$sort:{"lastMessage.createdAt": -1} }
        ]);
         
        // Fetch logged-in user's nicknames
        const user = await userSchema.findById(userObjectId).select("nicknames");
        
        // user?.nicknames.forEach(n => {
        //     if(n.contactUserId && n.nickName){
        //         nicknamesMap.set(n.contactUserId.toString(), {
        //             nickName: n.nickName,
        //             isActiveNickname: n.isActiveNickname ?? false
        //         })
        //     }
        // })
        const forwardedConversations = await fetchNickname(conversations, userObjectId)
        if (forwardedConversations.length > 0) {
            return callback(null, {
                chats: forwardedConversations,
            });
        } else {
            return callback(null, {
                status: 200,
                code: "NOT_FOUND",
                message: "No conversations found.",
                data: [],
            });
        }
    } catch (error) {
        console.error("Error in getConversationsLogic:", error);
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
};



// export const getConversationsLogic = async (
//     userId: string,
//     searchTerm:string,
//     callback: (error: any, result: any) => void
// ) => {
//     // Validate if userId is a valid MongoDB ObjectId
//     if (!mongoose.Types.ObjectId.isValid(userId)) {
//         return callback(
//             {
//                 status: 400,
//                 code: "INVALID_USER_ID",
//                 message: "Invalid User ID format.",
//             },
//             null
//         );
//     }

//     const userObjectId = new mongoose.Types.ObjectId(userId);
// console.log(userId);
//     try {
//         if(searchTerm === undefined) searchTerm="";
//         // Find all conversations for the user
//         const result = await chatSchema.aggregate([
//             {
//                 $match: {
//                     participants: userObjectId,
//                 },
//             },
//             {
//                 $lookup: {
//                     from: 'users',
//                     localField: 'participants',
//                     foreignField: '_id',
//                     as: 'participantDetails',
//                 },
//             },
//             {
//                 $lookup: {
//                     from: 'messages',
//                     let: {conversationId: '$_id'},
//                     pipeline:[
//                         {
//                             $match: {
//                                 $expr: {$eq: ['$chatId', '$$conversationId']},
//                             },
//                         },
//                         {
//                             $sort: {createdAt: -1},
//                         },
//                         {
//                             $limit: 1
//                         }
//                     ],
//                     as: 'lastMessageDetails',
//                 },
//             },
//             {
//                 $unwind: {
//                     path: '$lastMessageDetails',
//                     preserveNullAndEmptyArrays: true,
//                 },
//             },
//             {
//                 $lookup:{
//                     from: 'users',
//                     localField: 'lastMessageDetails.sender',
//                     foreignField: '_id',
//                     as: 'senderDetails',
//                 }
//             },
//             {
//                 $unwind: {
//                     path: '$senderDetails',
//                     preserveNullAndEmptyArrays: true,
//                 },
//             },
//             {
//                 $match: {
//                     participantDetails: {
//                         $elemMatch: {
//                             userName: { $regex: searchTerm, $options: 'i' },
//                             _id: { $ne: new mongoose.Types.ObjectId(userId) }
//                         }
//                     }
//                 }
//             },
//             {
//                 $lookup: {
//                     from: 'messages',
//                     let: { conversationId: '$_id', userId: userObjectId },
//                     pipeline: [
//                         {
//                             $match: {
//                                 $expr: {
//                                     $and: [
//                                         { $eq: ['$chatId', '$$conversationId'] },
//                                         { $ne: ['$sender', '$$userId'] },
//                                         { $eq: ['$isRead', false] },
//                                     ],
//                                 },
//                             },
//                         },
//                     ],
//                     as: 'unreadMessages',
//                 },
//             },
//             {
//                 $sort: {
//                     createdAt: -1,
//                 },
//             },
//             {
//                 $project: {
//                     _id: 1,
//                     isGroup: 1,
//                     groupName: 1,
//                     groupImage: 1,
//                     participantDetails: {
//                         _id: 1,
//                         userName: 1,
//                         profilePicture: 1,
//                     },
//                     lastMessage: {
//                         _id: '$lastMessageDetails._id',
//                         content: '$lastMessageDetails.content',
//                         messageId: '$lastMessageDetails.messageId',
//                         files: '$lastMessageDetails.files',
//                         sender: {
//                             _id: '$senderDetails._id',
//                             name: '$senderDetails.name',
//                             userName: '$senderDetails.userName',
//                             profilePicture: '$senderDetails.profilePicture',
//                         },
//                         createdAt: '$lastMessageDetails.createdAt',
//                     },
//                     unreadMessageCount: { $size: '$unreadMessages' },
//                     createdAt: 1,
//                 },
//             },
//         ]);

//         result.map((chat) => {
//             chat.participantDetails = chat.participantDetails.map((user: any) => ({
//                 ...user,
//                 profilePicture: user.profilePicture?.replace(/^(\w+)-.*$/, `$1/${user.profilePicture}`)
//             }));
//             return chat;
//         });
//         // Check if conversations exist
//         if (result.length > 0) {
//             return callback(null, result);
//         } else {
//             return callback(
//                 null,
//                 {
//                     status: 200,
//                     code: "NOT_CONVERSATIONS_FOUND",
//                     message: "No conversations found.",
//                     data:[],
//                 },
//             );
//         }
//     } catch (error) {

//         console.error("Error in getConversationsLogic:", error);
//         return callback(
//             {
//                 status: 500,
//                 code: "INTERNAL_SERVER_ERROR",
//                 message: error instanceof Error ? error.message : "An unexpected error occurred.",
//             },
//             null
//         );
//     }
// };


export const deleteMessageLogic = async (
    userId: string,
    reqbody:any,
    callback: (error: any, result: any) => void
) => {
    try {
        const io = getIo()
        const { messageId, chatId, deleteForEveryOne } = reqbody;
        // Validate if messageId is a valid MongoDB ObjectId

        const chat = await chatSchema.findById(chatId);
        if (!chat) {
            return callback(
                {
                    status: 400,
                    code: "CHAT_NOT_FOUND",
                    message: "Chat not found.",
                },
                null
            );
        }

        // Find the message by ID
        const message = await messageSchema.findOne({chatId: new mongoose.Types.ObjectId(chatId), messageId: messageId});

        if (!message) {
            return callback(
                {
                    status: 404,
                    code: "MESSAGE_NOT_FOUND",
                    message: "Message not found.",
                },
                null
            );
        }

        // Check if the logged-in user is the sender of the message
        // if (message.sender.toString() !== userId) {
        //     return callback(
        //         {
        //             status: 400,
        //             code: "FORBIDDEN",
        //             message: "You can only delete your own messages.",
        //         },
        //         null
        //     );
        // }

        if(deleteForEveryOne){

            const sentTime = new Date(message.createdAt);
            const now = new Date();
            const timeDifference = (now.getTime() - sentTime.getTime()) / (1000 * 60 * 60); // Convert to hours

            if (timeDifference > 55) { // Check if message is older than 2 days 7 hours
                return callback(
                    { status: 400, code: "DELETE_NOT_ALLOWED", message: "You can only delete messages for everyone within 2 days 7 hours (55 hours)." },
                    null
                );
            }

            // delete for everyone (permanent delete)
            await messageSchema.deleteOne({messageId: messageId})

            // check if the this was the last message in the chat
            const lastMessag = await messageSchema.findOne({chatId}).sort({createdAt: -1})

            await chatSchema.updateOne(
                {_id: chatId},
                {$set:{lastMessage: lastMessag ? lastMessag._id : null} }
            )
      
            // Fetch chat participants excluding the sender
            const participants = chat.participants.filter(
                (participant:any) => participant.toString() !== userId
            );
            participants.forEach((participant:any) => {
                const receiverSocketId = userSocketMap[participant.toString()];
                if (receiverSocketId) {
                    loggerMsg(`Delete message for everyone...!`,"debug")
                    io.to(receiverSocketId).emit("delete_message_everyone", {
                        messageId: message.messageId,
                        chatId: message.chatId,
                    });
                }
            })
            
            
            return callback(null, "Message deleted of everyone.")
        }else{
            // Mark the message as deleted for the sender
            message.isDeleted = true;
            if (!message.deletedFor) {
                message.deletedFor = [];
            }

            // Add logged-in user's ID to 'deletedFor' to track they deleted the message
            message.deletedFor.push(new mongoose.Types.ObjectId(userId));
            message.deletedAt = new Date();

            await message.save();

            return callback(null, "Message deleted successfully.");
        }
    } catch (error) {
        console.error("Error in deleteMessageLogic:", error);
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
};


export const clearAllChatLogic = async (
    userId: string,
    chatId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        // Validate if chatId is a valid MongoDB ObjectId
        if (!mongoose.Types.ObjectId.isValid(chatId)) {
            return callback(
                {
                    status: 400,
                    code: "INVALID_CHAT_ID",
                    message: "Invalid Chat ID format.",
                },
                null
            );
        }

        // Check if messages exist for the given chatId
        const messagesExist = await messageSchema.exists({ chatId });

        if (!messagesExist) {
            return callback(
                {
                    status: 404,
                    code: "CHAT_NOT_FOUND",
                    message: "Chat not found.",
                },
                null
            );
        }

        // Update all messages to mark them as deleted for the logged-in user
        await messageSchema.updateMany(
            { chatId },
            {
                $addToSet: { deletedFor: new mongoose.Types.ObjectId(userId) },
                $set: { isDeleted: true },
            }
        );

        // check if any non-deleted messages exist after update
        const remainingMessages = await messageSchema
            .findOne({chatId, isDeleted:{$ne: true} })
            .sort({createdAt: -1});

        // update lastMessageId in the chat schema
        // await chatSchema.updateOne(
        //     {_id: chatId},
        //     {$set:{lastMessage: remainingMessages ? remainingMessages._id : null} }
        // )

        const latestMessage = await messageSchema.findOne({chatId}).sort({createdAt:-1}).select("_id")

        // Update lastClearMessageId in chatParticipants for the user
        await chatParticipantSchema.updateOne(
            {chatId, userId},
            {$set:{lastClearedMessageId: latestMessage ? latestMessage._id : null} }
            // {$set:{lastClearedMessageId: null} }

        )

    
        return callback(null, "Chat cleared successfully.");
    } catch (error) {
        console.error("Error in clearAllChatLogic:", error);
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
};


export const clearChatForUser = async (userId: string, chatId: string) => {
    try {
        // Validate if chatId is a valid MongoDB ObjectId
        if (!mongoose.Types.ObjectId.isValid(chatId)) {
            throw {
                status: 400,
                code: "INVALID_CHAT_ID",
                message: "Invalid Chat ID format.",
            };
        }

        // Check if messages exist for the given chatId
        const messagesExist = await messageSchema.exists({ chatId });
        if (!messagesExist) {
            throw {
                status: 404,
                code: "CHAT_NOT_FOUND",
                message: "Chat not found.",
            };
        }

        // Mark all messages as deleted for the user
        await messageSchema.updateMany(
            { chatId },
            {
                $addToSet: { deletedFor: new mongoose.Types.ObjectId(userId) },
                $set: { isDeleted: true },
            }
        );

        // Get the latest non-deleted message
        const latestMessage = await messageSchema
            .findOne({ chatId })
            .sort({ createdAt: -1 })
            .select("_id");

        // Update lastClearedMessageId for the user in chatParticipants
        await chatParticipantSchema.updateOne(
            { chatId, userId },
            { $set: { lastClearedMessageId: latestMessage ? latestMessage._id : null } }
        );

        return { success: true, message: "Chat cleared successfully." };
    } catch (error) {
        console.error("Error in clearChatForUser:", error);
        throw error;
    }
};

// =========================== Groups =======================================

const toBoolean = (value: any, fallback = false): boolean => {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.toLowerCase() === "true";
    return Boolean(value);
};

const createInviteLink = (chatId: string) => `messenger212://join/${chatId}/${new mongoose.Types.ObjectId().toString()}`;

export const createGroupLogic = async (
    reqBody: any,
    creatorId: string,
    files: Express.Multer.File[],
    callback: (error: any, result: any) => void
) => {
    try {
        const { chatType, groupName, description, privacy, admins, participants, isProfilePhoto, isSendMessage, hideMembersInfo, hideNewMembersMessage, restrictContentSharing, isGroupProfilePhoto } = reqBody;

        const groupCreator = await userSchema.findById(creatorId).select("_id name userName profilePicture");

        if (![ChatType.GROUP, ChatType.CHANNEL].includes(chatType)) {
            return callback(
                { status: 400, code: "INVALID_CHAT_TYPE", message: "Chat type must be either 'group' or 'channel'." },
                null
            );
        }

        const parsedAdmins = admins ? JSON.parse(admins) : [];
        const parsedParticipants = participants ? JSON.parse(participants) : [];
        const adminList = [creatorId, ...parsedAdmins];

        const allParticipants = await userSchema.find({ _id: { $in: [creatorId, ...parsedParticipants] } })
            .select("_id userName profilePicture")
            .lean();

        const aesKey = generateAESKeys();
        const newChatId = new mongoose.Types.ObjectId();
        const chatPrivacy = privacy === "private" ? "private" : "public";
        const newChat = new chatSchema({
            _id: newChatId,
            type: chatType,
            groupName,
            description: chatType === ChatType.CHANNEL ? description : undefined,
            privacy: chatPrivacy,
            createdBy: new mongoose.Types.ObjectId(creatorId),
            admins: adminList.map(id => new mongoose.Types.ObjectId(id)),
            participants: allParticipants,
            isProfilePhoto: toBoolean(isProfilePhoto, true),
            isSendMessage: toBoolean(isSendMessage, chatType === ChatType.GROUP),
            hideMembersInfo: toBoolean(hideMembersInfo),
            hideNewMembersMessage: toBoolean(hideNewMembersMessage),
            restrictContentSharing: toBoolean(restrictContentSharing),
            isGroupProfilePhoto: toBoolean(isGroupProfilePhoto, true),
            inviteLink: createInviteLink(newChatId.toString()),
            encryptedAESKey: aesKey,
            isFirstMessage:1
        });

        if (files && files.length > 0) {
            // @ts-ignore
            newChat.groupImage = files[0].key;
        }

        const result:any = await newChat.save();
        const chatId = result._id.toString();

        const title = chatType === ChatType.GROUP ? "New Group Invitation" : "New Channel Invitation";
        const body = `You were added to "${groupName}"`;

        await Promise.all(parsedParticipants.map(async (user: string) => {
            const receiverDetails = await userSchema.findById(user);
            if (!receiverDetails?.isStopNotification) {
                const notificationPayload = {
                    title,
                    body,
                    chat_id: chatId,
                    click_action: CLICK_NOTIFICATION_TYPE,
                    sender: JSON.stringify(buildSenderPayload(groupCreator)),
                    type: chatType === ChatType.GROUP ? NotificationType.NEW_GROUP_CREATED : NotificationType.CREATE_NEW_CHANNEL,
                    content: `You were added to "${groupName}"`,
                    groupInfo: JSON.stringify(buildGroupInfoPayload(result)),
                    senderId: creatorId,
                    receiverId: user.toString(),
                    isMuteNotification: receiverDetails?.isMuteNotification
                };
                await sentPushNotificationToUser(user.toString(), notificationPayload);
                loggerMsg("New group created push sent successfully", "debug");
            }
        }));

        const chatParticipantsData = newChat.participants.map(participant => ({
            chatId: newChat._id,
            userId: participant._id,
            lastClearedMessageId: null
        }));
        await chatParticipantSchema.insertMany(chatParticipantsData);
        
        // **Create and Insert System Message for Group Creation**
        const groupCreatedMessage = {
            chatId,
            sender: creatorId,
            content: null,
            type: "system_message",
            createdAt: new Date(),
            isRead: false,
            messageId: Date.now().toString(),
            isDelivered: false,
            status: "delivered",
            systemMessage: {
                name: groupCreator?.name,
                profilePicture: groupCreator?.profilePicture,
                phone: null,
                message: `"${groupName}" ${chatType} was created by ${groupCreator?.name}.`
            }
        };
        await messageSchema.create(groupCreatedMessage);

        // **Create System Messages for All Participants**
        const systemMessages = newChat.hideNewMembersMessage ? [] : await Promise.all(parsedParticipants.map(async (userId: any) => {
            const userDetails = await userSchema.findById(userId).select("name").lean();
            return {
                chatId,
                sender: {
                    _id: groupCreator?._id,
                    name: groupCreator?.name,
                    userName: groupCreator?.userName,
                    profilePicture: groupCreator?.profilePicture,
                    lastSeen: groupCreator?.lastSeen,
                    bio:groupCreator?.bio, 
                    email:groupCreator?.email, 
                    isOnline:groupCreator?.isOnline, 
                    countryCode:groupCreator?.countryCode, 
                    countryISOCode:groupCreator?.countryISOCode,
                    profilePrivacy: groupCreator?.profilePrivacy
                },
                content: null,
                type: "system_message",
                status: "read",
                createdAt: new Date(),
                isRead: true,
                messageId: new mongoose.Types.ObjectId().toString(),
                systemMessage: {
                    name: groupCreator?.name,
                    profilePicture: groupCreator?.profilePicture,
                    phone: null,
                    message: `${userDetails?.name} was added to "${groupName}"`,
                }
            };
        }));

        // **Ensure Messages Are Inserted**
        if (systemMessages.length > 0) {
            await messageSchema.insertMany(systemMessages);
        }

        return callback(null, newChat);
    } catch (error) {
        return callback(
            { status: 500, code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "An unexpected error occurred." },
            null
        );
    }
};



export const addMembersLogic = async (
    chatId: string,
    newMemberIds: string[],
    userId: mongoose.Types.ObjectId | undefined,
    messageId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        const io = getIo();
        if (!userId) return callback({ status: 401, code: "UNAUTHORIZED", message: "User must be authenticated." }, null);

        const loggedinUser = await userSchema.findById(userId).select("_id name userName profilePicture");
        const chat = await chatSchema.findById(chatId);
        if (!chat) return callback({ status: 404, code: "CHAT_NOT_FOUND", message: "Chat not found." }, null);

        if (!chat.admins.includes(userId)) return callback({ status: 400, code: "NOT_AUTHORIZED", message: "You are not authorized to add members." }, null);

        const validMembers = await userSchema.find({ _id: { $in: newMemberIds } }).select("_id name").lean();
        if (!validMembers.length) return callback({ status: 400, code: "INVALID_MEMBERS", message: "No valid members found to add." }, null);

        chat.participants = chat.participants || [];

        const existingParticipants = new Set(chat.participants.map(id => id.toString()));

        // Check if any of the new members were previously removed
        const existingChatParticipants = await chatParticipantSchema.find({ chatId, userId: { $in: newMemberIds } }).lean();

        const rejoiningMembers: any[] = [];
        const newMembers: any[] = [];

        validMembers.forEach(member => {
            const existingParticipant = existingChatParticipants.find(p => p.userId.toString() === member._id.toString());

            if (existingParticipant) {
                if (existingParticipant.isRemoved) {
                    rejoiningMembers.push(member);
                }
            } else {
                newMembers.push(member);
            }
        });

        // Merge rejoining and new members
        const allAddedMembers = [...rejoiningMembers, ...newMembers];

        if (allAddedMembers.length === 0) {
            await sendNotificationsAndEmitEvents(chat, loggedinUser, io, [], allAddedMembers);
            return callback(null, { status: 1, message: "No new members added, but notifications sent.", data: { chatId: chat._id, updatedParticipants: chat.participants } });
        }

        // Update participants array (only if new members are there)
        newMembers.forEach(member => existingParticipants.add(member._id.toString()));
        chat.participants = Array.from(existingParticipants).map(id => new mongoose.Types.ObjectId(id));
        await chat.save();

        // Update ChatParticipantSchema (set isRemoved = false for rejoining users)
        const bulkUpdates = allAddedMembers.map(member => ({
            updateOne: {
                filter: { chatId, userId: member._id },
                update: { 
                    $set: { isRemoved: false, rejoinedAt: new Date(), lastClearedMessageId: null }
                },
                upsert: true
            }
        }));
        await chatParticipantSchema.bulkWrite(bulkUpdates);

        // Create system messages
        const systemMessages = chat.hideNewMembersMessage ? [] : allAddedMembers.map(member => ({
            chatId,
            sender: {
                _id: loggedinUser?._id,
                name: loggedinUser?.name,
                userName: loggedinUser?.userName,
                profilePicture: loggedinUser?.profilePicture,
                lastSeen: loggedinUser?.lastSeen,
                bio:loggedinUser?.bio, 
                email:loggedinUser?.email, 
                isOnline:loggedinUser?.isOnline, 
                countryCode:loggedinUser?.countryCode, 
                countryISOCode:loggedinUser?.countryISOCode,
                profilePrivacy: loggedinUser?.profilePrivacy
            },
            content: null,
            type: "system_message",
            status: "read",
            createdAt: new Date().toISOString(),
            isRead: true,
            messageId: messageId || new mongoose.Types.ObjectId().toString(),
            systemMessage: {
                _id: new mongoose.Types.ObjectId(),
                name: "System",
                message: rejoiningMembers.some(m => m._id.equals(member._id))
                    ? `${member.name} rejoined the group`
                    : `${member.name} was added by admin`,
                profilePicture: null
            }
        }));
        if (systemMessages.length > 0) {
            await messageSchema.insertMany(systemMessages);
        }

        // Send notifications and emit socket events to all users
        await sendNotificationsAndEmitEvents(chat, loggedinUser, io, systemMessages, allAddedMembers);

        return callback(null, { status: 1, message: "Members added successfully.", data: { chatId: chat._id, updatedParticipants: chat.participants } });
    } catch (error: any) {
        console.error("Error in addMembersLogic:", error);
        return callback({ status: 500, code: "INTERNAL_SERVER_ERROR", message: error.message || "An unexpected error occurred." }, null);
    }
};


// Function to send notifications and emit socket events
const sendNotificationsAndEmitEvents = async (chat: any, loggedinUser: any, io: any, systemMessages: any[], allAddedMembers: any[]) => {
    const typeName = chat.type === ChatType.GROUP ? "group" : "channel";
    const notifType = chat.type === ChatType.GROUP ? NotificationType.GROUP_INVITE : NotificationType.CHANNEL_INVITE;

    const activeParticipants = await chatParticipantSchema.find({ chatId: chat._id, isRemoved: false }).select("userId").lean();
    const activeUserIds = activeParticipants.map(p => p.userId.toString());
    const addedMemberIds = allAddedMembers.map(m => m._id.toString());
    const adminId = loggedinUser._id.toString();

    // Send push + in-app notification ONLY to newly added members
    await Promise.all(addedMemberIds.map(async (memberId) => {
        const user = await userSchema.findById(memberId).select("_id isStopNotification isMuteNotification");
        if (!user || user.isStopNotification) return;

        await sentPushNotificationToUser(memberId, {
            title: chat.groupName,
            body: `${loggedinUser.name || "Admin"} added you to this ${typeName}`,
            chat_id: chat._id.toString(),
            click_action: CLICK_NOTIFICATION_TYPE,
            sender: JSON.stringify(buildSenderPayload(loggedinUser)),
            type: notifType,
            content: `${loggedinUser.name || "Admin"} added you to "${chat.groupName}"`,
            groupInfo: JSON.stringify(buildGroupInfoPayload(chat)),
            senderId: adminId,
            receiverId: memberId,
            isMuteNotification: user.isMuteNotification,
        });
    }));

    // Emit socket events to all active participants
    await Promise.all(activeUserIds.map(async (userId) => {
        const socketId = userSocketMap[userId];
        if (!socketId) return;

        if (addedMemberIds.includes(userId)) {
            io.to(socketId).emit("added_to_group", {
                chatId: chat._id,
                groupName: chat.groupName,
                addedBy: loggedinUser,
                groupInfo: chat
            });
        }

        systemMessages.forEach(message => {
            io.to(socketId).emit("receive_system_message", message);
        });
    }));
};





export const groupConversationsLogic = async (
    userId: string,
    pageNumber: number,
    limitNumber: number,
    callback: (error: any, result: any) => void
) => {
    try {
        const skip = (pageNumber - 1) * limitNumber;

        // Perform aggregation to get group chats
        const groupChats = await chatSchema.aggregate([
            {
                $match: {
                    participants: new mongoose.Types.ObjectId(userId), // Groups where the user is a participant
                    isGroup: true,
                },
            },
            {
                $lookup: {
                    from: 'users', // Name of the User collection
                    localField: 'participants',
                    foreignField: '_id',
                    as: 'participantsDetails',
                },
            },
            {
                $addFields: {
                    participantsDetails: {
                        $map: {
                            input: '$participantsDetails',
                            as: 'participant',
                            in: {
                                _id: '$$participant',
                                name: '$$participant.userName',
                                profileImage: '$$participant.profilePicture',
                                isAdmin: { $in: ['$$participant', '$admins'] },
                            },
                        },
                    },
                },
            },
            {
                $lookup: {
                    from: 'messages', // Name of the Messages collection
                    localField: 'lastMessage',
                    foreignField: '_id',
                    as: 'lastMessageDetails',
                },
            },
            {
                $unwind: {
                    path: '$lastMessageDetails',
                    preserveNullAndEmptyArrays: true, // In case there's no last message
                },
            },
            {
                $project: {
                    _id: 1,
                    groupName: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    groupImage: 1,
                    isGroup: 1,
                    'lastMessageDetails.content': 1,
                    'lastMessageDetails.sender': 1,
                    'lastMessageDetails.createdAt': 1,
                    'lastMessageDetails.fileIds': 1,
                    'lastMessageDetails.isRead': 1,
                    participantsDetails: 1,
                },
            },
            { $sort: { updatedAt: -1 } }, // Sort groups by the most recent updates
            { $skip: skip }, // Skip documents for pagination
            { $limit: limitNumber }, // Limit the number of documents returned
        ]);

        // Get total count for pagination
        const totalGroupChats = await chatSchema.countDocuments({
            isGroup: true,
            participants: new mongoose.Types.ObjectId(userId),
        });

        if (groupChats && groupChats.length > 0) {
            return callback(null, {
                chats: groupChats,
                pagination: {
                    currentPage: pageNumber,
                    totalPages: Math.ceil(totalGroupChats / limitNumber),
                    totalItems: totalGroupChats,
                },
            });
        } else {
            return callback(
                {
                    status: 200,
                    code: 'NOT_FOUND',
                    message: 'No group chats found.',
                },
                null
            );
        }
    } catch (error) {
        return callback(
            {
                status: 500,
                code: 'INTERNAL_SERVER_ERROR',
                message: error instanceof Error ? error.message : 'An unexpected error occurred.',
            },
            null
        );
    }
};


export const assignAdminLogic = async (
    chatId: string,
    userId: mongoose.Types.ObjectId,
    loggedInUserId: string,
    removeFromAdmin: boolean,
    callback: (error: any, result: any) => void
) => {
    try {
        const io = getIo()
        // Fetch the chat by ID and ensure it exists
        const chat = await chatSchema.findById(chatId);
        if (!chat) {
            return callback({ status: 404, code: "CHAT_NOT_FOUND", message: "Chat not found" }, null);
        }

        const loggedinUser = await userSchema.findById(loggedInUserId).select("_id name userName profilePicture");
        const receiverUser = await userSchema.findById(userId).select("_id name userName profilePicture isStopNotification isMuteNotification");

        if (!loggedinUser || !receiverUser) {
            return callback({ status: 404, code: "USER_NOT_FOUND", message: "User not found" }, null);
        }

        // Ensure chat.admins and chat.participants are initialized
        chat.admins = chat.admins || [];
        chat.participants = chat.participants || [];

        // Check if the logged-in user is an admin
        if (!chat.admins.some((adminId) => adminId.toString() === loggedInUserId)) {
            return callback({ status: 400, code: "UNAUTHORIZED", message: "You are not authorized to assign admins" }, null);
        }

        // Check if the user is a participant
        if (!chat.participants.some((participant) => participant.toString() === userId.toString())) {
            return callback({ status: 400, code: "USER_NOT_PARTICIPANT", message: "User must be a participant of the group" }, null);
        }

        const groupCreatorId = chat.createdBy;
        let actionMessage = "";

        if (removeFromAdmin) {
            // Prevent removing the group creator as admin
            if (userId.toString() === groupCreatorId.toString()) {
                return callback({ status: 400, code: "CANNOT_REMOVE_CREATOR", message: "You cannot remove the group creator from admins" }, null);
            }

            // Remove user from admin list
            chat.admins = chat.admins.filter((adminId) => adminId.toString() !== userId.toString());
            actionMessage = `${receiverUser.userName} has been removed as an admin in ${chat.groupName}.`;
        } else {
            // Prevent adding the same user as admin
            if (chat.admins.some((adminId) => adminId.toString() === userId.toString())) {
                return callback({ status: 400, code: "USER_ALREADY_ADMIN", message: "User is already an admin" }, null);
            }

            // Assign user as an admin
            chat.admins.push(userId);
            actionMessage = `${receiverUser.userName} has been assigned as an admin in ${chat.groupName}.`;
        }

        await chat.save();
        const tempMessageId = new mongoose.Types.ObjectId().toString()
        // **Step 1: Create a System Message**
        const newMessage = new messageSchema({
            chatId,
            sender: userId,
            content: null,
            type: "system_message",
            status: "read",
            isRead: true,
            messageId: tempMessageId,
            systemMessage: {
                _id: receiverUser?._id,
                name: receiverUser?.name,
                message: `${receiverUser.name} ${removeFromAdmin ? "removed" : "assigned"} as admin`,
                phone: receiverUser?.phone,
                profilePicture: receiverUser?.profilePicture,
            },
        });
        await newMessage.save();

        // **Step 2: Send Notification to All Participants**
        if (!receiverUser.isStopNotification) {
            const notificationPayload = {
                title: removeFromAdmin ? "Removed as Admin" : "Assigned as Admin",
                body: actionMessage,
                chat_id: chatId.toString(),
                click_action: CLICK_NOTIFICATION_TYPE,
                sender: JSON.stringify(buildSenderPayload(loggedinUser)),
                type: NotificationType.ASSIGN_ADMIN,
                content: actionMessage,
                groupInfo: JSON.stringify(buildGroupInfoPayload(chat)),
                senderId: loggedInUserId,
                receiverId: userId.toString(),
                isMuteNotification: receiverUser.isMuteNotification,
            };

            await sentPushNotificationToUser(userId.toString(), notificationPayload);
        }

        // **Step 3: Emit Event to All Users in Group**
        const response = {
            chatId,
            sender: {
                _id: loggedinUser?._id,
                userName: loggedinUser?.userName,
                name: loggedinUser?.name,
                profilePicture: loggedinUser?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${loggedinUser?.profilePicture}`),
                lastSeen: loggedinUser?.lastSeen,
                bio:loggedinUser?.bio, 
                email:loggedinUser?.email, 
                isOnline:loggedinUser?.isOnline, 
                countryCode:loggedinUser?.countryCode, 
                countryISOCode:loggedinUser?.countryISOCode,
                profilePrivacy: loggedinUser?.profilePrivacy
            },
            content: null,
            type: "system_message",
            createdAt: new Date().toISOString(),
            messageId: tempMessageId,
            status: "sent",
            isRead: false,
            systemMessage: newMessage?.systemMessage
        };
        // ✅ Emit `receive_message` to all active members
        await Promise.all(
            chat.participants.map(async (participant) => {
                const receiverSocketId = userSocketMap[participant.toString()];
                if (receiverSocketId) {
                    io.to(receiverSocketId).emit("receive_system_message", {
                        ...response,
                        status: "read",
                        isRead: true,
                        encryptedAESKey: chat.encryptedAESKey || "",
                    });
                }
            })
        );

        const memberId = userSocketMap[userId.toString()];
        if(memberId){
            io.to(memberId).emit("admin_add_removed",{chatId,isAdmin: removeFromAdmin ? false : true})
        }
        // ✅ Emit Socket Event to the user who left the group
        // const socketIdLeavingUser = userSocketMap[userId.toString()];
        // if (socketIdLeavingUser) {
        //     io.to(socketIdLeavingUser).emit("added_to_group", {
        //         chatId: chatId.toString(),
        //         groupName: chat.groupName,
        //         message: "You assigned as admin.",
        //     });
        // }

        return callback(null, `User successfully ${removeFromAdmin ? "removed from" : "assigned as"} admin`);
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred.",
        }, null);
    }
};




export const leaveGroupLogic = async (
    chatId: string,
    userId: string,
    messageId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        const io = getIo();

        // Find the group chat by ID
        const group = await chatSchema.findById(chatId);
        if (!group) {
            return callback(
                { status: 404, code: "GROUP_NOT_FOUND", message: "Group not found" },
                null
            );
        }

        // Ensure `participants` and `admins` are initialized
        group.participants = group.participants || [];
        group.admins = group.admins || [];

        // Check if the user is a participant
        if (!group.participants.some((participant) => participant.toString() === userId)) {
            return callback(
                { status: 400, code: "USER_NOT_PARTICIPANT", message: "You are not a participant of this group" },
                null
            );
        }

        const isCreator = group.createdBy?.toString() === userId;
        const isAdmin = group.admins.some((adminId) => adminId.toString() === userId);

        const lastMessag = await messageSchema.findOne({chatId}).sort({createdAt: -1})

        // ✅ Update user status instead of removing from participants
        await chatParticipantSchema.findOneAndUpdate(
            { chatId, userId },
            { isRemoved: true, deletedFor: new Date(), lastClearedMessageId: lastMessag ? lastMessag._id : null},
            { new: true }
        );

        // Remove the user from admins if they were an admin
        if (isAdmin) {
            group.admins = group.admins.filter((adminId) => adminId.toString() !== userId);
        }

        // ✅ Get active participants (users who are not removed)
        const activeParticipants = await chatParticipantSchema.find({
            chatId,
            isRemoved: false, // Only active users
        }).select("userId");

        // ✅ If the user was an admin and no other admins exist, assign a new admin
        if (isCreator && group.admins.length === 0 && activeParticipants.length > 0) {
            const newAdminId = activeParticipants[0].userId;
            group.admins.push(new mongoose.Types.ObjectId(newAdminId));
            group.createdBy = newAdminId; // Update the creator field
        }

        // Save the updated group
        await group.save();

        const tempMessageId = messageId || new mongoose.Types.ObjectId().toString();

        const leaveUserDetails = await userSchema.findById(userId).select("_id name phone profilePicture");

        // Add disappearing message
        const newMessage = new messageSchema({
            chatId,
            sender: userId,
            content: null,
            type: "system_message",
            status: "read",
            isRead: true,
            messageId: tempMessageId,
            systemMessage: {
                _id: leaveUserDetails?._id,
                name: leaveUserDetails?.name,
                message: `${leaveUserDetails?.name} left`,
                phone: leaveUserDetails?.phone,
                profilePicture: leaveUserDetails?.profilePicture,
            },
        });
        await newMessage.save();

        // ✅ Send push notification to all active members except the one who left
        const title = "Member Left";
        const body = `${leaveUserDetails?.name} left the group "${group.groupName}".`;

        const notificationPromises = activeParticipants
            .filter((participant) => participant.userId.toString() !== userId.toString()) // Exclude leaving user
            .map(async (participant) => {
                const receiverDetails = await userSchema.findById(participant.userId).select("isStopNotification");

                if (!receiverDetails?.isStopNotification) {
                    const notificationPayload = {
                        title,
                        body,
                        chat_id: String(group._id),
                        click_action: CLICK_NOTIFICATION_TYPE,
                        sender: JSON.stringify(buildSenderPayload(leaveUserDetails)),
                        type: ChatType.GROUP === group.type ? NotificationType.LEAVE_GROUP : NotificationType.LEAVE_CHANNEL,
                        content: `${leaveUserDetails?.name} left the group "${group.groupName}".`,
                        groupImage:`${group.groupImage}`,
                        groupName:`${group.groupName}`,
                        groupInfo: JSON.stringify(buildGroupInfoPayload(group)),
                        senderId: userId.toString(),
                        receiverId: participant.userId.toString(),
                        isMuteNotification: receiverDetails?.isMuteNotification,
                    };
                    return sentPushNotificationToUser(participant.userId.toString(), notificationPayload);
                }
            });

        await Promise.all(notificationPromises);

        const response = {
            chatId,
            sender: {
                _id: leaveUserDetails?._id,
                userName: leaveUserDetails?.userName,
                name: leaveUserDetails?.name,
                profilePicture: leaveUserDetails?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${leaveUserDetails?.profilePicture}`),
                lastSeen: leaveUserDetails?.lastSeen,
                bio:leaveUserDetails?.bio, 
                email:leaveUserDetails?.email, 
                isOnline:leaveUserDetails?.isOnline, 
                countryCode:leaveUserDetails?.countryCode, 
                countryISOCode:leaveUserDetails?.countryISOCode,
                profilePrivacy: leaveUserDetails?.profilePrivacy
            },
            content: null,
            type: "system_message",
            createdAt: new Date().toISOString(),
            messageId: tempMessageId,
            status: "sent",
            isRead: false,
            systemMessage: newMessage?.systemMessage
        };
        // ✅ Emit `receive_message` to all active members
        await Promise.all(
            group.participants.map(async (participant) => {
                const receiverSocketId = userSocketMap[participant.toString()];
                if (receiverSocketId) {
                    io.to(receiverSocketId).emit("receive_system_message", {
                        ...response,
                        status: "read",
                        isRead: true,
                        encryptedAESKey: group.encryptedAESKey || "",
                    });
                }
            })
        );

        // ✅ Emit Socket Event to the user who left the group
        const socketIdLeavingUser = userSocketMap[userId.toString()];
        if (socketIdLeavingUser) {
            io.to(socketIdLeavingUser).emit("removed_from_group", {
                chatId: chatId.toString(),
                groupName: group.groupName,
                message: "You have left the group.",
            });
        }

        return callback(null, "You have left the group.");
    } catch (error) {
        return callback(
            { status: 500, code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "An unexpected error occurred." },
            null
        );
    }
};





export const removeMemberLogic = async (
    chatId: string,
    memberId: string,
    userId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        const io = getIo();

        // Find the group (chat)
        const group = await chatSchema.findById(chatId);
        if (!group) {
            return callback(
                {
                    status: 404,
                    code: "GROUP_NOT_FOUND",
                    message: "Group not found",
                },
                null
            );
        }

        // Check if the logged-in user is an admin
        if (!group.admins.some((adminId) => adminId.toString() === userId)) {
            return callback(
                {
                    status: 400,
                    code: "NOT_AUTHORIZED",
                    message: "You are not authorized to remove members",
                },
                null
            );
        }

        // ✅ Remove the member from the group's admin list if they were an admin
        group.admins = group.admins.filter((adminId) => adminId.toString() !== memberId);
        await group.save();

        const removedMember = await userSchema.findById(memberId).select("name");
        const removerUser = await userSchema.findById(userId).select("_id name userName profilePicture");

        // ✅ Send notification to the removed user
        const title = "Removed";
        const body = `You have been removed from "${group.groupName}".`;
        const receiverDetails = await userSchema.findById(memberId);
        const tempMessageId = new mongoose.Types.ObjectId().toString();

        const disAppearingMessages = `${removedMember?.name} left the group.`;
        const message = userId.toString() === memberId.toString() ? "left" : "removed by admin"
        const newMessage = new messageSchema({
            chatId,
            sender: userId,
            content: null,
            type: "system_message",
            status: "read",
            isRead: true,
            messageId: tempMessageId,
            systemMessage:{
                _id: receiverDetails?._id,
                name: receiverDetails?.name,
                message: `${removedMember?.name} removed`,
                phone: receiverDetails?.phone,
                profilePicture: receiverDetails?.profilePicture
            }
        });
        await newMessage.save();
        const response = {
            chatId,
            sender: {
                _id: removerUser?._id,
                userName: removerUser?.userName,
                name: removerUser?.name,
                profilePicture: removerUser?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${removerUser?.profilePicture}`),
                lastSeen: removerUser?.lastSeen,
                bio:removerUser?.bio, 
                email:removerUser?.email, 
                isOnline:removerUser?.isOnline, 
                countryCode:removerUser?.countryCode, 
                countryISOCode:removerUser?.countryISOCode,
                profilePrivacy: removerUser?.profilePrivacy
            },
            content: null,
            type: "system_message",
            createdAt: new Date().toISOString(),
            messageId: tempMessageId,
            status: "sent",
            isRead: false,
            systemMessage: newMessage?.systemMessage
        };
        
        

        // ✅ Send "you were removed" lastMessage to the removed member
        const removedMemberSocketId = userSocketMap[memberId.toString()];
        if (removedMemberSocketId) {
            io.to(removedMemberSocketId).emit("receive_system_message", {
                ...response,
                status: "read",
                isRead: true,
                encryptedAESKey: group.encryptedAESKey || ""
            });
        }

        // Find the participant entry
        const participant = await chatParticipantSchema.findOne({ chatId, userId: new mongoose.Types.ObjectId(memberId) });
        if (!participant) {
            return callback(
                {
                    status: 404,
                    code: "MEMBER_NOT_FOUND",
                    message: "Member not found in the group",
                },
                null
            );
        }

        // ✅ Update isRemoved field in ChatParticipantSchema
        participant.isRemoved = true;
        participant.deletedFor = new Date()
        participant.lastClearedMessageId = group.lastMessage;
        await participant.save();

        // ✅ Send push notification to all active participants except the removed member and the remover
        const activeParticipants = await chatParticipantSchema.find({
            chatId,
            isRemoved: false,
            isDeleted: false
        }).select("userId");

        await Promise.all(
            (activeParticipants || []).map(async (participant) => {
            // const participantId = participant instanceof mongoose.Types.ObjectId ? participant.toHexString() : participant.toString();
            const receiverSocketId = userSocketMap[participant.userId.toString()];
                if (receiverSocketId) {
                    io.to(receiverSocketId).emit("receive_system_message", {
                        ...response,
                        status: "read",
                        isRead: true,
                        encryptedAESKey: group.encryptedAESKey || ""
                    });
                }
            })
        );
        
        
        
       

        

        if (!receiverDetails?.isStopNotification) {
            
            const notificationPayload = {
                title: title,
                body: body,
                click_action: CLICK_NOTIFICATION_TYPE,
                type: ChatType.GROUP === group.type ? NotificationType.REMOVE_MEMBER_GROUP : NotificationType.REMOVE_MEMBER_CHANNEL,
                chat_id: chatId.toString(),
                sender: JSON.stringify(buildSenderPayload(removerUser)),
                content: `You are removed from \"${group.groupName}\"`,
                groupInfo: JSON.stringify(buildGroupInfoPayload(group)),
                senderId: userId.toString(),
                receiverId: memberId.toString(),
                isMuteNotification: receiverDetails?.isMuteNotification,
            };
            await sentPushNotificationToUser(memberId.toString(), notificationPayload);
        }

        const socketId = userSocketMap[memberId.toString()];
        if (socketId) {
            io.to(socketId).emit("removed_from_group", {
                chatId: chatId.toString(),
                groupName: group.groupName,
                removedBy: userId,
            });
        }

        

        const notificationPromises = activeParticipants
            .filter((participant) => 
                participant.userId.toString() !== memberId.toString() &&
                participant.userId.toString() !== userId.toString()
            )
            .map(async (participant) => {
                const receiverDetails = await userSchema.findById(participant.userId).select("isStopNotification");

                if (!receiverDetails?.isStopNotification) {
                    const notificationPayload = {
                        title: "Member Removed",
                        body: `${removerUser?.name} removed ${removedMember?.name} from "${group.groupName}".`,
                        chat_id: chatId.toString(),
                        click_action: CLICK_NOTIFICATION_TYPE,
                        sender: JSON.stringify(buildSenderPayload(removerUser)),
                        type: ChatType.GROUP === group.type ? NotificationType.REMOVE_MEMBER_GROUP : NotificationType.REMOVE_MEMBER_CHANNEL,
                        content: `${removerUser?.name} removed ${removedMember?.name} from "${group.groupName}".`,
                        groupInfo: JSON.stringify(buildGroupInfoPayload(group)),
                        senderId: userId.toString(),
                        receiverId: participant.userId.toString(),
                        isMuteNotification: receiverDetails?.isMuteNotification,
                    };
                    return sentPushNotificationToUser(participant.userId.toString(), notificationPayload);
                }

                const socketId = userSocketMap[participant.userId.toString()];
                // if (socketId) {
                //     io.to(socketId).emit("removed_from_group", {
                //         chatId: chatId.toString(),
                //         groupName: group.groupName,
                //         removedBy: userId,
                //     });
                // }
            });

        await Promise.all(notificationPromises);

        return callback(null, "Member removed from the group but can still view past messages.");
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
};



export const getGroupInfoLogic = async (
    chatId: string,
    userId: string,
    callback: (error: any, result: any) => void
) => {
    try {

        const chatParticipants = await chatParticipantSchema
        .find({ chatId, isRemoved: false }) // Fetch only active participants
        .select("userId")
        .lean();

        const validParticipantIds = chatParticipants.map((p) => p.userId.toString()); // Extract user IDs

        // Find the group using the provided chatId
        const group = await chatSchema
            .findById(chatId)
            .populate([
                {
                    path: "participants", // Populate participant details from the User model
                    match: { _id: { $in: validParticipantIds } }, // Apply filtering condition
                    select: "_id userName profilePicture lastSeen name", 
                },
                {
                    path: "admins",
                    match: { _id: { $in: validParticipantIds } }, // Apply filtering for admins as well
                    select: "_id userName profilePicture lastSeen name", // Select fields for admins
                },
                {
                    path: "lastMessage",
                    select: "_id content sender createdAt",
                    populate: {
                        path: "sender",
                        select: "_id userName profilePicture lastSeen name",
                    },
                },
            ]);

        if (!group) {
            return callback(null, {
                status: 400,
                message: "Group not found",
            });
        }

        if (!validParticipantIds.includes(userId.toString())) {
            return callback(null, {
                status: 403,
                message: "You are not a member of this group",
            });
        }

        // Determine if the current user is an admin
        let isAdmin = group.admins.some((admin) => admin._id.toString() === userId.toString());
        let isCreatedBy = group.createdBy.toString() === userId.toString() || false;

        group.participants = group.participants || []
        // Process participants: Exclude current user & add isAdmin field
        const participants = group.participants
            .filter((participant) => participant.toString() !== userId.toString()) // Exclude current user
            .map((participant: any) => ({
                _id: participant._id,
                userName: participant.userName,
                profilePicture: participant.profilePicture,
                name: participant.name,
                isAdmin: group.admins.some((admin) => admin.toString() === participant.toString()), // Check if participant is admin
                isCreator: participant._id.toString() === group.createdBy.toString(),
                lastSeen: participant.lastSeen, // Access lastSeen from populated user
            }));

        const admins = group.admins
            .filter((admin) => admin.toString() !== userId.toString()) // Exclude current user
            .map((admin: any) => ({
                _id: admin._id,
                userName: admin.userName,
                profilePicture: admin.profilePicture,
                lastSeen: admin.lastSeen,
                name: admin.name,
                isCreator: group.createdBy.toString() === admin._id.toString() || false,
            }));

            

        // Build the response object
        const groupInfo = {
            groupId: group._id,
            groupName: group.groupName,
            groupImage: group.groupImage,
            isCreatedBy: isCreatedBy,
            createdAt: group.createdAt,
            createdBy: group.createdBy,
            type: group.type,
            participants: group.hideMembersInfo && !isAdmin ? [] : participants,
            participantCount: participants.length,
            admins: group.hideMembersInfo && !isAdmin ? [] : admins,
            lastMessage: group.lastMessage,
            isProfilePhoto: group.isProfilePhoto,
            isSendMessage: group.isSendMessage,
            privacy: group.privacy,
            inviteLink: group.inviteLink,
            hideMembersInfo: group.hideMembersInfo,
            hideNewMembersMessage: group.hideNewMembersMessage,
            restrictContentSharing: group.restrictContentSharing,
            isGroupProfilePhoto: group.isGroupProfilePhoto ?? true,
            isAdmin, // Whether the current user is an admin
        };

        return callback(null, groupInfo);
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
};





/*
export const getGroupMessagesLogic = async (
    groupChatId: string,
    userId: string,
    page: number,
    limit: number,
    callback: (error: any, result: any) => void
) => {
    const skip = (page - 1) * limit;

    try {
        // Check if the group exists and the user is a participant
        const group = await chatSchema.findById(groupChatId);
        if (!group || !group.isGroup) {
            return callback(
                {
                    status: 404,
                    code: 'GROUP_NOT_FOUND',
                    message: 'Group not found or not a group chat.',
                },
                null
            );
        }

        // Check if the user is a participant of the group
        if (!group.participants.includes(new mongoose.Types.ObjectId(userId))) {
            return callback(
                {
                    status: 403,
                    code: 'USER_NOT_PARTICIPANT',
                    message: 'You are not a participant in this group.',
                },
                null
            );
        }

        // Fetch messages for the group chat
        
        const messages = await fetchMessagesOfGroupQuery(groupChatId, skip, limit)
        if (messages && messages.length > 0) {
            return callback(null, {
                result: { page, limit, messages },
            });
        } else {
            return callback(
                null,
                {
                    status: 200,
                    code: 'NO_MESSAGES_FOUND',
                    message: 'Not found group messages.',
                    data:[]
                }
                
            );
        }
    } catch (error) {
        return callback(
            {
                status: 500,
                code: 'INTERNAL_SERVER_ERROR',
                message: error instanceof Error ? error.message : 'An unexpected error occurred.',
            },
            null
        );
    }
};
*/

export const deleteGroupLogic = async (
    userId: string,
    chatId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        // Find the group chat by ID
        const group = await chatSchema.findById(chatId);
        if (!group) {
            return callback(
                {
                    status: 404,
                    code: "CHAT_NOT_FOUND",
                    message: "Chat not found",
                },
                null
            );
        }

        const isCreator = group.createdBy.toString() === userId;
        const isAdmin = group.admins.some((adminId) => adminId.toString() === userId);

        if (!isCreator && !isAdmin) {
            return callback(
                {
                    status: 403,
                    code: "UNAUTHORIZED",
                    message: "Only the creator or an admin can delete the group.",
                },
                null
            );
        }

        // ✅ Fetch active participants (users who are not removed)
        const activeParticipants = await chatParticipantSchema
            .find({ chatId, isRemoved: false })
            .select("userId");

        const otherAdmins = group.admins.filter((adminId) => adminId.toString() !== userId);

        if (isCreator) {
            if (otherAdmins.length > 0) {
                // ✅ If other admins exist, just remove creator from admins
                group.admins = otherAdmins;
            } else if (activeParticipants.length > 0) {
                // ✅ Assign a new admin from participants
                const newAdminId = activeParticipants[0].userId;
                group.admins.push(newAdminId);
                group.createdBy = newAdminId;
            } else {
                // ❌ No participants left, delete the group
                await chatSchema.findByIdAndDelete(chatId);
                return callback(null, "Chat deleted successfully.");
            }

            // ✅ Move the creator to the last index in participants
            const creatorIndex = group.participants.findIndex((p) => p.toString() === userId);
            if (creatorIndex !== -1) {
                group.participants.splice(creatorIndex, 1); // Remove creator
                group.participants.push(new mongoose.Types.ObjectId(userId)); // Add creator at the last index
            }

            await group.save();
            return callback(null, "Creator stepped down, new admin assigned.");
        } else if (isAdmin) {
            if (activeParticipants.length > 0) {
                // ✅ Assign a new admin and update createdBy
                const newAdminId = activeParticipants[0].userId;
                group.admins.push(newAdminId);
                group.createdBy = newAdminId;

                // ✅ Remove the current admin
                group.admins = group.admins.filter((adminId) => adminId.toString() !== userId);

                await group.save();
                return callback(null, "Admin stepped down, new admin assigned.");
            } else {
                // ❌ No participants left, delete the group
                await chatSchema.findByIdAndDelete(chatId);
                return callback(null, "Chat deleted successfully.");
            }
        }
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
};



export const updateGroupInfoLogic = async (
    userId: string,
    chatId: string,
    reqBody: any,
    files: any,
    callback: (error: any, result: any) => void
) => {
    const { groupName, isProfilePhoto, isSendMessage, chatType, privacy, hideMembersInfo, hideNewMembersMessage, restrictContentSharing, isGroupProfilePhoto, inviteLink } = reqBody;
    try {
        // Find the group chat (Now uses `ChatType.GROUP` instead of `isGroup`)
        const chat = await chatSchema.findOne({ _id: chatId, type: chatType });

        if (!chat) {
            return callback(
                {
                    status: 404,
                    code: "CHAT_NOT_FOUND",
                    message: "Group chat not found.",
                },
                null
            );
        }

        // Ensure the user is an admin before allowing updates
        const isAdmin = chat.admins.some(
            (adminId) => adminId.toString() === userId
        );
        if (!isAdmin) {
            return callback(
                {
                    status: 400,
                    code: "FORBIDDEN",
                    message: "Only admins can update group details.",
                },
                null
            );
        }

        // ✅ Update allowed fields
        if (groupName !== undefined) chat.groupName = groupName;
        if (isProfilePhoto !== undefined)
            chat.isProfilePhoto = toBoolean(isProfilePhoto, chat.isProfilePhoto);
        if (isSendMessage !== undefined) chat.isSendMessage = toBoolean(isSendMessage, chat.isSendMessage);
        if (privacy !== undefined) {
            chat.privacy = privacy === "private" ? "private" : "public";
            if (!chat.inviteLink) chat.inviteLink = createInviteLink(chat._id.toString());
        }
        if (hideMembersInfo !== undefined) chat.hideMembersInfo = toBoolean(hideMembersInfo, chat.hideMembersInfo);
        if (hideNewMembersMessage !== undefined) chat.hideNewMembersMessage = toBoolean(hideNewMembersMessage, chat.hideNewMembersMessage);
        if (restrictContentSharing !== undefined) chat.restrictContentSharing = toBoolean(restrictContentSharing, chat.restrictContentSharing);
        if (isGroupProfilePhoto !== undefined) chat.isGroupProfilePhoto = toBoolean(isGroupProfilePhoto, chat.isGroupProfilePhoto);
        if (inviteLink !== undefined && typeof inviteLink === "string" && inviteLink.length > 0) chat.inviteLink = inviteLink;

        // ✅ Handle group profile picture update
        if (files && files.length > 0) {
            chat.groupImage = files.map((file:any) => file.key)[0]
        }

        await chat.save();

        // Broadcast isSendMessage changes to all group participants in real-time.
        // Emit to each participant's own room (joined as their userId on
        // connect — see connection.ts's joinChat) rather than a single cached
        // socket id from userSocketMap: the cached id can be stale or missing
        // after a reconnect or on a second device, which silently dropped
        // this event and left members unable to see the permission flip live.
        if (isSendMessage !== undefined) {
            const io = getIo();
            const participants = await chatParticipantSchema.find({
                chatId: chat._id,
                isRemoved: false,
            });
            for (const participant of participants) {
                const participantId = participant.userId.toString();
                if (participantId === userId) continue;
                io.to(participantId).emit("group_send_permission_updated", {
                    chatId: chat._id,
                    isSendMessage: chat.isSendMessage,
                });
            }
        }

        return callback(null, chat);
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message:
                    error instanceof Error
                        ? error.message
                        : "An unexpected error occurred.",
            },
            null
        );
    }
};

export const revokeGroupInviteLinkLogic = async (
    userId: string,
    chatId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        const chat = await chatSchema.findOne({
            _id: chatId,
            type: { $in: [ChatType.GROUP, ChatType.CHANNEL] },
        });

        if (!chat) {
            return callback(
                {
                    status: 404,
                    code: "CHAT_NOT_FOUND",
                    message: "Group chat not found.",
                },
                null
            );
        }

        const isAdmin = chat.admins.some(
            (adminId) => adminId.toString() === userId
        );
        if (!isAdmin) {
            return callback(
                {
                    status: 400,
                    code: "FORBIDDEN",
                    message: "Only admins can revoke invite links.",
                },
                null
            );
        }

        chat.inviteLink = createInviteLink(chat._id.toString());
        await chat.save();

        return callback(null, {
            groupId: chat._id,
            inviteLink: chat.inviteLink,
            privacy: chat.privacy,
        });
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message:
                    error instanceof Error
                        ? error.message
                        : "An unexpected error occurred.",
            },
            null
        );
    }
};


export const checkInviteNameLogic = async (
    name: string,
    excludeChatId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        const escapedName = name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const query: any = { inviteLink: new RegExp(`\\/${escapedName}$`) };
        if (excludeChatId) {
            try { query._id = { $ne: new mongoose.Types.ObjectId(excludeChatId) }; } catch (_) { /* ignore bad id */ }
        }
        const existing = await chatSchema.findOne(query).select('_id').lean();
        return callback(null, { available: !existing });
    } catch (error) {
        return callback({ status: 500, code: "INTERNAL_SERVER_ERROR", message: "An error occurred." }, null);
    }
};

export const joinGroupByInviteLogic = async (
    chatId: string,
    inviteLink: string,
    userId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        const chat = await chatSchema.findById(chatId);
        if (!chat) {
            return callback({ status: 404, code: "CHAT_NOT_FOUND", message: "Group not found." }, null);
        }
        if (chat.type !== ChatType.GROUP && chat.type !== ChatType.CHANNEL) {
            return callback({ status: 400, code: "INVALID_ACTION", message: "Invalid chat type." }, null);
        }
        if (chat.privacy === "private" && inviteLink !== chat.inviteLink) {
            return callback({ status: 400, code: "INVALID_INVITE_LINK", message: "Invalid or expired invite link." }, null);
        }

        const userObjId = new mongoose.Types.ObjectId(userId);
        const isAlreadyParticipant = chat.participants.some((p) => p.equals(userObjId));
        if (isAlreadyParticipant) {
            return callback({ status: 400, code: "ALREADY_MEMBER", message: "You are already a member." }, null);
        }

        chat.participants.push(userObjId);
        await chat.save();

        await chatParticipantSchema.findOneAndUpdate(
            { chatId: chat._id, userId: userObjId },
            { $set: { isRemoved: false, rejoinedAt: new Date() } },
            { upsert: true, new: true }
        );

        return callback(null, { chatId: chat._id, groupName: chat.groupName, type: chat.type });
    } catch (error) {
        return callback({
            status: 500, code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        }, null);
    }
};

export const deleteChatApi = async(
    userId:string,
    chatId:string,
    callback:(error:any, result:any)=> void
)=>{
    try {
        const chat = await chatSchema.findById(chatId)
        if(!chat){
            return callback({
                status: 404,
                code:"CHAT_NOT_FOUND",
                message:"Chat not found"
            },null)
        }

        await chatParticipantSchema.updateOne({chatId, userId},{$set: {isDeleted: true} })

        // Update all messages to mark them as deleted for the logged-in user
        await messageSchema.updateMany(
            { chatId },
            {
                $addToSet: { deletedFor: new mongoose.Types.ObjectId(userId) },
                $set: { isDeleted: true },
            }
        );

        // check if any non-deleted messages exist after update
        const remainingMessages = await messageSchema
            .findOne({chatId, isDeleted:{$ne: true} })
            .sort({createdAt: -1});

        const latestMessage = await messageSchema.findOne({chatId}).sort({createdAt:-1}).select("_id")

        // Update lastClearMessageId in chatParticipants for the user
        await chatParticipantSchema.updateOne(
            {chatId, userId},
            {$set:{lastClearedMessageId: latestMessage ? latestMessage._id : null} }
        )

        return callback(null,"Chat delete successfully.")
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message:
                    error instanceof Error
                        ? error.message
                        : "An unexpected error occurred.",
            },
            null
        );
    }
}
