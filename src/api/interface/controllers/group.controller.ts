import {Request, Response} from "express"
import { successCreated, successResponse } from "../../helper/apiResponse"
import { addMembersLogic, assignAdminLogic, createGroupLogic, deleteGroupLogic, getGroupInfoLogic, groupConversationsLogic, joinGroupByInviteLogic, leaveGroupLogic, removeMemberLogic, revokeGroupInviteLinkLogic, updateGroupInfoLogic } from "../../domain/services/chat.service";


// create a New group Api
export const createGroup = (req: Request, res: Response) => {
    const { groupName,isProfilePhoto, isSendMessage, chatType="group" } = req.body;
    const files = req.files as Express.Multer.File[];
    const userId = req.user?.userId;

    // Validate group name
    if (!groupName) {
        return res.status(400).json({
            code: "GROUP_NAME_REQUIRED",
            message: "Group name is required.",
        });
    }

    createGroupLogic(req.body, userId, files, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successResponse(res, "Group created successfully.", result)
    });
};

// Add new member into group
export const addMembers = (req: Request, res: Response) => {
    const { groupId, newMembers, messageId } = req.body;
    const userId = req.user?.userId;

    // Validate input
    if (!groupId || !newMembers || !Array.isArray(newMembers) || newMembers.length === 0) {
        return res.status(400).json({
            code: "INVALID_INPUT",
            message: "GroupId and new members are required.",
        });
    }

    addMembersLogic(groupId, newMembers, userId,messageId, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return res.status(200).json(result);
        // return successResponse(res,"Members added successfully.", result)
    });
};

/*
// Sende Message into group
export const sendGroupMessage = (req: Request, res: Response) => {
    const { chatId, content, type = "text" } = req.body;
    const fileUrls = req.body.fileUrls;
    const senderId = req.user?.userId;
    const files = req.files as Express.Multer.File[];

    // Validate input
    if (!chatId || !senderId || !content) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    sendGroupMessageLogic(chatId, content, type, fileUrls, senderId, files, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return res.status(result.status).json(result);
    });
};
*/


/*
// Group Messages
export const getGroupMessages = (req: Request, res: Response) => {
    const { groupChatId } = req.params;
    const userId = req.user.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    getGroupMessagesLogic(groupChatId, userId, page, limit, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message,
                data:error?.data
            });
        }
        return successResponse(res,"Group messages.",result)
    });
};
*/

// get Conversations of groups
export const groupConversations = (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const { page = 1, limit = 10 } = req.query;

    // Validate input
    if (!userId) {
        return res.status(400).json({ message: 'User ID is required.' });
    }

    const pageNumber = parseInt(page as string);
    const limitNumber = parseInt(limit as string);

    groupConversationsLogic(userId, pageNumber, limitNumber, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        // return res.status(result.status).json(result);
        return successResponse(res,"'Group chats fetched successfully.'", result);

    });
};

// Assign admin into group
export const assignAdminToGroup = (req: Request, res: Response) => {
    const { chatId, userId, removeFromAdmin = false } = req.body;
    const loggedInUserId = req.user.userId;

    assignAdminLogic(chatId, userId, loggedInUserId,removeFromAdmin, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successCreated(res,result)
    });
};

// User Can Leave the group

export const leaveGroup = (req: Request, res: Response) => {
    const { chatId } = req.params;
    const userId = req.user.userId;
    const {messageId} = req.body;
    
    leaveGroupLogic(chatId, userId,messageId, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successCreated(res, result)
    });
};

// Admin can removed member from group
export const removeMember = (req: Request, res: Response) => {
    const { chatId, memberId } = req.body;
    const userId = req.user.userId; // Logged-in user ID

    removeMemberLogic(chatId, memberId, userId, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successCreated(res, result)
    });
};

// Get Information about group
export const getGroupInfo = (req: Request, res: Response) => {
    const { chatId } = req.params;
    const userId = req.user.userId;
    getGroupInfoLogic(chatId,userId, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successResponse(res,"Group Info",result)
    });
};


export const deleteGroup = async(req:Request, res: Response) => {
    const userId = req.user.userId;
    const {chatId} = req.params;

    deleteGroupLogic(userId, chatId, (error, result) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            })
        }
        return successCreated(res, result)
    })
}

export const updateGroupInfo = async(req:Request, res:Response)=>{
    const userId = req.user.userId;
    const {chatId} = req.params;
    const files = req.files as Express.Multer.File[];
    const { groupName, isProfilePhoto, isSendMessage } = req.body;

    // Validate input
    if (!chatId) {
        return res.status(400).json({
            code: "CHAT_ID_REQUIRED",
            message: "Chat ID is required."
        });
    }

    updateGroupInfoLogic(userId,chatId,req.body,files,(error, result) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            })
        }
        return successResponse(res, "Group details updated successfully.",result)
    })
}

