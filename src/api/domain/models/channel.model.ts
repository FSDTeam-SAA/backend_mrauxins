import {Request} from "express"
import { Channel } from "../schema/channel.schema";
import userSchema from "../schema/user.schema";
import mongoose from "mongoose";
import { getIo } from "../../../infrastructure/webserver/express/v1";
import messageSchema from "../schema/message.schema";
import { userSocketMap } from "../../socket/initDemoSocketHandlers";
import chatSchema, { ChatType } from "../schema/chat.schema";


export const createChannelLogic = async (
    reqBody: any,
    creatorId: string,
    files: any,
    callback: (error: any, result: any) => void
) => {
    try {
        const { channelName, description, privacy, admins, members } = reqBody;

        // Parse incoming admin and member lists
        const parsedAdmins = admins ? JSON.parse(admins) : [];
        const parsedMembers = members ? JSON.parse(members) : [];

        // Ensure the creator is added as an admin
        const adminList = [creatorId, ...parsedAdmins];

        // Construct the members array with roles
        const allMembers = [
            { userId: new mongoose.Types.ObjectId(creatorId), role: "admin" },
            ...parsedAdmins.map((adminId: string) => ({
                userId: new mongoose.Types.ObjectId(adminId),
                role: "admin",
            })),
            ...parsedMembers.map((memberId: string) => ({
                userId: new mongoose.Types.ObjectId(memberId),
                role: "member",
            })),
        ];

        const newChannel = new chatSchema({
            type: ChatType.CHANNEL, // Setting chat type as CHANNEL
            isGroup: false,
            groupName: channelName, // Using `groupName` field for the channel name
            description,
            privacy,
            createdBy: new mongoose.Types.ObjectId(creatorId),
            admins: adminList.map((id) => new mongoose.Types.ObjectId(id)),
            members: allMembers,
            inviteLink: privacy === "private" ? "http://localhost:3000" : null,
        });

        // Handle avatar upload
        if (files && files.length > 0) {
            const channelAvatar = files[0]; // Assume the first file is the profile picture
            newChannel.avatar = channelAvatar.filename?.replace(
                /^(\w+)-.*$/,
                `$1/${channelAvatar.filename}`
            ); // Adjust path based on your logic
        }

        await newChannel.save();
        return callback(null, newChannel);
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



export const getChannelDetailsLogic = async(
    channelId:string,
    userId: string,
    callback:(error:any, result:any) => void
)=>{
    try {
        const user = await userSchema.findById(userId);
        if(!user){
            return callback({
                status: 404,
                code: "USER_NOT_FOUND",
                message: "User not found"
            },null)
        }

        const channel = await Channel.findById(channelId)
        .populate("admins members", "userName profilePicture")
        .exec();

        if(!channel){
            return callback({
                status: 404,
                code: "CHANNEL_NOT_FOUND",
                message: "Channel not found"
            },null)
        }

        // fetch messages for the specific channel, sorted by createdAt (latest first)
        const messages = await messageSchema.find({channelId: channel._id})
        .sort({createdAt: -1})
        .populate('sender', 'userName profilePicture')
        .exec();

        if(messages && messages.length > 0){
        const response = {
            channel,
            messages
        }
        return callback(null, response)
    }else{
        return callback(null,{
            status:1,
            code:"CHANNEL_MESSAGE_NOT_FOUND",
            message:"Channel message not found",
            data:[]
        })
    }
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        },null)
    }
}


export const getAllChannelsLogic = async(
    userId: string,
    privacy: string,
    search: string,
    callback:(error:any, result: any) => void
)=>{
    try {
        const user = await userSchema.findById(userId);
        if(!user){
            return callback({
                status: 404,
                code: "USER_NOT_FOUND",
                message: "User not found"
            },null)
        }

        
        const filters: any = {
            $or: [
                {createdBy: userId},
                {'admins': userId},
                {'members.userId': userId, 'members.role': 'member'}
            ]
        };
        if (privacy) filters.privacy = privacy;
        if (search) {
            filters.channelName = { $regex: search, $options: 'i' };
        }
      
        const channels = await Channel.find(filters)
        .populate('admins', 'userName prifilePicture')
        .exec();
        
        if(channels && channels.length > 0){
        return callback(null, channels)
        }else{
            return callback(null,{
                status:1,
                code:"CHANNEL_MESSAGE_NOT_FOUND",
                message:"Channel message not found",
                data:[]
            })
        }
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        },null)
    }
}


