import {
	getStartupWarnings,
	recordStartupWarning,
	recordStartupWarnings,
	resetStartupWarnings,
} from './startup-warning-registry';

describe('startup warning registry', () => {
	beforeEach(() => {
		resetStartupWarnings();
	});

	test('records warnings once and preserves insertion order', () => {
		recordStartupWarning('first warning');
		recordStartupWarning('first warning');
		recordStartupWarning('second warning');

		expect(getStartupWarnings()).toEqual(['first warning', 'second warning']);
	});

	test('records multiple warnings and ignores blank values', () => {
		recordStartupWarnings(['', '  ', 'alpha', 'beta', 'alpha']);

		expect(getStartupWarnings()).toEqual(['alpha', 'beta']);
	});

	test('resets the stored warnings', () => {
		recordStartupWarning('reset me');
		resetStartupWarnings();

		expect(getStartupWarnings()).toEqual([]);
	});
});
