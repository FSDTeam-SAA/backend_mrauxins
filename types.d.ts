import { Request } from 'express';

// Extend the Request interface to include a `user` property
declare global {
    namespace Express {
        interface Request {
            user?: any; // or you can type it specifically, e.g., `user?: User`
        }
    }
}


export interface UserResponse {
    _id: string;
    name: string;
    email: string;
    phone: string;
    userName: string;
    isVerified: boolean;
    providerId: string | null; // or undefined if it's optional
    providerName: string | null;
    isOnline: boolean;
    lastSeen: Date | null;
    createdAt: Date;
    updatedAt: Date;
    bio: string | null;
    profilePicture: string | null; // Use the type based on your data
    countryISOCode: string;
    countryCode: string;
  }