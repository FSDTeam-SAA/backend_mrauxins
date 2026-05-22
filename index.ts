import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import { createServer } from './src/infrastructure/webserver/express/v1'
/** start server */
createServer();