export const revokeGroupInviteLink = async(req: Request, res: Response) => {
    const userId = req.user.userId;
    const { chatId } = req.params;

    if (!chatId) {
        return res.status(400).json({
            code: "CHAT_ID_REQUIRED",
            message: "Chat ID is required."
        });
    }

    revokeGroupInviteLinkLogic(userId, chatId, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status: error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successResponse(res, "Invite link revoked successfully.", result)
    })
}

export const joinGroupByInvite = async (req: Request, res: Response) => {
    const userId = req.user.userId;
    const { chatId } = req.params;
    const { inviteLink } = req.body;

    joinGroupByInviteLogic(chatId, inviteLink || "", userId, (error: any, result: any) => {
        if (error) {
            return res.status(error.status).json({
                status: error?.status,
                code: error?.code,
                message: error?.message,
            });
        }
        return successResponse(res, "Joined successfully.", result);
    });
}

export const searchPublicGroups = async (req: Request, res: Response) => {
    const { search = "", page = 1, limit = 20 } = req.query;
    const userId = req.user.userId;

    try {
        const skip = (Number(page) - 1) * Number(limit);
        const query: any = {
            privacy: "public",
            type: { $in: ["group", "channel"] },
        };
        if (search) {
            const escaped = (search as string).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
            query.groupName = { $regex: `^${escaped}`, $options: "i" };
        }

        const { default: chatSchema } = await import("../../domain/schema/chat.schema");
        const results = await chatSchema.find(query)
            .select("_id groupName groupImage type privacy participants inviteLink")
            .sort({ groupName: 1 })
            .skip(skip)
            .limit(Number(limit))
            .lean();

        const mapped = results.map((g: any) => ({
            _id: g._id,
            groupName: g.groupName,
            groupImage: g.groupImage,
            type: g.type,
            privacy: g.privacy,
            memberCount: g.participants?.length ?? 0,
            isMember: g.participants?.some((p: any) => p.toString() === userId) ?? false,
        }));

        return successResponse(res, "Public groups fetched.", mapped);
    } catch (error: any) {
        return res.status(500).json({ status: 500, message: error.message });
    }
}

export const searchDatabase = async (req: Request, res: Response) => {
    const { search = "", page = 1, limit = 50 } = req.query;
    const userId = req.user.userId;

    try {
        const skip = (Number(page) - 1) * Number(limit);
        const escaped = (search as string).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
        const results: any[] = [];

        // Search public users
        const { default: userSchema } = await import("../../domain/schema/user.schema");
        const userQuery: any = {
            _id: { $ne: userId },
            profilePrivacy: "public",
            isVerified: true,
            isProfileSetUp: true,
        };
        if (search) {
            userQuery.$or = [
                { userName: { $regex: `^${escaped}`, $options: "i" } },
                { name: { $regex: `^${escaped}`, $options: "i" } },
            ];
        }
        const users = await userSchema.find(userQuery)
            .select("_id name userName profilePicture lastSeen isOnline")
            .sort({ name: 1 })
            .skip(skip)
            .limit(Number(limit))
            .lean();

        for (const u of users) {
            results.push({
                _id: u._id,
                name: u.name,
                userName: u.userName,
                profilePicture: u.profilePicture,
                lastSeen: u.lastSeen,
                isOnline: u.isOnline,
                resultType: "user",
            });
        }

        // Search public groups & channels
        const { default: chatSchema } = await import("../../domain/schema/chat.schema");
        const groupQuery: any = {
            privacy: "public",
            type: { $in: ["group", "channel"] },
        };
        if (search) {
            groupQuery.groupName = { $regex: `^${escaped}`, $options: "i" };
        }
        const groups = await chatSchema.find(groupQuery)
            .select("_id groupName groupImage type privacy participants")
            .sort({ groupName: 1 })
            .skip(skip)
            .limit(Number(limit))
            .lean();

        for (const g of groups) {
            results.push({
                _id: g._id,
                name: g.groupName,
                groupImage: g.groupImage,
                type: g.type,
                memberCount: g.participants?.length ?? 0,
                isMember: g.participants?.some((p: any) => p.toString() === userId) ?? false,
                resultType: g.type,
            });
        }

        results.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        return successResponse(res, "Database search results.", results);
    } catch (error: any) {
        return res.status(500).json({ status: 500, message: error.message });
    }
}
