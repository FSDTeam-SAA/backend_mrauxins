import mongoose from "mongoose";
import { callHistory } from "../schema/callhistory.schema";
import notificationSchema, { InviteStatus, NotificationType } from "../schema/notification.schema";
import userSchema from "../schema/user.schema";
import { getNickNameDetails } from "../../socket/initDemoSocketHandlers";
import chatSchema from "../schema/chat.schema";
import { finalizeMembership } from "./chat.model";
import { getIo } from "../../../infrastructure/webserver/express/v1";



export const getNotificationLists = async (
    userId: string,
    page: number = 1,
    limit: number = 10,
    search: string, // Search parameter
    callback: (error: any, result: any) => void
) => {
    try {
        const skip = (page - 1) * limit;

        // Mark all unread notifications as read for this user
        await notificationSchema.updateMany(
            { receiverId: userId, isRead: false },
            { $set: { isRead: true } }
        );

        // Build initial filter (before lookups)
        let searchFilter: any = { receiverId: new mongoose.Types.ObjectId(userId) };

        // Aggregation pipeline
        const pipeline: any[] = [
            { $match: searchFilter }, // Apply initial filter before lookups

            // Lookup sender details
            {
                $lookup: {
                    from: "users",
                    localField: "senderId",
                    foreignField: "_id",
                    as: "sender"
                }
            },
            { $unwind: { path: "$sender", preserveNullAndEmptyArrays: true } }, // Keep null sender records
            {$match: {"sender.isDeleted": false} },
            // Lookup group details
            {
                $lookup: {
                    from: "chats",
                    localField: "chatId",
                    foreignField: "_id",
                    as: "groupInfo"
                }
            },
            { $unwind: { path: "$groupInfo", preserveNullAndEmptyArrays: true } }, // Keep null group records

            // Apply search filter after lookups (Ensuring sender.userName and groupInfo.groupName exist)
            {
                $match: search
                    ? {
                          $or: [
                              { message: { $regex: search, $options: "i" } }, // Search in notification message
                              { "sender.userName": { $regex: search, $options: "i" } }, // Search sender name
                              { "groupInfo.groupName": { $regex: search, $options: "i" } } // Search group name
                          ]
                      }
                    : {}
            },

            // Sort by latest notifications
            { $sort: { createdAt: -1 } },

            // Pagination
            { $skip: skip },
            { $limit: limit },

            // Select required fields
            {
                $project: {
                    _id: 1,
                    message: 1,
                    createdAt: 1,
                    isRead: 1,
                    type:1,
                    content:1,
                    status:1,
                    sender: {
                        _id: "$sender._id",
                        name:"$sender.name",
                        userName: "$sender.userName",
                        profilePicture: "$sender.profilePicture",
                        lastSeen: "$sender.lastSeen",
                        bio:"$sender.bio", 
                        email:"$sender.email", 
                        isOnline:"$sender.isOnline", 
                        countryCode:"$sender.countryCode", 
                        countryISOCode:"$sender.countryISOCode",
                        profilePrivacy: "$sender.profilePrivacy"
                    },
                    groupInfo: {
                        _id: "$groupInfo._id",
                        groupName: "$groupInfo.groupName",
                        groupImage: "$groupInfo.groupImage"
                    }
                }
            }
        ];

   
        async function fetchNickname(notifications:any, loggedInUserId: any){
            const updatedConversations = await Promise.all(notifications.map(async(chat:any) =>{
            
                if (chat.sender._id.toString() === loggedInUserId.toString()) return chat;

                const nicknameData = await getNickNameDetails(loggedInUserId.toString(), chat.sender._id.toString());
            
                const matchedNick = nicknameData?.[0]?.matchedNickname?.[0];
                return {
                    ...(chat.toObject ? chat.toObject() : chat),
                    sender:{
                        ...chat.sender,
                        nickName: matchedNick?.nickName,
                        isActiveNickname: matchedNick?.isActiveNickname
                    }
                    // name: nick ?? p.name
                }
            }))
            return updatedConversations;
        }

        // Execute aggregation
        const notifications = await notificationSchema.aggregate(pipeline);
        const updatedData = await fetchNickname(notifications,userId)
        
        // Count total matching notifications (before pagination)
        const countPipeline: any[] = [
            { $match: searchFilter },
            {
                $lookup: {
                    from: "users",
                    localField: "senderId",
                    foreignField: "_id",
                    as: "sender"
                }
            },
            { $unwind: { path: "$sender", preserveNullAndEmptyArrays: true } },
            {$match: {"sender.isDeleted": false} },
            {
                $lookup: {
                    from: "chats",
                    localField: "chatId",
                    foreignField: "_id",
                    as: "groupInfo"
                }
            },
            { $unwind: { path: "$groupInfo", preserveNullAndEmptyArrays: true } },
            {
                $match: search
                    ? {
                          $or: [
                              { message: { $regex: search, $options: "i" } },
                              { "sender.userName": { $regex: search, $options: "i" } },
                              { "groupInfo.groupName": { $regex: search, $options: "i" } }
                          ]
                      }
                    : {}
            },
            { $count: "totalCount" }
        ];

        const countResult = await notificationSchema.aggregate(countPipeline);
        const totalNotifications = countResult.length > 0 ? countResult[0].totalCount : 0;

        const pagination = {
            totalPages: Math.ceil(totalNotifications / limit),
            currentPage: page,
            limit,
        };

        if (notifications.length > 0) {
            return callback(null, {
                message: "Notifications List.",
                notifications: updatedData,
                notificationCount: totalNotifications,
                pagination
            });
        } else {
            return callback(null, {
                status: 200,
                code: "NOTIFICATION_NOT_FOUND",
                message: "No notifications found.",
                notifications: [],
                pagination
            });
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



export const markNotificationsAsRead = async (
    userId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        // Update all notifications where receiverId matches and isRead is false
        const result = await notificationSchema.updateMany(
            { receiverId: userId, isRead: false },
            { $set: { isRead: true } }
        );

        if (result.modifiedCount === 0) {
            return callback(null, {
                updatedCount: 0
            });
        }

        return callback(null, {
            updatedCount: result.modifiedCount
        });
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

export const clearCallLogLogic = async(
    userId: string,
    callIds: string[],
    callback:(error:any, result:any) => void
)=> {
    try {
        let filter:any = {"participants.userId": new mongoose.Types.ObjectId(userId)}

        // if specific call Ids are Provided, modify the filter
        if(callIds && callIds.length > 0){
            filter._id = {$in: callIds.map(id => new mongoose.Types.ObjectId(id))}
        }

        // update all calls where the user is a participant
        const result = await callHistory.updateMany(
            filter,
            { $set: { "participants.$[elem].isCleared": true } }, // Update only the matched userId
            {
                arrayFilters: [{ "elem.userId": new mongoose.Types.ObjectId(userId) }] // Filter only this user
            }
        );
        
        return callback(null,
            callIds && callIds.length > 0 
            ? `${callIds.length} call logs cleared successfully` 
            : "All call history cleared successfully"
        )
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
}



export const respondToInviteLogic = async (
    userId: string,
    notificationId: string,
    action: "accept" | "reject",
    callback: (error: any, result: any) => void
) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(notificationId)) {
            return callback({ status: 400, code: "INVALID_NOTIFICATION_ID", message: "Invalid notification id." }, null);
        }
        if (action !== "accept" && action !== "reject") {
            return callback({ status: 400, code: "INVALID_ACTION", message: "Action must be 'accept' or 'reject'." }, null);
        }

        const notification = await notificationSchema.findById(notificationId);
        if (!notification) {
            return callback({ status: 404, code: "NOTIFICATION_NOT_FOUND", message: "Notification not found." }, null);
        }
        if (notification.receiverId.toString() !== userId) {
            return callback({ status: 403, code: "NOT_AUTHORIZED", message: "You are not authorized to respond to this invitation." }, null);
        }
        if (notification.type !== NotificationType.GROUP_INVITE && notification.type !== NotificationType.CHANNEL_INVITE) {
            return callback({ status: 400, code: "NOT_AN_INVITE", message: "This notification is not an invitation." }, null);
        }
        if (notification.status !== InviteStatus.PENDING) {
            return callback({ status: 409, code: "ALREADY_RESPONDED", message: `This invitation has already been ${notification.status}.` }, null);
        }

        const chat = await chatSchema.findById(notification.chatId);
        if (!chat) {
            return callback({ status: 404, code: "CHAT_NOT_FOUND", message: "The group/channel for this invitation no longer exists." }, null);
        }

        if (action === "accept") {
            const member = await userSchema.findById(userId).select("_id name").lean();
            if (!member) {
                return callback({ status: 404, code: "USER_NOT_FOUND", message: "User not found." }, null);
            }
            await finalizeMembership(chat, member, getIo());
            notification.status = InviteStatus.ACCEPTED;
            notification.content = `You have joined "${chat.groupName}"`;
        } else {
            notification.status = InviteStatus.REJECTED;
            notification.content = "Invitation rejected";
        }

        await notification.save();

        return callback(null, notification);
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

export const clearNotificationApi = async (
    userId: string,
    callback:(error:any,result:any)=> void
) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return { success: false, message: "Invalid userId" };
      }
  
      const result = await notificationSchema.deleteMany({ receiverId: new mongoose.Types.ObjectId(userId) });
  
      if (result.deletedCount > 0) {
        return callback(null, "Notifications cleared successfully.")
      } else {
        return callback({
            status:400,
            code:"SOMETHING_WRONG",
            message:"Something wrong to delete notification"
        },null)
      }
    } catch (error: any) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      };
    }
  };
