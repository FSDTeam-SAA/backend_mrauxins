const mongoose = require("mongoose");
const messageSchema = require("./api/domain/schema/message.schema");

const checkDatabaseConnection = async () => {
    try {
        const connection = mongoose.connection;
        if (connection.readyState === 1) {
            console.log("Database connection is already established.");
            return true;
        }

        await mongoose.connect("mongodb://localhost:27017/telegram-app");
        console.log("Database connection established.");
        return true;

    } catch (error) {
        console.error("Database connection failed:", error.message);
        return false;
    }
}
const backfillDefaultValues = async () => {
    try {
        const isConnected = await checkDatabaseConnection();
        if (!isConnected) {
            console.error("Exiting script: Unable to establish database connection.");
            return;
        }

        // Update all documents missing the `isDeleted` field
        const result = await messageSchema.updateMany(
            { isDeleted: { $exists: false } }, // Find documents where `isDeleted` is missing
            { $set: { isDeleted: false } }    // Set `isDeleted` to false
        );

        console.log(`Backfilled ${result.nModified} documents with default values.`);
        await mongoose.disconnect();
    } catch (error) {
        console.error("Error during backfill:", error);
    }
};

backfillDefaultValues();