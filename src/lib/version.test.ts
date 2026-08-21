describe('getAppVersion', () => {
	afterEach(() => {
		delete (globalThis as Record<string, unknown>).__VERSION__;
	});

	test('returns a string', () => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const {getAppVersion} = require('./version');
		const version = getAppVersion();
		expect(typeof version).toBe('string');
		expect(version.length).toBeGreaterThan(0);
	});

	test('returns the correct version from package.json', () => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const {getAppVersion} = require('./version');
		const version = getAppVersion();
		// Should match semver-like pattern from package.json
		expect(version).toMatch(/^\d+\.\d+\.\d+/);
	});

	test('uses injected version when __VERSION__ is set', () => {
		(globalThis as Record<string, unknown>).__VERSION__ = 'test-version-1.2.3';
		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const {getAppVersion} = require('./version');
			expect(getAppVersion()).toBe('test-version-1.2.3');
		});
	});
});
