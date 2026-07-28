import {S3Client, PutObjectCommand, ObjectCannedACL, HeadObjectCommand} from "@aws-sdk/client-s3"
import multer from "multer"
import multerS3 from "multer-s3"; 

import path from "path"
import fs from "fs"
import { logger, loggerMsg } from "../lib/logger"
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import {RtcTokenBuilder, RtcRole} from "agora-token";
import admin from "../services/firebase";
import { deviceToken } from "../domain/schema/devicetoken.schema";
import { env } from "../../infrastructure/env";
import crypto from "crypto";
import axios from "axios";
import mongoose from "mongoose";

const s3 = new S3Client({
    region:env.AWS_REGION || "",
    credentials:{
       accessKeyId: env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey:env.AWS_SECRET_ACCESS_KEY || "",
    }
});

// Function to get file size from S3
export const getFileSizeFromS3 = async (bucket: string, key: string) => {
  const head = await s3.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
  return head.ContentLength || 0; // file size in bytes
};

const upload = multer({
    storage: multerS3({
        s3,
        bucket: env.AWS_S3_BUCKET_NAME!,
        // acl:"public-read",  // "private"
        metadata:(req, file,cb) => {
            cb(null, {fieldName: file.fieldname});
        },
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: (req, file, cb) => {
            // Get file extension
            const fileExtension = file.originalname.split(".").pop()?.toLowerCase() || "unknown";

            // Categorize based on file type
            let folder = "others"   // // Default folder

            if(file.mimetype.startsWith("image/") && file.mimetype !== "image/gif") folder = "images";
            else if(file.mimetype === "image/gif") folder = "gif";
            else if(file.mimetype.startsWith("video/")) folder = "videos";
            else if(file.mimetype.startsWith("audio/")) folder = "audio";
            else if (
                file.mimetype === "application/pdf" || 
                file.mimetype.startsWith('application/msword') || 
                file.mimetype.startsWith('application/vnd.openxmlformats-officedocument') || 
                file.mimetype.startsWith("application/vnd.")) folder = "documents";

            // Generate file path: `users/{userId}/{folder}/{timestamp-filename}
            const sanitizedFileName = Buffer.from(`${Date.now()}-${file.originalname}`).toString("utf-8")   // Prevent encoding issues
            const fileName = `${folder}/${sanitizedFileName}`;
            cb(null, fileName)
        }
    }),
    limits: {fileSize: 50 * 1024 * 1024}
})



// Function to download and upload image to s3
export async function downloadImageUploadS3(imageUrl:string){
    try {
        const response = await axios.get(imageUrl, {responseType: "arraybuffer"})
        const buffer = Buffer.from(response.data, "binary");
        // Extract file extension
        const fileExtension = path.extname(imageUrl).split("?")[0] || ".jpg";

        // Define S3 key (path)
        const key = `uploads/${Date.now()}_${Math.random().toString(36).substring(7)}${fileExtension}`;

        const uploadParams = {
            Bucket: env.AWS_S3_BUCKET_NAME!,
            Key: key,
            Body: buffer,
            contentType:  response.headers["content-type"],
            // acl: "public-read", // Make file publicly accessible
            // ACL: ObjectCannedACL.public_read, // Make it viewable in the browser
        }

        await s3.send(new PutObjectCommand(uploadParams))
        // return `https://${env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
        return key
    } catch (error) {
        throw error
    }
}
export default upload;

