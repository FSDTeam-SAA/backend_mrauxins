import e, { Request, Response } from "express"
import mongoose from "mongoose";
import { addOrUpdateNickname, adsConfigLogic, changeEmailAddress, getAllUsersLogic, getSingleUserDetailsLogicApi, isUserNameExist, updateContacts, updateNicknameToggle, updateUserProfileLogic, uploadMediaOnS3Bucket, userAccountDeleted, usersNewRefreshToken, verifyEmailAddress } from "../../domain/services/user.service";
import { ErrorResponse, successCreated, successResponse } from "../../helper/apiResponse";
import { loggerMsg } from "../../lib/logger";
import userSchema from "../../domain/schema/user.schema";


export const adsConfig = async (req: Request, res: Response) => {
    adsConfigLogic((error:any, result:any) => {
        if(error){
            return res.status(error.status).json({
                status: error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successResponse(res, "Ads Config.", result)
    })
}

export const updateUserProfile = async (req: Request, res: Response) => {
    const userId = req.user.userId;
    const updates = req.body;
    const files = req.files as Express.Multer.File[];

    // Validate `userId` format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({
            code: "INVALID_USER_ID",
            message: "Invalid user ID format",
        });
    }

    // Validate payload
    const allowedFields = ["email","phone","bio","name","countryISOCode","countryCode","userName","isProfileSetUp","isStopNotification","isMuteNotification","profilePrivacy"];
    const invalidFields = Object.keys(updates).filter((key) => !allowedFields.includes(key));

    if (invalidFields.length > 0) {
        return res.status(400).json({
            code: "INVALID_FIELDS",
            message: "Some fields are not allowed for update",
            invalidFields,
        });
    }

    // Proceed to update logic
    updateUserProfileLogic(userId, updates, files, (error:any, result:any) => {
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successResponse(res,"Update Succeddfully.", result)
    });
};

export const getAllUsers = async(req: Request, res: Response) => {
    const { page = 1, limit = 10, search, contactNumbers } = req.query;
    const pagination = {
        page : parseInt(page as string, 10),
        limit: parseInt(limit as string, 10)
    }

    const loggedInUserId = req.user.userId;

    let parsedContactNumbers: string[] = [];
    if (contactNumbers) {
        try { parsedContactNumbers = JSON.parse(contactNumbers as string); } catch {}
    }

    getAllUsersLogic(
        loggedInUserId,
        pagination,
        search as string,
        parsedContactNumbers,
    (error:any, result:any) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message,
                data:error?.data
            });
        }
        return successResponse(res,"Get All Users.",result)
    })
}


export const getDetailsOfSingleUser = async(req: Request, res: Response) => {
    const userId = req.user.userId;
    getSingleUserDetailsLogicApi(userId,(error, result) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successResponse(res,"User Details.",result)
    })
}

export const uploadMediaOnS3 = async(req: Request, res: Response) => {
    const files = req.files;
    uploadMediaOnS3Bucket(files,(error, result) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            })
        }
        return successResponse(res,"Media upload successfully.",result)
    })
}

export const syncContact = async (req: Request, res: Response) => {
    const userId = req.user.userId;
    updateContacts(userId,req.body,(error:any, result:any) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            })
        }
        return successResponse(res, "Contact update successfully.",result)
    })
}


export const requestToEmailChange = async(req: Request, res: Response) =>{
    const email = req.body.email;
    const userId = req.user.userId;
    changeEmailAddress(userId, email,(error:any, result:any) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            })
        }
        return successCreated(res,result)
    })
}




export const verifyOtpAndChangeEmail = async(req: Request, res: Response) =>{
    const userId = req.user.userId;
    const body = req.body;
    verifyEmailAddress(body,userId,(error:any, result:any) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            })
        }
        return successResponse(res,"Email update successfully.", result)
    })
}


export const accountDeleted = async(req: Request, res: Response) => {
 
    const userId = req.user.userId;
    const body = req.body;
    userAccountDeleted(userId,(error:any, result:any) => {
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

export const checkUserName = async(req:Request, res: Response) => {
    const userName = req.body.userName;
    const userId = req.user.userId;

    isUserNameExist(userName,userId,(error:any,result:any) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            })
        }
        return successResponse(res,"Check username.", result)
    })
}


export const newRefreshToken = async (req:Request, res: Response) => {
    const userId = req.user.userId;

    usersNewRefreshToken(userId,(error:any, result:any) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            })
        }
        return successResponse(res, "Refresh tokens.",result)
    })
}

export const isExist = async (req: Request, res: Response) => {
    const mobile = req.body.mobile;
    const countryCode = req.body.countryCode;
    const userId = req.user.userId;
    try {
        const isUserExist = await userSchema.findOne(
            {_id: userId}
        );
        if (isUserExist?.phone === mobile && isUserExist?.countryCode === countryCode) {
            return successResponse(res, "User exists.",{
                exists: true 
            })
        } else {
            return successResponse(res, "User does not exist.",{
                exists: false 
            })
        }
    } catch (error) {
        return ErrorResponse(res, error)
    }
}

export const setNickname = async (req: Request, res: Response) => {
    const userId = req.user.userId;
    const { contactUserId, nickName } = req.body;

    addOrUpdateNickname(userId,contactUserId,nickName,(error:any, result:any) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            })
        }
        // "Nickname set successfully.",
        return successCreated(res,  result);
    })
}

export const updateToggle = async(req: Request, res: Response) => {
    const userId = req.user.userId;
    const { contactUserId , isActiveNickname} = req.body;

    updateNicknameToggle(userId,contactUserId,(error:any, result:any) => {
        if(error){
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            })
        }
        return successResponse(res, `${isActiveNickname ? "Nickname enabled successfully." : "Nickname disabled successfully."}`, result);
    })
}
