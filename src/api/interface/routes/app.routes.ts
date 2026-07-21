import express from "express";
import { protectedRoute, optionalAuth} from "../../middleware/auth.middleware";
import { validateRequest } from "../../middleware/validation.middleware";
import { generateAgoraToken, getAgoraAppId, sentOtp, verifyOtp } from "../controllers/auth.controller";
import { sendOtpValidationSchema, verifyOtpValidationSchema } from "../../utils/validation-schems/user.validation";
import {  accountDeleted, adsConfig, checkUserName, getAllUsers, getDetailsOfSingleUser, isExist, newRefreshToken, requestToEmailChange, setNickname, syncContact, updateToggle, updateUserProfile, uploadMediaOnS3, verifyOtpAndChangeEmail } from "../controllers/user.controller";
import upload, { decryptMessage, decryptMessage_1, descryptedContent, encryptMessage_1 } from "../../helper/helper";
import {  createNewChat, getConversations,  getMessagesOfChatID,  sendMessage, uploadMediaOnChat, deleteMessage, clearAllChat, deleteChat, forwardConversations } from "../controllers/chat.controller";
import { getSavedMessages, saveMessage, sendSavedMessages, unsaveMessage } from "../controllers/save.messages.controller";
import { addMembers,createGroup, groupConversations, assignAdminToGroup, leaveGroup, removeMember, getGroupInfo, deleteGroup, updateGroupInfo, revokeGroupInviteLink, joinGroupByInvite, searchPublicGroups, searchDatabase, checkInviteName} from "../controllers/group.controller";
import { createStory, deleteStories, getAllStories, getAllStories1, getUserStoriesWithViewerDetails, getUserStoriesWithViewerDetails1, viewStory } from "../controllers/stories.controller";
import { addMemberToChannel, createChannel, deleteChannel, generateInviteLink, getChannelDetails, joinChannel, leaveChannel, listChannels, removeMemberFromChannel, sentMessageToChannel, updateChannelDetails } from "../controllers/channel.controller";
import { deleteDeviceToken, replaceToken, saveDeviceTokenApi } from "../controllers/devicetoken.controller";
import path from "path";
import {  getCallHistoryLists, updateCallStatus } from "../controllers/call.history.controller";
import { clearCallLog, clearNotification, getNotifications, updateUnreadMessage } from "../controllers/notifications.controller";
import { getPublicKey, saveEcKeys } from "../controllers/ec.controller";
import crypto from "crypto";
import { blockedUsers, blockUser, unBlockUser } from "../controllers/blockuser.controller";
import { getReportedUser, reportUser } from "../controllers/reportuser.controller";
import { refreshToken } from "firebase-admin/app";

// import { getUsersProfiles, imageCaptionUpdate, imageUpload, removeImages, removeSingleImage, setProfileImage, updateUserProfile } from "../controllers/user.controller";
const route = express.Router();

