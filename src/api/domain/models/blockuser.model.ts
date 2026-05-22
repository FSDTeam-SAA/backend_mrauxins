import { getIo } from "../../../infrastructure/webserver/express/v1";
import { userSocketMap } from "../../socket/initDemoSocketHandlers";
import { BlockedUser } from "../schema/blockuser.schema";
import chatSchema from "../schema/chat.schema";
import userSchema from "../schema/user.schema";

export const addBlockUser = async(
    loggedInUserId:string,
    blockedUserId: string,
    chatId: string,
    callback:(error:any, result:any) => void
)=>{
    try {
        const io = getIo()
        const chat = await chatSchema.findById(chatId);
        if(!chat){
            return callback({
                status: 404,
                code: `CHAT_NOT_FOUN`,
                message: "Chat not found."
            },null)
        }

        if(!blockedUserId){
            return callback({
                status: 400,
                code: "INVALID_BLOCK_USERID",
                message: "Invalid block userid."
            },null)
        }

        if(loggedInUserId.toString() === blockedUserId.toString()){
            return callback({
                status: 400,
                code: `CAN'T_BLOCK_YOUR_SELF`,
                message: "You cannot block yourself."
            },null)
        }

         // Check if the blocked user exists
         const blockedUser = await userSchema.findById(blockedUserId);
        if (!blockedUser) {
            return callback({
                status: 404,
                code: `USER_NOT_FOUND`,
                message: "User not found."
            },null)
        }

        // Check if already blocked
        const existingBlock = await BlockedUser.findOne({
            chatId: chat._id,
            blockerId: loggedInUserId,
            blockedId: blockedUserId,
        });

        if (existingBlock) {
            return callback(null, "User Already Block.")
        }

        // Block the user
        await new BlockedUser({chatId: chat._id, blockerId: loggedInUserId, blockedId: blockedUserId }).save();
        const socketId = userSocketMap[blockedUserId.toString()];
        if(socketId){
            io.to(socketId).emit("userBlocked",{
                isBlocked: true, 
                chatId,
                userId:"", 
                message:"You are blocked."
            })
        }
        return callback(null, "User blocked successfully." )
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        }, null);
    }
}


export const addUnBlockUser = async(
    loggedInUserId:string,
    blockedUserId: string,
    callback:(error:any, result:any) => void
)=>{
    try {
        const io = getIo()
        if (!blockedUserId) {
            return callback({
                status: 400,
                code: `INVALID_ID`,
                message: "Invalid blockedUserId."
            },null)
        }

        // Check if the blocked user exists
        const blockedEntry = await BlockedUser.findOneAndDelete({
            blockerId: loggedInUserId,
            blockedId: blockedUserId,
        });

        if (!blockedEntry) {
            return callback({
                status: 404,
                code: `NOT_BLOCKED`,
                message: "User is not blocked."
            },null)
        }

        const socketId = userSocketMap[blockedUserId.toString()];
        if(socketId){
            io.to(socketId).emit("userBlocked",{
                isBlocked: false,
                userId:loggedInUserId.toString(),
                chatId:"",
                message:"You are unblocked."
            })
        }

         return callback(null, "User unblocked successfully." )
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        }, null);
    }
}


export const blockUsersList = async(
    loggedInUserId:string,
    callback:(error:any, result:any) => void
)=>{
    try {
        const blockedUsers = await BlockedUser.find({ blockerId: loggedInUserId }).populate("blockedId", "name userName profilePicture lastSeen phone bio email isOnline countryCode countryISOCode");
        
        const response = blockedUsers.map((entry:any) => ({
            _id: entry.blockedId._id,
            name: entry.blockedId.name,
            userName: entry.blockedId.userName,
            profilePicture: entry.blockedId.profilePicture,
            lastSeen:entry.blockedId.lastSeen, 
            phone:entry.blockedId.phone,
            bio:entry.blockedId.bio,
            email:entry.blockedId.email, 
            isOnline:entry.blockedId.isOnline, 
            countryCode:entry.blockedId.countryCode,
            countryISOCode:entry.blockedId.countryISOCode
        }));

        return callback(null, { blockedUsers: response })
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        }, null);
    }
}


