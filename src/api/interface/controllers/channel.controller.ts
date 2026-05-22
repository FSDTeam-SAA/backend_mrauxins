import {Request, Response} from "express"
import { successCreated, successResponse } from "../../helper/apiResponse";
import { addMemberToChannelLogic, createChannelLogic, deleteChannelLogic, getAllChannelsLogic, getChannelDetailsLogic, joinChannelLogic, leaveChannelLogic, removeMemberFromChannelLogic, sendMessageToChannelLogic, updateChannelDetailsLogic } from "../../domain/models/channel.model";

// create channel
export const createChannel = async (req: Request, res: Response) => {
    const {channelName } = req.body;
    const creatorId = req.user.userId;
    const files = req.files as Express.Multer.File[];

    if(!channelName){
        res.status(400).json({message: "channelName are required."})
    }

    createChannelLogic(req.body,creatorId,files,(error, result) => {
        if(error){
            return res.status(error?.status).json({
                status: error?.status,
                code: error?.code,
                message: error?.message
            })
        }
        return successResponse(res,"Channel created.", result)
    })
}

export const getChannelDetails = async(req: Request, res: Response) => {
    const {channelId} = req.params;
    const userId = req.user.userId;

    getChannelDetailsLogic(channelId,userId,(error, result) => {
        if(error){
            return res.status(error.status).json({
                status: error?.status,
                code : error?.code,
                message: error?.message,
                data:error?.data
            })
        }
        return successResponse(res,"Channel Detail.",result)
    })
}


export const listChannels = async(req: Request, res: Response) => {
    const userId = req.user.userId;
    // privacy = private | public
    const { privacy, search } = req.query;

    getAllChannelsLogic(userId, String(privacy), String(search), (error, result) => {
        if(error){
            return res.status(error.status).json({
                status: error?.status,
                code : error?.code,
                message: error?.message,
                data:error?.data
            })
        }
        return successResponse(res,"List of channel.",result)
    })
}

export const joinChannel = async(req: Request, res: Response) => {
    const {channelId} = req.params;
    const {inviteLink} = req.body;
    const userId = req.user.userId;
    
    joinChannelLogic(channelId, inviteLink,userId, (error, result) => {
        if(error){
            return res.status(error?.status).json({
                status: error?.status,
                code : error?.code,
                message: error?.message
            })
        }
        return successCreated(res,result)
    })
}


export const leaveChannel = async(req: Request, res: Response) => {
    const {channelId} = req.params;
    const userId = req.user.userId;

    leaveChannelLogic(channelId,userId, (error, result) => {
        if(error){
            return res.status(error?.status).json({
                status: error?.status,
                code : error?.code,
                message: error?.message
            })
        }
        return successCreated(res,result)
    })
}



export const addMemberToChannel = async(req: Request, res: Response)=>{
    const {channelId} = req.params;
    const userId = req.user.userId;
    const {memberId} = req.body;

    addMemberToChannelLogic(channelId,userId,memberId, (error, result) => {
        if(error){
            return res.status(error?.status).json({
                status: error?.status,
                code : error?.code,
                message: error?.message
            })
        }
        return successCreated(res,result)
    })
}

export const removeMemberFromChannel = async(req: Request, res: Response)=>{
    const {channelId} = req.params;
    const userId = req.user.userId;
    const {memberId} = req.body;

    removeMemberFromChannelLogic(channelId,userId,memberId, (error, result) => {
        if(error){
            return res.status(error?.status).json({
                status: error?.status,
                code : error?.code,
                message: error?.message
            })
        }
        return successCreated(res,result)
    })
}

export const generateInviteLink = async(req: Request, res: Response) => {
    return successCreated(res,"Link generated successfully.")
}

export const deleteChannel = async(req: Request, res: Response) => {
    const {channelId} = req.params;
    const userId = req.user.userId;

    deleteChannelLogic(channelId,userId,(error, result) =>{
        if(error){
            return res.status(error?.status).json({
                status: error?.status,
                code : error?.code,
                message: error?.message
            })
        }
        return successCreated(res,result)
    })
}

export const updateChannelDetails = async(req: Request, res: Response) => {
    const {channelId } = req.params;
    const reqBody = req.body;
    const files = req.files as Express.Multer.File[];
    const userId = req.user.userId;

    updateChannelDetailsLogic(channelId, reqBody,files,userId, (error, result) =>{
        if(error){
            return res.status(error?.status).json({
                status: error?.status,
                code : error?.code,
                message: error?.message
            })
        }
        return successCreated(res,result)
    })
}


export const sentMessageToChannel = (req: Request, res: Response) => {
    const { channelId, content, type, fileUrls } = req.body;
    const sender = req.user.userId;
    const files = req.files as Express.Multer.File[];

    // Validate required fields
    if (!channelId || !sender || !content || !type) {
        return res.status(400).json({
            code: "INVALID_PAYLOAD",
            message: "Missing required fields.",
        })
    }

    sendMessageToChannelLogic(
        { channelId, content, type, sender, fileUrls, files },
        (error, result) => {
            if (error) {
                return res.status(error.status).json({
                    code: error?.code,
                    message: error?.message
                });
            }
            return successResponse(res, "Message sent successfully.", result)
        }
    );
};
