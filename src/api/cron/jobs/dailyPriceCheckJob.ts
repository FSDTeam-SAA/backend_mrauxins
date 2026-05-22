import schedule from 'node-schedule';
import messageSchema from '../../domain/schema/message.schema';
import chatSchema from '../../domain/schema/chat.schema';
import { getIo } from '../../../infrastructure/webserver/express/v1';
import { userSocketMap } from '../../socket/initDemoSocketHandlers';
import userSchema from '../../domain/schema/user.schema';

// Function to schedule a daily job at 6 AM
export const dailyPriceCheckJob = () => {

    schedule.scheduleJob('0 6 * * *', async () => {
        
        console.log('Running daily job at 6 AM');

    });


    schedule.scheduleJob("*/10 * * * * *", async () => { // Runs every 10 seconds
        const io = getIo()
        const now = new Date();

        // Step 1: Get chats that have messageAutoDeleteTime set(not null)
        const chatsWithAutoDelete = await chatSchema.find({
            messageAutoDeleteTime: { $ne: null},
        }).select('_id participants messageAutoDeleteTime messageAutoDeleteStartTime');

        for (const chat of chatsWithAutoDelete) {
                if(chat.messageAutoDeleteTime !== null){
                const expiryTimeInMs = chat.messageAutoDeleteTime * 1000; // Convert seconds to milliseconds

                // Step 2: Get expired messages for this chat
                const expiredMessages = await messageSchema.find({
                    chatId: chat._id,
                    createdAt: {
                        $gte: chat.messageAutoDeleteStartTime,
                        $lte: new Date(now.getTime() - expiryTimeInMs)
                    }
                });

                if(expiredMessages.length > 0){
                    const messageIds = expiredMessages.map(msg => msg._id);
                    await messageSchema.deleteMany({_id: {$in : messageIds}});

                    for (const element of chat.participants) {
                        const receiverSocketId = userSocketMap[element.toString()];
                        if (receiverSocketId) {
                            io.to(receiverSocketId).emit("message_auto_deleted", {
                                messageIds: messageIds,
                                chatId: chat._id,
                            });
                        }
                    }
                }
            }
        }
    });

    schedule.scheduleJob("*/2 * * * *", async () => {
        const io = getIo();
        const now = new Date();
        const oneMinuteAgo = new Date(now.getTime() - 1 * 60 * 1000);

        const users = await userSchema.find({ isDeleted: false });

        const offlineUserIds = new Set();

        for (const element of users) {
            if (element.isOnline && element.lastOnline !== null) {
            const lastOnline = new Date(element.lastOnline);

            
            console.log(`lastOnline     : ${lastOnline}`);
            console.log(`oneMinuteAgo   : ${oneMinuteAgo}`);

            if (lastOnline <= oneMinuteAgo) {
                console.log("❌ User should be marked OFFLINE");

                await userSchema.updateOne(
                { _id: element._id, isDeleted: false },
                { $set: { isOnline: false, lastSeen: now } }
                );

                offlineUserIds.add(String(element._id));
                
            } else {
                console.log("✅ User is still ONLINE");
            }
            }
        }

        // Now notify remaining online users (excluding the ones just updated)
        const stillOnlineUsers = await userSchema.find({
            isDeleted: false,
            isOnline: true
        });


            offlineUserIds.forEach(offlineUserId => {
                stillOnlineUsers.forEach((user:any) => {
                    if (String(user._id) !== String(offlineUserId)) {
                    const socket = userSocketMap[user._id.toString()];
                        if (socket) {
                            io.to(socket).emit("user-online-success", {
                                userOnline: "cron",
                                userId: offlineUserId, // ✅ user who went offline
                                isOnline: false,
                                lastSeen: now
                            });
                        }
                    }
                });
            });
    });
};

// // 2. Update them in bulk
        // const result = await userSchema.updateMany(
        //     {
        //         _id: { $in: usersToUpdate.map(u => u._id) } // safer reuse
        //     },
        // {
        //     $set: {
        //             isOnline: false,
        //             lastSeen: now
        //         }
        //     }
        // );

        // // 3. Emit event to each user via socket
        // if (result.modifiedCount > 0) {
        // console.log(`${result.modifiedCount} user(s) set to offline.`);

        // usersToUpdate.forEach((user:any) => {
        //     const socket = userSocketMap[user._id.toString()];
        //     if (socket) {
        //     io.to(socket).emit("user-online-success", {
        //         isOnline: false,
        //         lastSeen: now
        //     });
        //     }
        // });
        // }