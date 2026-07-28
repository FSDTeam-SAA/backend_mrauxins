import mongoose from "mongoose";
import messageSchema from "../schema/message.schema";
import { loggerMsg } from "../../lib/logger";
import chatSchema from "../schema/chat.schema";
import chatParticipantSchema from "../schema/chat.participant.schema";
import userSchema from "../schema/user.schema";
import { getNickNameDetails } from "../../socket/initDemoSocketHandlers";

// saveMessage into group query
export const savedMessageFromGroup = async (
  chatId: string,
  senderId: string,
  content: string,
  type: string,
  fileUrls: any
) => {
  const newMessage = new messageSchema({
    chatId,
    sender: senderId,
    content,
    type,
    fileIds: fileUrls,
  });
  const savedMessage = await newMessage.save();
  return savedMessage;
};

// group messages query
export const fetchMessagesOfGroupQuery = async (
  groupChatId: string,
  skip: number,
  limit: number
) => {
  const messages = await messageSchema.aggregate([
    {
      $match: { chatId: new mongoose.Types.ObjectId(groupChatId) },
    },
    {
      $sort: { createdAt: -1 },
    },
    {
      $skip: skip,
    },
    {
      $limit: limit,
    },
    {
      $lookup: {
        from: "users",
        localField: "sender",
        foreignField: "_id",
        as: "senderDetails",
      },
    },
    {
      $addFields: {
        senderDetails: { $arrayElemAt: ["$senderDetails", 0] },
      },
    },
    {
      $project: {
        content: 1,
        timestamp: 1,
        isRead: 1,
        fileIds: 1,
        createdAt: 1,
        "senderDetails._id": 1,
        "senderDetails.name": 1,
        "senderDetails.userName": 1,
        "senderDetails.profilePicture": 1,
      },
    },
  ]);

  return messages;
};

interface MediaDetails {
    fileName: string;
    fileSize:number;
    mimeType: string;
}

export const savedMessageOneToOne = async (
  chatId: string,
  sender: mongoose.Types.ObjectId,
  content: string,
  type: string,
  fileUrls: any,
  tempMessageId:string,
  deliveryStatus?:any,
  isRead?:Boolean,
  messageStatus?: string,
  replyToMessageId?: string,
  mediaDetails?:MediaDetails,
  messageCreatedAt?: Date
  
) => {
  loggerMsg("Inside call function save message","debug")
  const chat = await chatSchema.findById(chatId).select("messageAutoDeleteTime");
    let expiresAt;
    if(chat && chat.messageAutoDeleteTime){
      expiresAt = new Date(Date.now() + chat.messageAutoDeleteTime * 1000)
    }
  

  const newMessage = new messageSchema({
    chatId,
    sender,
    content: content !== null ? content : "",
    type,
    fileIds: fileUrls,
    status:messageStatus,
    files:mediaDetails,
    isRead:isRead,
    messageId:tempMessageId,
    deliveryStatus,
    expiresAt,
    replyTo : replyToMessageId,
    createdAt: messageCreatedAt || new Date()
  });
  loggerMsg("Saved messaes in db","debug")

  try {
    const savedMessage = await newMessage.save();
    return savedMessage;
  } catch (error: any) {
    if (error?.code === 11000 && error?.keyPattern?.messageId) {
      // Same tempMessageId already saved — happens when the REST and
      // Socket.IO send-message paths (or a client retry) both fire for the
      // same client-generated message. Return the existing row, flagged as
      // a duplicate, instead of throwing, so the caller can skip
      // re-delivering (duplicate socket emit + duplicate push notification).
      const existing = await messageSchema.findOne({ messageId: tempMessageId });
      if (existing) {
        (existing as any).isDuplicate = true;
        return existing;
      }
    }
    throw error;
  }
};

// one to one chat messages
// export const fetchMessagesOfChat = async (
//   chatId: string,
//   userId: string,
//   page: number,
//   limit: number,
//   skip: number,
//   search: string
// ) => {
//   // Fetch the chat participant details
//   const chatParticipant = await chatParticipantSchema
//     .findOne({ chatId, userId })
//     .select("isRemoved deletedFor rejoinedAt");

//   // Construct the query for fetching messages
//   const query: any = { chatId };

//   // Handle deleted messages visibility
//   query.$or = [
//     { isDeleted: { $exists: false } }, // Messages with no 'isDeleted' field
//     { isDeleted: false }, // Messages that are not globally deleted
//     { isDeleted: true, deletedFor: { $ne: new mongoose.Types.ObjectId(userId) } } // Exclude messages deleted by this user
//   ];

//   // If the user was removed, show only messages sent before 'deletedFor'
//   if (chatParticipant?.isRemoved && chatParticipant?.deletedFor) {
//     query["createdAt"] = { $lte: chatParticipant.deletedFor };
//   }

//   if (chatParticipant?.deletedFor && chatParticipant?.rejoinedAt) {
//     query["$or"] = [
//       { createdAt: { $gte: chatParticipant.rejoinedAt } }, // Get messages after rejoining
//       { createdAt: { $lte: chatParticipant.deletedFor } } // Get messages before deletion
//     ];
//   }
  
//   // Apply search filtering if needed
//   if (search) {
//     query.content = { $regex: search, $options: "i" }; // Case-insensitive search
//   }

