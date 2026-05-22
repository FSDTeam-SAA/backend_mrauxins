import mongoose, { Document, Schema } from "mongoose";

interface IBlockedUser extends Document {
    blockerId: mongoose.Types.ObjectId;
    blockedId: mongoose.Types.ObjectId;
    createdAt: Date;
    chatId?: mongoose.Types.ObjectId;
    blockType?: string;
}


const blockedUserSchema = new Schema<IBlockedUser>({
    blockerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    blockedId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, default: Date.now },
    chatId: {type: Schema.Types.ObjectId, ref: "Chat"},
    blockType:{type: String, enum:["chat","report"], default: "chat"}   // chat | report
});

// Ensure a user cannot block the same person multiple times
blockedUserSchema.index({ chatId: 1, blockerId: 1, blockedId: 1 }, { unique: true });

export const BlockedUser = mongoose.model<IBlockedUser>("BlockedUser", blockedUserSchema);