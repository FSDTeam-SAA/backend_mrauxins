import mongoose from "mongoose";
import { BlockedUser } from "../schema/blockuser.schema";
import { callHistory, CallStatus, CallType } from "../schema/callhistory.schema"
import notificationSchema from "../schema/notification.schema";
import userSchema from "../schema/user.schema";
import { getNickNameDetails } from "../../socket/initDemoSocketHandlers";

export const updateCallStatusLogic = async(
    callHistoryId:string,
    callStatus: "accepted" | "reject" | "callEnded",
    callback:(error:any, result:any) => void
)=>{
    try {
        const call = await callHistory.findById(callHistoryId);
        if(!call){
            return callback({
                status: 404,
                code: "CALL_NOT_FOUND",
                message: "Call not found"
            }, null);
        }

        let updateData:any = {} // Store update fields dynamically
        
        switch (callStatus) {
            case "accepted":
                updateData.status = "accepted";
                break;
            case "reject":
                updateData.status = "missed"; // Reject means the call was missed
                break;
            case "callEnded":
                if (!call.startTime) {
                    return callback({
                        status: 400,
                        code: "INVALID_CALL",
                        message: "Call does not have a valid startTime"
                    }, null);
                }
                const duration = Math.round((new Date().getTime() - new Date(call.startTime).getTime()) / 1000);
                updateData = {
                    status: "completed",
                    endTime: new Date(),
                    duration: duration
                };
                break;
            default:
                return callback({
                    status: 400,
                    code: "INVALID_STATUS",
                    message: "Invalid call status provided"
                }, null);
        }
        const result = await callHistory.findByIdAndUpdate(callHistoryId, updateData, { new: true });
        return callback(null, result);
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

async function fetchNickname(sender: any, loggedInUserId: any) {
    const updatedConversations = await Promise.all(
        sender.map(async (chat: any) => {
        if (chat._id.toString() === loggedInUserId.toString()) return chat;
        const nicknameData = await getNickNameDetails(loggedInUserId.toString(), chat._id.toString());
            
        const matchedNick = nicknameData?.[0]?.matchedNickname?.[0];
         const plainChat = chat.toObject ? chat.toObject() : chat;
        return {
            ...plainChat,
            nickName: matchedNick?.nickName,
            isActiveNickname: matchedNick?.isActiveNickname
            // name: nick ?? p.name
        }
    }));

    return updatedConversations;
}


export const getCallHistoryListsLogic = async (
    userId: string, 
    page: number = 1, 
    limit: number = 10,
    status:string,
    callType:string,
    callback:(error:any, result:any)=> void
) => {
    const skip = (page - 1) * limit;

    // Find users who have blocked the current user or whom the user has blocked
    const blockedUsers = await BlockedUser.find({
        $or: [{blockerId: userId}, {blockedId: userId}]
    }).lean();

    // Extract blocked user Ids
    const blockedUserIds = blockedUsers.map(block => 
        block.blockerId.toString() === userId ? block.blockedId.toString() : block.blockerId.toString()
    );

    const filters: any = { 
        $and: [
            { 
                participants: {
                    $elemMatch: {
                        userId: userId,
                        isCleared: {$ne: true}
                    }
                }
            }, // Ensure the user is a participant
            { "startedBy": { $nin: blockedUserIds } },  // Exclude calls started by blocked users
            { 
                participants:{
                    $not: {
                        $elemMatch:{
                            userId: {$in: blockedUserIds}
                        }
                    }
                }
            } // Exclude calls with blocked participants
        ]
    };
 
    try {
        // Fetch call history where the user is a participant
        const callHistoryList = await callHistory
            .find(filters)
            .populate({
                path: "chatId",
                select: "type isProfilePhoto isSendMessage encryptedAESKey groupName groupImage participants",
                populate: [
                    {
                        path: "participants",
                        select: "name userName profilePicture lastSeen phone bio email isOnline countryCode countryISOCode",
                    },
                    {
                        path: "admins",
                        select: "name userName profilePicture lastSeen phone bio email isOnline countryCode countryISOCode"
                    },
                    {
                        path: "lastMessage",
                        select: "_id files messageId createdAt content type sender",
                        populate: {
                            path: "sender",
                            select: "name userName profilePicture"
                        }
                    }
                ]
            })
            .populate("startedBy", "name userName profilePicture phone lastSeen bio email isOnline countryCode countryISOCode") // Populate user details
            .sort({ startTime: -1 })
            .limit(Number(limit))
            .skip((Number(page) - 1) * Number(limit));

        // Get total count for pagination
        const total = await callHistory.countDocuments();
        const formattedCallHistory = await Promise.all(callHistoryList.map(async(call) => {
            const isOutgoing = call.startedBy._id.toString() === userId; // Logged-in user is the caller
            const participant = call.participants.find(p => p.userId.toString() === userId);
            const isMissed = participant?.status === "missed";
           //@ts-ignore
            const sender = call.chatId && Array.isArray(call.chatId?.participants) ? call.chatId?.participants?.filter((p) => p._id.toString() !== userId) : [];
            const senderDetails = await fetchNickname(sender,userId);
            
            return {
                _id: call._id,
                chatInfo: call.chatId,
                participants: call.participants,
                // chatFullDetails: call.chatId,
                callId: call.callId,
                callType: call.callType,
                // sender: call.startedBy,
                sender: senderDetails[0],
                isEnded: call.isEnded,
                callStatus: call.callStatus,
                duration: call.duration,
                callDirection: isOutgoing ? "outgoing" : isMissed ? "missed" : "incoming",
                createdAt:call.startTime,
            };
        }));
        
        const pagination = {
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            limit,
        };
        if (callHistoryList.length > 0) {
            return callback(null, {
                callHistoryList: formattedCallHistory,
                pagination
            });
        } else {
            return callback(null, {
                status: 200,
                code: "CALLHISTORY_NOT_FOUND",
                message: "No call history found.",
                callHistoryList: []
                
            });
        }
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        }, null);
    }
};


