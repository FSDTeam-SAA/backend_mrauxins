import { generateECKeyPair } from "../../helper/helper"
import { loggerMsg } from "../../lib/logger";
import ECKeyModel from "../schema/ec.key.schema";

export const saveECkeysToDB = async(
    userId: string,
    callback:(error:any, result:any) => void
) => {
    const {privateKey, publicKey} = generateECKeyPair();
    try {
        // save key to mongodb
        // const keyEntry = await ECKeyModel.findOneAndUpdate(
        //     {userId},
        //     {publicKey, privateKey},
        //     {upsert: true, new : true}
        // );
        const keyEntry = await saveRSAKeysToDB(userId, privateKey, publicKey)

        return callback(null, keyEntry)
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
}

export const saveRSAKeysToDB = async(userId:String, privateKey:any, publicKey:any) => {
    try {
        // save key to mongodb
        const keyEntry = await ECKeyModel.findOneAndUpdate(
            {userId},
            {publicKey: publicKey,privateKey: privateKey},
            {upsert: true, new : true}
        )
      
        return keyEntry
    } catch (error) {
        loggerMsg("Error into saveRSAKeysToDB","error")
        return error
    }
}
export const getPublicKeyDetails = async (
    userId: string,
    callback:(error:any, result:any)=>void
)=>{
    try {
        // const result = await ECKeyModel.findOne({userId}).select("userId publicKey");
        const result = await getRSAKeys(userId);
        callback(null, result)
    } catch (error) {
        return callback(
            {
                status: 500,
                code: "INTERNAL_SERVER_ERROR",
                message: error instanceof Error ? error.message : "An unexpected error occurred.",
            },
            null
        );
    }
}

export const getRSAKeys = async(userId:String)=>{
    try {
        const rsaKey = await ECKeyModel.findOne({userId});
        return rsaKey;
    } catch (error) {
        loggerMsg("Error in getRSAKeys:","error")
        return error
    }
}