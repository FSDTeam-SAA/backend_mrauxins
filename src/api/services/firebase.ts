import * as admin from "firebase-admin";
import path from "path";
import { env } from "../../infrastructure/env";

// path to your service account key JSON file
const serviceAccountPath = JSON.parse(env.FIREBASE_CREDENTIALS as string)

// Initialize Firebase admin sdk
admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath)
})

export default admin;