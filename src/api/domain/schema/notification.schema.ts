import mongoose, { Document, mongo, Schema } from "mongoose";

export enum NotificationType {
    CHAT_MESSAGE = "chat_message",
    NEW_GROUP_CREATED = "new_group_created",
    CREATE_NEW_CHANNEL = "create_new_channel",

    GROUP_INVITE = "group_invite",
    CHANNEL_INVITE = "channel_invite",

    ASSIGN_ADMIN = "assign_admin",
    
    LEAVE_GROUP = "leave_group",
    DELETE_GROUP = "delete_group",
    REMOVED_GROUP = "removed_group",

    LEAVE_CHANNEL = "leave_channel",
    DELETE_CHANNEL = "delete_channel",
    REMOVED_CHANNEL = "removed_channel",
    

    REMOVE_MEMBER_GROUP = "removed_member_group",
    REMOVE_MEMBER_CHANNEL = "removed_member_channel",

    AGORA_CALL_INVITATION = "agora_call_invitation",

    
    AGORA_END_CALL = "agora_end_call",

    MESSAGE = "message",
    CHANNEL_MENTION = "channel_mention",
    VOICE= "voice",
    VIDEO = "video",
    VIDEO_GRPOP_CALL = "video_group_call",
    VOICE_GRPOP_CALL = "voice_group_call",
    OTHER = "other",

    CREATE_NEW_GROUP = "create_new_group",
}

export const CLICK_NOTIFICATION_TYPE = "212_MESSENGER_NOTIFICATION_CLICK"
interface INotification extends Document {
    receiverId : mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    chatId?: mongoose.Types.ObjectId;
    messageId?: mongoose.Types.ObjectId;
    type: NotificationType;
    content?: string;
    isRead: boolean;
    createdAt: Date;
}

const NotificationSchema = new Schema<INotification>({
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: "Chat" },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    type: { type: String, enum: Object.values(NotificationType), required: true },
    content: { type: String },
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<INotification>("Notification",NotificationSchema)