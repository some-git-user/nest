import {scheduleCleanupLogs} from './scheduleCleanup';

export const cronTimeZone = 'Europe/Berlin'; // set cron time zone to "Europe/Berlin" (UTC + 2)

export const runScheduler = () => {
	scheduleCleanupLogs();
};
