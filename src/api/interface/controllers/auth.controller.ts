import { Request, Response } from "express";
import { successCreated, successResponse } from "../../helper/apiResponse";
import { generateAgoraTokenLogic, getAgoraAppIdLogic, handleOtp, handleUserVerification } from "../../domain/services/user.service";
import {v4 as uuidv4} from "uuid"

// sendOtp
export const sentOtp = async (req: Request, res: Response) => {
    const { email } = req.body;
    const normalizedEmail = email.toLowerCase();

    handleOtp(normalizedEmail, (error:any, result:any) => {
        if (error) {
            return res.status(500).json({
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred."
            });
        }
        return successCreated(res, result)
    });
};

// verifyOtp
export const verifyOtp = async (req: Request, res: Response) => {
    const { phone,isPhoneVerify,isEmailVerify, name,photoURL, email, otp, provider, providerId, fcmToken, deviceType, countryISOCode, countryCode  } = req.body;

    // Validate if either email or phone is provided
    if (!email && !phone) {
        return res.status(400).json({
            code: "MISSING_FIELDS",
            message: "Either email or phone must be provided.",
        });
    }

    // Build the query dynamically based on available fields
    const query: any = {};
    
    if (email) query.email = email.toLowerCase();
    if (phone) query.phone = phone;

    handleUserVerification(query, { email,name,photoURL, phone, otp, provider, providerId, fcmToken, deviceType, countryISOCode, countryCode,isPhoneVerify,isEmailVerify }, (error:any, result:any) => {
        if (error) {
            return res.status(500).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successResponse(res,"Verify Successfuuly.",result)
    });
};


export const generateAgoraToken = async(req: Request, res: Response) => {
    // const {channelName, uid} = req.body;
    const channelName = uuidv4();   
    const uid = 0;
    const userId = req.user.userId;
    const chatId = req.params.chatId;
    const body = req.body;

    // if(!channelName || !uid){
    //     return res.status(400).json({error: "channelName and uid are required."})
    // }
    
    generateAgoraTokenLogic(userId, channelName, uid,chatId,body,(error, result) => {
        if(error){
            return res.status(error.status).json({
                status: error?.status,
                code: error?.code,
                message: error?.message
            })
        }

        return successResponse(res,"Token genrate successfully.",result)
    })
}

export const getAgoraAppId = async(req:Request, res: Response)=>{
    getAgoraAppIdLogic((error, result) => {
        if(error){
            return res.status(error.status).json({
                status: error?.status,
                code: error?.code,
                message: error?.message
            })
        }

        return successResponse(res,"Token genrate successfully.",result)
    })
}
