import {Request, Response} from "express"
import { successCreated, successResponse } from "../../helper/apiResponse"
import { clearAllChatLogic, createNewChatLogic, deleteChatApi, deleteMessageLogic, getConversationsLogic, getForwardedConversationsLogic, getMessagesOfChatIDLogic, sendMessageLogic } from "../../domain/services/chat.service";
import { loggerMsg } from "../../lib/logger";

// create New Chat between two user or return existing user chat
export const createNewChat = (req: Request, res: Response) => {
    const { userId2 } = req.body;
    const userId1 = req.user.userId;

    createNewChatLogic(userId1, userId2, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successResponse(res,"New chat created.", result)
    });
};



export const sendMessage = (req: Request, res: Response) => {
    const { chatId, content, type, fileUrls, messageId, isGroup=false, replyToMessageId, url, size, createdAt  } = req.body;
    loggerMsg(`Media payload......\n${JSON.stringify(req.body)}`,'debug')
    const sender = req.user.userId;
    const files = req.files as Express.Multer.File[];

    
    // Validate required fields
    if (!chatId || !sender /* || !content */ || !type) {
        return res.status(400).json({
            code: "INVALID_PAYLOAD",
            message: "Missing required fields.",
        })
    }

    sendMessageLogic(
        { chatId, content, type, sender, fileUrls, files, messageId, replyToMessageId, url, size, createdAt  },
        (error, result) => {
            if (error) {
                return res.status(error.status).json({
                    status:error?.status,
                    code: error?.code,
                    message: error?.message
                });
            }
            return successResponse(res, "Message sent successfully.", result)
        }
    );
};

export const getMessagesOfChatID = (req: Request, res: Response) => {
    const { chatId } = req.params;
    const userId = req.user.userId;
    const page = parseInt(req.query.page as string);
    const limit = parseInt(req.query.limit as string);
    const skip = (page - 1) * limit;
    const serach = req.query.search as string || ""
    // Validate input
    if (!chatId) {
        return res.status(400).json({
            code: "CHAT_ID_REQUIRED",
            message: "chatID is required.",
        });
    }

    if (!userId) {
        return res.status(400).json({
            code: "USER_ID_REQUIRED",
            message: "userID is required.",
        });
    }

    getMessagesOfChatIDLogic(chatId, userId,page,limit,skip,serach, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message,
                data: error?.data
            });
        }
        return successResponse(res,"Messages fetched successfully.", result)
    });
};


export const uploadMediaOnChat = async(req:Request, res:Response) => {
    try {
        // check if req.files is an array before useing map
        if(Array.isArray(req.files)){
            const uploadedFiles = req.files?.map(file => file.filename);
            res.status(200).json({
                success: true,
                message: 'Files uploaded successfully',
                files: uploadedFiles
            });
        }
    } catch (error:any) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: error.message || 'Internal Server Error'
        });
    }
}

// Conversations List of chat
export const getConversations = (req: Request, res: Response) => {
    const userId = req.user.userId;
    const searchTerm = req.query.searchTerm as string;
    const archived = String(req.query.archived);

    // Validate userId
    if (!userId) {
        return res.status(400).json({
            code: "USER_ID_REQUIRED",
            message: "User ID is required.",
        });
    }

    getConversationsLogic(userId,searchTerm,archived, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message,
                data:error?.data
            });
        }
        return successResponse(res,"Conversation list fetched successfully.", result)
    });
};

export const forwardConversations = (req: Request, res: Response) => {
    const userId = req.user.userId;
    const searchTerm = req.query.searchTerm as string;
    const archived = String(req.query.archived);

    // Validate userId
    if (!userId) {
        return res.status(400).json({
            code: "USER_ID_REQUIRED",
            message: "User ID is required.",
        });
    }

    getForwardedConversationsLogic(userId,searchTerm,archived, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message,
                data:error?.data
            });
        }
        return successResponse(res,"Conversation list fetched successfully.", result)
    });
};



export const deleteMessage = (req: Request, res: Response) => {
    const { messageId } = req.body;
    const userId = req.user.userId;

    // Validate required fields
    if (!messageId) {
        return res.status(400).json({
            code: "MESSAGE_ID_REQUIRED",
            message: "Message ID is required.",
        });
    }

    deleteMessageLogic(userId, req.body, (error, result) => {
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


export const clearAllChat = (req: Request, res: Response) => {
    const { chatId } = req.params;
    const userId = req.user.userId;

    // Validate required fields
    if (!chatId) {
        return res.status(400).json({
            code: "CHAT_ID_REQUIRED",
            message: "Chat ID is required.",
        });
    }

    clearAllChatLogic(userId, chatId, (error, result) => {
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

export const deleteChat = (req: Request, res: Response)=> {
    const userId = req.user.userId;
    const chatId = req.body.chatId;
    
    deleteChatApi(userId, chatId, (error, result) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successCreated(res,result)
    });
}
