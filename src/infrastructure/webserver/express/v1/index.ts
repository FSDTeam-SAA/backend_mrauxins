import express from 'express';
import bodyParser from 'body-parser';
import rateLimit from "express-rate-limit";
import http from 'http';
import cors from 'cors';
import cookieParser from "cookie-parser";
import {createRouter} from "./routes";
import {env} from '../../../env';
import retry from 'retry';
import {initCronJobs} from "../../../../api/cron";
import connectDB from '../../../../api/config/db';
// import { setupSwagger } from '../../../../swagger';
import swaggerFile from "../../../../swagger-output.json"
import { Server } from 'socket.io';
import swaggerUi from 'swagger-ui-express';
import { initDemoSocketHandlers } from '../../../../api/socket/initDemoSocketHandlers';
import path from "path";
import serveIndex from "serve-index"
import { loggerMsg } from '../../../../api/lib/logger';
/**
 * Creates an Express server with the necessary configurations and middleware.
 * The server listens on the specified port and host.
 *
 * @returns {void}
 */

let io: Server | any = null;

// Export the socket.IO instance
export const getIo = () => {
    if(!io){
        throw new Error("Socket.IO not initialized!")
    }
    return io;
}

// Socket.IO logic
export const onlineUsers = new Map<string, string>();

export const createServer = (): void => {
    // Create the Express app
    const app = express();

    // Get configuration values
    const port = env.APP_PORT || 3000;

    // Create an HTTP server explicitly
    const server = http.createServer(app);

    // Initialize Socket.IO with the server
    io = new Server(server, {
        cors: {
            origin: "*",    // Adjust as per your needs
            methods: ["GET", "POST"]
        },
        transports: ['websocket'], // Force websocket
        pingInterval: 10000,       // 10 seconds
        pingTimeout: 5000
    });


    const host = env.HOST;

    const limiter = rateLimit({
        windowMs: 60 * 1000, // 1 minutes
        max: 60, // Limit each IP to 60 requests per windowMs
        message: {
            status: 0,
            message: 'Too many requests, please try again later.'
        }
    });

    // app.use(limiter);

    

    // Middleware setup
    app.use(bodyParser.json({limit: '50mb'})); // JSON body parser
    app.use(bodyParser.urlencoded({limit: '50mb', extended: true})); // URL-encoded body parser

    app.use(cookieParser());
    app.use(cors({
        origin: function (origin, callback) {
            return callback(null, true);
        },
        optionsSuccessStatus: 200,
        credentials: true,
        allowedHeaders: '*'
    }));

    app.use((req, res, next) => {
        if (env.NODE_ENV == "development") {
            // Log every HTTP request
            // console.log(req.originalUrl, 'info');
            // console.log(req.body, 'info');
            // console.log(req.headers, 'info');
        }

        // CORS Headers
        const responseSettings = {
            "AccessControlAllowOrigin": '*',
            "AccessControlAllowHeaders": "Content-Type,X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5,  Date, X-Api-Version, X-File-Name",
            "AccessControlAllowMethods": "POST, GET, PUT, DELETE, OPTIONS",
            "AccessControlAllowCredentials": 'true'
        };

        // Set CORS headers
        res.header("Access-Control-Allow-Credentials", responseSettings.AccessControlAllowCredentials);
        res.header("Access-Control-Allow-Headers", (req.headers['access-control-request-headers']) ? req.headers['access-control-request-headers'] : "x-requested-with");
        res.header("Access-Control-Allow-Methods", (req.headers['access-control-request-method']) ? req.headers['access-control-request-method'] : responseSettings.AccessControlAllowMethods);

        if ('OPTIONS' == req.method) {
            res.send(200).end(); // Respond to preflight OPTIONS requests
        } else {
            next(); // Continue to the next middleware/route handler
        }
    });

    app.get("/",(req,res) => {
        res.type("html").send(`
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mrauxins API Server</title>
    <style>
        :root {
            color-scheme: light;
            --bg: #f5f7fb;
            --panel: #ffffff;
            --text: #172033;
            --muted: #637083;
            --line: #dce3ee;
            --accent: #0f766e;
            --accent-soft: #dff7f3;
            --shadow: 0 18px 45px rgba(22, 32, 51, 0.10);
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background:
                radial-gradient(circle at top left, rgba(15, 118, 110, 0.12), transparent 34rem),
                linear-gradient(135deg, #f8fafc 0%, var(--bg) 100%);
            color: var(--text);
            display: grid;
            place-items: center;
            padding: 32px 16px;
        }

        main {
            width: min(920px, 100%);
        }

        .shell {
            background: rgba(255, 255, 255, 0.88);
            border: 1px solid rgba(220, 227, 238, 0.9);
            box-shadow: var(--shadow);
            backdrop-filter: blur(12px);
            border-radius: 24px;
            overflow: hidden;
        }

        .hero {
            display: grid;
            gap: 28px;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            padding: 42px;
            border-bottom: 1px solid var(--line);
        }

        .status {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            width: fit-content;
            color: var(--accent);
            background: var(--accent-soft);
            border: 1px solid rgba(15, 118, 110, 0.18);
            border-radius: 999px;
            padding: 8px 12px;
            font-size: 14px;
            font-weight: 700;
        }

        .dot {
            width: 9px;
            height: 9px;
            border-radius: 50%;
            background: #10b981;
            box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.16);
        }

        h1 {
            margin: 18px 0 10px;
            font-size: clamp(32px, 5vw, 54px);
            line-height: 1.02;
            letter-spacing: 0;
        }

        p {
            margin: 0;
            color: var(--muted);
            font-size: 17px;
            line-height: 1.65;
            max-width: 620px;
        }

        .badge {
            min-width: 172px;
            min-height: 172px;
            display: grid;
            place-items: center;
            border-radius: 28px;
            background: #172033;
            color: #ffffff;
            text-align: center;
            padding: 24px;
        }

        .badge strong {
            display: block;
            font-size: 44px;
            line-height: 1;
        }

        .badge span {
            display: block;
            margin-top: 10px;
            color: #c7d2de;
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .content {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 1px;
            background: var(--line);
        }

        .item {
            background: var(--panel);
            padding: 26px;
        }

        .label {
            color: var(--muted);
            font-size: 13px;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .value {
            margin-top: 10px;
            color: var(--text);
            font-size: 18px;
            font-weight: 800;
            overflow-wrap: anywhere;
        }

        .actions {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            padding: 26px;
            background: var(--panel);
            border-top: 1px solid var(--line);
        }

        a {
            color: inherit;
        }

        .button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 44px;
            border-radius: 10px;
            padding: 0 16px;
            text-decoration: none;
            font-weight: 800;
            border: 1px solid var(--line);
            background: #ffffff;
        }

        .button.primary {
            color: #ffffff;
            background: var(--accent);
            border-color: var(--accent);
        }

        @media (max-width: 720px) {
            body {
                place-items: start center;
            }

            .hero {
                grid-template-columns: 1fr;
                padding: 30px 22px;
            }

            .badge {
                width: 100%;
                min-height: 120px;
                border-radius: 18px;
            }

            .content {
                grid-template-columns: 1fr;
            }

            .actions {
                padding: 22px;
            }

            .button {
                width: 100%;
            }
        }
    </style>
</head>
<body>
    <main>
        <section class="shell" aria-label="API server status">
            <div class="hero">
                <div>
                    <div class="status"><span class="dot" aria-hidden="true"></span> Server running</div>
                    <h1>Mrauxins API Server</h1>
                    <p>The backend is online and ready to handle mobile app requests, socket connections, media, and API documentation.</p>
                </div>
                <div class="badge" aria-label="HTTP 200 OK">
                    <strong>200</strong>
                    <span>Healthy</span>
                </div>
            </div>

            <div class="content">
                <div class="item">
                    <div class="label">Environment</div>
                    <div class="value">${env.NODE_ENV || "local"}</div>
                </div>
                <div class="item">
                    <div class="label">Base URL</div>
                    <div class="value">${req.protocol}://${req.get("host")}</div>
                </div>
                <div class="item">
                    <div class="label">API Prefix</div>
                    <div class="value">/api</div>
                </div>
            </div>

            <div class="actions">
                <a class="button primary" href="/api-docs">Open API Docs</a>
                <a class="button" href="/media">Browse Media</a>
            </div>
        </section>
    </main>
</body>
</html>
        `)
    })
    app.get("/.well-known/assetlinks.json",(req, res,next) => {
        const filePath = path.resolve(process.cwd(), ".well-known", "assetlinks.json");
        res.sendFile(filePath);
    })
    app.use("/api", createRouter());

    // setupSwagger(app)
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerFile));
    
    initCronJobs();

    // initSocketHandlers(io)
    app.set('socketio',io);
    initDemoSocketHandlers(io)

    // const logsPath = path.join(__dirname, "../../../../../logs");
    // loggerMsg(`logs path...\n${logsPath}`,"debug")
    // const imagePath = path.resolve(__dirname,String(env.IMAGES_PATH));
    // loggerMsg(`image path...\n${imagePath}`,"debug");
    
    // app.use('/logs', express.static(logsPath), serveIndex(logsPath, { icons: true }));
    app.use('/media', express.static('./src/assets'), serveIndex("./src/assets", { icons: true }));

    // app.get("/chat-app", (req, res) => {
    //     res.sendFile(path.join(__dirname, "../../../../public/index.html"))
    // })

    // Initialize the database connection with retry mechanism
    const maxRetries = 3;
    let connectionInitialized = false;

    const operation = retry.operation({retries: maxRetries});

    function initializeAppDataSource(currentAttempt: number) {
        if (connectionInitialized) {
            return;
        }

        if (currentAttempt <= maxRetries) {
            try {
                connectDB().then(() => {
                    server.listen(port, () => {
                        console.info(`Server listening on http://localhost:${port}`);
                    });
                })
                .catch((error:any) => {
                        console.error(`Database Connection Failed (Attempt ${currentAttempt} of ${maxRetries}):`, error);
                        setTimeout(() => initializeAppDataSource(currentAttempt + 1), 1000); // Retry after 1 second
                })
                // server.listen(port, () => {
                //     console.info(`Server listening on http://localhost:${port}`);
                // });
                    
            } catch (error: any) {
                console.error(`Database Connection Failed (Attempt ${currentAttempt} of ${maxRetries}):`, error);
                setTimeout(() => initializeAppDataSource(currentAttempt + 1), 1000); // Retry after 1 second
            }
        } else {
            console.error('Max retries reached. Database Connection Failed.');
        }
    }

    // Use the retry library to initialize the database connection
    operation.attempt((currentAttempt: number) => {
        initializeAppDataSource(currentAttempt);
    });

}
