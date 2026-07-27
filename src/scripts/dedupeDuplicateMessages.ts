// One-off migration: dedupes the messages collection before the
// `unique: true` index on `messageId` (message.schema.ts) can be created —
// Mongo refuses to build a unique index while duplicate values exist.
//
// Root cause of the duplicates: the REST and Socket.IO send-message paths
// (chat.model.ts's sendMessageLogic and messages.ts's "send_message" socket
// handler) both independently saved a message and sent a push notification
// for the same client-generated messageId, with no idempotency guard. That
// gap is now closed (savedMessageOneToOne detects the duplicate key and
// skips re-delivery), but pre-existing duplicate rows from before the fix
// still need to be cleaned up here.
//
// For each messageId with more than one row:
//   - if a chat's or channel's `lastMessage` points at one of the duplicate
//     rows, that row is kept (deleting it would leave a dangling reference)
//   - otherwise the earliest-created row (lowest _id) is kept, matching the
//     original send order
// All other rows for that messageId are deleted. replies/forwards reference
// messages by the `messageId` string (not `_id`), so they resolve correctly
// regardless of which duplicate row survives.
//
// Run once, before deploying the schema change that adds the unique index:
//   npm run migrate:dedupe-messages

import mongoose from "mongoose";
import connectDB from "../api/config/db";
import messageSchema from "../api/domain/schema/message.schema";
import chatSchema from "../api/domain/schema/chat.schema";
import { Channel } from "../api/domain/schema/channel.schema";

const run = async () => {
    await connectDB();

    const duplicates = await messageSchema.aggregate([
        { $match: { messageId: { $exists: true, $ne: null } } },
        {
            $group: {
                _id: "$messageId",
                ids: { $push: "$_id" },
                count: { $sum: 1 },
            },
        },
        { $match: { count: { $gt: 1 } } },
    ]);

    console.log(`Found ${duplicates.length} messageId value(s) with duplicates.`);

    const referencedIds = new Set<string>();
    for (const doc of await chatSchema.find({ lastMessage: { $ne: null } }).select("lastMessage")) {
        if (doc.lastMessage) referencedIds.add(doc.lastMessage.toString());
    }
    for (const doc of await Channel.find({ lastMessage: { $ne: null } }).select("lastMessage")) {
        if (doc.lastMessage) referencedIds.add(doc.lastMessage.toString());
    }

    let deletedCount = 0;
    for (const dup of duplicates) {
        const rows = await messageSchema
            .find({ _id: { $in: dup.ids } })
            .sort({ _id: 1 });

        const keepIndex = rows.findIndex(r => referencedIds.has(r._id.toString()));
        const keep = keepIndex >= 0 ? rows[keepIndex] : rows[0];
        const staleRows = rows.filter(r => r._id.toString() !== keep._id.toString());
        if (staleRows.length === 0) continue;

        await messageSchema.deleteMany({ _id: { $in: staleRows.map(r => r._id) } });
        deletedCount += staleRows.length;
        console.log(`  messageId ${dup._id}: kept ${keep._id}${keepIndex >= 0 ? " (referenced by lastMessage)" : ""}, deleted ${staleRows.length}`);
    }

    console.log(`Done. Deleted ${deletedCount} duplicate message row(s).`);
    await mongoose.disconnect();
    process.exit(0);
};

run().catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
});
