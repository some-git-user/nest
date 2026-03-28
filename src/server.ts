import express, {Application, Request, Response} from 'express';
import fs from 'fs';
import https from 'https';
import {env} from './config/env';
import {runScheduler} from './lib/cron/scheduler';
import {recordHoneypotSignal, recordNetworkProbeSignal} from './lib/honey-pot';
import {logger} from './lib/logger';
import {createNagiosReturnMessage} from './lib/nagios';
import {ensureTlsCertificate} from './lib/tls';
import appInfo from './routes/app-info';
import dynamicRoutes from './routes/dynamic-routes';
import honeyPot from './routes/honey-pot';

const app: Application = express();

app.use(express.json());

// route files
app.get('/favicon.ico', (_req: Request, res: Response) => res.status(204));
app.use('/', dynamicRoutes);
app.use('/nagios', appInfo);
app.use('/nagios/honey-pot', honeyPot);
// 404 handler for unknown routes
app.use((req: Request, res: Response) => {
	recordHoneypotSignal(req, 'unknown-route');
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

const getRemoteIp = (socket: unknown): string => {
	if (typeof socket !== 'object' || socket === null) {
		return 'unknown';
	}

	if (!('remoteAddress' in socket)) {
		return 'unknown';
	}

	const remoteAddress = (socket as {remoteAddress?: unknown}).remoteAddress;
	if (typeof remoteAddress === 'string' && remoteAddress.length > 0) {
		return remoteAddress;
	}

	return 'unknown';
};

server.on('tlsClientError', (_err, socket) => {
	recordNetworkProbeSignal(getRemoteIp(socket), 'tls-client-error');
});

server.on('clientError', (_err, socket) => {
	recordNetworkProbeSignal(getRemoteIp(socket), 'http-client-error');
});

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
