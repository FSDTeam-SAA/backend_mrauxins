import express from 'express'
import {appRoute} from "../../../../api/interface/routes/app.routes";

export const createRouter = (): express.Router => {
    const router = express.Router();
    appRoute(router);

    return router;
}