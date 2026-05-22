import {Request, Response} from "express";
import { successCreated } from "../../helper/apiResponse";
import { deleteDeviceTokenApiLogic, replaceFcmToken, saveDeviceTokenLogic } from "../../domain/models/device.token.model";


export const saveDeviceTokenApi = async(req: Request, res: Response)=>{
    const {userId, deviceToken, deviceType} = req.body;

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
    // const userId = req.user.userId;
    const {deviceToken, userId, deviceType} = req.body;

    // if(!userId && !deviceToken){
    //     return res.status(400).json({message: "deviceToken & userId is required."})
    // }

    replaceFcmToken(userId, deviceToken,deviceType,(error:any, result:any) => {
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