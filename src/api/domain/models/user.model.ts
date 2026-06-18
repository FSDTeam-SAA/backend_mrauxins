import mongoose, { MongooseError, Types } from "mongoose";
import { downloadImageUploadS3, generateAccessToken, generateAgoraToken, generateECKeyPair, generateOtp, generateRefreshToken, saveDeviceToken } from "../../helper/helper";
import { loggerMsg } from "../../lib/logger";
import userSchema, { IUser } from "../schema/user.schema";
import chatSchema from "../schema/chat.schema";
import messageSchema from "../schema/message.schema";
import { getNickNameDetails, userOnlineStatusMap, userSocketMap } from "../../socket/initDemoSocketHandlers";
import { getIo } from "../../../infrastructure/webserver/express/v1";
import { savedMessageFromGroup } from "./messages.model";
import { env } from "../../../infrastructure/env";
import { sentPushNotificationToUser } from "./device.token.model";
import { callHistory, CallStatus, CallType } from "../schema/callhistory.schema";
import { initiateCall } from "./callhistory.model";
import {v4 as uuidv4} from "uuid"
import notificationSchema, { CLICK_NOTIFICATION_TYPE, NotificationType } from "../schema/notification.schema";
import { sentOtpService } from "../../services/auth.service";
import { getRSAKeys, saveRSAKeysToDB } from "./ec.key.model";
import ECKeyModel from "../schema/ec.key.schema";
import { deviceToken } from "../schema/devicetoken.schema";
import crypto from "crypto";
import chatParticipantSchema from "../schema/chat.participant.schema";
import { Story } from "../schema/stories.schema";
import { formatUserResponse, IUserResponse } from "../dto/user.dto";

interface userData{
    email: string; 
    name: string;
    photoURL: string;
    phone: string;
    otp: string;
    provider: string;
    providerId: string;
    isPhoneVerify:boolean,
    isEmailVerify:boolean,
    fcmToken?: string;
    deviceType?: string
    countryISOCode?: string;
    countryCode?: string;
}
export const adsConfigData = {
    "admob_appopen": "ca-app-pub-3940256099942544/9257395921",
    "admob_interstital": "ca-app-pub-3940256099942544/1033173712",
    "admob_interstital_reward": "ca-app-pub-3940256099942544/5354046379",
    "admob_reward": "ca-app-pub-3940256099942544/5224354917",
    "admob_banner": "ca-app-pub-3940256099942544/6300978111",
    "admob_native": "ca-app-pub-3940256099942544/2247696110",
    "admanager_appopen": "/6499/example/app-open",
    "admanager_interstital": "/6499/example/interstitial",
    "admanager_interstital_reward":
        "/21775744923/example/rewarded_interstitial",
    "admanager_reward": "/6499/example/rewarded",
    "admanager_banner": "/6499/example/banner",
    "admanager_native": "/6499/example/native",
    "ads_show": "on",
    "activity_show": "on",
    "ad_blocker": "off",
    "appopen": "on",
    "extra_activity": 4,
    "interstitial_extra_adcount": "2",
    "interstitial_count": "1",
    "interstitial_backcount": "1",
    "interstitial_start_screen_ad": "on",
    "appopen_type": "admob",
    "ad_appopen": [
        "admob",
    ],
    "ad_inter": [
        "admob",
    ],
    "ad_inter_reward": [
        "admob",
    ],
    "ad_native": [
        "admob",
    ],
    "ad_banner": [
        "admob",
    ],
    "ad_reward": [
        "admob",
    ]
};

const shouldSendOtpEmail = () => {
    return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS);
};

