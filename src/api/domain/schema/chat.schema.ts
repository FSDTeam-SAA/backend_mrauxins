import mongoose, { Document, Schema } from "mongoose";

export enum ChatType {
    ONE_TO_ONE = "one_to_one",
    GROUP = "group",
    CHANNEL = "channel"
}

interface IChat extends Document {
    type:ChatType,
    isGroup: boolean;
    participants: mongoose.Types.ObjectId[];
    // participants?: Array<{ userId: mongoose.Types.ObjectId, role: string }>;
    admins: mongoose.Types.ObjectId[];
    groupName?: string;
    groupImage?: string;
    lastMessage?: mongoose.Types.ObjectId;
    createdAt: Date;
    isProfilePhoto: boolean,
    isSendMessage:boolean;
    hideMembersInfo: boolean;
    hideNewMembersMessage: boolean;
    restrictContentSharing: boolean;
    isGroupProfilePhoto: boolean;
    createdBy: mongoose.Types.ObjectId;

    // channel fields
    description?: string;
    avatar?:string;
    privacy?: 'public' | 'private';
    members?: Array<{ userId: mongoose.Types.ObjectId, role: string }>;
    inviteLink?: string;

    // Encrypted AES Key
    encryptedAESKey: string;
    messageAutoDeleteTime: number | null;
    messageAutoDeleteStartTime: Date | null;
    sortIndex?:number;
    isFirstMessage?:number
}

const Chat = new Schema<IChat>({
    type: { type: String, enum: Object.values(ChatType), required: true, default: ChatType.ONE_TO_ONE },
    isGroup: { type: Boolean, required: true, default: false },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],

    admins:[{type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true}],
    // Group fields
    groupName: { type: String },
    groupImage: { type: String },
    
    // Channel fields
    description: { type: String },
    avatar: { type: String },
    privacy: { type: String, enum: ['public', 'private'] },
    inviteLink: { type: String },

    isProfilePhoto:{type: Boolean, default: true},
    isSendMessage:{type: Boolean, default: true},
    hideMembersInfo:{type: Boolean, default: false},
    hideNewMembersMessage:{type: Boolean, default: false},
    restrictContentSharing:{type: Boolean, default: false},
    isGroupProfilePhoto:{type: Boolean, default: true},
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    createdAt: { type: Date, required: true, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },

    sortIndex: {type: Number, default: function(){ return Date.now(); }, index: true }, // Added index
    encryptedAESKey: {type: String, required: true},
    messageAutoDeleteTime: {type: Number, default: null},
    messageAutoDeleteStartTime:{type: Date, default: null},
    isFirstMessage:{type: Number,default: 0}    // o means, chat create but not any message        
    /**
        null → No auto-deletion.
        3600 → 1 hour.
        86400 → 1 day.
        604800 → 7 days. 
    */
  });

  export default mongoose.model<IChat>('Chat', Chat)
