import swaggerAutogen from 'swagger-autogen';
import { exec } from 'child_process';

const outputFile = './swagger-output.json';
const endpointsFiles = ['./api/interface/routes/app.routes.ts']; // Your main route file(s)

const doc = {
    info: {
        title: '212messenger App API Doc',
        description: 'API Documentation for 212messenger App',
        version: '1.0.0',
    },
    servers: [
        {
            url: 'http://localhost:3000/api',
            description: 'Local Development Server',
        },
        {
            url: 'http://18.130.137.253/api',
            description: 'Live Production Server',
        }
    ],
    schemes: ['http'],
    basePath: '/',
};

const swaggerAutogenInstance = swaggerAutogen({ openapi: '3.0.0' });

swaggerAutogenInstance(outputFile, endpointsFiles, doc).then(async () => {
    // This will start your server (assuming it's in the same file)
    exec('ts-node ./api/interface/routes/app.routes.ts', (err, stdout, stderr) => {
        if (err) {
            console.error('Error starting the server:', err);
            return;
        }
    });
});