export const adsConfigLogic = async(
    callback:(error:any, result:any) => void
)=>{
    try {
        // const user = await userSchema.findById(userId).select("userName profilePicture");
        // if (!user) {
        //     return callback({
        //         status:404,
        //         code:"USER_NOT_FOUND",
        //         message:"User not found"
        //     }, null)
        // }


        // const isPremium = user.subscription_status === "premium"; // adapt field as needed
        // ads_show: isPremium ? "off" : "on";

        
        return callback(null,adsConfigData)
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
}

// Function to handle OTP creation and saving logic
export const handleOtp = async (email:string, callback:any) => {
    try {
        let user = await userSchema.findOne({ email }).select('otp otpExpiry');

        const otp = email === "test@gmail.com" ? "123456" : generateOtp();
        // const otp = "123456";
        let otpExpiry = new Date();
        otpExpiry.setMinutes(otpExpiry.getMinutes() + 10);

        if (!user) {
            user = new userSchema({ email, otp, otpExpiry, isVerified: false, userName: null });
            await user.save();
            // return callback(null, "Otp Sent Successfully");
        }

        user.otp = otp;
        user.otpExpiry = otpExpiry;
        user.isEmailVerify= false,
        await user.save();
        
        if (shouldSendOtpEmail()) {
            await sentOtpService(email, otp);
        } else {
            loggerMsg("SMTP is not configured. Skipping OTP email send.", "warn");
        }

        return callback(null, "Otp Sent Successfully");
    } catch (error) {
        return callback(error, null);
    }
};


/**
 * Handle OTP verification for new or existing users.
 */
export const handleUserVerification = async (query:any, userData:userData, callback:any) => {
    try {
        // Find user by phone or email
        const user = await userSchema.findOne({ $or: [query] });
  

        if (!user) {
            // If user doesn't exist, handle as a new user
            return handleNewUser(userData, callback);
        }

        // If user exists, handle as an existing user
        return handleExistingUser(user, userData, callback);

    } catch (error) {
        return callback(error, null);
    }
};


/**
 * Handle logic for new users.
 */
const handleNewUser = async (userData:userData, callback:any) => {
    const { phone,name,photoURL, email, provider, providerId, deviceType, fcmToken, countryCode, countryISOCode } = userData;
    try {
        let newUser;

        // new changes
        if (provider && providerId) {
            loggerMsg("New User Register via Phone, facebook", "info");
           
            const newUserData:any = {
                providerName: provider,
                providerId,
                isVerified: true,
            }

            if(email && email.trim() !== ""){
                // newUserData.userName = email.split("@")[0];
                newUserData.userName = null;
                newUserData.email = email;
                newUserData.isEmailVerify = true;
            }
            
            if(phone && phone.trim() !== ""){
                newUserData.userName = null;
                newUserData.isPhoneVerify = true
            }

            // Only add `name` if it is not empty or undefined
            if (name && name.trim() !== "") newUserData.name = name;
            // if (phone && phone.trim() !== "") newUserData.phone = phone;
            // if (email && email.trim() !== "")   newUserData.email = email;
            if(provider && providerId){
                const s3Url = await downloadImageUploadS3(photoURL);
                if (photoURL && photoURL.trim() !== "") newUserData.profilePicture = s3Url;
            }
            if (countryISOCode && countryISOCode.trim() !== "") newUserData.countryISOCode = countryISOCode;
            if (countryCode && countryCode.trim() !== "") newUserData.countryCode = countryCode;

            newUser = await userSchema.create(newUserData);
        }else if (phone) {
            loggerMsg("New User Register via Phone, manually", "info");
            newUser = await userSchema.create({
                phone,
                isVerified: true,
                userName: null,
                name:name ?? null,
                providerName: "manually",
                countryISOCode,
                countryCode,
                isEmailVerify: false,
                isPhoneVerify: true
            });
        } else {
            return callback({ code: "INVALID_PAYLOAD", message: "User not found" }, null);
        }

        // old code
        /*
        if (phone && provider && providerId) {
            loggerMsg("New User Register via Phone, facebook", "info");
            newUser = await userSchema.create({
                phone,
                providerName: provider,
                providerId,
                isVerified: true,
                userName: phone,
                countryISOCode,
                countryCode
            });
        } else if (email && provider && providerId) {
            loggerMsg(`New User Register via email, ${provider}`, "info");
            newUser = await userSchema.create({
                email,
                providerName: provider,
                providerId,
                isVerified: true,
                userName: email.split("@")[0]
            });
        } else if (phone) {
            loggerMsg("New User Register via Phone, manually", "info");
            newUser = await userSchema.create({
                phone,
                isVerified: true,
                userName: phone,
                providerName: "manually",
                countryISOCode,
                countryCode
            });
        } else {
            return callback({ code: "INVALID_PAYLOAD", message: "User not found" }, null);
        }
        */

        await saveDeviceToken(String(newUser._id), String(fcmToken), String(deviceType))
        // const {privateKey, publicKey} = generateECKeyPair()
        // const rssKey = await saveRSAKeysToDB(String(newUser._id), privateKey, publicKey)
        // const getRsaKey:any = await getRSAKeys(String(newUser._id))
        const access_token = generateAccessToken(String(newUser._id));
        const refresh_token = generateRefreshToken(String(newUser._id));
        const response = {
            _id: newUser._id,
            name: newUser.name,
            email: newUser.email,
            phone: newUser.phone,
            userName: newUser.userName,
            isVerified: newUser.isVerified,
            providerId: newUser.providerId,
            providerName: newUser.providerName,
            isOnline: newUser.isOnline,
            lastSeen: newUser.lastSeen,
            createdAt: newUser.createdAt,
            updatedAt: newUser.updatedAt,
            bio: newUser.bio,
            profilePicture : newUser?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${newUser?.profilePicture}`),
            countryISOCode: newUser.countryISOCode,
            countryCode: newUser.countryCode,
            isProfileSetUp: newUser.isProfileSetUp,
            isStopNotification: newUser.isStopNotification,
            isMuteNotification: newUser.isMuteNotification,
            // publicKey: publicKey,
            // privateKey:privateKey,
            profilePrivacy: newUser.profilePrivacy,
            // allowEmail: newUser.profilePrivacy === "public" ? true : false,
            // allowPhone: newUser.profilePrivacy === "public" ? true : false,
            // allowUserName: newUser.profilePrivacy === "public" ? true : false,
            isEmailVerify: newUser.isEmailVerify,
            isPhoneVerify: newUser.isPhoneVerify

        }
        return callback(null, {token:access_token,refresh_token, user: response});

    } catch (error) {
        return callback(error, null);
    }
};


/**
 * Handle logic for existing users.
 */
const handleExistingUser = async (user:any, userData:userData, callback:any) => {
    const { otp, provider, providerId, deviceType, fcmToken, isEmailVerify, isPhoneVerify } = userData;
    try {
        // Update provider and providerId if the user logs in with a new provider
        if (provider && providerId) {
            loggerMsg(`User login via ${provider} for existing account`, "info");
            user.providerName = provider;
            user.providerId = providerId;
        } else {
            user.providerName = "manually";
            // no need providerId when manually login
            // user.providerId = null;
        }

        // Validate OTP if provided
        if (otp) {
            if (user.otpExpiry && new Date() > new Date(user.otpExpiry)) {
                return callback({ code: "BAD_REQUEST", message: "OTP has expired" }, null);
            }

            if (user.otp !== otp) {
                return callback({ code: "BAD_REQUEST", message: "Invalid OTP" }, null);
            }

            user.isVerified = true;
            user.isEmailVerify = true;
            user.otp = null;
        }

        await user.save();
        await saveDeviceToken(String(user._id), String(fcmToken), String(deviceType))
        // let rsaKey = await ECKeyModel.findOne({userId: user._id})
        // console.log("existing user..",rsaKey)
       
        // if(!rsaKey){
        //     const {privateKey, publicKey} = generateECKeyPair();
        //     console.log("not exist create new")
        //     await saveRSAKeysToDB(user._id, privateKey, publicKey)
        //     rsaKey = await ECKeyModel.findOne({userId: user._id})
        // }
        const access_token = generateAccessToken(String(user._id));
        const refresh_token = generateRefreshToken(String(user._id));
        const response = {
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
            profilePicture : user?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${user?.profilePicture}`),
            countryISOCode: user.countryISOCode,
            countryCode: user.countryCode,
            isProfileSetUp: user.isProfileSetUp,
            isStopNotification: user.isStopNotification,
            isMuteNotification: user.isMuteNotification,
            // publicKey: rsaKey?.publicKey,
            // privateKey:rsaKey?.privateKey,
            isEmailVerify: user.isEmailVerify,
            isPhoneVerify: user.isPhoneVerify,
            profilePrivacy: user.profilePrivacy,
            // allowEmail: user.profilePrivacy === "public" ? true : false,
            // allowPhone: user.profilePrivacy === "public" ? true : false,
            // allowUserName: user.profilePrivacy === "public" ? true : false,
        }
        // const response = {token,user}
        return callback(null, {token:access_token, refresh_token, user: response});

    } catch (error) {
        return callback(error, null);
    }
};


