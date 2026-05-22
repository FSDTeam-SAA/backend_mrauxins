
import {Request, Response} from "express";
import { successCreated } from "../../helper/apiResponse";
import { createReportUser, listsReportedUser } from "../../domain/models/reportuser.model";

export const reportUser = async (req: Request, res: Response) => {
    
    const reportedBy = req.user.userId;


    createReportUser(reportedBy,req.body,(error, result) => {
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

export const getReportedUser = async (req: Request, res: Response) => {
    
    const reportedBy = req.user.userId;


    listsReportedUser((error, result) => {
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