export const uploadImagesFile = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            // const uploadDir = path.resolve(__dirname,String(env.IMAGES_PATH))
            
            let folder = "";
            const mimeType = file.mimetype;

            if(mimeType.startsWith('image/') && mimeType !== "image/gif"){
                folder = "images"
            }else if(mimeType === "image/gif"){
                folder = "gifs"
            }else if(mimeType.startsWith('video/')){
                folder = "videos"
            }else if(mimeType.startsWith('audio/')){
                folder = "audio"
            }else if(mimeType === "application/pdf" || mimeType.startsWith('application/msword') || mimeType.startsWith('application/vnd')){
                folder = "documents";
            }else{
                //@ts-ignore
                return cb(new Error('Unsupported file type'), false)
            }

            const uploadDir = path.resolve(__dirname,'../../assets',folder);
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            const mimeType = file.mimetype;
            let folder = "";

            // Assign folder based on mime type
            if (mimeType.startsWith('image/') && mimeType !== "image/gif") {
                folder = "images";
            }else if(mimeType === "image/gif"){
                folder = "gifs";
            } else if (mimeType.startsWith('video/')) {
                folder = "videos";
            } else if (mimeType.startsWith('audio/')) {
                folder = "audio";
            } else if (mimeType === "application/pdf" || mimeType.startsWith('application/msword') || mimeType.startsWith('application/vnd')) {
                folder = "documents";
            }

            // create the folder if the it does't exist
            const folderPath = path.resolve(__dirname, '../../assets/', folder);
            if(!fs.existsSync(folderPath)){
                fs.mkdirSync(folderPath, {recursive: true})
            }
            // Modify filename to include the folder name for easy reference
            // const modifiedFileName = `${folder}-${Date.now()}-${file.originalname}`;
            const modifiedFileName = path.join(`${folder}-${file.originalname}`);
            cb(null, modifiedFileName);
        }
    }),
    fileFilter: (req, file, cb) => {
        const allowedImagesExits = ['.png', '.jpg', '.jpeg', '.gif'];
        const allowedVideosExits = ['.mp4', '.mkv', '.avi'];
        const allowedAudioExits = ['.mp3', '.wav', '.aac'];
        const allowedDocsExits = ['.pdf','.doc', '.docx'];

        const ext = path.extname(file.originalname).toLowerCase();
    
        if (
            allowedImagesExits.includes(ext) || 
            allowedVideosExits.includes(ext) || 
            allowedAudioExits.includes(ext) || 
            allowedDocsExits.includes(ext)
        ) {
            cb(null, true); // Accept the file
        } else {
            cb(new Error("Unsupported file type....")); // Reject the file with an error
        }
    },
}).array("files")


// function to generate EC key pair
// export const generateECKeyPair = () => {
//     const {privateKey, publicKey} = crypto.generateKeyPairSync("ec",{
//         namedCurve: "prime256v1",
//         publicKeyEncoding: {
//             type: "spki",
//             format: "pem"
//         },
//         privateKeyEncoding: {
//             type:"pkcs8",
//             format:"pem"
//         }
//     })

//     // Define the paths
//     const keyDir = path.join(__dirname,"keys");
//     if(!fs.existsSync(keyDir)){
//         fs.mkdirSync(keyDir)    // Create directory if it doesn't exist
//     }
//     // save keys to files
//     fs.writeFileSync(path.join(keyDir,"ec_private_key.pem"), privateKey);
//     fs.writeFileSync(path.join(keyDir, "ec_public_key.pem"), publicKey);

//     loggerMsg("Ecc keys generated and saved successfully!")
//     console.log("Ecc keys generated and saved successfully!")
//     return {privateKey, publicKey}
// }

export const generateECKeyPair = () => {
    const {privateKey, publicKey} = crypto.generateKeyPairSync("rsa",{
        modulusLength: 2048,    // secure key length
        publicExponent: 0x10001, //Recommended exponent
        publicKeyEncoding: {
            type: "spki", // Recommended format for public key
            format: "der"
        },
        privateKeyEncoding: {
            type: "pkcs8", // Recommended format for private key
            format: "der",
            cipher: "aes-192-cbc", // Encrypt the private key
            passphrase: env.RSA_PASSPHRASE || "212MessengerIsGoingToBlowUpMinds" // Secure passphrase
        }
    })

    const privateKeyHex = privateKey.toString("hex")
    const publicKeyHex = publicKey.toString("hex");

    
    // logger.info("RSA keys generated successfully!","info")
    return {privateKey:privateKeyHex, publicKey:publicKeyHex}
}

