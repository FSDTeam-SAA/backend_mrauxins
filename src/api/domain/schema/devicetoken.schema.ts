import mongoose, { Document, Schema } from "mongoose";

interface IDeviceToken extends Document{
    userId: mongoose.Types.ObjectId;
    deviceToken?: string;
    voipToken?: string;
    deviceType?: string;
    createdAt: Date;
    updatedAt: Date;
}

const deviceTokenSchema = new Schema<IDeviceToken>({
    userId: {type: Schema.Types.ObjectId, ref: "User", required: true},
    // Not required: a fresh iOS install can register its PushKit voipToken
    // before the FCM deviceToken arrives (see saveDeviceToken in helper.ts).
    deviceToken: {type: String, unique: true, sparse: true },
    // iOS PushKit VoIP token — used to send incoming-call pushes directly
    // via APNs (FCM can't deliver the voip push type). Not set on Android.
    voipToken: {type: String, unique: true, sparse: true },
    deviceType: {type: String, enum: ["Android","ios","web"], default: "Web"}
},{timestamps: true});

export const deviceToken = mongoose.model<IDeviceToken>("deviceToken",deviceTokenSchema);