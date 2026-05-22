import {Request, Response} from "express"
import { successResponse } from "../../helper/apiResponse";
import {  getCallHistoryListsLogic, updateCallStatusLogic } from "../../domain/models/callhistory.model";



export const updateCallStatus = async(req:Request, res: Response) => {
    const {callHistoryId, callStatus} = req.body

    updateCallStatusLogic(callHistoryId,callStatus,(error, result)=>{
        if (error) {
            return res.status(error.status).json({
                status:error?.status,
                code: error?.code,
                message: error?.message
            });
        }
        return successResponse(res,"Call rejected.", result)
    })
}

export const getCallHistoryLists = async (req: Request, res: Response) => {
    try {
        const userId = req.user.userId;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const status = req.query.status;
        const callType = req.query.callType;

        getCallHistoryListsLogic(userId, page, limit,String(status),String(callType),(error, result) => {
            if(error){
                return res.status(error.status).json({
                    status:error?.status,
                    code: error?.code,
                    message: error?.message
                });
            }
            return successResponse(res, "Call History List.", result);
        });

       

    } catch (error) {
        return res.status(500).json({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
    }
};