export const generateAESKeys = () => {
    const aesKey = crypto.randomBytes(32);
    const base64AesKey = aesKey.toString("base64"); // Convert to Base64

    return base64AesKey;
};

interface EncryptedData {
    cipher: string;
    iv: string;
  }

  export const decryptMessage = (aeskey: string, plain_message:string) => {
    try {
        const aesKey = aeskey;
        const message = plain_message;
            const keyBuffer = Buffer.from(aesKey, 'base64'); // Convert key from hex
            const ivBuffer = crypto.randomBytes(16); // Generate a random IV (16 bytes)
            
            const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, ivBuffer);
            const encryptedBuffer = Buffer.concat([
                cipher.update(message, 'utf-8'),
                cipher.final(),
                ]);
            
                const authTag = cipher.getAuthTag(); // Get authentication tag

            const encryptedJson = {
                cipher: Buffer.concat([encryptedBuffer, authTag]).toString('base64'),
                iv: ivBuffer.toString('base64')
            }
           
            return encryptedJson
    } catch (error) {
        if(error instanceof Error){
            return error.message || "Failed message to encrypt"
        }
    }
  }


  export const decryptMessage_1 = (encryptedJson:string, aesKey:string) => {
    try {
        const { cipher, iv } = JSON.parse(encryptedJson);

        const key = Buffer.from(aesKey, 'utf-8').subarray(0, 32); // Ensure 32-byte key
        const ivBuffer = Buffer.from(iv, 'base64');
        const cipherBuffer = Buffer.from(cipher, 'base64');

        const authTag = cipherBuffer.slice(-16); // Extract last 16 bytes as auth tag
        const encryptedText = cipherBuffer.slice(0, -16);

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuffer);
        decipher.setAuthTag(authTag);

        let decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
        return decrypted.toString('utf-8');
    } catch (error:any) {
        throw new Error(`Failed to decrypt message: ${error.message}`);
    }
};


