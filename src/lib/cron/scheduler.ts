import cron from 'node-cron';

import {
    initLog,
    persistLog,
    setErrorMessage,
    setMessage,
} from '@/lib/log/log';
import Log, { LogTypes } from '@/models/Log';

export const cronTimeZone = 'Europe/Berlin'; // set cron time zone to "Europe/Berlin" (UTC + 2)

export const runScheduler = () => {
    scheduleCleanUpLogs();
};

// # ┌────────────── second (optional)
// # │ ┌──────────── minute
// # │ │ ┌────────── hour
// # │ │ │ ┌──────── day of month
// # │ │ │ │ ┌────── month
// # │ │ │ │ │ ┌──── day of week
// # │ │ │ │ │ │
// # │ │ │ │ │ │
// # * * * * * *
const scheduleCleanUpLogs = () => {
    cron.schedule(
        '0 0 * * *',
        () => {
            cleanUpLogs();
        },
        { timezone: cronTimeZone },
    );
};

const cleanUpLogs = async () => {
    const log = await initLog('cleanUpLogs', LogTypes.CLEANUP);
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    let result = null;
    try {
        result = await Log.deleteMany({ createdAt: { $lte: oneWeekAgo } });
    } catch (error) {
        setErrorMessage(log, error as string);
    } finally {
        setMessage(log, `cleaned up ${result?.deletedCount ?? 0} logs`);
        persistLog(log);
    }
};
