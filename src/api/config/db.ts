import mongoose from 'mongoose';
import { env } from '../../infrastructure/env';

const connectDB = async (): Promise<void> => {
  try {
    const MONGO_URI = env.MONGO_URI;
    console.log("Connecting to MongoDB at:", MONGO_URI);

    if (!MONGO_URI) {
      throw new Error("Mongo URI is not defined in environment variables");
    }

    await mongoose.connect(MONGO_URI,{
      connectTimeoutMS: 60000,
      // serverSelectionTimeoutMS: 5000,  // Reduce connection timeout
      // socketTimeoutMS: 45000,
    }); // No extra options needed in Mongoose 6+

    console.log("✅ MongoDB connected successfully!");
  } catch (error: any) {
    console.error("❌ MongoDB connection error:", error.message);

    if (error.name === "MongoNetworkError") {
      console.error("❌ Check if MongoDB is running and accessible!");
    } else if (error.message.includes("authentication failed")) {
      console.error("❌ Authentication failed! Check your username and password.");
    }

    process.exit(1);
  }
};

export default connectDB;