export const appRoute = (router: express.Router): void => {
    try {
        router.use('/v1', route)

        route.get("/ads-config",adsConfig);

        route.put("/setNickname", protectedRoute, setNickname);
        route.put("/toggle-nickname",protectedRoute, updateToggle)

        /** ++++++++++++++++++++++++++ Users Api ++++++++++++++++++++++++++++++ */
        // Sent otp on email api
        route.post("/auth/send-otp",validateRequest(sendOtpValidationSchema), sentOtp);
        // verify otp || Register via google, facebook, phone api
        route.post("/auth/verify-otp",/** validateRequest(verifyOtpValidationSchema) */ verifyOtp);
        // Update user profile api
        route.put("/users",protectedRoute, upload.array("files",5), updateUserProfile);
        // get all users with logged-in user api
        route.get("/users",protectedRoute, getAllUsers);
        // get user details
        route.get("/find-one-user",protectedRoute, getDetailsOfSingleUser);

        route.post("/upload/media", protectedRoute, upload.array("files",5), uploadMediaOnS3)

        route.post("/sync-contact",protectedRoute, syncContact);

        route.post("/request-email-change", protectedRoute, requestToEmailChange)

        route.post("/verify-email-change", protectedRoute, verifyOtpAndChangeEmail)

        route.post("/check-username",protectedRoute, checkUserName)

        route.post("/block-user",protectedRoute, blockUser)
        route.post("/unblock-user",protectedRoute, unBlockUser)
        route.get("/blocked-users",protectedRoute, blockedUsers)

        route.post("/report-user",protectedRoute, reportUser)
        route.get("/reported-users",protectedRoute, getReportedUser)

        route.post("/user/is_exist", protectedRoute, isExist)
        /** ++++++++++++++++++++++++++ Delete Account Api ++++++++++++++++++++++++++++++ */
        route.delete("/auth/account-delete",protectedRoute, accountDeleted)

        /** ++++++++++++++++++++++++++ Chat Api ++++++++++++++++++++++++++++++ */
        // create New Chat api
        route.post("/chat/create-chat",protectedRoute,  createNewChat);
        // Sent message int chat api
        route.post("/chat/sent-message",protectedRoute, upload.array("files",5), sendMessage);      
        // all messages of single chat api
        route.get("/chat/:chatId",protectedRoute, getMessagesOfChatID); 
        // Upload Media api
        route.post("/chat/upload-media",protectedRoute,  upload.array("files",5), uploadMediaOnChat);
        // Conversations of chats api
        route.get("/chat/conversations/list",protectedRoute, getConversations)
        // Forwad conversation list
        route.get("/chat/forward/list",protectedRoute, forwardConversations)

        // User delete own messages
        route.delete("/chat/delete-message",protectedRoute, deleteMessage)
        // User can clear all chat
        route.delete("/chat/clear-chat/:chatId",protectedRoute, clearAllChat);

        route.delete("/delete-chat",protectedRoute, deleteChat)

        /** ++++++++++++++++++++++++++ Group Api ++++++++++++++++++++++++++++++ */
        // create New group api 
        route.post("/group/create-group",protectedRoute, upload.array("files",5), createGroup) // 1.
        // Add new member into group api
        route.post("/group/add-members", protectedRoute, addMembers)
        // Send message into group api
        // route.post("/group/sent-group-message", protectedRoute,uploadImagesFile, sendGroupMessage);
        // Conversations of groups api
        route.get("/group/group-chat", protectedRoute, groupConversations);
        // Assign admin into group api
        route.post("/group/assignAdminToGroup", protectedRoute, assignAdminToGroup);
        // User Can Leave the group api
        route.delete("/group/leaveGroup/:chatId", protectedRoute, leaveGroup)
        // Admin Can remove member from group api
        route.post('/group/remove-member',protectedRoute, removeMember);
        // Search public groups and channels
        // (must be registered before "/group/:chatId" — otherwise Express
        // matches "search-public" as a :chatId value and getGroupInfo
        // swallows the request before this handler is ever reached)
        route.get("/group/search-public", protectedRoute, searchPublicGroups)
        // Database-wide search for public users, groups, channels
        // (same ordering requirement as above)
        route.get("/group/search-database", protectedRoute, searchDatabase)
        // Check if a custom invite name is available (must be before /:chatId)
        route.get("/group/check-invite-name", protectedRoute, checkInviteName)
        // Get group info of group api
        route.get("/group/:chatId",protectedRoute, getGroupInfo)
        // Get messages of group api
        // route.get("/group/messages/:groupChatId",protectedRoute, getGroupMessages)
        // Delete group api
        route.delete("/group/delete/:chatId", protectedRoute, deleteGroup)

        // Update group info api
        route.put("/group/update/:chatId",protectedRoute,upload.array("files",5), updateGroupInfo)

        // Join group/channel via invite link
        route.post("/group/join/:chatId", protectedRoute, joinGroupByInvite)
        // Revoke and regenerate group invite link api
        route.post("/group/revoke-invite-link/:chatId", protectedRoute, revokeGroupInviteLink)

        /** ++++++++++++++++++++++++++ SavedMessage Api ++++++++++++++++++++++++++++++ */
        route.post("/send/saved-messages", protectedRoute,upload.array("files",5), sendSavedMessages)
        // User Can save own message and participants message api
        route.post("/saved-messages", protectedRoute,  saveMessage);
        // get saved messages api
        route.get("/saved-messages", protectedRoute, getSavedMessages)
        // remove saved messages api
        route.delete("/unsaved-message",protectedRoute, unsaveMessage);


        /** ++++++++++++++++++++++++++ Stories Api ++++++++++++++++++++++++++++++ */
        // User can create/upload stories api
        route.post("/stories/create-stories", protectedRoute, upload.array("files",5), createStory);
        // User can delete stories api
        route.delete("/stories/:storiesId", protectedRoute, deleteStories);
        // get all users stories with logged-in api
        route.get("/stories", protectedRoute, getAllStories1);
        // get all active stories of logged-in user with viewers
        route.get("/getUserStoriesWithViewerDetails", protectedRoute, getUserStoriesWithViewerDetails1);
        // logged-in user see stories of users, and we updated viewers into users document, api
        route.post("/stories/:storiesId/view", protectedRoute, viewStory)


        /** ++++++++++++++++++++++++++ Agora Token Api ++++++++++++++++++++++++++++++ */
        route.post("/generate-token/:chatId", protectedRoute, generateAgoraToken)
        route.get("/get-app_id",protectedRoute,getAgoraAppId);

        route.put("/update-call-status",protectedRoute,updateCallStatus)
        route.get("/get-notifications", protectedRoute, getNotifications)
        route.get("/get-callhistory", protectedRoute, getCallHistoryLists)
        route.put("/update-unread-message", protectedRoute, updateUnreadMessage)
        route.delete("/clear-call-log",protectedRoute, clearCallLog)

        route.delete("/clear-notification",protectedRoute, clearNotification)

        /** ++++++++++++++++++++++++++ EC Private & Public Key ++++++++++++++++++++++++++++++ */
        route.post("/generate/eckeys/:userId",saveEcKeys)
        route.get("/get-public/key/:userId",getPublicKey)
        /** ++++++++++++++++++++++++++ Channel Api ++++++++++++++++++++++++++++++ */
        // create channel api
        route.post("/create-channel", protectedRoute, upload.array("files",5), createChannel);
        // get channel details api
        route.get("/channels/:channelId", protectedRoute, getChannelDetails);
        // List All Channel
        route.get("/channels", protectedRoute, listChannels);
        // join channel via public or invite link for private channel api
        route.post("/channels/join/:channelId", protectedRoute, joinChannel);
        // leave a channel api
        route.post("/channels/leave/:channelId", protectedRoute, leaveChannel);
        
        // update channel details (admin only) api
        route.put("/channels/:channelId", protectedRoute, upload.array("files",5), updateChannelDetails);

        // add member to a channel (admins only) api
        route.post("/channels/members/add/:channelId", protectedRoute, addMemberToChannel);
        // remove member from a channel (admins only) api
        route.post("/channels/:channelId", protectedRoute, removeMemberFromChannel)
        
        // generate an invite link (for private channels) api.
        // route.post("/channels/:channelId/invite", generateInviteLink);
        
        // delete channel (admins only) api
        route.delete("/channels/:channelId", protectedRoute, deleteChannel)

        // sent message into channel api
        route.post("/channels/message/sent",protectedRoute, upload.array("files",5), sentMessageToChannel)

        /** ++++++++++++++++++++++++++ DeviceToken Api ++++++++++++++++++++++++++++++ */
        route.delete("/delete-token", protectedRoute, deleteDeviceToken)
        route.post("/replace-token", optionalAuth, replaceToken);
         /** ++++++++++++++++++++++++++ Push Notification Api ++++++++++++++++++++++++++++++ */
         route.post("/push", optionalAuth, saveDeviceTokenApi)

         route.get("/refresh-token", protectedRoute, newRefreshToken)
         route.get("/privacy-policy", (req, res) => {
            // require("../../../public/privacypolicy.html")
            // res.send("privacy page")
            res.sendFile(path.join(__dirname, "../../../public/privacypolicy.html"))
         })



route.post("/encrypt",(req,res) => {
    /**
     * Testing payload
     * {
            "encryptedJson":{"cipher":"r5ht/y6rR5W+H8mgbd9lfaH3Ik21GO9499xZZYHPbQ==","iv":"hQTA42c6BCfxlihXiHl2Sw=="},
            "aesKey": "WWFOmFLhdy6qw/NI46IipTkmwzAbytQMboh0kHuiZwg="
        }
        // output
        Hello world 123
     */
    const message = req.body.message;
    const aesKey = req.body.aesKey;
    const result = encryptMessage_1(message, aesKey);
 
    res.send(result)
})

route.post("/decrypt",(req,res) => {
/** 
 * // Testing payload
    {
        "message":"Hello world 123", 
        "aesKey":"WWFOmFLhdy6qw/NI46IipTkmwzAbytQMboh0kHuiZwg="
    }

    // output
    {"cipher":"r5ht/y6rR5W+H8mgbd9lfaH3Ik21GO9499xZZYHPbQ==","iv":"hQTA42c6BCfxlihXiHl2Sw=="}
 */
    const encryptedJson = req.body.encryptedJson;
    const aesKey = req.body.aesKey;

    const result = decryptMessage_1(JSON.stringify(encryptedJson), aesKey);
 
    res.send(result)
})
    } catch (error) {
        // Log any errors that occur during route definition
        console.log(error, 'warn')
    }
}

