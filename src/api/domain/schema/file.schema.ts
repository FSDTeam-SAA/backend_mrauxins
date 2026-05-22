import mongoose, { Document } from "mongoose";

export interface IFile extends Document {
    type: 'image' | 'video' | 'audio' | 'document' | 'pdf';
    filePath: string;
    messageId: mongoose.Types.ObjectId;
    uploadedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const FileSchema = new mongoose.Schema<IFile>({
    type: { type: String, enum: ['image', 'video', 'audio', 'document', 'pdf'], required: true },
    filePath: { type: String, required: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Messages', required: false },
    uploadedAt: { type: Date, default: Date.now },
},{ timestamps: true });

export const fileSchema = mongoose.model<IFile>('File', FileSchema);