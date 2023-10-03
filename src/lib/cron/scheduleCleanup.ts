import mongoose from 'mongoose';
import cron from 'node-cron';

import { cronTimeZone } from '@/lib/cron/scheduler';
import {
    initLog,
    persistLog,
    setErrorMessage,
    setMessage,
} from '@/lib/log/log';
import { ILog, LogTypes } from '@/models/Log';
import Image from '@/models/Image';

// # ┌────────────── second (optional)
// # │ ┌──────────── minute
// # │ │ ┌────────── hour
// # │ │ │ ┌──────── day of month
// # │ │ │ │ ┌────── month
// # │ │ │ │ │ ┌──── day of week
// # │ │ │ │ │ │
// # │ │ │ │ │ │
// # * * * * * *
export const scheduleUpdateRoleStatus = () => {
    cron.schedule(
        '0 0 * * *',
        () => {
            updateRoleStatus();
        },
        { timezone: cronTimeZone },
    );
};

const updateRoleStatus = async () => {
    const log: ILog = await initLog('updateRoleStatus', LogTypes.CRON);
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const session = await mongoose.startSession();
    session.startTransaction();
    let message = '';

    try {
        Image.deleteMany({ createdAt: { $lt: oneWeekAgo } }, (err: Error | null, result: { deletedCount?: number }) => {
            if (err) {
                setErrorMessage(log, err.message);
            } else {
                message = `Deleted ${result.deletedCount} images older than one week.`;
            }
        });
        await session.commitTransaction();
    } catch (error) {
        await session.abortTransaction();
        setErrorMessage(log, error as string);
        console.error(error);
    } finally {
        session.endSession();
        setMessage(log, message);

        if (!log.error) {
            persistLog(log);
        }
    }
};