import {Request, Response} from "express"
import {  successCreated, successResponse } from "../../helper/apiResponse";
import { getSavedMessagesLogic, saveMessageLogic, sendSavedMessageLogic, unsaveMessageLogic } from "../../domain/models/savedmessages.model";
import { loggerMsg } from "../../lib/logger";
import mongoose from "mongoose";


export const sendSavedMessages = (req: Request, res: Response) => {
    const { content, type, fileUrls, messageId, replyToMessageId, url, size } = req.body;
   
    loggerMsg(`sendSavedMessages Media payload......\n${JSON.stringify(req.body)}`,'debug')
    const sender = req.user.userId;
    const files = req.files as Express.Multer.File[];


    // Validate required fields
    if ( !sender /* || !content */ || !type) {
        return res.status(400).json({
            code: "INVALID_PAYLOAD",
            message: "Missing required fields.",
        })
    }
    const tempMessageId = messageId || new mongoose.Types.ObjectId().toString();
    sendSavedMessageLogic(
        {content, type, sender, fileUrls, files, tempMessageId, replyToMessageId, url, size },
        (error, result) => {
            if (error) {
                return res.status(error.status).json({
                    status:error?.status,
                    code: error?.code,
                    message: error?.message
                });
            }
            return successResponse(res, "Message sent successfully.", result)
        }
    );
};

export const saveMessage = (req: Request, res: Response) => {
  const userId = req.user.userId;
  const { messageId,chatId,tempMessageId,isTempMessage,content,type } = req.body;
    console.log("============> req.body",JSON.stringify(req.body));
    
  saveMessageLogic(userId, messageId,chatId,tempMessageId,isTempMessage,content,type, (error, result) => {
      if (error) {
        return res.status(error.status).json({
            status:error?.status,
            code: error?.code,
            message: error?.message
        });
      }
      return successCreated(res, result)
  });
};

export const getSavedMessages = (req: Request, res: Response) => {
  const userId = req.user.userId;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const searchTerm = (req.query.search as string) || ""

  getSavedMessagesLogic(userId, page, limit,searchTerm, (error, result) => {
      if (error) {
        return res.status(error.status).json({
            status:error?.status,
            code: error?.code,
            message: error?.message,
            data:error?.data
        });
      }
      return successResponse(res,"Get all saved messages.",result)
  });
};

export const unsaveMessage = (req: Request, res: Response) => {
  const userId = req.user.userId;
  const messageId = req.query.messageId as string;
  // const { messageId } = req.body;

  unsaveMessageLogic(userId, messageId, (error, result) => {
      if (error) {
        return res.status(error.status).json({
            status:error?.status,
            code: error?.code,
            message: error?.message
        });
      }
      return successCreated(res,result)
  });
};