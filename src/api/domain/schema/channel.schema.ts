import mongoose, { Document, Schema } from "mongoose";

enum ChannelPrivacy {
    PUBLIC = 'public',
    PRIVATE = 'private'
}

interface IChannel extends Document {
    channelName: string;
    description?: string;
    avatar?: string;
    privacy: ChannelPrivacy;
    createdBy: mongoose.Types.ObjectId;
    admins: mongoose.Types.ObjectId[];     
    members:  Array<{ userId: mongoose.Types.ObjectId, role: string }>;  
    inviteLink?: string;                   
    lastMessage?: mongoose.Types.ObjectId;
    createdAt: Date;
}


const channelSchema: Schema<IChannel> = new Schema({
    channelName: {type: String, required: true},
    description: {type: String},
    avatar: { type: String },
    privacy:{type: String, enum: [ChannelPrivacy.PUBLIC, ChannelPrivacy.PRIVATE], default: ChannelPrivacy.PUBLIC},
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    members: [
        { 
            userId: {type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            role: {type: String, enum: ['admin', 'member'], default: "member"}

        }
    ],
    inviteLink: { type: String },
    lastMessage: {type: mongoose.Types.ObjectId, ref:'Message'},
    createdAt: { type: Date, default: Date.now },  
})

export const Channel = mongoose.model<IChannel>("Channel", channelSchema);