export const updateUserProfileLogic = async (userId: string, updates: any, files: any, callback: any) => {
    try {
        const user = await userSchema.findById(userId);

        if (!user) {
            return callback({
                code: "USER_NOT_FOUND",
                message: "User not found",
                status: 404,
            }, null);
        }

        // Check if the new userName is already taken
        if (updates.userName) {
            const existingUser = await userSchema.findOne({ userName: updates.userName, _id: { $ne: userId } });
            if (existingUser) {
                return callback({
                    code: "USERNAME_TAKEN",
                    message: "Username is already taken. Choose another one.",
                    status: 400,
                }, null);
            }
        }

        if (updates.phone) {
            const existingPhoneUser = await userSchema.findOne({ phone: updates.phone, _id: { $ne: userId } });
            if (existingPhoneUser) {
                return callback({
                    code: "PHONE_NO_ALREADY_EXIST",
                    message: "Phone number is already in use. Choose another.",
                    status: 400
                }, null);
            }

            if (!user.isPhoneVerify) {
                updates.isPhoneVerify = true;
            }
        }

        const updateFields: any = {};

        if (updates.email === "") {
            if (!user.phone) {  // Ensure at least one contact field remains
                return callback({
                    code: "",
                    message: "At least phone number should not be null.",
                    status: 400
                }, null);
            }
            updateFields.$unset = { ...(updateFields.$unset || {}), email: 1, isEmailVerify: 1 };
        }

        if (updates.phone === "") {
            if (!user.email) {  // Ensure at least one contact field remains
                return callback({
                    code: "",
                    message: "At least email should not be null.",
                    status: 400
                }, null);
            }
            updateFields.$unset = { ...(updateFields.$unset || {}), phone: 1 };
            updateFields.$set = {
                countryISOCode: "GB",
                countryCode: "+44",
                isPhoneVerify: false
            };
        }

        // Update allowed fields dynamically
        Object.keys(updates).forEach((key) => {
            if (updates[key] !== "") {  // Prevent empty string values
                updateFields.$set = { ...(updateFields.$set || {}), [key]: updates[key] };
            }
        });
        // Handle profile picture update
        if (files && files.length > 0) {
            files?.forEach((file: any) => {
                updateFields.$set = { ...(updateFields.$set || {}), profilePicture: file.key };
            });
        }
        // Apply updates using updateOne (fixes the email "" issue)
        if (Object.keys(updateFields).length > 0) {
            await userSchema.updateOne({ _id: userId }, updateFields);
        }

        // Fetch the updated user after the update
        const updatedUser = await userSchema.findById(userId);

        const response = {
            _id: updatedUser?._id,
            name: updatedUser?.name,
            email: updatedUser?.email,
            phone: updatedUser?.phone,
            userName: updatedUser?.userName,
            isVerified: updatedUser?.isVerified,
            providerId: updatedUser?.providerId,
            providerName: updatedUser?.providerName,
            isOnline: updatedUser?.isOnline,
            lastSeen: updatedUser?.lastSeen,
            createdAt: updatedUser?.createdAt,
            updatedAt: updatedUser?.updatedAt,
            bio: updatedUser?.bio,
            profilePicture: updatedUser?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${updatedUser?.profilePicture}`),
            countryISOCode: updatedUser?.countryISOCode,
            countryCode: updatedUser?.countryCode,
            isProfileSetUp: updatedUser?.isProfileSetUp,
            isStopNotification: updatedUser?.isStopNotification,
            isMuteNotification: updatedUser?.isMuteNotification,
            profilePrivacy: updatedUser?.profilePrivacy,
            // allowEmail: updatedUser?.profilePrivacy === "public",
            // allowPhone: updatedUser?.profilePrivacy === "public",
            // allowUserName: updatedUser?.profilePrivacy === "public",
            isEmailVerify: updatedUser?.isEmailVerify,
            isPhoneVerify: updatedUser?.isPhoneVerify,
        };

        return callback(null, response);

    } catch (error) {
        return callback(
            error instanceof Error && "code" in error && (error as any).code === 11000
                ? {
                      code: "DUPLICATE_KEY_ERROR",
                      // @ts-ignore
                      message: `Oops! This ${Object.keys(error?.keyValue)[0]} is already linked to an existing account. Please use a different one or log in to continue.`,
                      status: 400,
                  }
                : {
                      code: "INTERNAL_SERVER_ERROR",
                      message: error instanceof Error ? error.message : "An unexpected error occurred.",
                      status: 500,
                  },
            null
        );
    }
};


// Cleaned up duplicate getAllUsersLogic implementations

export const getAllUsersLogic = async (
    loggedInUserId: string | undefined,
    pagination: { page: number; limit: number },
    searchQuery: string | undefined,
    requestContactNumbers: string[],
    callback: (error: any, result: any) => void
) => {
    try {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;

        if (!loggedInUserId) {
            return callback(
                { status: 400, code: "USER_NOT_LOGGED_IN", message: "User must be logged in to perform this action." },
                null
            );
        }

        // Fetch logged-in user's contacts
        const currentUser = await userSchema.findById(loggedInUserId).select("contacts nicknames");
        if (!currentUser) {
            return callback(
                { status: 404, code: "USER_NOT_FOUND", message: "Logged-in user not found." },
                null
            );
        }

        const normalizePhoneNumber = (phone: string) => phone.replace(/\D/g, "");
        const storedContacts = currentUser.contacts?.map(normalizePhoneNumber) || [];
        // Prefer contact numbers sent by the client (fresh from device); fall back to MongoDB stored list
        const normalizedContacts = requestContactNumbers.length > 0
            ? requestContactNumbers.map(normalizePhoneNumber)
            : storedContacts;

        const escapeRegex = (text: string) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
        let escapedSearchQuery = searchQuery ? escapeRegex(searchQuery) : "";

        let matchCondition: any;

        if (searchQuery) {
            // Search mode: include contacts, chat participants, and public profiles
            const chatParticipants = await chatSchema.aggregate([
                { $match: { participants: new mongoose.Types.ObjectId(loggedInUserId), isFirstMessage: 1 } },
                { $lookup: { from: "chatparticipants", localField: "participants", foreignField: "userId", as: "chatParticipants" } },
                { $unwind: "$chatParticipants" },
                { $match: { "chatParticipants.isRemoved": false, "chatParticipants.isDeleted": { $ne: true }, "chatParticipants.userId": { $ne: new mongoose.Types.ObjectId(loggedInUserId) } } },
                { $group: { _id: "$chatParticipants.userId" } }
            ]).then((chats) => chats.map((chat) => new mongoose.Types.ObjectId(chat._id)));

            matchCondition = {
                _id: { $ne: new mongoose.Types.ObjectId(loggedInUserId) },
                $or: [
                    { phone: { $in: normalizedContacts } },
                    { _id: { $in: chatParticipants } },
                    { profilePrivacy: "public" }
                ],
                isVerified: true,
                isProfileSetUp: true,
                $and: [{
                    $or: [
                        { userName: { $regex: escapedSearchQuery, $options: "i" } },
                        { name: { $regex: escapedSearchQuery, $options: "i" } },
                        { phone: { $regex: escapedSearchQuery, $options: "i" } },
                        { email: { $regex: escapedSearchQuery, $options: "i" } }
                    ]
                }]
            };
        } else {
            // Contacts tab: ONLY return users whose phone matches device contacts — no chat participants
            matchCondition = {
                _id: { $ne: new mongoose.Types.ObjectId(loggedInUserId) },
                phone: { $in: normalizedContacts },
                isVerified: true,
                isProfileSetUp: true
            };
        }

        // Build aggregation pipeline
        const pipeline: any[] = [
            { $match: matchCondition },
            { $sort: { name: 1 } },
            { $skip: skip },
            { $limit: limit },
            {
                // Lookup the existing chat between loggedInUser and the current user
                $lookup: {
                    from: "chats",
                    let: { otherUserId: "$_id" },
                    pipeline: [
                    {
                        $match: {
                        $expr: {
                                $and: [
                                    {$eq: ["$type","one_to_one"]},  // ✅ Only one-to-one chats
                                    { $in: [new mongoose.Types.ObjectId(loggedInUserId), "$participants"] },// Check if loggedInUser is a participant
                                    { $in: ["$$otherUserId", "$participants"] },// Check if other user is a participant
                                    { $eq: ["$isFirstMessage", 1] } // Optional filter for first message (can be removed if not needed)
                                ]
                            }
                        }
                    },
                    { $limit: 1 },  // Limit to 1 chat (assuming only one chat exists between two users)
                    { $project: { 
                        _id: 1, 
                        messageAutoDeleteTime:1,
                        messageAutoDeleteStartTime: 1
                    } } // Only return the _id of the matched chat
                    ],
                    as: "existingChat"
                }
            },
            {
                // Extract the chatId from the first matching existingChat
                $addFields: {
                    chatId: { $arrayElemAt: ["$existingChat._id", 0] },
                    messageAutoDeleteTime: { $arrayElemAt: ["$existingChat.messageAutoDeleteTime", 0] },
                    messageAutoDeleteStartTime: { $arrayElemAt: ["$existingChat.messageAutoDeleteStartTime", 0] },

                }
            },
            {
                // Lookup to check if the loggedInUser is blocked by the other user in this chat
                $lookup: {
                    from: "blockedusers",
                    let: { chatId: "$chatId", userId: "$_id" },
                    pipeline: [
                    {
                        $match: {
                        $expr: {
                            $and: [
                            { $eq: ["$chatId", "$$chatId"] },
                            { $eq: ["$blockedId", new mongoose.Types.ObjectId(loggedInUserId)] }
                            ]
                        }
                        }
                    }
                    ],
                    as: "isBlocked"
                }
            },
            {
                // Lookup to check if the loggedInUser has blocked the other user in this chat
                $lookup: {
                    from: "blockedusers",
                    let: { chatId: "$chatId", userId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                            $expr: {
                                $and: [
                                { $eq: ["$chatId", "$$chatId"] },
                                { $eq: ["$blockerId", new mongoose.Types.ObjectId(loggedInUserId)] }
                                ]
                            }
                            }
                        }
                    ],
                    as: "youBlocked"
                }
            },
            {
                // Convert lookup results into boolean flags
                $addFields: {
                    isBlocked: { $gt: [{ $size: "$isBlocked" }, 0] },
                    youBlocked: { $gt: [{ $size: "$youBlocked" }, 0] }
                }
            },
            { $project: { password: 0 } }
        ];

        // Execute aggregation
        const users = await userSchema.aggregate(pipeline);

        // const user = await userSchema.findById(userObjectId).select("nicknames");
                
        const nicknamesMap = new Map<string, {nickName:string,isActiveNickname:boolean}>();
        currentUser?.nicknames.forEach(n => {
            if(n.contactUserId && n.nickName){
                nicknamesMap.set(n.contactUserId.toString(), {
                    nickName: n.nickName,
                    isActiveNickname: n.isActiveNickname ?? false
                })
            }
        })
        
        
        async function fetchNickname(users:any, loggedInUserId: any){
            const updatedConversations = await Promise.all(users.map(async(chat:any) =>{
            
            // if(chat.type === ChatType.GROUP || chat.type === ChatType.CHANNEL) return chat;
        
                // one-to-one
                if(chat._id.toString() === loggedInUserId) return chat;
    

                const nicknameData = await getNickNameDetails(loggedInUserId.toString(), chat._id.toString());
                
                const matchedNick = nicknameData?.[0]?.matchedNickname?.[0];
                return {
                    ...chat,
                    nickName: matchedNick?.nickName,
                    isActiveNickname: matchedNick?.isActiveNickname
                    // name: nick ?? p.name
                }
            }))
            return updatedConversations;
        }

        const updatedUsers = await fetchNickname(users, loggedInUserId)

        // Count total users matching criteria
        const totalUsers = await userSchema.countDocuments({
            // @ts-ignore
            $or: [
                { phone: { $in: normalizedContacts } },
                { _id: { $in: chatParticipants } },
                searchQuery ? { profilePrivacy: "public" } : null
            ].filter(Boolean), // Remove null values
            isVerified: true,
            isProfileSetUp: true
        });

        return callback(null, { users: updatedUsers, totalUsers });
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
};





export const getSingleUserDetailsLogicApi = async(
    userId: string | undefined,
    callback: (error:any, result: any) => void
)=>{
    try {
        const user = await userSchema.findById(userId);
        if(!user){
            return callback({
                status: 404,
                code: "USER_NOT_FOUND",
                message: "User not found."
            },null)
        }
        // const rskey:any = await getRSAKeys(String(userId))
        const response = {
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
            // profilePicture: user.profilePicture
            profilePicture : user?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${user?.profilePicture}`),
            countryISOCode: user.countryISOCode,
            countryCode: user.countryCode,
            isProfileSetUp: user.isProfileSetUp,
            isStopNotification: user.isStopNotification,
            isMuteNotification: user.isMuteNotification,
            // publicKey: rskey.publicKey,
            // privateKey:rskey.privateKey,
            profilePrivacy: user.profilePrivacy,
            allowEmail: user.allowEmail,
            allowPhone: user.allowPhone,
            allowUserName: user.allowUserName,
        }
        return callback(null, response)
    } catch (error) {
        return callback({
            status: 500,
            code: 'INTERNAL_SERVER_ERROR',
            message: error instanceof Error ? error.message : 'An unexpected error occurred.',
    }, null)
    }
}

