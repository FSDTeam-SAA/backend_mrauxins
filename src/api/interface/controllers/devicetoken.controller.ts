import {Request, Response} from "express";
import { successCreated } from "../../helper/apiResponse";
import { deleteDeviceTokenApiLogic, replaceFcmToken, saveDeviceTokenLogic } from "../../domain/models/device.token.model";
import { loggerMsg } from "../../lib/logger";


export const saveDeviceTokenApi = async(req: Request, res: Response)=>{
    const {deviceToken, deviceType} = req.body;
    let userId = req.user?.userId;
    if(!userId){
        loggerMsg(`/push called without a valid auth token — falling back to body userId ${req.body.userId}. This fallback is deprecated and will be removed.`, "warn");
        userId = req.body.userId;
    }

    saveDeviceTokenLogic(userId, deviceToken, deviceType, (error, result) => {
        if(error){
            return res.status(error.status).json({
                status: error.status,
                code: error.code,
                message: error.message
            })
        }
        return successCreated(res, result)
    })
}

export const deleteDeviceToken = async(req:Request, res: Response) => {
    const userId = req.user.userId;
    const {deviceToken} = req.body;

    if(!userId && !deviceToken){
        return res.status(400).json({message: "deviceToken & userId is required."})
    }

    deleteDeviceTokenApiLogic(userId, deviceToken,(error, result) => {
        if(error){
            return res.status(error.status).json({
                status: error.status,
                code: error.code,
                message: error.message
            })
        }
        return successCreated(res, result)
    })
}

export const replaceToken = async(req: Request, res: Response) => {
    const {deviceToken, voipToken, deviceType} = req.body;
    let userId = req.user?.userId;
    if(!userId){
        loggerMsg(`/replace-token called without a valid auth token — falling back to body userId ${req.body.userId}. This fallback is deprecated and will be removed.`, "warn");
        userId = req.body.userId;
    }

    if(!userId || (!deviceToken && !voipToken)){
        return res.status(400).json({message: "deviceToken or voipToken, and userId, are required."})
    }

    replaceFcmToken(userId, deviceToken, deviceType, voipToken, (error:any, result:any) => {
        if(error){
            return res.status(error.status).json({
                status: error.status,
                code: error.code,
                message: error.message
            })
        }
        return successCreated(res, result)
    })
}