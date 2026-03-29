import {Response} from 'express';
import {NagiosReturnValuesEnum} from '../types/nagios';
import {createNagiosReturnMessage} from './nagios';

export const sendNagiosUnknownError = (
	res: Response,
	httpStatus: number,
	message: string,
) => {
	return res
		.status(httpStatus)
		.send(createNagiosReturnMessage(message, NagiosReturnValuesEnum.UNKNOWN));
};
