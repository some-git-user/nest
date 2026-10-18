import type {LocalConfigEntry} from './local-config';
import {getConfigKeys, safeLookupConfig} from './local-config';
import {getNagiosStatusText} from './nagios';
import {commandToRoutePath} from './plugin-utils';
import {
	BUILT_IN_UNIFIED_CHECKS,
	NEST_UNIFIED_PARAM,
	aggregateUnifiedResults,
	getUnifiedChecks,
	getUnifiedPresetEntries,
	isUnifiedEnabled,
	stripUnifiedParam,
} from './unified-check';

jest.mock('./local-config');
jest.mock('./plugin-utils', () => ({
	commandToRoutePath: jest.fn((command: string) => `/plugins/${command}`),
}));
jest.mock('./nagios', () => ({
	getNagiosStatusText: jest.fn((code: number) => {
		const names: Record<number, string> = {
			0: 'OK',
			1: 'WARNING',
			2: 'CRITICAL',
			3: 'UNKNOWN',
		};
		return names[code] ?? 'UNKNOWN';
	}),
}));

const mockedGetConfigKeys = jest.mocked(getConfigKeys);
const mockedSafeLookupConfig = jest.mocked(safeLookupConfig);
const mockedStatusText = jest.mocked(getNagiosStatusText);
const mockedCommandToRoutePath = jest.mocked(commandToRoutePath);

