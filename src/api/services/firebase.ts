import * as admin from "firebase-admin";
import path from "path";
import { env } from "../../infrastructure/env";
import { loggerMsg } from "../lib/logger";

export let isFirebaseInitialized = false;

try {
    // path to your service account key JSON file
    const serviceAccountPath = JSON.parse(env.FIREBASE_CREDENTIALS as string)

    // Initialize Firebase admin sdk
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath)
    })

    isFirebaseInitialized = true;
} catch (error) {
    loggerMsg(`Failed to initialize Firebase Admin SDK — push notifications are disabled: ${error instanceof Error ? error.message : error}`, "fatal");
}

export default admin;