export const getCallHistoryListsLogic2 = async (
    userId: string,
    page: number = 1,
    limit: number = 10,
    status: string,
    callType: string,
    callback: (error: any, result: any) => void
) => {
    const skip = (page - 1) * limit;

    // Find users who have blocked the current user or whom the user has blocked
    const blockedUsers = await BlockedUser.find({
        $or: [{ blockerId: userId }, { blockedId: userId }]
    }).lean();

    // Extract blocked user Ids
    const blockedUserIds = blockedUsers.map(block =>
        block.blockerId.toString() === userId ? block.blockedId.toString() : block.blockerId.toString()
    );

    const filters: any = {
        $and: [
            { "participants.userId": userId }, // Ensure the user is a participant
            { "participants.isCleared": { $ne: true } }, // Not cleared
            { "startedBy": { $nin: blockedUserIds } },  // Exclude calls started by blocked users
            { "participants.userId": { $nin: blockedUserIds } } // Exclude calls with blocked participants
        ]
    };

    if (status) {
        filters.$and.push({ callStatus: status }); // Filter by call status if provided
    }

    if (callType) {
        filters.$and.push({ callType }); // Filter by call type if provided
    }

    try {
        // Fetch call history where the user is a participant
        const callHistoryList = await callHistory
            .find(filters)
            .populate({
                path: "chatId",
                select: "type isProfilePhoto isSendMessage encryptedAESKey groupName groupImage participants",
                populate: [
                    {
                        path: "participants",
                        select: "name userName profilePicture lastSeen phone bio email isOnline countryCode countryISOCode",
                    },
                    {
                        path: "admins",
                        select: "name userName profilePicture lastSeen phone bio email isOnline countryCode countryISOCode"
                    },
                    {
                        path: "lastMessage",
                        select: "_id files messageId createdAt content type sender",
                        populate: {
                            path: "sender",
                            select: "name userName profilePicture"
                        }
                    }
                ]
            })
            .populate("startedBy", "name userName profilePicture phone lastSeen bio email isOnline countryCode countryISOCode") // Populate user details
            .sort({ startTime: -1 })
            .limit(Number(limit))
            .skip((Number(page) - 1) * Number(limit));

        // Get total count for pagination
        const total = await callHistory.countDocuments(filters);

        // Process and format the call history
        const formattedCallHistory = callHistoryList.map((call: any) => {
            const isOutgoing = call.startedBy._id.toString() === userId; // Logged-in user is the caller
            const participant = call.participants.find((p:any) => p.userId.toString() === userId);
            const isMissed = participant?.status === "missed";

            //@ts-ignore
            const sender = call.chatId && Array.isArray(call.chatId?.participants) 
                ? call.chatId?.participants?.filter((p:any) => p._id.toString() !== userId) 
                : [];

            let callDirection = "";
            let callStatus = "";

            // Handling status for One-to-One calls
            if (call.callType === CallType.VOICE || call.callType === CallType.VIDEO) {
                if (isOutgoing) {
                    callDirection = "outgoing";
                    callStatus = call.isEnded ? "completed" : (isMissed ? "missed" : "incoming");
                } else if (!isOutgoing && isMissed) {
                    callDirection = "missed";
                    callStatus = "missed";
                } else {
                    callDirection = "incoming";
                    callStatus = call.isEnded ? "completed" : "incoming";
                }
            }

            // Handling status for Group calls
            if (call.callType === CallType.VOICE_GROUP_CALL || call.callType === CallType.VIDEO_GROUP_CALL) {
                if (isOutgoing) {
                    callDirection = "outgoing";
                    callStatus = call.isEnded ? "completed" : "incoming";
                } else {
                    callDirection = "incoming";
                    callStatus = participant?.status === "missed" ? "missed" : "completed";
                }
            }

            return {
                _id: call._id,
                chatInfo: call.chatId,
                callId: call.callId,
                callType: call.callType,
                sender: sender[0],
                isEnded: call.isEnded,
                callStatus: callStatus,
                duration: call.duration,
                callDirection: callDirection,
                createdAt: call.startTime,
            };
        });

        const pagination = {
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            limit,
        };

        if (callHistoryList.length > 0) {
            return callback(null, {
                callHistoryList: formattedCallHistory,
                pagination
            });
        } else {
            return callback(null, {
                status: 200,
                code: "CALLHISTORY_NOT_FOUND",
                message: "No call history found.",
                callHistoryList: []
            });
        }
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        }, null);
    }
};