describe('unified-check', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockedCommandToRoutePath.mockImplementation((c) => `/plugins/${c}`);
	});

	describe('NEST_UNIFIED_PARAM', () => {
		it('is the reserved flag name', () => {
			expect(NEST_UNIFIED_PARAM).toBe('nestUnified');
		});
	});

	describe('isUnifiedEnabled', () => {
		it('is true only for the literal "true"', () => {
			expect(isUnifiedEnabled({nestUnified: 'true'})).toBe(true);
		});

		it('is false when the flag is absent', () => {
			expect(isUnifiedEnabled({})).toBe(false);
		});

		it('is false for any other value', () => {
			expect(isUnifiedEnabled({nestUnified: 'false'})).toBe(false);
			expect(isUnifiedEnabled({nestUnified: ''})).toBe(false);
			expect(isUnifiedEnabled({nestUnified: 'yes'})).toBe(false);
		});
	});

	describe('stripUnifiedParam', () => {
		it('removes only the reserved flag', () => {
			expect(
				stripUnifiedParam({host: 'h', nestUnified: 'true', port: '22'}),
			).toEqual({host: 'h', port: '22'});
		});

		it('returns an equal copy when the flag is absent', () => {
			expect(stripUnifiedParam({host: 'h'})).toEqual({host: 'h'});
		});

		it('returns an empty object when the flag is the only key', () => {
			expect(stripUnifiedParam({nestUnified: 'true'})).toEqual({});
		});
	});

	describe('getUnifiedPresetEntries', () => {
		it('returns opted-in presets with the flag stripped', () => {
			mockedGetConfigKeys.mockReturnValue(['a', 'b']);
			mockedSafeLookupConfig.mockImplementation(
				(key: string): LocalConfigEntry =>
					key === 'a'
						? {command: 'check-a', params: {host: 'h', nestUnified: 'true'}}
						: {command: 'check-b', params: {nestUnified: 'false'}},
			);

			expect(getUnifiedPresetEntries()).toEqual([
				{key: 'a', path: '/plugins/check-a', params: {host: 'h'}},
			]);
			expect(mockedCommandToRoutePath).toHaveBeenCalledWith('check-a');
		});

		it('skips a key whose entry is missing from the cache', () => {
			mockedGetConfigKeys.mockReturnValue(['gone']);
			mockedSafeLookupConfig.mockReturnValue(undefined);

			expect(getUnifiedPresetEntries()).toEqual([]);
		});

		it('returns an empty list when no keys exist', () => {
			mockedGetConfigKeys.mockReturnValue([]);

			expect(getUnifiedPresetEntries()).toEqual([]);
			expect(mockedSafeLookupConfig).not.toHaveBeenCalled();
		});
	});

	describe('BUILT_IN_UNIFIED_CHECKS', () => {
		it('always includes the nagios and honey-pot routes', () => {
			expect(BUILT_IN_UNIFIED_CHECKS).toEqual([
				{key: 'nagios', path: '/nagios', params: {}},
				{key: 'honey-pot', path: '/nagios/honey-pot', params: {}},
			]);
		});
	});

	describe('getUnifiedChecks', () => {
		it('leads with the built-in routes then appends opted-in presets', () => {
			mockedGetConfigKeys.mockReturnValue(['a']);
			mockedSafeLookupConfig.mockReturnValue({
				command: 'check-a',
				params: {nestUnified: 'true'},
			});

			expect(getUnifiedChecks()).toEqual([
				{key: 'nagios', path: '/nagios', params: {}},
				{key: 'honey-pot', path: '/nagios/honey-pot', params: {}},
				{key: 'a', path: '/plugins/check-a', params: {}},
			]);
		});

		it('still includes the built-ins when no preset opts in', () => {
			mockedGetConfigKeys.mockReturnValue([]);

			expect(getUnifiedChecks()).toEqual(BUILT_IN_UNIFIED_CHECKS);
		});
	});

	describe('aggregateUnifiedResults', () => {
		it('reports UNKNOWN when nothing ran', () => {
			expect(aggregateUnifiedResults([])).toEqual({
				code: 3,
				message: 'NEST UNIFIED: UNKNOWN - no presets were run',
			});
		});

		it('is OK when every preset is OK, counting none as problems', () => {
			const result = aggregateUnifiedResults([
				{key: 'a', code: 0, message: 'fine'},
				{key: 'b', code: 0, message: 'fine'},
			]);
			expect(result.code).toBe(0);
			expect(result.message).toBe('NEST UNIFIED: OK - 0 problem(s) of 2');
		});

		it('lists every non-OK preset and picks the worst code', () => {
			const result = aggregateUnifiedResults([
				{key: 'a', code: 1, message: 'warm'},
				{key: 'b', code: 2, message: 'broken'},
				{key: 'c', code: 0, message: 'fine'},
			]);
			expect(result.code).toBe(2);
			expect(result.message).toBe(
				'NEST UNIFIED: CRITICAL - 2 problem(s) of 3; a: WARNING - warm; b: CRITICAL - broken',
			);
		});

		it('ranks CRITICAL above UNKNOWN', () => {
			const result = aggregateUnifiedResults([
				{key: 'a', code: 3, message: 'errored'},
				{key: 'b', code: 2, message: 'broken'},
			]);
			expect(result.code).toBe(2);
		});

		it('ranks UNKNOWN above WARNING', () => {
			const result = aggregateUnifiedResults([
				{key: 'a', code: 1, message: 'warm'},
				{key: 'b', code: 3, message: 'errored'},
			]);
			expect(result.code).toBe(3);
		});

		it('concatenates performance data from every preset, including OK ones', () => {
			const result = aggregateUnifiedResults([
				{key: 'a', code: 0, message: 'fine', performanceData: 'a=1'},
				{key: 'b', code: 1, message: 'warm', performanceData: 'b=2'},
			]);
			expect(result.performanceData).toBe('a=1 b=2');
		});

		it('namespaces duplicate perfdata labels with the preset key', () => {
			const result = aggregateUnifiedResults([
				{key: 'a', code: 0, message: 'fine', performanceData: 'time=1'},
				{key: 'b', code: 0, message: 'fine', performanceData: 'time=2'},
			]);
			expect(result.performanceData).toBe('time=1 b_time=2');
		});

		it('adds a numeric suffix when a namespaced label still clashes', () => {
			const result = aggregateUnifiedResults([
				{
					key: 'a',
					code: 0,
					message: 'fine',
					performanceData: 'time=1 b_time=9',
				},
				{key: 'b', code: 0, message: 'fine', performanceData: 'time=2'},
			]);
			expect(result.performanceData).toBe('time=1 b_time=9 b_time_1=2');
		});

		it('preserves quoted labels that contain spaces', () => {
			const result = aggregateUnifiedResults([
				{
					key: 'a',
					code: 0,
					message: 'fine',
					performanceData: `'cpu load'=5%`,
				},
				{
					key: 'b',
					code: 0,
					message: 'fine',
					performanceData: `'cpu load'=6%`,
				},
			]);
			expect(result.performanceData).toBe(`'cpu load'=5% 'b_cpu load'=6%`);
		});

		it('passes through a token without a label untouched', () => {
			const result = aggregateUnifiedResults([
				{key: 'a', code: 0, message: 'fine', performanceData: '42'},
			]);
			expect(result.performanceData).toBe('42');
		});

		it('collapses runs of spaces in performance data', () => {
			const result = aggregateUnifiedResults([
				{key: 'a', code: 0, message: 'fine', performanceData: ' a=1   b=2 '},
			]);
			expect(result.performanceData).toBe('a=1 b=2');
		});

		it('sanitises a preset key used to namespace a label', () => {
			const result = aggregateUnifiedResults([
				{key: 'a b', code: 0, message: 'fine', performanceData: 'time=1'},
				{key: 'a b', code: 0, message: 'fine', performanceData: 'time=2'},
			]);
			// The key's space becomes '_' so the token stays well-formed.
			expect(result.performanceData).toBe('time=1 a_b_time=2');
		});

		it('caps performance data at the Nagios output limit', () => {
			// 2000 tokens of `k<n>=1` far exceed 4 KB; whole trailing tokens drop.
			const many = Array.from({length: 2000}, (_, i) => `k${i}=1`).join(' ');
			const result = aggregateUnifiedResults([
				{key: 'a', code: 0, message: 'fine', performanceData: many},
			]);
			const capped = result.performanceData ?? '';
			expect(Buffer.byteLength(capped, 'utf8')).toBeLessThanOrEqual(4096);
			// Ends on a complete token, never a sliced one.
			expect(capped.endsWith('=1')).toBe(true);
			expect(capped.split(' ').length).toBeLessThan(2000);
		});

		it('omits performance data when a single token exceeds the limit', () => {
			const huge = `k${'x'.repeat(5000)}=1`;
			const result = aggregateUnifiedResults([
				{key: 'a', code: 0, message: 'fine', performanceData: huge},
			]);
			expect(result.performanceData).toBeUndefined();
		});

		it('budgets performance data in bytes, not characters', () => {
			// Each token is 604 chars but 1204 UTF-8 bytes (each ç is 2 bytes).
			// Four tokens are 4819 bytes but only 2419 chars, so a byte budget keeps
			// three while a character budget would wrongly keep all four.
			const big = `'${'ç'.repeat(600)}'=1`;
			const many = [big, big, big, big].join(' ');
			const result = aggregateUnifiedResults([
				{key: 'a', code: 0, message: 'fine', performanceData: many},
			]);
			const capped = result.performanceData ?? '';
			expect(Buffer.byteLength(capped, 'utf8')).toBeLessThanOrEqual(4096);
			expect(capped.split(' ').length).toBe(3);
		});

		it('omits performanceData when no preset has any', () => {
			const result = aggregateUnifiedResults([
				{key: 'a', code: 0, message: 'fine'},
				{key: 'b', code: 0, message: 'fine', performanceData: ''},
			]);
			expect(result.performanceData).toBeUndefined();
		});

		it('truncates a very long message to the Nagios output limit', () => {
			const long = 'x'.repeat(5000);
			const result = aggregateUnifiedResults([
				{key: 'a', code: 2, message: long},
			]);
			expect(Buffer.byteLength(result.message, 'utf8')).toBeLessThanOrEqual(
				4096,
			);
			expect(result.message.endsWith('...')).toBe(true);
		});

		it('truncates without splitting a multi-byte character', () => {
			const long = 'é'.repeat(5000);
			const result = aggregateUnifiedResults([
				{key: 'a', code: 2, message: long},
			]);
			expect(Buffer.byteLength(result.message, 'utf8')).toBeLessThanOrEqual(
				4096,
			);
			// A split surrogate/byte would render as the replacement character.
			expect(result.message).not.toContain('\uFFFD');
		});

		it('uses the status text helper for the header and each problem', () => {
			aggregateUnifiedResults([
				{key: 'a', code: 1, message: 'warm'},
				{key: 'b', code: 2, message: 'broken'},
			]);
			// Header uses the worst code; each problem line uses its own code.
			expect(mockedStatusText).toHaveBeenCalledWith(2);
			expect(mockedStatusText).toHaveBeenCalledWith(1);
		});
	});
});
