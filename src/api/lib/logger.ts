import log4js from 'log4js';

let appLogger = log4js.configure({
    appenders: {
        application: {
            type: "dateFile",
            filename: "logs/application.log",
            pattern: "yyyy-MM-dd",
            backups: 10,
            keepFileExt: true,
            alwaysIncludePattern: true,
        }
        // everything: {
        //     type: "dateFile",
        //     filename: "logs/application.log",
        //     pattern: "yyyy-MM-dd",
        //     keepFileExt: true,
        //     alwaysIncludePattern: true,
        // }
    },
    categories: {
        default: {
            appenders: ["application"],
            level: "debug"
        }
    }
});

export const logger = appLogger.getLogger()

export const loggerMsg = (msg: any, type: string = 'warn') => {

    if(type) {
        if(type == 'debug')
            logger.debug(msg)
        if(type == 'info')
            logger.info(msg)
        if(type == 'warn')
            logger.warn(msg)
        if(type == 'error')
            logger.error(msg)
        if(type == 'fatal')
            logger.fatal(msg)
    }else{
        logger.error(msg)
    }

}

// import Winston from 'winston';
// import DailyRotateFile from 'winston-daily-rotate-file';
//
// const transports: Array<Winston.transport> = [];
//
// transports.push(
//     new Winston.transports.Console({
//         format: Winston.format.combine(
//             Winston.format.cli(),
//             Winston.format.splat()
//         )
//     })
// );
//
// export const logger: Winston.Logger = Winston.createLogger({
//     level: 'debug',
//     levels: Winston.config.npm.levels,
//     format: Winston.format.combine(
//         Winston.format.timestamp({
//             format: 'YYYY-MM-DD HH:mm:ss',
//         }),
//         Winston.format.errors({ stack: true }),
//         Winston.format.splat(),
//         Winston.format.json()
//     ),
//     silent: false,
//     transports,
// })
//
// export const LoggerStream = {
//     write: (msg: string): void => {
//         logger.info(msg.replace(/(\n)/gm, ''))
//     },
// }
//
//
// const transport: DailyRotateFile = new DailyRotateFile({
//     filename: 'logs/application-%DATE%.log',
//     datePattern: 'YYYY-WW', // Use 'YYYY-WW' for weekly rotation
//     zippedArchive: true,
//     maxSize: '20m',
//     maxFiles: '14w' // Use '14w' for 14 weeks of retention
// });
//
// export const loggerFile = Winston.createLogger(
//     {
//         transports: [
//             transport
//         ]
//     }
// );