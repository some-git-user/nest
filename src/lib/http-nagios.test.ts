import {Response} from 'express';
import {sendNagiosUnknownError} from './http-nagios';

describe('sendNagiosUnknownError', () => {
	test('sets status and sends Nagios UNKNOWN response body', () => {
		const statusMock = jest.fn().mockReturnThis();
		const sendMock = jest.fn().mockReturnThis();
		const res = {
			status: statusMock,
			send: sendMock,
		} as unknown as Response;

		const result = sendNagiosUnknownError(res, 403, 'Forbidden');

		expect(statusMock).toHaveBeenCalledWith(403);
		expect(sendMock).toHaveBeenCalledWith({
			message: 'Forbidden',
			code: 3,
		});
		expect(result).toBe(res);
	});
});
