import {meta} from './check_reboot_required';

// Define type for the mocked module's exports
type MockedModule = {
	checkRebootRequired: (params: {checkReasons?: boolean | string}) => {
		message: string;
		code: number;
		performanceData: Array<{
			label: string;
			value: number | string;
			uom: string;
		}>;
	};
};

describe('checkRebootRequired plugin', () => {
	afterEach(() => {
		jest.resetModules();
		jest.restoreAllMocks();
	});

	test('exports startup metadata usage for http and shell clients', () => {
		expect(meta.usage.http).toContain('/plugins/check-reboot-required');
		expect(meta.usage.shell).toContain('./check_nest.sh check-reboot-required');
	});

	test('returns OK when no reboot is required', () => {
		jest.doMock('fs', () => ({
			__esModule: true as const,
			default: {
				existsSync: (path: string) => path !== '/var/run/reboot-required',
			},
			existsSync: (path: string) => path !== '/var/run/reboot-required',
		}));

		const {checkRebootRequired: localCheckRebootRequired} =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./check_reboot_required') as unknown as MockedModule;
		const result = localCheckRebootRequired({});

		expect(result.code).toBe(0);
		expect(result.message).toBe('OK: No reboot required');
		expect(result.performanceData).toEqual([]);
	});

	test('returns WARNING when reboot is required and checkReasons is false', () => {
		jest.doMock('fs', () => ({
			__esModule: true as const,
			default: {
				existsSync: (path: string) =>
					path === '/var/run/reboot-required' ||
					path === '/var/run/reboot-required.pkgs',
				readFileSync: () => 'apt\n',
			},
			existsSync: (path: string) =>
				path === '/var/run/reboot-required' ||
				path === '/var/run/reboot-required.pkgs',
			readFileSync: () => 'apt\n',
		}));

		const {checkRebootRequired: localCheckRebootRequired} =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./check_reboot_required') as unknown as MockedModule;
		const result = localCheckRebootRequired({checkReasons: 'false'});

		expect(result.code).toBe(1);
		expect(result.message).toBe('WARNING: Reboot required');
		expect(result.performanceData).toEqual([
			{
				label: 'reboot_required',
				value: 1,
				uom: '',
			},
		]);
	});

	test('returns WARNING when reboot is required and checkReasons is omitted', () => {
		jest.doMock('fs', () => ({
			__esModule: true as const,
			default: {
				existsSync: (path: string) =>
					path === '/var/run/reboot-required' ||
					path === '/var/run/reboot-required.pkgs',
				readFileSync: () => 'apt\n',
			},
			existsSync: (path: string) =>
				path === '/var/run/reboot-required' ||
				path === '/var/run/reboot-required.pkgs',
			readFileSync: () => 'apt\n',
		}));

		const {checkRebootRequired: localCheckRebootRequired} =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./check_reboot_required') as unknown as MockedModule;
		const result = localCheckRebootRequired({});

		expect(result.code).toBe(1);
		expect(result.message).toBe('WARNING: Reboot required');
	});

	test('returns WARNING when reboot is required, checkReasons is false, and pkgs file does not exist', () => {
		jest.doMock('fs', () => ({
			__esModule: true as const,
			default: {
				existsSync: (path: string) => path === '/var/run/reboot-required',
			},
			existsSync: (path: string) => path === '/var/run/reboot-required',
		}));

		const {checkRebootRequired: localCheckRebootRequired} =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./check_reboot_required') as unknown as MockedModule;
		const result = localCheckRebootRequired({checkReasons: 'false'});

		expect(result.code).toBe(1);
		expect(result.message).toBe('WARNING: Reboot required');
		expect(result.performanceData).toEqual([
			{
				label: 'reboot_required',
				value: 1,
				uom: '',
			},
		]);
	});

	test('returns CRITICAL with reasons when reboot is required and checkReasons is true', () => {
		jest.doMock('fs', () => ({
			__esModule: true as const,
			default: {
				existsSync: (path: string) =>
					path === '/var/run/reboot-required' ||
					path === '/var/run/reboot-required.pkgs',
				readFileSync: () => 'apt\nsnapd\nlibc6\n',
			},
			existsSync: (path: string) =>
				path === '/var/run/reboot-required' ||
				path === '/var/run/reboot-required.pkgs',
			readFileSync: () => 'apt\nsnapd\nlibc6\n',
		}));

		const {checkRebootRequired: localCheckRebootRequired} =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./check_reboot_required') as unknown as MockedModule;
		const result = localCheckRebootRequired({checkReasons: 'true'});

		expect(result.code).toBe(2);
		expect(result.message).toBe(
			'CRITICAL: Reboot required. Updates from: apt, snapd, libc6',
		);
		expect(result.performanceData).toEqual([
			{
				label: 'reboot_required',
				value: 1,
				uom: '',
			},
			{
				label: 'reason_apt',
				value: 1,
				uom: '',
			},
			{
				label: 'reason_snapd',
				value: 1,
				uom: '',
			},
			{
				label: 'reason_libc6',
				value: 1,
				uom: '',
			},
		]);
	});

	test('returns CRITICAL when checkReasons is the coerced boolean true (HTTP layer)', () => {
		jest.doMock('fs', () => ({
			__esModule: true as const,
			default: {
				existsSync: (path: string) =>
					path === '/var/run/reboot-required' ||
					path === '/var/run/reboot-required.pkgs',
				readFileSync: () => 'linux-image-amd64\n',
			},
			existsSync: (path: string) =>
				path === '/var/run/reboot-required' ||
				path === '/var/run/reboot-required.pkgs',
			readFileSync: () => 'linux-image-amd64\n',
		}));

		const {checkRebootRequired: localCheckRebootRequired} =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./check_reboot_required') as unknown as MockedModule;
		const result = localCheckRebootRequired({checkReasons: true});

		expect(result.code).toBe(2);
		expect(result.message).toBe(
			'CRITICAL: Reboot required. Updates from: linux-image-amd64',
		);
	});

	test('collapses duplicate package names from the pkgs file', () => {
		jest.doMock('fs', () => ({
			__esModule: true as const,
			default: {
				existsSync: (path: string) =>
					path === '/var/run/reboot-required' ||
					path === '/var/run/reboot-required.pkgs',
				readFileSync: () => 'apt\napt\nlibc6\napt\n',
			},
			existsSync: (path: string) =>
				path === '/var/run/reboot-required' ||
				path === '/var/run/reboot-required.pkgs',
			readFileSync: () => 'apt\napt\nlibc6\napt\n',
		}));

		const {checkRebootRequired: localCheckRebootRequired} =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./check_reboot_required') as unknown as MockedModule;
		const result = localCheckRebootRequired({checkReasons: 'true'});

		expect(result.code).toBe(2);
		expect(result.message).toBe(
			'CRITICAL: Reboot required. Updates from: apt, libc6',
		);
		expect(result.performanceData).toEqual([
			{
				label: 'reboot_required',
				value: 1,
				uom: '',
			},
			{
				label: 'reason_apt',
				value: 1,
				uom: '',
			},
			{
				label: 'reason_libc6',
				value: 1,
				uom: '',
			},
		]);
	});

	test('returns WARNING with empty reasons when pkgs file exists but is empty', () => {
		jest.doMock('fs', () => ({
			__esModule: true as const,
			default: {
				existsSync: (path: string) =>
					path === '/var/run/reboot-required' ||
					path === '/var/run/reboot-required.pkgs',
				readFileSync: () => '',
			},
			existsSync: (path: string) =>
				path === '/var/run/reboot-required' ||
				path === '/var/run/reboot-required.pkgs',
			readFileSync: () => '',
		}));

		const {checkRebootRequired: localCheckRebootRequired} =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./check_reboot_required') as unknown as MockedModule;
		const result = localCheckRebootRequired({checkReasons: 'true'});

		expect(result.code).toBe(1);
		expect(result.message).toBe('WARNING: Reboot required');
		expect(result.performanceData).toEqual([
			{
				label: 'reboot_required',
				value: 1,
				uom: '',
			},
		]);
	});

	test('handles error when checking reboot status', () => {
		const mockFs = {
			existsSync: jest.fn((path: string) => {
				if (path === '/var/run/reboot-required') {
					throw new Error('Permission denied');
				}
				return false;
			}),
			readFileSync: jest.fn(),
		};

		jest.doMock('fs', () => mockFs);

		const {checkRebootRequired: localCheckRebootRequired} =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./check_reboot_required') as unknown as MockedModule;
		const result = localCheckRebootRequired({});

		expect(result.code).toBe(3);
		expect(result.message).toContain('UNKNOWN: error checking reboot status');
		expect(result.message).toContain('Permission denied');
	});

	test('handles non-Error throw when checking reboot status', () => {
		const mockFs = {
			existsSync: jest.fn((path: string) => {
				if (path === '/var/run/reboot-required') {
					// eslint-disable-next-line @typescript-eslint/only-throw-error
					throw 'Permission error string';
				}
				return false;
			}),
			readFileSync: jest.fn(),
		};

		jest.doMock('fs', () => mockFs);

		const {checkRebootRequired: localCheckRebootRequired} =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./check_reboot_required') as unknown as MockedModule;
		const result = localCheckRebootRequired({});

		expect(result.code).toBe(3);
		expect(result.message).toContain('UNKNOWN: error checking reboot status');
		expect(result.message).toContain('Permission error string');
	});

	test('handles error when reading the pkgs file', () => {
		jest.doMock('fs', () => ({
			__esModule: true as const,
			default: {
				existsSync: (path: string) =>
					path === '/var/run/reboot-required' ||
					path === '/var/run/reboot-required.pkgs',
				readFileSync: () => {
					throw new Error('Permission denied');
				},
			},
			existsSync: (path: string) =>
				path === '/var/run/reboot-required' ||
				path === '/var/run/reboot-required.pkgs',
			readFileSync: () => {
				throw new Error('Permission denied');
			},
		}));

		const {checkRebootRequired: localCheckRebootRequired} =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./check_reboot_required') as unknown as MockedModule;
		const result = localCheckRebootRequired({checkReasons: 'true'});

		expect(result.code).toBe(1);
		expect(result.message).toBe('WARNING: Reboot required');
	});

	test('handles special characters in reason names by sanitizing them', () => {
		jest.doMock('fs', () => ({
			__esModule: true as const,
			default: {
				existsSync: (path: string) =>
					path === '/var/run/reboot-required' ||
					path === '/var/run/reboot-required.pkgs',
				readFileSync: () => 'apt-updates\nsnapd.core20\n',
			},
			existsSync: (path: string) =>
				path === '/var/run/reboot-required' ||
				path === '/var/run/reboot-required.pkgs',
			readFileSync: () => 'apt-updates\nsnapd.core20\n',
		}));

		const {checkRebootRequired: localCheckRebootRequired} =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./check_reboot_required') as unknown as MockedModule;
		const result = localCheckRebootRequired({checkReasons: 'true'});

		expect(result.code).toBe(2);
		expect(result.performanceData?.[1]?.label).toBe('reason_apt_updates');
		expect(result.performanceData?.[2]?.label).toBe('reason_snapd_core20');
	});

	test('returns WARNING without reading reasons when checkReasons is false', () => {
		jest.doMock('fs', () => ({
			__esModule: true as const,
			default: {
				existsSync: (path: string) => path === '/var/run/reboot-required',
				readFileSync: () => 'apt\n',
			},
			existsSync: (path: string) => path === '/var/run/reboot-required',
			readFileSync: () => 'apt\n',
		}));

		const {checkRebootRequired: localCheckRebootRequired} =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./check_reboot_required') as unknown as MockedModule;
		const result = localCheckRebootRequired({});

		expect(result.code).toBe(1);
		expect(result.message).toBe('WARNING: Reboot required');
		expect(result.performanceData).toEqual([
			{
				label: 'reboot_required',
				value: 1,
				uom: '',
			},
		]);
	});

	test('returns WARNING when checkReasons is true but pkgs file does not exist', () => {
		jest.doMock('fs', () => ({
			__esModule: true as const,
			default: {
				existsSync: (path: string) => path === '/var/run/reboot-required',
				readFileSync: () => 'apt\n',
			},
			existsSync: (path: string) => path === '/var/run/reboot-required',
			readFileSync: () => 'apt\n',
		}));

		const {checkRebootRequired: localCheckRebootRequired} =
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./check_reboot_required') as unknown as MockedModule;
		const result = localCheckRebootRequired({checkReasons: 'true'});

		expect(result.code).toBe(1);
		expect(result.message).toBe('WARNING: Reboot required');
		expect(result.performanceData).toEqual([
			{
				label: 'reboot_required',
				value: 1,
				uom: '',
			},
		]);
	});
});
