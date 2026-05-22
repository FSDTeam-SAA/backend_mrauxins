import {Request, Response} from "express"
import { successCreated, successResponse } from "../../helper/apiResponse";
import { createNewStoryLogic, deleteStoriesLogic,  getAllStoriesLogic,  getAllStoriesLogic1, getUserStoriesWithViewerDetailsLogic, getUserStoriesWithViewerDetailsLogic1, viewStoryLogic } from "../../domain/models/stories.model";
import { userSocketMap } from "../../socket/initDemoSocketHandlers";
import { getIo } from "../../../infrastructure/webserver/express/v1";
import { sentPushNotificationToUser } from "../../domain/models/device.token.model";
import { loggerMsg } from "../../lib/logger";

export const createStory = async(req: Request, res: Response) => {
    const userId = req.user.userId;
    const { mediaType, caption, duration} = req.body;
    const files = req.files as Express.Multer.File[];
    const io = getIo();

    if (!userId) {
        return res.status(400).json({ message: "userId is a required" });
    }

    // Validate inputs
    if (!mediaType) {
        return res.status(400).json({ message: "Media URL and media type are required" });
    }

    // create story
    createNewStoryLogic(userId, mediaType, caption,duration, files, (error,result) => {
        if(error){
            return res.status(error.status).json({
                status: error.status,
                code: error?.code,
                message: error?.message
            })
        }
        // Notify all connected users about the new story
        // const connectedUsers = Object.keys(userSocketMap);
        // loggerMsg(`SenderId...${userId}`,"debug")
        // loggerMsg(`connectedUsers....\n${connectedUsers}`,"debug")
        // connectedUsers.forEach(async (connectedUserId) => {
        //     if(connectedUserId !== userId){
        //         loggerMsg(`connectedUserId...\n${connectedUserId}`,"debug")
        //         const sokcetId = userSocketMap[connectedUserId];
        //         if(sokcetId){
        //             io.to(sokcetId).emit('storyUploaded', {
        //                 message: `New story uploaded by ${userId}`,
        //                 data: {
        //                     "userId": result?.userId,
        //                     "mediaUrl": result?.mediaUrl,
        //                     "mediaType": result?.mediaType,
        //                     "caption": result?.caption,
        //                     "expiresAt": result?.expiresAt,
        //                     "userName": result?.userName,
        //                     "profilePicture": result?.profilePicture
        //                 }
        //             });
        //             loggerMsg(`Story upload via socket to ${connectedUserId}`,"debug")
        //         }
        //         const notificationPayload = {
        //                 title : `story Upload by ${result.userName}.`,
        //                 body : result?.mediaUrl !== undefined ? result?.mediaUrl : "https://12e0-116-72-2-183.ngrok-free.app/media/images/images-logo1_transparent1%202.png",
        //                 click_action : CLICK_NOTIFICATION_TYPE,
        //                 type : 'view_new_story',
        //                 story_id : result._id,
        //             }
                
        //         loggerMsg(`Push notification send will be this ${connectedUserId.toString()}`,"debug")
        //         await sentPushNotificationToUser(connectedUserId.toString(), notificationPayload)
        //         loggerMsg(`Push notification of Story upload to ${connectedUserId.toString()}`,"debug")
        //     }
        // })
        return successResponse(res,"Stories Uploaded Successfully.",result)
    })
}

export const deleteStories = async (req: Request, res: Response) => {
    const {storiesId} = req.params;
    const userId = req.user.userId;

    if(!userId){
        return res.status(400).json({ message: "userId are required" });
    }

    if(!storiesId){
        return res.status(400).json({ message: "storiesId are required" });
    }

    deleteStoriesLogic(storiesId, userId,(error, result) => {
        if(error){
            return res.status(error.status).json({
                status: error.status,
                code: error?.code,
                message: error?.message
            })
        }
        return successCreated(res, result)
    })

}

export const getAllStories = async(req: Request, res: Response) => {
    const userId = req.user.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    getAllStoriesLogic(userId, page, limit, skip, (error, result) => {
        if(error){
            res.status(error.status).json({
                status: error.status,
                code: error?.code,
                message: error?.message
            })
        }
        return res.status(200).json(result)
    })
}

export const getAllStories1 = async(req: Request, res: Response) => {
    const userId = req.user.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    getAllStoriesLogic1(userId, page, limit, skip, (error, result) => {
        if(error){
            res.status(error.status).json({
                status: error.status,
                code: error?.code,
                message: error?.message,
                data:error?.data
            })
        }
        return successResponse(res,"All Stories.!",result)
    })
}


export const getUserStoriesWithViewerDetails = async (req: Request, res: Response) => {
    const userId = req.user.userId;
    getUserStoriesWithViewerDetailsLogic(userId, (error, result) => {
        if(error){
            res.status(error.status).json({
                status: error?.status,
                code: error?.code,
                message: error?.message
            })
        }
        return res.status(200).json(result)
    })
}

export const getUserStoriesWithViewerDetails1 = async (req: Request, res: Response) => {
    const userId = req.user.userId;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    getUserStoriesWithViewerDetailsLogic1(userId,page,limit, (error, result) => {
        if(error){
            res.status(error.status).json({
                status: error?.status,
                code: error?.code,
                message: error?.message,
                data: error?.data
            })
        }
        return res.status(200).json(result)
    })
}

export const viewStory = async(req: Request, res: Response) => {
    const viewUserId = req.user.userId;
    const {storiesId} = req.params;

    if(!viewUserId){
        return res.status(400).json({message: "user are required."})
    }

    if(!storiesId){
        return res.status(400).json({message: "storiesId are required."})
    }

    viewStoryLogic(viewUserId, storiesId, (error, result) => {
        if(error){
            res.status(error?.status).json({
                status: error?.status,
                code: error?.code,
                message: error?.message
            })
        }

        return successCreated(res,result);
    })
}