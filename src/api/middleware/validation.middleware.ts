import { Request, Response, NextFunction } from 'express';
import { ObjectSchema } from 'joi';

export const validateRequest = (schema: ObjectSchema) => {
    return (req: Request, res: Response, next: NextFunction) => {

        const { error } = schema.validate(req.body, { abortEarly: false });
        // abortEarly => if true then sends error on first failure => if false then sends all the failure errors

        if (error) {
            return res.status(400).json({
                status: "error",
                code: "VALIDATION_ERROR",
                message: "Validation failed for the request.",
                error: error.details.map(err => ({
                    message: err.message,
                    path: err.path
                }))
            });
        }

        next();
    };
};
