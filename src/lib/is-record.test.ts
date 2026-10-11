import {isRecord} from './is-record';

describe('isRecord', () => {
	it('accepts a plain object', () => {
		expect(isRecord({a: 1})).toBe(true);
	});

	it('accepts an empty object', () => {
		expect(isRecord({})).toBe(true);
	});

	it('rejects null', () => {
		expect(isRecord(null)).toBe(false);
	});

	it('rejects an array', () => {
		expect(isRecord([1, 2, 3])).toBe(false);
	});

	it('rejects a non-object', () => {
		expect(isRecord('text')).toBe(false);
	});
});
