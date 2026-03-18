import express, {Application, Request, Response} from 'express';
import fs from 'fs';
import https from 'https';
import {env} from './config/env';
import {runScheduler} from './lib/cron/scheduler';
import {logger} from './lib/logger';
import {createNagiosReturnMessage} from './lib/nagios';
import {ensureTlsCertificate} from './lib/tls';
import appInfo from './routes/app-info';
import dynamicRoutes from './routes/dynamic-routes';

const app: Application = express();

app.use(express.json());

// route files
app.get('/favicon.ico', (_req: Request, res: Response) => res.status(204));
app.use('/', dynamicRoutes);
app.use('/nagios', appInfo);
// 404 handler for unknown routes
app.use((req: Request, res: Response) => {
	const nagiosReturn = createNagiosReturnMessage(
		`Route not found: ${req.url}`,
		3,
	);
	res.status(404).send(nagiosReturn);
});

const tlsPaths = ensureTlsCertificate();
const server = https.createServer(
	{
		cert: fs.readFileSync(tlsPaths.certPath),
		key: fs.readFileSync(tlsPaths.keyPath),
	},
	app,
);

server.listen(env.PORT, env.HOST, () => {
	logger.info(
		`HTTPS server running in ${env.NODE_ENV} mode on host ${env.HOST} and port ${env.PORT} with PID ${process.pid}. URL: https://${env.HOST}:${env.PORT}`,
	);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: {message: string}) => {
	logger.error(`Error: ${err.message}`);
	// close server & exit process
	server.close(() => process.exit(1));
});

process.on('uncaughtException', (err: {message: string}) => {
	logger.error(`Error: ${err.message}`);
	// close server & exit process
	server.close(() => process.exit(1));
});

process.on('SIGTERM', (err: {message: string}) => {
	logger.error(`Error: ${err.message}`);
	// close server & exit process
	server.close(() => process.exit(1));
});

// start cron scheduler
runScheduler();

logger.info(`Started application in ${env.NODE_ENV} mode...`);
