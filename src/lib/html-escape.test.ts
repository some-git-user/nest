import {escapeHtml} from './html-escape';

describe('escapeHtml', () => {
	it('returns plain text unchanged', () => {
		expect(escapeHtml('hello world')).toBe('hello world');
	});

	it('escapes ampersands', () => {
		expect(escapeHtml('a & b')).toBe('a &amp; b');
	});

	it('escapes angle brackets', () => {
		expect(escapeHtml('<script>alert(1)</script>')).toBe(
			'&lt;script&gt;alert(1)&lt;/script&gt;',
		);
	});

	it('escapes double quotes', () => {
		expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;');
	});

	it('escapes a combination of characters', () => {
		expect(escapeHtml('<a href="x">&</a>')).toBe(
			'&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;',
		);
	});

	it('handles an empty string', () => {
		expect(escapeHtml('')).toBe('');
	});
});
