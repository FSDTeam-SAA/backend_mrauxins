import { BlockedUser } from "../schema/blockuser.schema";
import reportuserSchema, { REPORT_REASONS } from "../schema/reportuser.schema";


export const createReportUser = async(
    reportedBy: string,
    reqBody:any,
    callback:(error:any, result:any) => void
)=>{
    try {
        const { reportedUser, reason, description } = reqBody;
        
        // Validate reason
        if (!REPORT_REASONS.includes(reason)) {
            return callback({
                status:400,
                code:"INVALID_REPORT",
                message: "Invalid report reason"
            },null)
        }

        if(!reportedUser || !reason){
            return callback({
                status:400,
                code:"INVALID_FIELD",
                message:"all field are required."
            },null)
        }

        const newReport = await reportuserSchema.create({
            reportedBy,
            reportedUser,
            reason,
            description
        })
        // const isBlockedReportUser = await BlockedUser.findOne({
        //     blockerId: reportedBy, 
        //     blockedId: reportedUser
        // })
        // if(isBlockedReportUser){
        //     isBlockedReportUser.blockType = "report";
        //     await isBlockedReportUser.save();
        // }else{
        //     await new BlockedUser({
        //         blockerId: reportedBy, 
        //         blockedId: reportedUser, 
        //         blockType:"report" 
        //     }).save();
        // }

        await newReport.save();
        return callback(null, "Report submit successfully.")
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
}


export const listsReportedUser = async(
    callback:(error:any, result:any) => void
)=>{
    try {
        const reports = await reportuserSchema.find()
            .populate("reportedBy", "userName email")
            .populate("reportedUser", "userName email");
        return callback(null, reports);
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
}