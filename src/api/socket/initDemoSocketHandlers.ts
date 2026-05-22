import { Server } from 'socket.io';
import mongoose from 'mongoose';
import userSchema from '../domain/schema/user.schema';
import { loggerMsg } from '../lib/logger';

import { registerConnectionHandlers } from './handlers/connection';
import { registerMessageHandlers } from './handlers/messages';
import { registerSavedMessagesHandlers } from './handlers/savedMessages';
import { registerCallHandlers } from './handlers/calls';
import { registerSettingsHandlers } from './handlers/settings';

interface UserSocketMap {
  [userId: string]: string;
}

interface UserOnlineStatusMap {
  [userId: string]: boolean;
}

interface UserIsInCall {
  [userId: string]: boolean;
}

interface ReceiverOpenChatMap {
  [userId: string]: {
    [chatId: string]: boolean;
  };
}

export const userSocketMap: UserSocketMap = {};
export const userOnlineStatusMap: UserOnlineStatusMap = {};
export const userSocketInCall: UserIsInCall = {};
export const receiverOpenChat: ReceiverOpenChatMap = {};

export async function getNickNameDetails(participantId: string, senderId: string) {
  const receiver = await userSchema.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(participantId) } },
    {
      $project: {
        _id: 1,
        matchedNickname: {
          $filter: {
            input: "$nicknames",
            as: "nickname",
            cond: {
              $and: [
                { $eq: ["$$nickname.contactUserId", new mongoose.Types.ObjectId(senderId)] },
              ]
            }
          }
        }
      }
    }
  ]);
  return receiver;
}

export const initDemoSocketHandlers = (io: Server) => {
  io.on("connection", (socket) => {
    console.log(`New User Connected: ${socket.id}`);
    loggerMsg("connection done...", "info");

    registerConnectionHandlers(io, socket);
    registerMessageHandlers(io, socket);
    registerSavedMessagesHandlers(io, socket);
    registerCallHandlers(io, socket);
    registerSettingsHandlers(io, socket);
  });
};
