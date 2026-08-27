import {
	LOOPBACK_HOSTS,
	WILDCARD_HOSTS,
	resolveSelfRequestHost,
} from './network-identity';

describe('WILDCARD_HOSTS', () => {
	it('covers the IPv4, IPv6 and literal wildcard bind addresses', () => {
		expect(WILDCARD_HOSTS).toEqual(['0.0.0.0', '::', '*']);
	});
});

describe('LOOPBACK_HOSTS', () => {
	it('covers the hostname and both loopback addresses', () => {
		expect(LOOPBACK_HOSTS).toEqual(['localhost', '127.0.0.1', '::1']);
	});
});

describe('resolveSelfRequestHost', () => {
	it.each(WILDCARD_HOSTS)(
		'resolves the wildcard bind address %s to localhost',
		(bindHost) => {
			expect(resolveSelfRequestHost(bindHost)).toBe('localhost');
		},
	);

	it('keeps a specific IPv4 bind address', () => {
		expect(resolveSelfRequestHost('192.168.111.50')).toBe('192.168.111.50');
	});

	it('keeps a specific IPv6 bind address', () => {
		expect(resolveSelfRequestHost('fd00::10')).toBe('fd00::10');
	});

	it('keeps a specific hostname', () => {
		expect(resolveSelfRequestHost('nest.local')).toBe('nest.local');
	});

	it('keeps a loopback bind address as-is', () => {
		expect(resolveSelfRequestHost('127.0.0.1')).toBe('127.0.0.1');
	});
});
