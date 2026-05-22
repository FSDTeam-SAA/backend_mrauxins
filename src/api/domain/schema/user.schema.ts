import { string } from "joi";
import mongoose, { Document, mongo, Schema } from "mongoose";

type ClearedChat = {
    chatId: mongoose.Types.ObjectId; // Reference to the Chat ID
    clearedAt: Date; // Timestamp of when the chat was cleared
};

interface INickname{
    contactUserId: mongoose.Types.ObjectId;
    nickName?: string | null,
    isActiveNickname: boolean
}

// const NicknameSchema = new Schema<INickname>(
//   {
//     contactUserId: {
//       type: Schema.Types.ObjectId,
//       ref: "User",
//       required: true
//     },
//     nickName: {
//       type: String
//     }
//   },
//   { _id: false } // prevents auto _id for each nickname entry
// );
export interface IUser extends Document {
    name: string; // Full name
    email: string; // Email address
    phone?: string; // Phone number (optional)
    userName: string; // Unique username
    password: string; // Hashed password
    otp?: string | null;
    otpExpiry?: Date;
    isVerified?:boolean;
    profilePicture?: string; // Profile picture URL (optional)
    bio?: string; // Bio or description (optional)
    socialMedia?:{
        facebookId?: string; // Facebook account ID (optional)
        instagramId?: string; // Instagram account ID (optional)
    };
    providerName?:string;
    providerId?:string;
    countryISOCode?: string;
    countryCode?: string;
    lastSeen: Date; // Last seen timestamp
    isOnline: boolean; // Online status
    createdAt: Date; // Timestamp of account creation
    updatedAt: Date; // Timestamp of last account update
    isProfileSetUp:boolean;
    isStopNotification:boolean;
    isMuteNotification:boolean;
    profilePrivacy: "private" | "public";
    contacts:string[],
    storyPrivacy: "public" | "contacts" | "custom";
    allowUserName: boolean;
    allowEmail: boolean;
    allowPhone: boolean,
    isPhoneVerify: false,
    isEmailVerify: false;
    isDeleted: boolean;
    deletedAt: Date;
    lastOnline: Date;
    nicknames: INickname[]; // Array of nicknames for contacts
}

// define the user schema
const userSchema:Schema = new Schema<IUser>({
    name: {
        type: String
    },
    email: {
        type: String, unique: true, sparse: true
    },
    phone: { type: String, unique: true, sparse: true},
    userName: { type: String, unique: false, required: false , default:null},
    password: { type: String },
    profilePicture: { type: String , default:null},
    otp:{type: String},
    otpExpiry:{type: Date},
    isVerified:{type: Boolean, default: false},
    bio: { type: String },
    socialMedia: {
        facebookId: {type: String},
        instagramId: {type: String}
    },
    providerId:{type: String, unique: true, sparse: true},      // facebookProviderId | googleProviderId
    providerName:{type: String, enum:['google','facebook','manually'], default:"manually"},    // facebook | google
    countryCode:{type: String, default: "+44"},
    countryISOCode:{type: String, default:"GB"},
    lastSeen: { type: Date, default: Date.now },
    isOnline: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    isProfileSetUp:{type:Boolean, default:false},
    isStopNotification:{type:Boolean, default: false},
    isMuteNotification:{type:Boolean, default: false},
    profilePrivacy:{type: String, enum:["private","public"], default: "private"},
    contacts:[{type: String}],
    storyPrivacy: {
        type: String,
        enum: ["public","contacts","custom"],
        default:"contacts"
    },
    allowEmail:{type: Boolean, default: false},
    allowPhone: {type: Boolean, default: false},
    allowUserName: {type: Boolean, default: false},
    isPhoneVerify: {type: Boolean, default: false},
    isEmailVerify: {type: Boolean, default: false},
    isDeleted: {type: Boolean, default: false},
    deletedAt: {type: Date, default: null},
    lastOnline: {type: Date, default: null},
    nicknames: [{
        contactUserId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        nickName: {
            type: String
        },
        isActiveNickname: {
            type: Boolean,
            default: false
        }
    }]
});

// userSchema.index({ email: 1 });

// Export the User model
export default mongoose.model<IUser>("User", userSchema);