export const encryptMessage_1 = (message:string, aesKey:string) => {
    if (!message) return "";

    const key = Buffer.from(aesKey, 'utf-8').subarray(0, 32); // Ensure 32-byte key
    const iv = crypto.randomBytes(16); // Generate IV dynamically

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = Buffer.concat([cipher.update(message, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag(); // Get authentication tag

    return JSON.stringify({
        cipher: Buffer.concat([encrypted, authTag]).toString('base64'), // Combine encrypted data & auth tag
        iv: iv.toString('base64')
    });
};

export const descryptedContent = (encryptedJsonContent:any,aeskey:string) => {
    // const encryptedJson = encryptedJsonContent
    const aesKey = aeskey;
    // const encryptedJson:EncryptedData = encryptedJsonContent
    const encryptedJson: EncryptedData = JSON.parse(encryptedJsonContent);
    try {
        const aesKeyRaw = Buffer.from(aesKey, "utf-8").subarray(0, 32);
        if (aesKeyRaw.length !== 32) {
            return "Invalid AES key length! Must be 32 bytes."
        }

        // Convert IV and CipherText from Base64 to Buffers
        const ivBuffer = Buffer.from(encryptedJson.iv, "base64");
        if (ivBuffer.length !== 16) {
            return "Invalid IV length! Must be 16 bytes."
        }

        const cipherTextBuffer = Buffer.from(encryptedJson.cipher, "base64");

        // Extract authentication tag (last 16 bytes)
        const authTag = cipherTextBuffer.slice(-16);
        const encryptedText = cipherTextBuffer.slice(0, -16);

        // Create decipher with AES-256-GCM
        const decipher = crypto.createDecipheriv("aes-256-gcm", aesKeyRaw, ivBuffer);
        decipher.setAuthTag(authTag); // Attach the extracted authentication tag

        // Perform decryption
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        // Send response
        const decryptedMessage = decrypted.toString("utf-8")
        return decryptedMessage

    } catch (error:any) {
        if(error instanceof Error){
            loggerMsg(`Failed to decrypt message=> ${error.message}`,"error")
            return error.message || "Failed to decrypt message"
        }
    }
}
export const logErrorMessage = (error:any, customMessage:any) => {
    // Log the error details for debugging
    if (error instanceof Error) {
        loggerMsg(`${customMessage}\nError Name${error.name}\nError message: ${error.message}\nStack trace: ${error.stack}`);
    } else {
        loggerMsg(`${customMessage}\nUnexpected error: ${error}`);
    }
}


export const hashdPassword = async (password:string) => {
    return await bcrypt.hash(password, 10)
}

export const generateOtp = (): string => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

export const generateAccessToken = (userId: string): string => {
    return jwt.sign({ userId }, "supersecretkeys", { expiresIn: "7d" });    // 7 days
};


export const generateRefreshToken = (userId: string): string => {
    return jwt.sign({ userId }, "supersecretkeys", { expiresIn: "180d" });  // 6 month
};
  

/**
 * Generate an Agora RTC Token.
 *
 * @param appId - Your Agora App ID.
 * @param appCertificate - Your Agora App Certificate.
 * @param channelName - The name of the channel.
 * @param uid - The unique user ID for the token.
 * @param expirationTimeInSeconds - The token's expiration time in seconds.
 * @returns The generated RTC token.
 */

export const generateAgoraToken = (
    appId: string,
    appCertificate: string,
    channelName: string,
    uid: number,
    expirationTimeInSeconds: number = 3600
): string => {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    return RtcTokenBuilder.buildTokenWithUid(
        appId,
        appCertificate,
        channelName,
        uid,
        RtcRole.PUBLISHER,
        privilegeExpiredTs,
        privilegeExpiredTs
    )
}

export const saveDeviceToken = async (
    userId: string,
    token: string | undefined,
    deviceType: string,
    voipToken?: string
) => {
    const hasToken = token && token.trim() !== '';
    const hasVoipToken = voipToken && voipToken.trim() !== '';
    if (!hasToken && !hasVoipToken) return null;
    try {
    if (hasToken) {
        // Match on the physical device token alone (not {userId, token}), so a
        // token that's already registered to a different account (previous
        // login on a shared/reused device, or a reinstall) is reassigned to the
        // current user instead of piling up as a second row for the same
        // physical device.
        const update: { userId: string; deviceToken: string; deviceType: string; voipToken?: string } = { userId, deviceToken: token as string, deviceType };
        if (hasVoipToken) update.voipToken = voipToken as string;
        const saved = await deviceToken.findOneAndUpdate(
            { deviceToken: token },
            update,
            { upsert: true, new: true }
        );

        // A token refresh (Firebase periodically rotates FCM tokens) lands
        // here with a new token value, which doesn't match any existing row,
        // so the upsert above inserts a new row rather than replacing the
        // old one. Without this, the old row keeps receiving pushes
        // alongside the new one, so the same physical device gets sent (and
        // displays) every push twice. Prune any other rows for this
        // user+deviceType now that the current token is saved.
        await deviceToken.deleteMany({
            userId,
            deviceType,
            deviceToken: { $ne: token }
        });

        return saved;
    }

    // VoIP-only update: the PushKit token can arrive before the FCM token
    // on a fresh launch. Attach it to this user's existing device row for
    // this device type, or create one if this is the first token we've
    // seen from that device.
    return await deviceToken.findOneAndUpdate(
        { userId, deviceType },
        { userId, deviceType, voipToken },
        { upsert: true, new: true }
    );
    } catch (error:any) {
        if (error instanceof mongoose.Error.ValidationError) {
            throw {
                status: 400,
                code: "VALIDATION_ERROR",
                message: error.message,
            };
        } else if (error.code === 11000) {
            throw {
                status: 409,
                code: "DUPLICATE_DEVICE_TOKEN",
                message: "This device token is already registered.",
            };
        } else {
            throw {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: "An unexpected error occurred.",
            };
        }    
    }   
}