export const uploadMediaOnS3Bucket = async(
    files:any,
    callback:(error:any, result:any) => void
)=>{
    try {
        if(!files){
            return callback({
                status:400,
                code:"NO_FILES_UPLOADED",
                message:"No files uploaded!"
            },null)
        }
        const filesUrls = (files as Express.MulterS3.File[]).map((file) => file.location);
        return callback(null, filesUrls)
    } catch (error) {
        return callback({
            status: 500,
            code: 'INTERNAL_SERVER_ERROR',
            message: error instanceof Error ? error.message : 'An unexpected error occurred.',
        }, null)
    }
}
/*
// Send group message
export const sendGroupMessageLogic = async (
    chatId: string,
    content: string,
    type: string,
    fileUrls: string[] | undefined,
    senderId: string | undefined,
    files: Express.Multer.File[] | undefined,
    callback: (error: any, result: any) => void
) => {
    const io = getIo(); // Initialize your socket connection
    try {
        if (!senderId) {
            return callback(
                {
                    status: 401,
                    code: "UNAUTHORIZED",
                    message: "User must be authenticated.",
                },
                null
            );
        }

        // Fetch the group
        const group = await chatSchema.findById(chatId);
        if (!group || !group.isGroup) {
            return callback(
                {
                    status: 404,
                    code: "GROUP_NOT_FOUND",
                    message: "Group not found or not a group chat.",
                },
                null
            );
        }

        // Check if sender is a participant in the group
        if (!group.participants.includes(new mongoose.Types.ObjectId(senderId))) {
            return callback(
                {
                    status: 403,
                    code: "NOT_PARTICIPANT",
                    message: "You are not a participant in this group.",
                },
                null
            );
        }

        // Handle file uploads (if any)
        if (files && files.length > 0) {
            fileUrls = files.map((file: Express.Multer.File) => `${file.filename}`);
        }

        // Save the message in the database
        const savedMessage = await savedMessageFromGroup(chatId, senderId, content, type, fileUrls)

        // Update the last message in the group
        group.lastMessage = new mongoose.Types.ObjectId(String(savedMessage._id));
        await group.save();

        // Emit the message to all participants in the group
        group.participants.forEach((participantId) => {
            if (participantId.toString() !== senderId) {
                const receiverSocketId = userSocketMap[participantId.toString()];
                const receiver = userOnlineStatusMap[participantId.toString()]
                if (receiver) {
                    // const receiverSocketId = receiver.socketId;
                    io.to(receiverSocketId).emit("receive_group_message", {
                        chatId,
                        message: savedMessage,
                    });
                }
            }
        });

        // Respond with success
        return callback(null, {
            status: 1,
            code: "MESSAGE_SENT",
            message: "Group message sent successfully.",
            data: savedMessage,
        });
    } catch (error) {
        console.log(error)
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
};
*/

