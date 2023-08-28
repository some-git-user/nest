import Log, { LogTypes, ILog, Status } from '@/models/Log';

export const initLog = async (
    cronName: string,
    logType: LogTypes,
): Promise<ILog> => {
    const log = new Log({
        name: cronName,
        status: Status.RUNNING,
        runtime: {
            startDate: new Date(),
        },
        type: logType,
    });
    return await log.save();
};

export const persistLog = async (log: ILog) => {
    log.runtime.endDate = new Date();
    log.status = Status.FINISHED;
    log.runtime.duration =
    log.runtime.endDate.getTime() - log.runtime.startDate.getTime();
    await log.updateOne(log);
};

export const setErrorMessage = (log: ILog, error: string): void => {
    log.error = error;
};

export const setMessage = (log: ILog, message: string): void => {
    log.message = message;
};