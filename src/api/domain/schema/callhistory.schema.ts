import { required } from "joi";
import mongoose, { Document, Schema } from "mongoose";

export enum CallType {
    VOICE = "voice",
    VIDEO = "video",
    VOICE_GROUP_CALL = "voice_group_call",
    VIDEO_GROUP_CALL = "video_group_call",

    // ONE_TO_ONE_VIDEO = "onet_to_one_video",
    // ONE_TO_ONE_VOICE = "one_to_one_voice",
    // GROUP_VIDEO = "group_video",
    // GROUP_VOICE = "group_voice"
}

export enum CallStatus {
    ACCEPTED = "accepted", // User joined the call
    ENDED = "ended",       // User left or call ended
    MISSED = "missed"      // User never joined
}

interface IParticipant {
    userId : mongoose.Types.ObjectId;
    status: "joined" | "missed" | "left" | "ended";    // "missed" if they never joined
    // sessions?: {joinTime: Date; leaveTime?: Date}[] // Only for group calls
    joinTime: Date;
    leaveTime?: Date;
    totalDuration?: number;  // Total time spent in call (for group calls)
    isCleared: boolean
}

interface ICallHistory extends Document {
    callId: string; // Unique call identifier
    chatId: mongoose.Types.ObjectId;
    callType: CallType,
    startedBy : mongoose.Types.ObjectId;   // Who initiated the call
    endedBy : mongoose.Types.ObjectId; 
    participants: IParticipant[];
    startTime: Date;
    endTime?: Date;
    isEnded: boolean;
    callStatus:CallStatus,
    duration:number;
    createdBy:Date;
}

const callHistorySchema = new Schema<ICallHistory>({
    callId:{type:String, required: true, unique: true},
    chatId:{type: mongoose.Schema.Types.ObjectId, ref:"Chat", required:true},
    callType: {type: String, enum:Object.values(CallType), required: true},
    startedBy: {type: mongoose.Schema.Types.ObjectId, ref: "User", required:true},
    endedBy: {type: mongoose.Schema.Types.ObjectId, ref: "User", required:false},
    participants:[
        {
            userId:{type: mongoose.Schema.Types.ObjectId, ref:"User", required: true},
            status:{type: String, enum: ["joined","missed","left","ended"], required:true},
            // sessions:[
            //     {
            //         joinTime: {type: Date, required: true},
            //         leaveTime : {type: Date}
            //     }
            // ],
            joinTime:{type: Date, required: true},
            leaveTime: {type: Date},
            totalDuration: {type: Number, default:0},
            isCleared: {type:Boolean, default: false}
        }
    ],
    startTime: {type: Date, required: true, default: Date.now},
    endTime: {type: Date},
    isEnded: {type: Boolean, default: false},
    callStatus:{type:String},
    duration:{type:Number, default:0},
    createdBy:{type:Date, default:Date.now()}
})

export const callHistory = mongoose.model<ICallHistory>("callHistory",callHistorySchema)

// interface IParticipantStatus {
//     userId: mongoose.Types.ObjectId;
//     status: 'missed' | 'accepted';  
// }

// interface ICallHistory extends Document{
//     channelName: string,
//     chatId:mongoose.Types.ObjectId;
//     participants: mongoose.Types.ObjectId[];
//     participantStatus: IParticipantStatus[]
//     callerId:mongoose.Types.ObjectId;
//     callType: CallType;    // Type of the call
//     duration: number;   // duration of the call in seconds
//     status: 'missed' | 'completed' | 'ongoing' | 'accepted';     // status of the call
//     direction:"incoming" | "outgoing";
//     startTime: Date | null;
//     endTime: Date | null;
//     createdAt: Date;
// }

// const callHistorySchema = new Schema<ICallHistory>({
//     channelName: { type: String, required: true },
//     chatId:{type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: false},
//     participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
//     participantStatus: [{
//         userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
//         status: { type: String, enum: ['missed', 'accepted'], default: 'missed' }
//     }],
//     callerId:{type: mongoose.Schema.Types.ObjectId,ref: 'User', required: true},
//     callType: {type: String, enum: ['voice','video','voice_group_call','video_group_call'], required: true},
//     duration: { type: Number, required: true, default: 0 },  // duration in seconds
//     status: { type: String, enum: ['missed', 'completed', 'ongoing','accepted'], required: true },
//     direction:{type: String, enum: ['incoming', 'outgoing'], required: true},
//     startTime: { type: Date, required: true, default: Date.now },
//     endTime: { type: Date, default: null },
//     createdAt: { type: Date, required: true, default: Date.now },
// });

// export const callHistory = mongoose.model<ICallHistory>("callHistory", callHistorySchema);
