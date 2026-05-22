import Joi from 'joi';

export const sendOtpValidationSchema = Joi.object({
    email: Joi.string().email().required().messages({
        "string.email": "Please enter a valid email address.",
        "any.required": "Email is required."
    }),
});

export const verifyOtpValidationSchema = Joi.object({
    email: Joi.string().email().optional().messages({
        "string.email": "Please enter a valid email address."
    }),
    phone: Joi.string().optional().messages({
        "string.base": "Phone number must be a string."
    }),
    otp: Joi.string().length(6).when(Joi.object({ email: Joi.exist() }).unknown(), {
        then: Joi.required(),
        otherwise: Joi.optional()
    }).messages({
        "string.length": "OTP must be exactly 6 digits.",
        "any.required": "OTP is required when email is provided."
    })
}).or('email', 'phone'); 

export const signupValidationSchema = Joi.object({
    phone: Joi.string().required().messages({
        "string.phone": "Please enter a valid Phoneno.",
        "any.required": "Phone is required."
    })
});


export const signinValidationSchema = Joi.object({
    phone: Joi.string().required().messages({
        "string.phone": "Please enter a valid Phoneno.",
        "any.required": "Phone is required."
    })
});
