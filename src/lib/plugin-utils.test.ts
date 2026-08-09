import {commandToRoutePath} from './plugin-utils';

describe('commandToRoutePath', () => {
	it('should convert command with hyphens to route path', () => {
		expect(commandToRoutePath('check-test')).toBe('/plugins/check-test');
	});

	it('should convert command with underscores to hyphens', () => {
		expect(commandToRoutePath('check_debian_eol')).toBe(
			'/plugins/check-debian-eol',
		);
		expect(commandToRoutePath('check_smart_status')).toBe(
			'/plugins/check-smart-status',
		);
	});

	it('should convert command to lowercase', () => {
		expect(commandToRoutePath('Check-Test')).toBe('/plugins/check-test');
		expect(commandToRoutePath('CHECK_TEST')).toBe('/plugins/check-test');
	});

	it('should replace special characters with hyphens', () => {
		expect(commandToRoutePath('check.test')).toBe('/plugins/check-test');
		expect(commandToRoutePath('check test')).toBe('/plugins/check-test');
	});

	it('should handle mixed cases', () => {
		expect(commandToRoutePath('Check_Demo_Ban_Eol')).toBe(
			'/plugins/check-demo-ban-eol',
		);
	});

	it('should handle single word commands', () => {
		expect(commandToRoutePath('test')).toBe('/plugins/test');
		expect(commandToRoutePath('check')).toBe('/plugins/check');
	});
});
