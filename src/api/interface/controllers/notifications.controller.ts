import {Request, Response} from "express"
import { successCreated, successResponse } from "../../helper/apiResponse";
import { clearCallLogLogic, clearNotificationApi, getNotificationLists, markNotificationsAsRead, respondToInviteLogic } from "../../domain/models/notifications.model";

export const getNotifications = async(req:Request, res:Response) => {
    const userId = req.user.userId;
     // Get pagination params (default: page=1, limit=10)
     const page = parseInt(req.query.page as string) || 1;
     const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string || ""

    getNotificationLists(userId, page, limit,search,(error, result) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successResponse(res,"Notifications List.",result)
    })
}


export const updateUnreadMessage = async(req:Request, res:Response) => {
    const userId = req.user.userId;
    
     markNotificationsAsRead(userId, (error, result) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successResponse(res,"Messages read successfully.",result)
    })
}


export const respondToInvite = async(req:Request, res:Response) => {
    const userId = req.user.userId;
    const { notificationId, action } = req.body;

    if (!notificationId || !action) {
        return res.status(400).json({
            code: "INVALID_INPUT",
            message: "notificationId and action are required.",
        });
    }

    respondToInviteLogic(userId, notificationId, action, (error, result) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successResponse(res,"Invitation response recorded.",result)
    })
}

export const clearCallLog = async(req:Request, res:Response) => {
    const userId = req.user.userId;
    const {callIds} = req.body;
    clearCallLogLogic(userId,callIds, (error, result) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successCreated(res,result)
    })
}

export const clearNotification = async(req:Request, res:Response) => {
    const userId = req.user.userId;
    const {callIds} = req.body;
    clearNotificationApi(userId, (error, result) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successCreated(res,result)
    })
}