interface Call {
    callId: string;
    participants: Array<{ userId: string, status: string, callTime: Date, endTime: Date }>;
    callType: string;
    startedBy: string;
    duration: number;
    isEnded: boolean;
    status:string
  }
  export const getCallHistoryListsLogic3 = async (
    userId: string, 
    page: number = 1, 
    limit: number = 10,
    status:string,
    callType:string,
    callback:(error:any, result:any)=> void
  ) => {
    // const { userId } = req.params;  // userId will be provided in the URL
  
    try {
   // Fetch the call history for the user
   const calls = await callHistory.aggregate([
    {
      $match: {
        "participants.userId": new mongoose.Types.ObjectId(userId),
      },
    },
    {
      $unwind: "$participants",  // Flatten the participants array to work on individual participant
    },
    {
      $match: {
        "participants.userId": new mongoose.Types.ObjectId(userId),
      },
    },
    {
      $project: {
        callId: 1,
        callType: 1,
        startedBy: 1,
        endedBy: 1,
        participants: 1,
        startTime: 1,
        endTime: 1,
        isEnded: 1,
        duration: 1,
        callStatus: 1,
        "participants.status": 1, // keep this as is
        "participants.joinTime": 1,
        "participants.leaveTime": 1,
      },
    },
  ]);

  if (!calls || calls.length === 0) {
    // return res.status(404).json({ success: false, message: "No call history found for this user" });
    return callback("errror.........",null)
  }

  // Process calls to add status for the user
  const processedCalls = calls.map((call: any) => {
    // Check each participant's status
    const userParticipant = call.participants.find((p:any) => p.userId.toString() === userId);

    let status = "";
    if (call.isEnded && userParticipant) {
      if (userParticipant.status === "joined") {
        status = "completed"; // User joined and the call ended
      } else if (userParticipant.status === "missed") {
        status = "missed"; // User missed the call
      }
    } else if (!call.isEnded && userParticipant) {
      if (userParticipant.status === "joined") {
        status = "incoming"; // Call is ongoing, user joined
      } else {
        status = "missed"; // User missed the incoming call
      }
    }

    // Handle the scenario for outgoing call
    if (call.startedBy.toString() === userId && !call.isEnded) {
      status = "outgoing"; // User started the call but it's ongoing
    }

    // Update the status
    call.status = status;

    return {
      callId: call.callId,
      callType: call.callType,
      startedBy: call.startedBy,
      endedBy: call.endedBy,
      participants: call.participants,
      startTime: call.startTime,
      endTime: call.endTime,
      isEnded: call.isEnded,
      callStatus: call.callStatus,
      duration: call.duration,
      status: status,
    };
  });
    //   return res.status(200).json({ success: true, calls: processedCalls });
    return callback(null,{calls: processedCalls})
    } catch (error) {
      console.error("Error fetching call history:", error);
      return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        },null)
    }
  };
