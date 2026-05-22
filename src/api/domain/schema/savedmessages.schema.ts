import mongoose, { Document, Schema } from "mongoose";

interface IFileDetails {
    url: string;
    fileName: string;
    fileSize:number;
    mimeType: string;
}

export interface Reaction {
    userId: mongoose.Types.ObjectId;
    emoji: string;
}

interface SavedMessages extends Document {
    userId : mongoose.Types.ObjectId;
    sender: mongoose.Types.ObjectId;
    messageId: string;
    chatId:mongoose.Types.ObjectId;
    content?: string;
    type: 'text' | 'media' | 'image' | 'video' | 'audio' | 'document'| 'pdf' | 'mixed' | 'gif';
    fileIds?: Array<string>;
    savedAt: Date;
    files: IFileDetails[];
    tempMessageId: string;
    reactions:Array<string>;
    reactOnMessage: Reaction[];
    replyTo?: string;
    pinned: boolean;
    isEditedMessage: boolean;
}

const savedMessagesSchema = new Schema<SavedMessages>({
    userId: {type: Schema.Types.ObjectId, ref: 'User', required: true},
    sender: {type: Schema.Types.ObjectId, ref: "User", required: true},
    messageId: {type: String},
    tempMessageId:{type: String},
    chatId: {type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: false},
    type: {type: String, enum: ['text','media', 'image', 'video', 'audio', 'document','pdf', 'mixed','gif'], required: false, default: 'text'},
    content: { type: String, default: null },
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
    savedAt: { type: Date, default: Date.now },
    reactions: {type: [String], default:[]},
    reactOnMessage:[
        {
            userId: {type : mongoose.Schema.Types.ObjectId,ref: "user"},
            emoji: {type: String, required: true}
        }
    ],
    replyTo: {type: String, default: null},
    pinned:{type: Boolean, default: false},
    isEditedMessage: {type: Boolean, default: false}
})

export default mongoose.model<SavedMessages>('SavedMessage',savedMessagesSchema);