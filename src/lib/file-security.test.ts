import fs from 'fs';
import {validateUnixFileSecurity} from './file-security';

const makeStat = (uid: number, mode: number): fs.Stats =>
	({uid, mode}) as unknown as fs.Stats;

describe('validateUnixFileSecurity', () => {
	// ──────────────── OK paths ────────────────

	test('returns ok when uid matches and file is not group/other writable', () => {
		// 0o644 = rw-r--r-- — typical read-only file
		const result = validateUnixFileSecurity(makeStat(1000, 0o100644), 1000);
		expect(result).toEqual({ok: true});
	});

	test('returns ok for mode 0o400 (read-only owner only)', () => {
		const result = validateUnixFileSecurity(makeStat(500, 0o100400), 500);
		expect(result).toEqual({ok: true});
	});

	// ──────────────── owner-mismatch ────────────────

	test('rejects when file uid does not match process uid', () => {
		const result = validateUnixFileSecurity(makeStat(999, 0o100644), 1000);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('owner-mismatch');
			expect(result.expectedUid).toBe(1000);
			expect(result.actualUid).toBe(999);
		}
	});

	test('rejects uid=0 (root-owned) when process runs as non-root', () => {
		const result = validateUnixFileSecurity(makeStat(0, 0o100644), 1001);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('owner-mismatch');
			expect(result.actualUid).toBe(0);
		}
	});

	// ──────────────── group-or-other-writable ────────────────

	test('rejects when group-write bit is set (mode & 0o020)', () => {
		// 0o664 = rw-rw-r-- — group-writable
		const result = validateUnixFileSecurity(makeStat(1000, 0o100664), 1000);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('group-or-other-writable');
		}
	});

	test('rejects when other-write bit is set (mode & 0o002)', () => {
		// 0o646 = rw-r--rw- — world-writable
		const result = validateUnixFileSecurity(makeStat(1000, 0o100646), 1000);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('group-or-other-writable');
		}
	});

	test('rejects when both group and other write bits are set (mode 0o666)', () => {
		// 0o666 = rw-rw-rw-
		const result = validateUnixFileSecurity(makeStat(1000, 0o100666), 1000);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('group-or-other-writable');
		}
	});

	// ──────────────── owner-mismatch takes priority ────────────────

	test('reports owner-mismatch even when file is also group-writable', () => {
		// Wrong owner AND group-writable — owner-mismatch is checked first
		const result = validateUnixFileSecurity(makeStat(999, 0o100664), 1000);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('owner-mismatch');
		}
	});

	// ──────────────── edge: uid=0 process running as root ────────────────

	test('returns ok when both uid and expected uid are 0 and mode is safe', () => {
		const result = validateUnixFileSecurity(makeStat(0, 0o100600), 0);
		expect(result).toEqual({ok: true});
	});
});
