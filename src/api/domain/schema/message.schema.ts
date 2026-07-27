import { number, ref, string } from 'joi';
import mongoose, { Schema, Document } from 'mongoose';


interface IFileDetails {
    url: string;
    fileName: string;
    fileSize:number;
    mimeType: string;
}

export interface IDeliveryStatus {
    [userId: string]:'sent' | 'delivered' | 'read'
}

interface ISystemMessage {
    name?: string;
    phone?:string;
    profilePicture?:string;
    message?:string;
    _id:mongoose.Types.ObjectId;
}
export interface Reaction {
    userId: mongoose.Types.ObjectId;
    emoji: string;
}
interface IMessages extends Document {
    channelId: mongoose.Types.ObjectId;
    chatId: mongoose.Types.ObjectId;
    sender: mongoose.Types.ObjectId;
    content?: string;
    type: 'text' | 'media' | 'image' | 'video' | 'audio' | 'document'| 'pdf' | 'mixed' | 'gif' | 'disappearing_messages' | 'system_message';
    // fileIds?: Array<string>;
    fileIds?: Array<string>;
    files: IFileDetails[];
    isDeleted: boolean;
    deletedAt: Date;
    deletedFor:Array<mongoose.Types.ObjectId>;
    messageId: string;
    isRead: boolean;
    isDelivered:boolean;
    status: 'sent' | 'delivered' | 'read';
    deliveryStatus: IDeliveryStatus;
    createdAt: Date;
    expiresAt?: Date;
    replyTo?: string;
    disAppearingMessages?:number;
    systemMessage?:ISystemMessage;
    forwarded: false;
    originalMessageId: string;
    pinned: boolean;
    reactions: Array<string>;
    reactOnMessage: Reaction[]
    isEditedMessage?: boolean;
}

const Messages = new Schema<IMessages>({
    channelId: {type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: false},
    chatId: {type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: false},
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, default: null },
    type: {type: String, enum: ['text','media', 'image', 'video', 'audio', 'document','pdf', 'mixed','gif','disappearing_messages',"system_message"], required: true, default: 'text'},
    // fileIds:[{type: mongoose.Types.ObjectId, ref: 'File'}],
    fileIds: {
        type: [String], // Store file URLs or paths as strings
        default: []
    },
    files:[{
        url:{type: String},
        fileName: { type: String, required: false },
        fileSize: { type: Number, required: false },
        mimeType: { type: String, required: false },
    }],
    isDeleted:{type: Boolean, default: false},
    deletedAt: {type: Date},
    // unique + sparse: guards against the same client-generated tempMessageId
    // being saved twice (e.g. the REST and Socket.IO send-message paths both
    // firing for one message, or a client retry). sparse so system-generated
    // messages that never set messageId (savedMessageFromGroup, channel
    // broadcast messages) aren't affected by the uniqueness constraint.
    messageId: {type: String, unique: true, sparse: true},
    deletedFor: [{type: mongoose.Schema.Types.ObjectId, ref: "User"}],// Tracks users who cleared the message
    isRead: { type: Boolean, default: false },
    isDelivered: {type: Boolean, default: false},
    status:{type: String, enum:["sent","delivered","read"]},
    deliveryStatus:{
        type: Map,
        of: String,
        enum: ['sent','delivered','read'],
        default:{}
    },
    // createdAt: { type: Date, required: true, default: Date.now },
    expiresAt: {type: Date, default: null},
    replyTo: {type: String, default: null},
    disAppearingMessages:{type: Number, default: null},
    systemMessage: {
        name: { type: String, default: null },
        profilePicture: { type: String, default: null },
        phone: { type: String, default: null },
        message:{type: String, default: null},
        _id: { type: mongoose.Schema.Types.ObjectId } // No need to auto-generate
    }, // Convert systemMessage to object
    forwarded: {type: Boolean,default: false},
    originalMessageId:{type: String, default: null},
    pinned:{type: Boolean, default: false},
    reactions:{type: [String], default:[]},
    reactOnMessage:[
        {
            userId: {type : mongoose.Schema.Types.ObjectId,ref: "user"},
            emoji: {type: String, required: true}
        }
    ],
    isEditedMessage: {type: Boolean, default: false}
},{timestamps: true});  // ✅ Enables `createdAt` and `updatedAt` automatically.

export default mongoose.model<IMessages>('Message',Messages);