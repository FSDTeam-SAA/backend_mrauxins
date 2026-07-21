import { Request, Response, NextFunction } from "express";
// import { AuthService } from "../services/auth.service";
import { env } from "../../infrastructure/env";
import jwt from 'jsonwebtoken'

declare global {
    namespace Express {
        interface Request {
            user?: any;  // Use `any` or replace with the correct type for `user`
        }
    }
}

// export const validateAuth = async (req: Request, res: Response, next: NextFunction) => {
//     const token = req.header("Authorization")?.split(" ")[1];

//     if (!token) {
//         return res.status(400).json({
//             status: "error",
//             code: "AUTH_TOKEN_MISSING",
//             message: "Authentication token is missing. Please log in to continue."
//         });
//     }

//     try {
//         const payload = await AuthService.verifyToken(token);
//         req.user = payload;
//         next();
//     } catch (error) {
//         // Token is invalid or expired
//         return res.status(403).json({
//             status: "error",
//             code: "AUTH_TOKEN_EXPIRED",
//             message: "Your session has expired. Please log in again."
//         });
//     }
// };

// export const validateAuthNoAuth = async (req: Request, res: Response, next: NextFunction) => {
//     const token = req.header("Authorization")?.split(" ")[1];

//     if (!token) {
//         next();
//     } else {
//         try {
//             const payload = await AuthService.verifyToken(token);
//             req.user = payload;
//             next();
//         } catch (error) {
//             // Token is invalid or expired
//             next();
//         }
//     }
// };


// Attaches req.user when a valid token is present, but never blocks the request —
// lets routes prefer the authenticated userId while still falling back to a legacy
// unauthenticated caller during a phased rollout (see devicetoken.controller.ts).
export const optionalAuth = async(req:Request, res:Response, next: NextFunction) =>{
    let token;

    if (req.headers.authorization) {
        if (req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }
        else {
            token = req.headers.authorization;
        }
    }

    if (!token) {
        return next();
    }

    try {
        req.user = jwt.verify(token, "supersecretkeys" as string);
    } catch (error) {
        // invalid/expired token on an optional-auth route — fall through unauthenticated
        // instead of rejecting, so the legacy fallback path still works
    }
    next()
}

export const protectedRoute = async(req:Request, res:Response, next: NextFunction) =>{
    let token;
    let message = 'Not authorized to access this route.';
    let msg = 'The user belonging to this token does not exist.';

    // check header for authorization
    if (req.headers.authorization) {
        if (req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }
        else {
            token = req.headers.authorization;
        }
    }

    if (!token) {
        res.status(401).json({ message: message });
        return
    }

    try {
        const decoded = jwt.verify(token, "supersecretkeys" as string);
        req.user = decoded;
        next()
    } catch (error) {
        res.status(403).json({ message: "Invalid or expired token" })
    }
}