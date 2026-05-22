import mongoose from "mongoose";
import { IUser } from "../schema/user.schema";

export interface IUserResponse {
    _id: any;
    name: string;
    email: string;
    phone:string | undefined;
    userName: string;
    isVerified: boolean | undefined;
    providerId: string | undefined;
    providerName: string | undefined;
    isOnline: boolean;
    lastSeen: Date;
    createdAt: Date;
    updatedAt: Date;
    bio: string | undefined;
    profilePicture: string | undefined;
    countryISOCode: string | undefined;
    countryCode: string | undefined;
    isProfileSetUp: boolean;
    isStopNotification: boolean;
    isMuteNotification: boolean;
    profilePrivacy: string;
    isEmailVerify: boolean;
    isPhoneVerify: boolean;
}

export const formatUserResponse = (user:IUser) : IUserResponse => {
    return {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        userName: user.userName,
        isVerified: user.isVerified,
        providerId: user.providerId,
        providerName: user.providerName,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        bio: user.bio,
        profilePicture: user.profilePicture ? user.profilePicture.replace(/^(\w+)-.*$/, `$1/${user.profilePicture}`) : undefined,
        countryISOCode: user.countryISOCode,
        countryCode: user.countryCode,
        isProfileSetUp: user.isProfileSetUp,
        isStopNotification: user.isStopNotification,
        isMuteNotification: user.isMuteNotification,
        profilePrivacy: user.profilePrivacy,
        isEmailVerify: user.isEmailVerify,
        isPhoneVerify: user.isPhoneVerify
    }
}

export interface SenderResponse {
    _id: any;
    userName: string | undefined;
    name: string | undefined;
    profilePicture: string | undefined;
    lastSeen: Date | undefined;
    bio: string | undefined;
    email: string | undefined;
    isOnline: boolean | undefined;
    countryCode: string | undefined;
    countryISOCode: string | undefined;
    profilePrivacy: string | undefined;
}
export interface ReplyToResponse {
    _id: any,
    chatId: mongoose.Types.ObjectId | undefined;
    content: string | undefined;
    type: string | undefined;
    sender: mongoose.Types.ObjectId | undefined;
    files: any[] | undefined;
    fileIds: string[] | undefined;
    messageId: string | undefined
    disAppearingMessages: Number | undefined;
    systemMessage: string;
    createdAt: Date | undefined,
}
export interface SendMessageResponse {
    chatId: string;
    sender: SenderResponse;
    content: string;
    type: string;
    fileUrls: string[];
    createdAt: Date | undefined;
    messageId: string | undefined;
    replyTo: ReplyToResponse | null;
    status: string;
    isRead: boolean;
}