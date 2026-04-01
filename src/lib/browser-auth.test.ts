import type {Request} from 'express';
import {
	apiKeyMatches,
	isBrowserRequest,
	parseBasicAuthPassword,
} from './browser-auth';

// ── apiKeyMatches ─────────────────────────────────────────────────────────────

describe('apiKeyMatches', () => {
	test('returns true for identical keys', () => {
		expect(apiKeyMatches('secret', 'secret')).toBe(true);
	});

	test('returns false for keys of the same length that differ', () => {
		expect(apiKeyMatches('secret1', 'secret2')).toBe(false);
	});

	test('returns false when provided key is shorter than expected', () => {
		expect(apiKeyMatches('sec', 'secret')).toBe(false);
	});

	test('returns false when provided key is longer than expected', () => {
		expect(apiKeyMatches('secret-long', 'secret')).toBe(false);
	});

	test('returns true when both keys are empty strings', () => {
		expect(apiKeyMatches('', '')).toBe(true);
	});

	test('returns false when provided is empty and expected is not', () => {
		expect(apiKeyMatches('', 'secret')).toBe(false);
	});

	test('is case-sensitive', () => {
		expect(apiKeyMatches('Secret', 'secret')).toBe(false);
	});
});

// ── parseBasicAuthPassword ────────────────────────────────────────────────────

describe('parseBasicAuthPassword', () => {
	test('returns empty string for an empty header', () => {
		expect(parseBasicAuthPassword('')).toBe('');
	});

	test('returns empty string when header does not start with "Basic "', () => {
		expect(parseBasicAuthPassword('Bearer token123')).toBe('');
	});

	test('returns empty string when header uses wrong case ("basic ")', () => {
		const encoded = Buffer.from('user:pass').toString('base64');
		expect(parseBasicAuthPassword(`basic ${encoded}`)).toBe('');
	});

	test('extracts password from user:password credentials', () => {
		const encoded = Buffer.from('user:mypassword').toString('base64');
		expect(parseBasicAuthPassword(`Basic ${encoded}`)).toBe('mypassword');
	});

	test('extracts password when username is empty (:password)', () => {
		const encoded = Buffer.from(':apikey').toString('base64');
		expect(parseBasicAuthPassword(`Basic ${encoded}`)).toBe('apikey');
	});

	test('returns everything after the first colon when password contains colons', () => {
		const encoded = Buffer.from('user:pass:with:colons').toString('base64');
		expect(parseBasicAuthPassword(`Basic ${encoded}`)).toBe('pass:with:colons');
	});

	test('returns empty string when decoded value has no colon', () => {
		const encoded = Buffer.from('nocolon').toString('base64');
		expect(parseBasicAuthPassword(`Basic ${encoded}`)).toBe('');
	});

	test('returns empty string when Buffer.from throws during decode', () => {
		const spy = jest.spyOn(Buffer, 'from').mockImplementationOnce(() => {
			throw new Error('mock decode error');
		}) as jest.SpyInstance;
		expect(parseBasicAuthPassword('Basic abc123')).toBe('');
		spy.mockRestore();
	});
});

// ── isBrowserRequest ──────────────────────────────────────────────────────────

describe('isBrowserRequest', () => {
	const makeReq = (accept?: string): Request =>
		({headers: accept !== undefined ? {accept} : {}}) as unknown as Request;

	test('returns true when Accept header is text/html', () => {
		expect(isBrowserRequest(makeReq('text/html'))).toBe(true);
	});

	test('returns true when Accept includes text/html among other types', () => {
		expect(
			isBrowserRequest(makeReq('text/html,application/xhtml+xml,*/*;q=0.8')),
		).toBe(true);
	});

	test('returns false when Accept is application/json', () => {
		expect(isBrowserRequest(makeReq('application/json'))).toBe(false);
	});

	test('returns false when Accept is an empty string', () => {
		expect(isBrowserRequest(makeReq(''))).toBe(false);
	});

	test('returns false when Accept header is absent', () => {
		expect(isBrowserRequest(makeReq())).toBe(false);
	});
});