/**
 On Call Initiation: When a user initiates a call (either voice or video), 
    a new call history entry will be created with the participants, call type,
  and status set to ongoing. The start time will also be recorded.
 */
export const startCallLogic = async(
    callerId: string, 
    recipientId: string,
    callType: CallType,
    channelName: string,
    chatId:string,
    callback: (error:any, result:any) => void
)=>{
    try {
        const savedCall = initiateCall(callerId,recipientId,channelName,callType,chatId)
        if(savedCall){
            return callback(null,savedCall)
        }
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        },null)
    }
} 

export const initiateCall = async(
    // participants: string[],
    callerId: string, 
    recipientId: string,
    channelName: string,
    chatId: string,
    callType: string,
) => {
    const newCallHistory = new callHistory({
        channelName,
        callerId:callerId,
        participants:[callerId, recipientId],
        callType,
        direction:"outgoing",
        status: "missed",
        startTime: new Date(),
        endTime: null,
        chatId
    })

   return await newCallHistory.save()
}

export const callAccepted = async(
    callHistoryId: string,
) => {
    const result = await callHistory.findOneAndUpdate(
        {_id: callHistoryId},{status: "accepted"}
    )
    return result
}

export const rejectCall = async(
    callHistoryId: string,
)=>{
    const result = await callHistory.findOneAndUpdate({_id: callHistoryId},{status: "missed"})
    return result
}

export const callEnded = async(
    callHistoryId: string,
)=>{
    const call = await callHistory.findById(callHistoryId);
        if (!callHistory) {
            console.log("Call history not found.");
            return;
        }

    // Ensure that startTime is not null before createing a Date object
    const startTime = call?.startTime;
    if(!startTime){
        console.log("Invalid startTime in call history.");
        return
    }
    // const endTime = new Date();
    const duration = Math.round((new Date().getTime() - new Date(startTime).getTime()) / 1000); // duration in seconds


    await callHistory.findByIdAndUpdate(callHistoryId, {
        status: "completed",
        endTime: new Date(),
        duration:duration
    });
}
/*
On Call End: When the call ends, you will update the call history entry with the endTime, duration, and status. 
The duration will be calculated based on the difference between endTime and startTime
*/
export const endCallLogic = async(
    callId: string, // call history entry ID
    status: 'completed' | 'misses',  // status of the call
    callback:(error:any, result: any) => void
) => {
    try {
        const call = await callHistory.findById(callId);
        if(!call){
            return callback({
                status: 404,
                code: "CALL_NOT_FOUND",
                message: "Call history entry not found."
            },null)
        }
        
        const startTime = call?.startTime;
        if(!startTime){
            console.log("Invalid startTime in call history.");
            return
        }

        // update call duration and status
        const endTime = new Date();
        const duration = Math.floor((endTime.getTime() - new Date(startTime).getTime()) / 1000);   // in seconds
        call.endTime = endTime;
        call.duration = duration;
        // call.status = "completed";
        await call.save()
        return callback(null, call)
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        },null)
    }
}

export const endCallLogicFunction = async()=>{

}
/*
Handling Missed Calls: If a user misses a call (i.e., the call wasn't answered), the status will be set to missed. 
This can be triggered from the frontend when a user doesn't answer or is unavailable.
*/
export const markCallAsMissed = async(
    callId: string,
    callback: (error:any,result:any) => void
) => {
    try {
        const call = await callHistory.findById(callId);
        if (!call) {
            return callback({
                status: 404,
                code: "CALL_NOT_FOUND",
                message: "Call history entry not found."
            }, null);
        }

        // call.status = 'missed';
        const updatedCall = await call.save();
        return callback(null, updatedCall);
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        },null)
    }
}

/* 
Fetching Call History: To retrieve the call history for a user, 
you can query the CallHistory model based on the user's ID and return all the calls they were involved in.
*/

export const getCallHistory = async(userId: string) => {
    try {
        const calls = await callHistory.find({ participants: userId }).sort({ startTime: -1 });
        return calls;
    } catch (error) {
        console.error("Error fetching call history:", error);
        return null;
    }
}
