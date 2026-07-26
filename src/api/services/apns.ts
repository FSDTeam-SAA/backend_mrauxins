import http2 from "http2";
import jwt from "jsonwebtoken";
import { env } from "../../infrastructure/env";
import { loggerMsg } from "../lib/logger";

// Talks to APNs directly over HTTP/2 rather than via the `apn` npm package:
// that package (last published 2.2.0, unmaintained) has no way to set the
// `apns-push-type` header, which Apple requires on every VoIP push — a push
// missing it gets rejected by APNs. Hand-rolling this keeps full control
// over the required headers.

export const isApnsConfigured = Boolean(
    env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_BUNDLE_ID && env.APNS_AUTH_KEY
);

const APNS_HOST = env.APNS_ENVIRONMENT === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";

// Apple rate-limits/flags frequent token minting — reuse one for up to ~55
// minutes rather than generating a fresh one per push.
const TOKEN_TTL_SECONDS = 55 * 60;
let cachedToken: { value: string; issuedAt: number } | null = null;

const getAuthToken = (): string => {
    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && now - cachedToken.issuedAt < TOKEN_TTL_SECONDS) {
        return cachedToken.value;
    }

    const key = (env.APNS_AUTH_KEY as string).replace(/\\n/g, "\n");
    const value = jwt.sign(
        { iss: env.APNS_TEAM_ID, iat: now },
        key,
        { algorithm: "ES256", header: { alg: "ES256", kid: env.APNS_KEY_ID as string } }
    );
    cachedToken = { value, issuedAt: now };
    return value;
};

// One persistent HTTP/2 connection, reconnected on demand — APNs expects
// clients to keep a connection open rather than reconnect per-request.
let session: http2.ClientHttp2Session | null = null;

const getSession = (): http2.ClientHttp2Session => {
    if (session && !session.closed && !session.destroyed) {
        return session;
    }
    session = http2.connect(APNS_HOST);
    session.on("error", (error) => {
        loggerMsg(`APNs HTTP/2 session error: ${error}`, "error");
    });
    session.on("close", () => {
        session = null;
    });
    return session;
};

/**
 * Sends a PushKit VoIP push directly to APNs (FCM cannot deliver this push
 * type). Apple requires that every VoIP push results in the client calling
 * CXProvider.reportNewIncomingCall — so this must only ever be used for a
 * genuine new incoming call invite, never for call-end/mute/other signaling,
 * or Apple can revoke the app's VoIP entitlement.
 */
export const sendVoipPush = async (voipToken: string, payload: Record<string, any>): Promise<void> => {
    if (!isApnsConfigured) {
        loggerMsg("APNs is not configured (APNS_KEY_ID/APNS_TEAM_ID/APNS_BUNDLE_ID/APNS_AUTH_KEY) — skipping VoIP push", "warn");
        return;
    }

    const client = getSession();
    const body = JSON.stringify(payload);

    return new Promise<void>((resolve) => {
        const req = client.request({
            ":method": "POST",
            ":path": `/3/device/${voipToken}`,
            "authorization": `bearer ${getAuthToken()}`,
            "apns-topic": `${env.APNS_BUNDLE_ID}.voip`,
            "apns-push-type": "voip",
            "apns-priority": "10",
            "apns-expiration": "0",
            "content-type": "application/json",
        });

        let status: number | undefined;
        let responseBody = "";

        req.on("response", (headers) => {
            status = headers[":status"] as number;
        });
        req.on("data", (chunk) => {
            responseBody += chunk;
        });
        req.on("end", () => {
            if (status !== 200) {
                loggerMsg(`VoIP push failed for token ${voipToken}: status=${status} body=${responseBody}`, "error");
            }
            resolve();
        });
        req.on("error", (error) => {
            loggerMsg(`VoIP push request error for token ${voipToken}: ${error}`, "error");
            resolve();
        });

        req.end(body);
    });
};
