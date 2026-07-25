import mongoose, { Document, Schema } from "mongoose";

interface IDeviceToken extends Document{
    userId: mongoose.Types.ObjectId;
    deviceToken: string;
    deviceType?: string;
    createdAt: Date;
    updatedAt: Date;
}

const deviceTokenSchema = new Schema<IDeviceToken>({
    userId: {type: Schema.Types.ObjectId, ref: "User", required: true},
    deviceToken: {type: String, required: true, unique: true },
    // deviceToken: {type: String, required: true, /* unique: true */},
    deviceType: {type: String, enum: ["Android","ios","web"], default: "Web"}
},{timestamps: true});

export const deviceToken = mongoose.model<IDeviceToken>("deviceToken",deviceTokenSchema);