import mongoose, { HydratedDocument, Model } from 'mongoose';
import { EmptyObject } from '../@types/utils';

export enum LogTypes {
  CRON = 'cron',
  CLEANUP = 'cleanup',
}

export enum Status {
  RUNNING = 'running',
  FINISHED = 'finished',
}

export interface IRuntime {
  startDate: Date;
  endDate: Date;
  duration: number;
}

interface LogBase {
  name: string;
  status: Status;
  message: string;
  error: string;
  runtime: IRuntime;
  type: LogTypes;
}
/**
 * A model for a Log.
 * 1. Parameter -> Properties of a log
 * 2. Query Helpers -> not set
 * 3. Methods & Overrides -> not set
 * 4. Virtuals -> not set
 */
type LogModel = Model<LogBase, EmptyObject, EmptyObject, EmptyObject>;

const LogSchema = new mongoose.Schema<LogBase, LogModel>(
    {
        name: {
            type: String,
            required: true,
        },
        status: {
            type: String,
            enum: Status,
            default: Status.RUNNING,
        },
        runtime: {
            type: mongoose.Schema.Types.Mixed,
        },
        message: {
            type: String,
            trim: true,
            maxlength: 1024,
        },
        error: {
            type: String,
            trim: true,
            maxlength: 1024,
        },
        type: {
            type: String,
            enum: LogTypes,
        },
    },
    {
        timestamps: true,
    },
);

/**
 * We don't extend the `Document` type because it has some problems and will be deprecated in future versions.
 * See: [Mongoose Docs](https://mongoosejs.com/docs/typescript.html#using-extends-document)
 */
export type ILog = HydratedDocument<LogBase>;
const Log = mongoose.model<ILog>('Log', LogSchema);

export default Log;