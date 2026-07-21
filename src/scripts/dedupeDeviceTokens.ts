// One-off migration: dedupes the deviceToken collection before the
// `unique: true` index (devicetoken.schema.ts) can be created — Mongo
// refuses to build a unique index while duplicate values exist.
//
// For each deviceToken value with more than one row, keeps the most
// recently updated row (the most likely to reflect the current owner of
// that physical device) and deletes the rest.
//
// Run once, before deploying the schema change that adds the unique index:
//   npm run migrate:dedupe-device-tokens

import mongoose from "mongoose";
import connectDB from "../api/config/db";
import { deviceToken } from "../api/domain/schema/devicetoken.schema";

const run = async () => {
    await connectDB();

    const duplicates = await deviceToken.aggregate([
        {
            $group: {
                _id: "$deviceToken",
                ids: { $push: "$_id" },
                count: { $sum: 1 },
            },
        },
        { $match: { count: { $gt: 1 } } },
    ]);

    console.log(`Found ${duplicates.length} device token value(s) with duplicates.`);

    let deletedCount = 0;
    for (const dup of duplicates) {
        // Keep the most recently updated row; delete the rest.
        const rows = await deviceToken
            .find({ _id: { $in: dup.ids } })
            .sort({ updatedAt: -1 });
        const [, ...staleRows] = rows;
        if (staleRows.length === 0) continue;

        await deviceToken.deleteMany({ _id: { $in: staleRows.map(r => r._id) } });
        deletedCount += staleRows.length;
        console.log(`  deviceToken ${dup._id}: kept 1, deleted ${staleRows.length}`);
    }

    console.log(`Done. Deleted ${deletedCount} duplicate device token row(s).`);
    await mongoose.disconnect();
    process.exit(0);
};

run().catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
});
