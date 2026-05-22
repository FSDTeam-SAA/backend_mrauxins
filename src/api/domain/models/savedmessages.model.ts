import mongoose from "mongoose";
import messageSchema from "../schema/message.schema";
import savedmessagesSchema from "../schema/savedmessages.schema";
import chatSchema from "../schema/chat.schema";
import { getIo } from "../../../infrastructure/webserver/express/v1";
import userSchema from "../schema/user.schema";
import { getNickNameDetails, userSocketMap } from "../../socket/initDemoSocketHandlers";
import { decryptMessage, descryptedContent } from "../../helper/helper";
import {v4 as uuidv4} from "uuid"

interface SendSavedMessageData {
    content: string;
    type: string;
    sender: mongoose.Types.ObjectId;
    fileUrls?: string[];
    files?: Express.Multer.File[];
    tempMessageId?: string;
    replyToMessageId?: string;
    url?:string;
    size?:string;
}

export const sendSavedMessageLogic = async (
    { content, type, sender, fileUrls = [], files = [], tempMessageId, replyToMessageId, url, size }: SendSavedMessageData,
    callback: (error: any, result: any) => void
) => {

    const io = getIo();
    try {
     
        let mediaDetails: any = [];

        // Handle file uploads (Only for media messages)
        
        if(type.toLowerCase() === "gif"){
            if(!url || !size){
                return callback({status:400, code: "INVALID_GIF_DATA", message:"GIF URL or size is missing."}, null)
            }
            fileUrls.push(url);
            mediaDetails = [{
                url: url,
                mimeType: "gif",
                fileName: "GIF",
                fileSize: Number(size),
            }]
        }else if (files && files.length > 0) {
            fileUrls = files.map((file: any) => `${file.key}`);
            mediaDetails = files.map((file:any) => ({
                url: file.key,
                mimeType: file.mimetype, // ✅ Fix: Get the correct MIME type dynamically
                fileName: file.originalname,
                fileSize: file.size,
            }));
        }
        const senderDetails = await userSchema.findById(sender).select('userName name profilePicture');

         let repliedMessage = null;
        if(replyToMessageId){
            repliedMessage = await savedmessagesSchema.findOne({messageId: replyToMessageId})
            .populate({
                path: "sender",
                select: "name userName profilePicture countryCode phone countryISOCode isOnline lastSeen email"
            });
        }
        // Create response
        const response = {
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
            content: content !== null ? content : "",
            type,
            fileIds: fileUrls.map((file) => file.replace(/^(\w+)-.*$/, `$1/${file}`)),
            files: mediaDetails,
            createdAt: new Date(),
            messageId:tempMessageId, // ✅ Fix: Directly use messageId as a string (No conversion)
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
        };

        // Emit event only to sender's socket
        const userSocketId = userSocketMap[sender.toString()]; // ✅ Fix: Get sender's socketId
        if (userSocketId) {
            io.to(userSocketId).emit("messageSaved", { messageId:tempMessageId });
        }

        // Callback response
        callback(null, response);

        // Save message asynchronously (Only if it's media)
        const mediaTypes = ["media", "image", "video", "audio", "document", "pdf", "mixed", "gif"];
        if (mediaTypes.includes(type)) {
            //  const newMessage = new messageSchema({
            //     sender,
            //     content: content !== null ? content : "",
            //     type,
            //     fileIds: fileUrls,
            //     files:mediaDetails,
            //     messageId:tempMessageId
            //   });
            //   await newMessage.save()

        
            const newSavedMessage = new savedmessagesSchema({
                messageId:tempMessageId,
                content: content !== null ? content : "",
                fileIds: fileUrls,
                files: mediaDetails,
                userId: sender, // ✅ Fix: Store sender as a string (not ObjectId)
                sender: sender,
                type:type,
                savedAt: new Date(),
                replyTo:replyToMessageId
            });
            await newSavedMessage.save();

        }else{
        
            const newSavedMessage = new savedmessagesSchema({
                messageId:tempMessageId,
                content: content !== null ? content : "",
                fileIds: fileUrls,
                files: mediaDetails,
                userId: sender, // ✅ Fix: Store sender as a string (not ObjectId)
                sender: sender,
                type:type,
                savedAt: new Date(),
            });
            await newSavedMessage.save();
        }
    } catch (error) {
        console.error("Error in sendSavedMessageLogic:", error);
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



export const saveMessageLogic = async (
    userId: string,
    messageId: string,
    chatId: string,
    tempMessageId: string,
    isTempMessage: boolean,
    content: string,
    type: string,
    callback: (error: any, result: any) => void
) => {
    let message: any; // Declare message variable at the top

    try {
        

        // Validate temp message case
        if (isTempMessage) {
            if (!tempMessageId) {
                return callback(
                    { status: 400, code: 'TEMP_MESSAGE_ID_REQUIRED', message: 'Temp Message Id is required.' },
                    null
                );
            }

         
            message = await messageSchema.findOne({ messageId: tempMessageId });

            if (!message) {
                return callback(
                    { status: 404, code: 'TEMP_MESSAGE_NOT_FOUND', message: 'Temp Message not found.' },
                    null
                );
            }
            messageId = message._id.toString(); // Convert ObjectId to string
   
        } 
        // Validate regular message case
        else {
            if (!messageId) {
                return callback(
                    { status: 400, code: 'MESSAGE_ID_REQUIRED', message: 'Message ID is required.' },
                    null
                );
            }

            message = await messageSchema.findOne({ _id: new mongoose.Types.ObjectId(messageId) });

            if (!message) {
                return callback(
                    { status: 404, code: 'MESSAGE_NOT_FOUND', message: 'Message not found.' },
                    null
                );
            }

            // Check if the message is already saved
            const alreadySaved = await savedmessagesSchema.findOne({ userId: new mongoose.Types.ObjectId(userId), messageId });

            if (alreadySaved) {
                return callback(
                    { status: 400, code: 'MESSAGE_ALREADY_SAVED', message: 'Message already saved.' },
                    null
                );
            }
        }

        // If chatId exists, handle decryption and saving
        if (chatId) {
            const chat = await chatSchema.findById(chatId);
            if (!chat) {
                return callback(
                    { status: 404, code: 'CHAT_ID_NOT_FOUND', message: 'Chat Id not found.' },
                    null
                );
            }

            let decryptedMessage;
            let filesIds: any = [];
            let files: any = [];

            if (message) {
                decryptedMessage = descryptedContent(message.content, chat.encryptedAESKey);

                if (message.type !== "text") {
                    filesIds = message.fileIds || [];
                    files = message.files || [];
                }
            } else {
                return callback(
                    { status: 404, code: "CHAT_MESSAGE_NOT_FOUND", message: "Chat message not found" },
                    null
                );
            }

            const saveMessage = new savedmessagesSchema({
                userId,
                sender: message.sender,
                content: decryptedMessage,
                chatId,
                messageId,
                fileIds: filesIds,
                files: files,
                type:message.type
            });

            await saveMessage.save();
        } 
        // If no chatId, save regular content
        else {
            if (!content) {
                return callback(
                    { status: 404, code: 'CONTENT_NOT_FOUND', message: 'Content not found.' },
                    null
                );
            }

            const saveMessage = new savedmessagesSchema({ userId, content, type });
            await saveMessage.save();
        }

        return callback(null, 'Message saved successfully.');
    } catch (error) {
        console.log("Error in saveMessageLogic:", error);
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



export const getSavedMessagesLogic = async (
    userId: string,
    page: number,
    limit: number,
    searchTerm: string,
    callback: (error: any, result: any) => void
) => {
    const skip = (page - 1) * limit;

    try {
        if (!userId) {
            return callback({ status: 400, code: 'USER_ID_REQUIRED', message: 'User ID is required.' }, null);
        }

        let aggregationPipeline: any[] = [
            {
                $match: { userId: new mongoose.Types.ObjectId(userId) },
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'sender',
                    foreignField: '_id',
                    as: 'senderDetails',
                },
            },
            { $unwind: { path: '$senderDetails', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'savedmessages',
                    localField: 'replyTo',
                    foreignField: 'messageId',
                    as: 'replyTo',
                },
            },
            { $unwind: { path: '$replyTo', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 1,
                    messageId: 1,
                    
                    messageDetails: {
                        chatId: '$chatId',
                        // sender:"$sender",
                        sender:{
                            _id: '$senderDetails._id',
                            userName: '$senderDetails.userName',
                            name: '$senderDetails.name',
                            profilePicture: '$senderDetails.profilePicture'
                        },
                        type: '$type', 
                        fileIds: '$fileIds',
                        files: '$files',
                        content: '$content',
                        createdAt: '$savedAt',
                        replyTo:"$replyTo",
                        reactions:"$reactions",
                        pinned:"$pinned",
                        isEditedMessage:"$isEditedMessage",
                        messageId: '$messageId'
                    },
                    senderDetails: {
                        _id: '$senderDetails._id',
                        userName: '$senderDetails.userName',
                        name: '$senderDetails.name',
                        profilePicture: '$senderDetails.profilePicture',
                    },
                },
            },
        ];

        // **🔍 Add Search Filtering if searchTerm is provided**
        if (searchTerm) {
            aggregationPipeline.push({
                $match: {
                    'messageDetails.content': { $regex: searchTerm, $options: 'i' }, // Case-insensitive search
                },
            });
        }

        // **📌 Apply Sorting, Pagination**
        aggregationPipeline.push(
            { $sort: { 'messageDetails.createdAt': -1 } }, // Sort messages in descending order
            { $skip: skip }, // Skip for pagination
            { $limit: limit } // Limit per page
        );

       
        let savedMessages = await savedmessagesSchema.aggregate(aggregationPipeline);
            
        async function fetchNickname(sender:any, loggedInUserId: any){    
            const senderData = sender;
            if(senderData._id.toString() === loggedInUserId.toString()) return senderData;
            const nicknameData = await getNickNameDetails(loggedInUserId.toString(), senderData._id.toString());
            
            const matchedNick = nicknameData?.[0]?.matchedNickname?.[0];
            return {
                ...senderData,
                nickName: matchedNick?.nickName,
                isActiveNickname: matchedNick?.isActiveNickname
                // name: nick ?? p.name
            }
        }
        
        const modifiedSavedMessages = await Promise.all(savedMessages.map(async (msg) => {
            const plainMsg = msg.toObject ? msg.toObject() : msg;
            let senderDetails = await fetchNickname(msg.senderDetails,userId);
            let messageDetails = await fetchNickname(msg.messageDetails.sender,userId);


            // If it's a Mongoose document, convert to plain object
            if (senderDetails?.toObject) {
                senderDetails = senderDetails.toObject();
            }
            
            return {
                ...plainMsg,
                senderDetails,
                messageDetails:{
                    ...plainMsg.messageDetails, // keep other fields of messageDetails
                    sender: messageDetails      // replace only sender field
                },
            }
        }))
        
        const pinnedMessages = await modifiedSavedMessages.filter((msg:any) => msg.messageDetails?.pinned);

        // **📌 Count Total Messages (with search filter)**
        let totalSavedMessages = await savedmessagesSchema.aggregate([
            { $match: { userId: new mongoose.Types.ObjectId(userId) } },
            ...(searchTerm
                ? [{ $match: { 'content': { $regex: searchTerm, $options: 'i' } } }] // Match search term if exists
                : []),
            { $count: 'total' },
        ]);

        const total = totalSavedMessages.length > 0 ? totalSavedMessages[0].total : 0;

        return callback(null, {
            savedMessages:modifiedSavedMessages,
            pinnedMessages,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        if (error instanceof Error) {
            return callback(
                { status: 500, code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred.' },
                null
            );
        }
    }
};




export const unsaveMessageLogic = async (
    userId: string,
    messageId: string, // Make messageId optional
    callback: (error: any, result: any) => void
) => {
    try {
        let result;

        if (messageId) {
            
            // Delete a specific saved message
            result = await savedmessagesSchema.findOneAndDelete({ sender: new mongoose.Types.ObjectId(userId), _id: messageId });
            if (!result) {
                return callback(
                    {
                        status: 404,
                        code: 'NOT_FOUND',
                        message: 'Saved message not found.',
                    },
                    null
                );
            }
        } else {
            // Delete all saved messages for the user
            result = await savedmessagesSchema.deleteMany({ userId });
            if (result.deletedCount === 0) {
                return callback(
                    {
                        status: 404,
                        code: 'NOT_FOUND',
                        message: 'No saved messages found to delete.',
                    },
                    null
                );
            }
        }

        // Success response
        return callback(null, 'Message(s) unsaved successfully.');
    } catch (error) {
        // Handle unexpected errors
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