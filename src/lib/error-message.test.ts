import {getErrorMessage} from './error-message';

describe('getErrorMessage', () => {
	test('returns Error.message for Error instances', () => {
		expect(getErrorMessage(new Error('boom'))).toBe('boom');
	});

	test('returns .message when plain object contains a string message', () => {
		expect(getErrorMessage({message: 'plain-object-message'})).toBe(
			'plain-object-message',
		);
	});

	test('falls back to String(error) for primitives and unknown shapes', () => {
		expect(getErrorMessage(123)).toBe('123');
		expect(getErrorMessage({code: 500})).toBe('[object Object]');
	});
});