export const joinChannelLogic = async (
    chatId: string,
    inviteLink: string,
    userId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        const chat = await chatSchema.findById(chatId);
        if (!chat) {
            return callback(
                {
                    status: 404,
                    code: "CHAT_NOT_FOUND",
                    message: "Chat not found",
                },
                null
            );
        }

        // Ensure this logic only applies to channels (not groups)
        if (chat.type !== ChatType.CHANNEL) {
            return callback(
                {
                    status: 400,
                    code: "INVALID_ACTION",
                    message: "You can only join channels using this API.",
                },
                null
            );
        }

        // Check invite link for private channels
        if (chat.privacy === "private" && inviteLink !== chat.inviteLink) {
            return callback(
                {
                    status: 400,
                    code: "INVALID_INVITE_LINK",
                    message: "Invalid invite link",
                },
                null
            );
        }

        // Ensure 'members' array is initialized
        if(!Array.isArray(chat.members)){
            chat.members = []
        }

        // Check if the user is already a member
        const isAlreadyMember = chat.members.some((member) =>
            member.userId.equals(new mongoose.Types.ObjectId(userId))
        );

        if (isAlreadyMember) {
            return callback(
                {
                    status: 400,
                    code: "ALREADY_MEMBER",
                    message: "You are already a member of this channel",
                },
                null
            );
        }

        // Add user as a channel member
        chat.members.push({
            userId: new mongoose.Types.ObjectId(userId),
            role: "member",
        });

        await chat.save();
        return callback(null, "Joined the channel");
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



export const leaveChannelLogic = async (
    chatId: string,
    userId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        const io = getIo()
        const chat = await chatSchema.findById(chatId);
        if (!chat) {
            return callback(
                {
                    status: 404,
                    code: "CHAT_NOT_FOUND",
                    message: "Chat not found",
                },
                null
            );
        }

        // Ensure the chat is a channel or group (not a direct message)
        if (chat.type !== ChatType.CHANNEL && chat.type !== ChatType.GROUP) {
            return callback(
                {
                    status: 400,
                    code: "INVALID_ACTION",
                    message: "You can only leave groups or channels.",
                },
                null
            );
        }

        // Ensure 'members' array is initialized
        if (!Array.isArray(chat.members)) {
            chat.members = [];
        }

        // Find the user's index in the members list
        const index = chat.members.findIndex((member) =>
            member.userId.equals(new mongoose.Types.ObjectId(userId))
        );

        if (index === -1) {
            return callback(
                {
                    status: 404,
                    code: "YOU_ARE_NOT_IN_CHAT",
                    message: "You are not a member of this chat.",
                },
                null
            );
        }

        // Remove the user from the members list
        chat.members.splice(index, 1);

        // If it's a group and the user was the last admin, prevent them from leaving
        if (chat.type === ChatType.GROUP) {
            const isUserAdmin = chat.admins.some((adminId) =>
                adminId.equals(new mongoose.Types.ObjectId(userId))
            );

            if (isUserAdmin) {
                // Check if there are other admins left
                const remainingAdmins = chat.admins.filter(
                    (adminId) => !adminId.equals(new mongoose.Types.ObjectId(userId))
                );

                if (remainingAdmins.length === 0 && chat.members.length > 0) {
                    // Promote another member to admin (optional logic)
                    chat.admins = [chat.members[0].userId];
                } else {
                    // Remove user from admins
                    chat.admins = remainingAdmins;
                }
            }
        }

        await chat.save();

        const socketIdLoginUser = userSocketMap[userId.toString()]
        if(socketIdLoginUser){
            // ✅ Emit Socket Event to the user who left the group
            io.to(userId.toString()).emit("left_group", {
                chatId: chatId.toString(),
                groupName: chat.groupName,
                message: "You have left the group.",
            });
        }

        // const chatIdUser = userSocketMap[chatId.toString()]
        // if(chatIdUser){
        //     // ✅ Emit event to all remaining group participants
        //     io.to(chatId.toString()).emit("group_updated", {
        //         chatId: chat._id.toString(),
        //         updatedParticipants: chat.members,
        //     });
        // }

        return callback(null, "Left the chat");
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


export const addMemberToChannelLogic = async (
    chatId: string,
    loggedInUserId: string,
    memberId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        const chat = await chatSchema.findById(chatId);
        if (!chat) {
            return callback(
                {
                    status: 404,
                    code: "CHAT_NOT_FOUND",
                    message: "Chat not found",
                },
                null
            );
        }

        // Ensure the chat is a group or channel (not a direct message)
        if (chat.type !== ChatType.GROUP && chat.type !== ChatType.CHANNEL) {
            return callback(
                {
                    status: 400,
                    code: "INVALID_ACTION",
                    message: "You can only add members to groups or channels.",
                },
                null
            );
        }

        // Ensure 'members' array is initialized
        if (!Array.isArray(chat.members)) {
            chat.members = [];
        }

        // Check if the logged-in user is an admin
        const isAdmin = chat.admins.some((adminId) =>
            adminId.equals(new mongoose.Types.ObjectId(loggedInUserId))
        );

        if (!isAdmin) {
            return callback(
                {
                    status: 400,
                    code: "UNAUTHORIZED",
                    message: "Only admins can add members.",
                },
                null
            );
        }

        // Check if the user is already a member
        const isAlreadyMember = chat.members.some((member) =>
            member.userId.equals(new mongoose.Types.ObjectId(memberId))
        );

        if (isAlreadyMember) {
            return callback(
                {
                    status: 400,
                    code: "ALREADY_MEMBER",
                    message: "User is already a member of this chat.",
                },
                null
            );
        }

        // Add the user to the chat members list
        chat.members.push({
            userId: new mongoose.Types.ObjectId(memberId),
            role: "member",
        });

        await chat.save();
        return callback(null, "Member added to the chat.");
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



export const removeMemberFromChannelLogic = async (
    chatId: string,
    userId: string,
    memberId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        const chat = await chatSchema.findById(chatId);
        if (!chat) {
            return callback(
                {
                    status: 404,
                    code: "CHAT_NOT_FOUND",
                    message: "Chat not found.",
                },
                null
            );
        }

        // Ensure the chat is a group or channel (not a direct message)
        if (chat.type !== ChatType.GROUP && chat.type !== ChatType.CHANNEL) {
            return callback(
                {
                    status: 400,
                    code: "INVALID_ACTION",
                    message: "You can only remove members from groups or channels.",
                },
                null
            );
        }

        // Ensure 'members' array is initialized
        if (!Array.isArray(chat.members)) {
            return callback(
                {
                    status: 400,
                    code: "NO_MEMBERS_FOUND",
                    message: "No members found in this chat.",
                },
                null
            );
        }

        // Check if the user trying to remove is an admin
        const isAdmin = chat.admins.some((adminId) =>
            adminId.equals(new mongoose.Types.ObjectId(userId))
        );

        if (!isAdmin) {
            return callback(
                {
                    status: 400,
                    code: "UNAUTHORIZED",
                    message: "Only admins can remove members.",
                },
                null
            );
        }

        // Check if the member exists
        const index = chat.members.findIndex((member) =>
            member.userId.equals(new mongoose.Types.ObjectId(memberId))
        );

        if (index === -1) {
            return callback(
                {
                    status: 400,
                    code: "USER_IS_NOT_MEMBER",
                    message: "User is not a member of this chat.",
                },
                null
            );
        }

        // Remove the member from the chat
        chat.members.splice(index, 1);
        await chat.save();
        
        return callback(null, "Member removed from the chat.");
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


export const updateChannelDetailsLogic = async (
    chatId: string,
    reqBody: any,
    files: any,
    userId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        const chat = await chatSchema.findById(chatId);
        if (!chat) {
            return callback(
                {
                    status: 404,
                    code: "CHAT_NOT_FOUND",
                    message: "Chat not found.",
                },
                null
            );
        }

        // Ensure the chat is either a group or channel (not a direct message)
        if (chat.type !== ChatType.GROUP && chat.type !== ChatType.CHANNEL) {
            return callback(
                {
                    status: 400,
                    code: "INVALID_ACTION",
                    message: "Only groups or channels can be updated.",
                },
                null
            );
        }

        // Ensure the user is an admin of the group/channel
        if (!chat.admins.some((admin) => admin.toString() === userId)) {
            return callback(
                {
                    status: 400,
                    code: "FORBIDDEN",
                    message: "Only an admin can update chat details.",
                },
                null
            );
        }

        // Handle avatar update if files are provided
        if (files && files.length > 0) {
            const chatAvatar = files[0]; // Assume the first file is the profile picture
            reqBody.avatar = `${chatAvatar.filename}`; // Adjust based on your logic
        }

        await chatSchema.updateOne(
            { _id: chatId }, // filter
            { $set: reqBody } // update
        );

        return callback(null, "Updated successfully.");
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


export const deleteChannelLogic = async (
    chatId: string,
    userId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        const chat = await chatSchema.findById(chatId);
        if (!chat) {
            return callback(
                {
                    status: 404,
                    code: "CHAT_NOT_FOUND",
                    message: "Chat not found.",
                },
                null
            );
        }

        // Ensure the chat is either a group or channel (not a direct message)
        if (chat.type !== ChatType.GROUP && chat.type !== ChatType.CHANNEL) {
            return callback(
                {
                    status: 400,
                    code: "INVALID_ACTION",
                    message: "Only groups or channels can be deleted.",
                },
                null
            );
        }

        // Only the creator can delete the chat
        if (chat.createdBy.toString() !== userId) {
            return callback(
                {
                    status: 400,
                    code: "UNAUTHORIZED",
                    message: "Only the creator of this chat can delete it.",
                },
                null
            );
        }

        // Delete the chat
        await chatSchema.findByIdAndDelete(chatId);

        return callback(null, "Chat deleted successfully.");
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

interface SendMessageData {
    channelId: string;
    content: string; 
    type: string;
    sender: string;
    fileUrls: any;
    files: any
}

export const sendMessageToChannelLogic = async (
    { channelId, content, type, sender, fileUrls = [], files = [] }: SendMessageData,
    callback: (error: any, result: any) => void
) => {
    const io = getIo();

    try {
        // Check if the chat exists
        const channel = await Channel.findById(channelId);
        if (!channel) {
            return callback(
                {
                    status: 404,
                    code: "CHANNEL_NOT_FOUND",
                    message: "Channel not found.",
                },
                null
            );
        }

        // Check if the sender is an admin of the channel
        const isAdmin = channel.admins.some(admin => admin.equals(new mongoose.Types.ObjectId(sender)));
        if(!isAdmin){
            return callback({
                status: 400,
                code: "FORBIDDEN",
                message: "Only admins can send messages in this channel"
            },null)
        }
        // Check if the sender exists in the channel members
        // const isExistingMember = channel.members.some(member => member.userId.equals(new mongoose.Types.ObjectId(sender)));
        // if (!isExistingMember) {
        //     return callback(
        //         {
        //             status: 403,
        //             code: "FORBIDDEN",
        //             message: "You are not a participant in this chat.",
        //         },
        //         null
        //     );
        // }

        // Handle file uploads
        if (files && files.length > 0) {
            fileUrls = files.map((file: Express.Multer.File) => `${file.filename}`);
        }

        // Create and save the new message one to one
        // const savedMessage = await savedMessageOneToOne(chatId, sender, content, type, fileUrls);

          const newMessage = new messageSchema({
            channelId,
            sender,
            content,
            type,
            fileIds: fileUrls,
          });
        
          const savedMessage = await newMessage.save();
        
        //   return savedMessage;

        // Update the last message in the chat
        channel.lastMessage = new mongoose.Types.ObjectId(String(savedMessage._id));
        await channel.save();

        // Emit the message to the receiver(s) if they are online
        channel.members.forEach((member: any) => {
            if (member.userId.toString() !== sender) {
                const receiverSocketId = userSocketMap[member?.userId.toString()];
                if (receiverSocketId) {
                    io.to(receiverSocketId).emit("receive_message_of_channel", {
                        channelId: channel._id,
                        message: savedMessage,
                    });
                }
            }
        });

        // Callback with success response
        return callback(null, savedMessage);
    } catch (error) {
        console.error("Error in sendMessageLogic:", error);
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