import mongoose, { Document, Schema } from "mongoose";

interface IChatParticipant extends Document{
    userId: mongoose.Types.ObjectId;
    chatId: mongoose.Types.ObjectId;
    lastClearedMessageId?: mongoose.Types.ObjectId | null;
    lastReadMessageId?: mongoose.Types.ObjectId | null;
    isArchived?:boolean;
    isRemoved?:boolean;
    isDeleted?:boolean;
    deletedFor?:Date;
    rejoinedAt?:Date;
    unreadCount?:number;
    isPinned?: boolean
    pinnedAt?: Date | null,
    isNotificationMute:boolean,
    markMessageAsUnread: boolean,
    sortConversationDate: Date;
}

const ChatParticipantSchema = new Schema<IChatParticipant>({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
    lastClearedMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    lastReadMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    isArchived: {type: Boolean, default: false},
    isRemoved:{type: Boolean, default: false},
    isDeleted:{type: Boolean, default: false},
    deletedFor:{type: Date, default: null},
    rejoinedAt:{type: Date, default: null},
    unreadCount:{type: Number, default: 0},
    isPinned: {type: Boolean, default: false},
    pinnedAt: {type: Date, default: null},
    isNotificationMute: {type: Boolean, default: false},
    markMessageAsUnread: {type: Boolean, default: false},
    sortConversationDate: {type: Date, default: Date.now}
},{ timestamps: true})

export default mongoose.model<IChatParticipant>('ChatParticipant',ChatParticipantSchema)