import { addBlockUser, addUnBlockUser, blockUsersList } from "../../domain/models/blockuser.model";
import { successCreated, successResponse } from "../../helper/apiResponse"
import {Request, Response} from "express";


export const blockUser = async (req: Request,res: Response) => {
    const loggedInUserId = req.user.userId;
    const {blockedUserId, chatId } = req.body;
    addBlockUser(loggedInUserId,blockedUserId,chatId,(error:any, result:any) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successCreated(res, result)
    })
}


export const unBlockUser = async (req: Request,res: Response) => {
    const loggedInUserId = req.user.userId;
    const {blockedUserId } = req.body;
    addUnBlockUser(loggedInUserId,blockedUserId,(error:any, result:any) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successCreated(res, result)
    })
}

export const blockedUsers = async (req: Request,res: Response) => {
    const loggedInUserId = req.user.userId;
    blockUsersList(loggedInUserId,(error:any, result:any) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successResponse(res,"Lists of blocked users.", result)
    })
}