//   // Fetch messages with pagination and sender details
//   const messages = await messageSchema
//     .find(query)
//     .sort({ createdAt: -1 }) // Order by newest first
//     .skip(skip)
//     .limit(limit)
//     .populate({
//       path: "sender",
//       select: "userName name profilePicture"
//     });

//   console.log("Total messages fetched:", messages.length);

//   return messages;
// };



// 02-04-25 changes
export const fetchMessagesOfChat = async (
  chatId: string,
  userId: string,
  page: number,
  limit: number,
  skip: number,
  search: string
) => {
  // Fetch the chat participant details
  const chatParticipant = await chatParticipantSchema
    .findOne({ chatId, userId })
    .select("isRemoved deletedFor rejoinedAt");

    const query: any = { chatId };

  // Exclude messages deleted by the logged-in user
  query.$and = [
    {
      $or: [
        { isDeleted: { $exists: false } }, // Messages with no 'isDeleted' field
        { isDeleted: false }, // Messages that are not globally deleted
        { isDeleted: true, deletedFor: { $ne: new mongoose.Types.ObjectId(userId) } } // Exclude messages deleted by this user
      ]
    },
    {
      deletedFor: { $ne: new mongoose.Types.ObjectId(userId) } // Ensure deleted messages do not appear for this user
    }
  ];

  // If the user was removed from the chat, show only messages sent before 'deletedFor'
  if (chatParticipant?.isRemoved && chatParticipant?.deletedFor) {
    query["createdAt"] = { $lte: chatParticipant.deletedFor };
  }

  // If the user has rejoined, adjust message visibility
  if (chatParticipant?.deletedFor && chatParticipant?.rejoinedAt) {
    query.$and.push({
      $or: [
        { createdAt: { $gte: chatParticipant.rejoinedAt } }, // Get messages after rejoining
        { createdAt: { $lte: chatParticipant.deletedFor } } // Get messages before deletion
      ]
    });
  }

  // Apply search filtering if needed
  if (search) {
    query.content = { $regex: search, $options: "i" }; // Case-insensitive search
  }

  // Fetch messages with pagination and sender details
  const messages = await messageSchema
    .find(query)
    .sort({ createdAt: -1 }) // Order by newest first
    .skip(skip)
    .limit(limit)
    .populate({
      path: "sender",
      select: "userName name profilePicture"
    });



  return messages;
};


export const pinnedMessagesOfChat = async (
  chatId: string,
  userId: string,
  page: number,
  limit: number,
  skip: number,
  search: string
) => {
  // Fetch the chat participant details
  const chatParticipant = await chatParticipantSchema
    .findOne({ chatId, userId })
    .select("isRemoved deletedFor rejoinedAt");

    const query: any = { chatId };

  query.pinned = true;
  // Exclude messages deleted by the logged-in user
  query.$and = [
    {
      $or: [
        { isDeleted: { $exists: false } }, // Messages with no 'isDeleted' field
        { isDeleted: false }, // Messages that are not globally deleted
        { isDeleted: true, deletedFor: { $ne: new mongoose.Types.ObjectId(userId) } } // Exclude messages deleted by this user
      ]
    },
    {
      deletedFor: { $ne: new mongoose.Types.ObjectId(userId) } // Ensure deleted messages do not appear for this user
    }
  ];

  // If the user was removed from the chat, show only messages sent before 'deletedFor'
  if (chatParticipant?.isRemoved && chatParticipant?.deletedFor) {
    query["createdAt"] = { $lte: chatParticipant.deletedFor };
  }

  // If the user has rejoined, adjust message visibility
  if (chatParticipant?.deletedFor && chatParticipant?.rejoinedAt) {
    query.$and.push({
      $or: [
        { createdAt: { $gte: chatParticipant.rejoinedAt } }, // Get messages after rejoining
        { createdAt: { $lte: chatParticipant.deletedFor } } // Get messages before deletion
      ]
    });
  }

  // Apply search filtering if needed
  if (search) {
    query.content = { $regex: search, $options: "i" }; // Case-insensitive search
  }

  // Fetch messages with pagination and sender details
  const messages = await messageSchema
    .find(query)
    .sort({ createdAt: -1 }) // Order by newest first
    // .skip(skip)
    // .limit(limit)
    .populate({
      path: "sender",
      select: "userName name profilePicture"
    });

  
  const nicknamesMap = new Map<string, {nickName: string, isActiveNickname: boolean}>();
  const user = await userSchema.findById(userId).select("nicknames");
            
  user?.nicknames.forEach(n => {
      if(n.contactUserId && n.nickName){
          nicknamesMap.set(n.contactUserId.toString(), {
              nickName: n.nickName,
              isActiveNickname: n.isActiveNickname ?? false
          })
      }
  })
    
  async function fetchNickname(sender:any, loggedInUserId: any){    
      const senderData = sender.toObject();
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

  

  const modifyMessages = await Promise.all(messages.map(async(msg) => {
    const plainMsg = msg.toObject ? msg.toObject() : msg;
    let senderDetails = await fetchNickname(msg.sender,userId);
    
    // If it's a Mongoose document, convert to plain object
    if (senderDetails?.toObject) {
      senderDetails = senderDetails.toObject();
    }

    return {
      ...plainMsg,
      sender: senderDetails
    }
  }))
  return modifyMessages;
};
