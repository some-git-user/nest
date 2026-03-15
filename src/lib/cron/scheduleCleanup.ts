import fs from 'fs';
import cron from 'node-cron';
import path from 'path';
import zlib from 'zlib';
import {env} from '../../config/env';
import {cronTimeZone} from '../../lib/cron/scheduler';
import {logger} from '../logger';

export const scheduleCleanupLogs = () => {
	cron.schedule(
		'* * * * *', // run every minute
		() => {
			void cleanupLogs();
		},
		{timezone: cronTimeZone},
	);
	logger.info(
		`Cron job "cleanup logs" scheduled to run every minute at time zone ${cronTimeZone}, max logfile size ${env.MAX_LOG_FILE_SIZE_BYTES} bytes`,
	);
};

const cleanupLogs = async () => {
	logger.debug('running cleanup logs');

	const logFilePath = env.LOG_FILE_PATH;
	if (!logFilePath) {
		return;
	}

	try {
		const stats = await fs.promises.stat(logFilePath);
		logger.debug(`Log file size: ${stats.size} bytes`);
		if (stats.size < env.MAX_LOG_FILE_SIZE_BYTES) {
			logger.debug(
				`Log file smaller than ${env.MAX_LOG_FILE_SIZE_BYTES} bytes; skipping rotation.`,
			);
			return;
		}

		const logFileDir = path.dirname(logFilePath);
		const logFileName = path.basename(logFilePath);
		const timestamp = new Date().toISOString().replace(/:/g, '-');
		const rotatedLogFilePath = `${logFileDir}/${logFileName}.${timestamp}`;
		const zippedLogFilePath = rotatedLogFilePath + '.gz';

		// rename current log to rotated log file (not zipped yet)
		await fs.promises.rename(logFilePath, rotatedLogFilePath);

		// create new empty log file
		await fs.promises.writeFile(logFilePath, '', {encoding: 'utf8'});

		// gzip the rotated log file (stream from rotatedLogFilePath to zippedLogFilePath)
		await new Promise<void>((resolve, reject) => {
			const input = fs.createReadStream(rotatedLogFilePath);
			const output = fs.createWriteStream(zippedLogFilePath);
			const gzipStream = zlib.createGzip();

			input
				.pipe(gzipStream)
				.pipe(output)
				.on('finish', resolve)
				.on('error', reject);
		});

		// remove the original uncompressed rotated file
		await fs.promises.unlink(rotatedLogFilePath);

		logger.info(`Rotated and zipped log file: ${zippedLogFilePath}`);
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		logger.error(`Error rotating/zipping log file: ${errorMessage}`);
	}

	logger.info('finished cleanup logs');
};
