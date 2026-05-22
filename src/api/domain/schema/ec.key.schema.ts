

import mongoose from "mongoose";

const ECKeySchema = new mongoose.Schema(
    {
        userId: {type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true},
        publicKey: {type: String, required: true},
        privateKey: {type: String, required: true}
    },
    {
        timestamps: true
    }
)

const ECKeyModel = mongoose.model("ECKey", ECKeySchema);
export default ECKeyModel;