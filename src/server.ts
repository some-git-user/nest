import express, {Application, Request, Response} from 'express';
import {env} from './config/env';
import {runScheduler} from './lib/cron/scheduler';
import {logger} from './lib/logger';
import {createNagiosReturnMessage} from './lib/nagios';
import dynamicRoutes from './routes/dynamic-routes';

const app: Application = express();

app.use(express.json());

// route files
app.get('/favicon.ico', (_req: Request, res: Response) => res.status(204));
app.use('/', dynamicRoutes);
// 404 handler for unknown routes
app.use((req: Request, res: Response) => {
	const nagiosReturn = createNagiosReturnMessage(
		`Route not found: ${req.url}`,
		3,
	);
	res.status(404).send(nagiosReturn);
});

const server = app.listen(
	env.PORT,
	env.HOST,
	logger.info(
		`Server running in ${env.NODE_ENV} mode on host ${env.HOST} and port ${env.PORT} with PID ${process.pid}`,
	) as never,
);

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
