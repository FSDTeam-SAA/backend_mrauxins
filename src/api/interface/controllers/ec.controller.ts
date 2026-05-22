import {Request, Response} from "express"
import { getPublicKeyDetails, saveECkeysToDB } from "../../domain/models/ec.key.model";
import { successResponse } from "../../helper/apiResponse";

export const saveEcKeys = async(req: Request, res: Response ) => {
    const userId = req.params.userId;
    
    saveECkeysToDB(userId,(error, result) => {
        if(error){
            return res.status(400).json({
                code: "GROUP_NAME_REQUIRED",
                message: "Group name is required.",
            });
        }
        return successResponse(res, "Key saved successfully.", result)
    })
}


export const getPublicKey = async(req: Request, res: Response) => {
    const userId = req.params.userId;

    getPublicKeyDetails(userId,(error:any, result:any)=>{
        if(error){
            return res.status(400).json({
                code: "GROUP_NAME_REQUIRED",
                message: "Group name is required.",
            });
        }
        return successResponse(res,"Get public key.", result)
    })
}