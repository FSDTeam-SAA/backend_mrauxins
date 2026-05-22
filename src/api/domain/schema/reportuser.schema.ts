import mongoose, { Document, Schema } from "mongoose";

export const REPORT_REASONS = [
    "Spam",
    "Harassment",
    "Inappropriate Content",
    "Fake Profile",
    "Scam or Fraud",
    "Violence or Threats",
    "Hate Speech",
    "other"
];

export interface IReport extends Document {
    reportedBy: mongoose.Types.ObjectId;  // User who reported
    reportedUser: mongoose.Types.ObjectId;  // User being reported
    reason: string;  // Reason for reporting
    description?: string;  // Optional description
    status: "pending" | "reviewed";  // Status of the report
    createdAt: Date;
}


/** Report Schema */
const ReportSchema = new Schema<IReport>(
    {
        reportedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
        reportedUser: { type: Schema.Types.ObjectId, ref: "User", required: true },
        reason: { type: String, required: true },
        description: { type: String, default:null },
        status: { type: String, enum: ["pending", "reviewed"], default: "pending" },
        createdAt: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

export default mongoose.model<IReport>("Report", ReportSchema);