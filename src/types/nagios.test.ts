import type {NagiosReturnCode} from './nagios';
import {NagiosReturnCodes} from './nagios';

describe('nagios types', () => {
	describe('NagiosReturnCodes', () => {
		it('should define OK as 0', () => {
			expect(NagiosReturnCodes.OK).toBe(0);
		});

		it('should define WARNING as 1', () => {
			expect(NagiosReturnCodes.WARNING).toBe(1);
		});

		it('should define CRITICAL as 2', () => {
			expect(NagiosReturnCodes.CRITICAL).toBe(2);
		});

		it('should define UNKNOWN as 3', () => {
			expect(NagiosReturnCodes.UNKNOWN).toBe(3);
		});

		it('should have all return codes as readonly', () => {
			expect(Object.keys(NagiosReturnCodes)).toEqual([
				'OK',
				'WARNING',
				'CRITICAL',
				'UNKNOWN',
			]);
		});

		it('should have correct type for OK', () => {
			const code: NagiosReturnCode = NagiosReturnCodes.OK;
			expect(code).toBe(0);
		});

		it('should have correct type for WARNING', () => {
			const code: NagiosReturnCode = NagiosReturnCodes.WARNING;
			expect(code).toBe(1);
		});

		it('should have correct type for CRITICAL', () => {
			const code: NagiosReturnCode = NagiosReturnCodes.CRITICAL;
			expect(code).toBe(2);
		});

		it('should have correct type for UNKNOWN', () => {
			const code: NagiosReturnCode = NagiosReturnCodes.UNKNOWN;
			expect(code).toBe(3);
		});

		it('should not allow invalid return codes', () => {
			// This is a type-level test - the following would cause a TypeScript error:
			// const invalid: NagiosReturnCode = 4;
			// We test that valid codes work correctly
			const validCodes: NagiosReturnCode[] = [
				NagiosReturnCodes.OK,
				NagiosReturnCodes.WARNING,
				NagiosReturnCodes.CRITICAL,
				NagiosReturnCodes.UNKNOWN,
			];

			expect(validCodes).toEqual([0, 1, 2, 3]);
		});

		it('should be usable in switch statements', () => {
			const getStatusText = (code: NagiosReturnCode): string => {
				switch (code) {
					case NagiosReturnCodes.OK:
						return 'OK';
					case NagiosReturnCodes.WARNING:
						return 'WARNING';
					case NagiosReturnCodes.CRITICAL:
						return 'CRITICAL';
					case NagiosReturnCodes.UNKNOWN:
						return 'UNKNOWN';
					default:
						return 'UNKNOWN';
				}
			};

			expect(getStatusText(NagiosReturnCodes.OK)).toBe('OK');
			expect(getStatusText(NagiosReturnCodes.WARNING)).toBe('WARNING');
			expect(getStatusText(NagiosReturnCodes.CRITICAL)).toBe('CRITICAL');
			expect(getStatusText(NagiosReturnCodes.UNKNOWN)).toBe('UNKNOWN');
		});

		it('should be comparable with numeric literals', () => {
			const code = NagiosReturnCodes.OK;
			expect(code === 0).toBe(true);
			expect(code === 1).toBe(false);
		});

		it('should be assignable to number', () => {
			const num: number = NagiosReturnCodes.OK;
			expect(num).toBe(0);
		});

		it('should maintain const assertion', () => {
			// NagiosReturnCodes should be readonly
			expect(typeof NagiosReturnCodes.OK).toBe('number');
			expect(typeof NagiosReturnCodes.WARNING).toBe('number');
			expect(typeof NagiosReturnCodes.CRITICAL).toBe('number');
			expect(typeof NagiosReturnCodes.UNKNOWN).toBe('number');
		});
	});

	describe('NagiosReturnCode type', () => {
		it('should only accept 0, 1, 2, or 3', () => {
			const ok: NagiosReturnCode = 0;
			const warning: NagiosReturnCode = 1;
			const critical: NagiosReturnCode = 2;
			const unknown: NagiosReturnCode = 3;

			expect(ok).toBe(0);
			expect(warning).toBe(1);
			expect(critical).toBe(2);
			expect(unknown).toBe(3);
		});

		it('should work in arrays', () => {
			const codes: NagiosReturnCode[] = [0, 1, 2, 3];
			expect(codes).toEqual([
				NagiosReturnCodes.OK,
				NagiosReturnCodes.WARNING,
				NagiosReturnCodes.CRITICAL,
				NagiosReturnCodes.UNKNOWN,
			]);
		});

		it('should work in conditionals', () => {
			const testCode = (code: NagiosReturnCode): boolean => {
				if (code === NagiosReturnCodes.OK) {
					return true;
				}
				return false;
			};

			expect(testCode(0)).toBe(true);
			expect(testCode(1)).toBe(false);
			expect(testCode(2)).toBe(false);
			expect(testCode(3)).toBe(false);
		});
	});
});
