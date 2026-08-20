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
		expect(getErrorMessage({code: 500})).toBe('[Unknown error]');
	});

	test('returns Undefined error for undefined input', () => {
		expect(getErrorMessage(undefined)).toBe('Undefined error');
	});

	test('returns Null error for null input', () => {
		expect(getErrorMessage(null)).toBe('Null error');
	});

	test('converts string, number and boolean to string', () => {
		expect(getErrorMessage('boom')).toBe('boom');
		expect(getErrorMessage(true)).toBe('true');
	});
});
