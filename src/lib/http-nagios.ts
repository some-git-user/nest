import {Response} from 'express';
import {NagiosReturnCodes} from '../types/nagios';
import {createNagiosReturnMessage} from './nagios';

export const sendNagiosUnknownError = (
	res: Response,
	httpStatus: number,
	message: string,
): Response => {
	return res
		.status(httpStatus)
		.send(createNagiosReturnMessage(message, NagiosReturnCodes.UNKNOWN));
};