export const generateAgoraTokenLogic = async (
    userId: string,
    channelName: string,
    uid: number,
    chatId: string,
    body: any,
    callback: (error: any, result: any) => void
) => {
    const io = getIo();
    const { type, groupName, groupImage } = body;

    try {
        loggerMsg(`Call Agora token API`, "debug");

        const APP_ID = env.APP_ID || "";
        const APP_CERTIFICATE = env.APP_CERTIFICATE || "";
        const chat = await chatSchema.findById(chatId);

        if (!chat || !chat.participants) {
            loggerMsg(`CHAT_NOT_FOUND`, "debug");
            return callback(
                {
                    status: 404,
                    code: "CHAT_NOT_FOUND",
                    message: "Chat not found",
                },
                null
            );
        }

        // Exclude caller from participants
        const otherParticipants = chat.participants.filter((p) => p.toString() !== userId);
        const activeParticipants = await chatParticipantSchema.find({chatId,userId:{$ne: new mongoose.Types.ObjectId(userId)}, isRemoved: false, isDeleted: false })
    

         // Filter out only the active participants from the otherParticipants array
        const activeUserIds = (await activeParticipants).map((p) => p.userId.toString());

        const filteredActiveParticipants = otherParticipants.filter((participantId) =>
            activeUserIds.includes(participantId.toString())
        );

        const token = generateAgoraToken(APP_ID, APP_CERTIFICATE, channelName, uid);
        const offlineUsers: string[] = [];
        const participantStatus: { userId: string; status: string }[] = [];

        // Add caller to participantStatus with "accepted"
        participantStatus.push({ userId: userId.toString(), status: "accepted" });

        // Add other participants with "missed" by default
        filteredActiveParticipants.forEach((participantId) => {
            participantStatus.push({ userId: participantId.toString(), status: "missed" });
        });

    
        const callId = uuidv4();
        const activeChatParticipants = await chatParticipantSchema.find({chatId, isRemoved: false, isDeleted: false })
        
        const participants = activeChatParticipants.map((user) => ({
            userId: user.userId,
            status: user.userId.toString() !== userId.toString() ? "missed" : "joined",
            joinTime: new Date()
        }))
        
        const newCallHistory = new callHistory({
            chatId:chatId,
            callId:callId,
            callType: type === CallType.VIDEO
                ? CallType.VIDEO : type === CallType.VOICE
                ? CallType.VOICE : type === CallType.VIDEO_GROUP_CALL
                ? CallType.VIDEO_GROUP_CALL : CallType.VOICE_GROUP_CALL,
            startedBy: userId,
            participants: participants,
            startTime: new Date(),
            isEnded: false,
            callStatus: CallStatus.MISSED
        })

        await newCallHistory.save();

        // Notify all participants
        await Promise.all(
            filteredActiveParticipants.map(async (participantId) => {
                
               
                const receiverOnline = userOnlineStatusMap[participantId.toString()];

                const userDetails = await userSchema.findById(userId).select('name userName profilePicture nicknames');
                const nicknamesMap = new Map<string, {nickName: string, isActiveNickname: boolean}>();
                
                const receiverUser = await userSchema.findById(participantId).select("nicknames");
                receiverUser?.nicknames.forEach(n => {
                    if(n.contactUserId && n.nickName){
                        nicknamesMap.set(n.contactUserId.toString(), {
                            nickName: n.nickName,
                            isActiveNickname: n.isActiveNickname ?? false
                        })
                    }
                })

                
                let senderWithNickname;
                if(userDetails){
                    // Clone sender details to modify name safely
                    senderWithNickname = userDetails?.toObject()

                    const nicknameData = await getNickNameDetails(userId.toString(), participantId.toString());
            
                    const matchedNick = nicknameData?.[0]?.matchedNickname?.[0];
                    
                    if(matchedNick?.isActiveNickname){
                        senderWithNickname.name = matchedNick?.nickName;
                    }
                }
                
                // if (receiverOnline) {
                //     const socketId = userSocketMap[participantId.toString()];
                //     io.to(socketId).emit("receiver-agora-token-generated", {
                //         participantId: participantId.toString(),
                //         token,
                //         channel_name: channelName,
                //         call_type:
                //             type === CallType.VOICE
                //                 ? CallType.VOICE
                //                 : type === CallType.VIDEO
                //                 ? CallType.VIDEO
                //                 : type === CallType.VIDEO_GROUP_CALL
                //                 ? CallType.VIDEO_GROUP_CALL
                //                 : CallType.VOICE_GROUP_CALL,
                //         chat_id: chatId,
                //         sender: userDetails,
                //         groupImage,
                //         groupName,
                //         callId: newCallHistory.callId,
                //     });
                //     console.log("+++++++++++++++++ CALL Event Sent successflly +++++++++++++++++")
                //     loggerMsg("receiver-agora-token-generated", "debug");
                // }
                
                const receiverDeviceType = await deviceToken.findOne({userId: new mongoose.Types.ObjectId(participantId)}).select("deviceType");
                 
                const isInComeingCall = true;
                // Send push notification to offline users
                const title = type === NotificationType.VOICE ? `Incoming 212 Call`
                    : type === NotificationType.VIDEO ? `Incoming 212 Video Call`
                    : type === NotificationType.VIDEO_GRPOP_CALL ? `Incoming 212 Video Group Call`
                    : type === NotificationType.VOICE_GRPOP_CALL ? `Incoming 212 Voice Group Call`
                    : "Incoming call";
                
                const body = type === NotificationType.VOICE ? `You have been invited to a voice call: ${senderWithNickname?.name}`
                : type === NotificationType.VIDEO ? `You have been invited to a video call: ${senderWithNickname?.name}`
                : type === NotificationType.VIDEO_GRPOP_CALL ? `You have been invited to a video group call: ${chat.groupName}`
                : type === NotificationType.VOICE_GRPOP_CALL ? `You have been invited to a voice group call: ${chat.groupName}`
                : "You have been invited to a join call.";
                
                    const notificationPayload = {
                        title: `${title}`,
                        body: `${body}`,
                        click_action: CLICK_NOTIFICATION_TYPE,
                        type:NotificationType.AGORA_CALL_INVITATION,
                        chat_id: chatId,
                        sender: JSON.stringify(senderWithNickname),
                        channel_name: channelName,
                        token,
                        call_type:
                            type === CallType.VOICE
                                ? CallType.VOICE
                                : type === CallType.VIDEO
                                ? CallType.VIDEO
                                : type === CallType.VIDEO_GROUP_CALL
                                ? CallType.VIDEO_GROUP_CALL
                                : CallType.VOICE_GROUP_CALL,
                        groupImage,
                        groupName,
                        senderId: userId.toString(),
                        receiverId: participantId.toString(),
                        callId: newCallHistory.callId,
                        deviceType: `${receiverDeviceType?.deviceType}`,
                        isInComeingCall:isInComeingCall,
                        isMuteNotification: false
                    };
console.log("notificationPayload........",notificationPayload)
                    await sentPushNotificationToUser(participantId.toString(), notificationPayload);
                    
                    loggerMsg("Push notification sent successfully", "debug");
                
                offlineUsers.push(participantId.toString());
            })
        );

        // Send token to caller
        if (token) {
            const socketId = userSocketMap[userId];
            if (socketId) {
                io.to(socketId).emit("sender-agora-token-generated", {
                    userId,
                    token,
                    channelName,
                    type,
                });
                loggerMsg("sender-agora-token-generated", "debug");
            }
            return callback(null, { token, channelName, APP_ID, type,callId: newCallHistory.callId, });
        } else {
            return callback(
                {
                    status: 0,
                    code: "INVALID_TOKEN",
                    message: "Something went wrong generating the token",
                },
                null
            );
        }
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
};




export const getAgoraAppIdLogic = async(
    callback:(error:any, result: any) => void
)=>{
    const APP_ID = env.APP_ID || "";
    const ads_config = adsConfigData
    try {
        return callback(null,{APP_ID,ads_config})
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
}

export const updateContacts = async (
    userId: string,
    reqbody: any,
    callback: (error: any, result: any) => void
) => {
    try {
        let { contacts } = reqbody;

        if (!userId || !Array.isArray(contacts)) {
            return callback({
                status: 400,
                code: "INVALID_REQUEST_FORMAT",
                message: "Invalid request format",
            }, null);
        }

        // Clean contacts: remove spaces, country codes, empty values, and keep only valid 10-digit numbers
        const cleanedContacts = contacts
            .map(phone => phone.replace(/\s+/g, '')) // Remove spaces
            .map(phone => phone.replace(/^(\+91|91)/, '')) // Remove country codes
            .filter(phone => /^[6-9]\d{9}$/.test(phone)); // Keep only valid 10-digit numbers

     

        // Update user contacts
        const updateUser = await userSchema.findByIdAndUpdate(
            userId,
            { $set: { contacts: cleanedContacts } },
            { new: true }
        );

        if (!updateUser) {
            return callback({
                status: 404,
                code: "USER_NOT_FOUND",
                message: "User not found",
            }, null);
        }

        return callback(null, updateUser);
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred.",
        }, null);
    }
};



