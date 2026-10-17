import fs from 'fs';
import os from 'os';
import path from 'path';
import {hashFile} from './file-hash';

describe('hashFile', () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-hash-'));
	});

	afterEach(() => {
		fs.rmSync(dir, {recursive: true, force: true});
	});

	test('returns the SHA-256 hex digest of a file', () => {
		const filePath = path.join(dir, 'a.txt');
		fs.writeFileSync(filePath, 'hello');

		// sha256("hello")
		expect(hashFile(filePath)).toBe(
			'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
		);
	});

	test('throws when the file cannot be read', () => {
		expect(() => hashFile(path.join(dir, 'missing.txt'))).toThrow();
	});
});
