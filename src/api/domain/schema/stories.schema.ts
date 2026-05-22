import mongoose from "mongoose";

interface Viewer{
    userId: mongoose.Types.ObjectId;
    viewedAt: Date; 
}

interface AllowedUsers{
    userId: mongoose.Types.ObjectId;
}

interface IStory {
    // _id: mongoose.Types.ObjectId,
    userId:mongoose.Types.ObjectId,
    mediaUrl: string;
    mediaType: "image" | "video";
    caption?: string;
    createdAt: Date; 
    expiresAt: Date; 
    viewers: Viewer[]; // Array of viewers who watched the story
    visibility: "public" | "contacts" | "custom",
    allowedUsers:AllowedUsers[];
    duration:number;
}

const storiesSchema = new mongoose.Schema<IStory>({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    mediaUrl: {type: String, required: true},
    // mediaType: {type: String, enum: ["image", "video"], required: true},
    mediaType: {type: String, required: true},
    caption: { type: String, default: null }, 
    createdAt: { type: Date, default: Date.now }, 
    expiresAt: { type: Date, required: true }, // Expiry timestamp (e.g., 24 hours after creation)
    viewers: [
        {
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Viewer ID
            viewedAt: { type: Date, default: Date.now } // When they viewed the story
        }
    ],
    visibility: {
        type: String,
        enum: ["public","contacts","custom"],
        default:"contacts"
    },
    allowedUsers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User" // Users explicitly allowed to view the story
      }],
      duration: {type: Number, default:5}
},{ timestamps: true });

export const Story = mongoose.model<IStory>('Story', storiesSchema);