export const changeEmailAddress = async(
    userId: string,
    email:string,
    callback:(error:any, result:any)=> void
)=> {
    try {
        if(!email){
            return callback({
                status: 400,
                code: "EMAIL_REQURIED",
                message: "email is required."
            }, null)
        }
        let user = await userSchema.findById(userId)

        if(!user){
            return callback({
                status: 404,
                code: "USER_NOT_FOUND",
                message: "User not found."
            }, null)
        }

        const otp = email === "test@gmail.com" ? "123456" : generateOtp();
        
        // const otp = "123456";
        let otpExpiry = new Date();
        otpExpiry.setMinutes(otpExpiry.getMinutes() + 10); // Adjust as needed
        //@ts-ignore
        user?.otp = otp;
        user.otpExpiry = otpExpiry;
        await user.save();

        if (shouldSendOtpEmail()) {
            await sentOtpService(email, otp);
        } else {
            loggerMsg("SMTP is not configured. Skipping OTP email send.", "warn");
        }

        return callback(null,"Otp send successfully.")
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
}


export const verifyEmailAddress = async(
    body:any,
    userId: string,
    callback:(error:any, result:any)=> void
)=> {
    const {newEmail, otp} = body;
    try {
    

        if (!newEmail || !otp) {
            return callback({
                status: 400,
                code: "EMAIL_REQURIED",
                message: "All fields are required"
            }, null)
          }
        let user = await userSchema.findById(userId)

        if(!user){
            return callback({
                status: 404,
                code: "USER_NOT_FOUND",
                message: "User not found."
            }, null)
        }

        if(newEmail === user.email){
            //@ts-ignore
            if(user.otp !== otp || new Date() > new Date(user.otpExpiry)){
                return callback({
                    status: 400,
                    code: "INVALID_OR_EXPIRED_OTP",
                    message: "Invalid or expired OTP"
                }, null)
            }
            return callback(null,user)
        }

        // check if the new email is already in use
        const existinguser = await userSchema.findOne({email: newEmail})
        if(existinguser){
            return callback({
                status: 400,
                code: "EXISTING_EMAIL_ADDRESS",
                message: "New email is already in use"
            }, null)
        }

        // check otp validity
        //@ts-ignore
        if(user.otp !== otp || new Date() > new Date(user.otpExpiry)){
            return callback({
                status: 400,
                code: "INVALID_OR_EXPIRED_OTP",
                message: "Invalid or expired OTP"
            }, null)
        }

        //@ts-ignore
        user.email = newEmail;
        // if (!user.isPhoneVerify) {
            // @ts-ignore
            user.isEmailVerify = true as boolean;
        // }
        // @ts-ignore
        user?.otp = null;
        // @ts-ignoreuse
        user.otpExpiry = null;
        await user.save();


        return callback(null,user)
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
}

export const userAccountDeleted = async (
    userId: string,
    callback: (error: any, result: any) => void
) => {
    try {

        const user = await userSchema.findById(userId);
        if (!user) {
            return callback({
                status: 404,
                code: "USER_NOT_FOUND",
                message: "User not found."
            }, null);
        }

        const randomSuffix = crypto.randomBytes(3).toString("hex");

        // ✅ Handle Groups Created by the User
        const groups = await chatSchema.find({ createdBy: userId, type:"group" });

const groupUpdates = groups.map(async (group) => {
    let otherAdmins = group.admins.filter((adminId: any) => adminId.toString() !== userId.toString());
    let otherParticipants = group.participants.filter((p: any) => p.toString() !== userId.toString());


            // ✅ Remove deleted user from admins
            await chatSchema.updateOne(
                { _id: group._id },
                { $pull: { admins: userId } }
            );

            if (otherAdmins.length > 0) {
                // ✅ If other admins exist, assign `createdBy` to another admin
                return chatSchema.updateOne(
                    { _id: group._id },
                    { $set: { createdBy: otherAdmins[0] } }
                );
            } else if (otherParticipants.length > 0) {
                // ✅ If no other admins exist, assign first participant as new admin & creator
                return chatSchema.updateOne(
                    { _id: group._id },
                    {
                        $set: { createdBy: otherParticipants[0] },
                        $addToSet: { admins: otherParticipants[0] }
                    }
                );
            } else {
                // 🚨 If no admins and no participants, DELETE the group
                return chatSchema.deleteOne({ _id: group._id });
            }
        });
        await Promise.all([...groupUpdates]);

        // ✅ Remove user from admin list in groups
        await chatSchema.updateMany(
            { admins: userId },
            { $pull: { admins: userId } }
        );

        // ✅ Set `isRemoved: true` in chat participants
        await chatParticipantSchema.updateMany(
            { userId },
            { $set: { isRemoved: true } }
        );

        // ✅ Delete Channels Created by the User
        const deleteChannels = chatSchema.deleteMany({ createdBy: userId, isGroup: false });
        const lastSeen = new Date();

        // ✅ Remove Email & Phone (Anonymize Account)
        const anonymizeUser = userSchema.updateOne(
            { _id: userId },
            {
                $unset: { email: 1, phone: 1, providerId: 1, providerName: 1 },
                $set: {
                    userName: `DeletedUser_${randomSuffix}`,
                    name: `212 Deleted User`,
                    profilePicture: "images/1742551612551-delete-user_9634209.png",
                    isDeleted: true,
                    deletedAt: new Date(),
                    isVerified: false,
                    lastSeen: lastSeen,
                    isOnline: false
                }
            }
        );

        // ✅ Remove Device Tokens
        const deleteTokens = deviceToken.deleteMany({ userId });

        // delete all story
        await Story.deleteMany({userId})
        await Promise.all([deleteChannels, anonymizeUser, deleteTokens]);
      
        return callback(null, "Account deleted successfully.");
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
};



export const isUserNameExist = async(
    userName: string,
    userId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        const result = await userSchema.findOne({userName:{ $regex: `^${userName}$`, $options: "i" }, _id: {$ne: userId} });
        
        if(result){
            return callback(null, {
                 message : "This username is already taken. Please choose a different one.",
                 isExist: true
            })
        }
        return callback(null,{
            message: "This username is available.",
            isExist: false
        })
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
}


export const usersNewRefreshToken = async (
    userId: string,
    callback: (error: any, result: any) => void
) => {
    try {
        const user = await userSchema.findById(userId);
        if (!user) {
            return callback({
                status: 404,
                code: "USER_NOT_FOUND",
                message: "User not found."
            }, null);
        }

        const access_token = generateAccessToken(String(user._id));
        const refresh_token = generateRefreshToken(String(user._id));

        const response = {
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
            profilePicture : user?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${user?.profilePicture}`),
            countryISOCode: user.countryISOCode,
            countryCode: user.countryCode,
            isProfileSetUp: user.isProfileSetUp,
            isStopNotification: user.isStopNotification,
            isMuteNotification: user.isMuteNotification,
            profilePrivacy: user.profilePrivacy,
            isEmailVerify: user.isEmailVerify,
            isPhoneVerify: user.isPhoneVerify

        }

        return callback(null,{token: access_token, refresh_token, user:response})
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    } 
}

export const addOrUpdateNickname = async(
    userId:string,
    contactUserId:string,
    nickName:string,
    callback:(error:any, result:any) => void
) => {
    try {
        
        // if(!nickName || !nickName.trim()){
        //     return callback({
        //         status: 400,
        //         code: "NICKNAME_REQUIRED",
        //         message:"Nickname is required."
        //     },null)
        // }

        const user = await userSchema.findById(userId);
        if(!user){
            return callback({
                status: 404,
                code: "USER_NOT_FOUND",
                message: "User not found."
            }, null);
        }

        // normalize nickname: set null if empty or whitespace
        const finalNickName = nickName && nickName.trim() !== "" ? nickName.trim() : null;
        // Check if nickname already exists
        const existingNickname = user.nicknames.find(n => n.contactUserId.toString() === contactUserId);
        if(existingNickname){
            existingNickname.nickName = finalNickName;
            existingNickname.isActiveNickname =  finalNickName !== null;
        }else{
            user.nicknames.push({
                contactUserId: new mongoose.Types.ObjectId(contactUserId), 
                nickName, 
                isActiveNickname: finalNickName !== null
            })
        }

        await user.save();
        
        const response:IUserResponse = formatUserResponse(user)
        return callback(null,{
            nickName,
            isActiveNickname: finalNickName !== null,
            ...response
        });
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
}

export const updateNicknameToggle = async(
    userId:string,
    contactUserId:string,
    callback:(error:any, result:any) => void
)=>{
    try {
        const user = await userSchema.findById(userId);
        if(!user){
            return callback({
                status: 404,
                code: "USER_NOT_FOUND",
                message: "User not found."
            }, null);
        }

        const existingNickname = user.nicknames.find(n => n.contactUserId.toString() === contactUserId);
        if(existingNickname){
            if(!existingNickname.nickName || !existingNickname.nickName.trim()){
                return callback({
                    status: 400,
                    code: "EMPTY_NICKNAME",
                    message: "Please assign a nickname before enabling this option."
                },null)
            }
            console.log("!existingNickname.is_active_nickname;",!existingNickname.isActiveNickname)
            existingNickname.isActiveNickname = !existingNickname.isActiveNickname;
        }else{
             return callback({
                status: 404,
                code: "NICKNAME_NOT_FOUND",
                message: "Set a nickname before enabling this option."
            }, null);
        }
        await user.save()
        const formatUser:IUserResponse = formatUserResponse(user);
        const response = {
            nickname : existingNickname.nickName,
            is_active_nickname: existingNickname.isActiveNickname ?? false,
            ...formatUser
        }
        
        return callback(null,response);
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
}
