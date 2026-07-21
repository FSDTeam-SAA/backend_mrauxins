
import nodemailer from "nodemailer";
import { env } from "../../infrastructure/env";
import { renderEmailTemplate } from "../utils/emailTemplate";

const smtpPort = Number(env.SMTP_PORT || 587);

const transportOptions: any = {
    host:env.SMTP_HOST,
    port:smtpPort,
    secure: smtpPort === 465,
    auth:{
        user: env.SMTP_USER,
        pass: env.SMTP_PASS
    }
};

// const transportOptions: any = {
//     host:"smtp.mailgun.org",
//     port:587,
//     secure: false,
//     auth:{
//         user: "postmaster@sandbox65f97cd2d548430ea1e42c712f50ca4d.mailgun.org",
//         pass: "e0e7ef7c3c0653e7ee851702ecaf4d62-da554c25-ea996cd2"
//     }
// }

const transport = nodemailer.createTransport(transportOptions)


const sendEmail = async(to:string, subject:string, text:string, html:string)=>{
    const mailOptions = {
        from: `${env.EMAIL_FROM_NAME || "212 Messenger"} <${env.DEFAULT_EMAIL_FROM || env.SMTP_USER}>`,
        to: to,// "vishvadattfreshcode@gmail.com",
        subject: subject,
        text: text,
        html: html
    }

    try {
        const info = await transport.sendMail(mailOptions);
        console.log("Email sent successfully.",info.messageId)
        return info.messageId
    } catch (error) {
        console.error("Error sending email.",error);
        throw error;
    }
}

export const sentOtpService = async(email:string,otp:string) => {
    const expiryMinutes = 10;

    try {
        const html = renderEmailTemplate('otpEmail', {
            otp,
            expiryMinutes,
            APP_NAME: '212 Messenger',
            current_year: new Date().getFullYear(),
            email
        });

        await sendEmail(
            email, // Receiver's email address
            'Welcome to Our 212 Messenger App.',     // Subject
            `Your 212 Messenger OTP is ${otp}. It expires in ${expiryMinutes} minutes.`, // Text content
            html // HTML content
        );

        return {message : "OTP sent successfully."}
    } catch (error) {
        console.error("Error sending email",error);
        throw new Error("Failed to send OTP");
    }
}

export const verifyOtpService = async(email:string, otp:string) => {


    

    

    

    
}
