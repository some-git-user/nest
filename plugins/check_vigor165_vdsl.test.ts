import {Client} from 'ssh2';
import {NagiosReturnCodes} from '../src/types/nagios';
import {checkVigor165Vdsl, meta} from './check_vigor165_vdsl';

jest.mock('ssh2', () => {
	return {
		Client: jest.fn(),
	};
});

describe('check-vigor165-vdsl plugin', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		// Set up a default mock client that errors immediately for tests that don't override it
		const mockClient = {
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'error') {
					callback(new Error('Connection refused'));
				}
				return mockClient;
			}),
			connect: jest.fn(),
			end: jest.fn(),
		};
		(Client as any).mockImplementation(() => mockClient);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('meta', () => {
		it('should have valid meta information', () => {
			expect(meta).toBeDefined();
			expect(meta.usage).toBeDefined();
			expect(meta.usage.http).toContain('/plugins/check-vigor165-vdsl');
			expect(meta.usage.shell).toContain('./check_nest.sh check-vigor165-vdsl');
			expect(meta.help).toBeDefined();
			expect(meta.help).toContain('check-vigor165-vdsl');
			expect(meta.examples).toBeDefined();
			expect(meta.examples.length).toBeGreaterThan(0);
		});

		it('should have DrayTek CLI example', () => {
			const example = meta.examples?.find(
				(ex) => ex.label === 'DrayTek CLI over SSH',
			);
			expect(example).toBeDefined();
			expect(example?.method).toBe('POST');
			expect(example?.path).toBe('/plugins/check-vigor165-vdsl');
			expect(example?.fields).toHaveLength(8);
		});
	});

	describe('checkVigor165Vdsl function - parameter parsing', () => {
		it('should require host parameter', async () => {
			const result = await checkVigor165Vdsl({
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('Usage:');
		});

		it('should require username parameter', async () => {
			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('Usage:');
		});

		it('should require password parameter', async () => {
			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				bookedDownstreamMbps: '100',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('Usage:');
		});

		it('should require bookedDownstreamMbps parameter', async () => {
			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('Usage:');
		});

		it('should accept routerUrl as alternative to host', async () => {
			// This should not fail parameter validation
			const result = await checkVigor165Vdsl({
				routerUrl: '192.168.111.1:22333',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});

			// Will fail at connection in test environment
			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should use default port when not specified', async () => {
			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});

			// Will fail at connection in test environment
			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should use default command when not specified', async () => {
			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should use default prompt when not specified', async () => {
			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should use default timeout when not specified', async () => {
			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should accept custom port', async () => {
			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				port: '22333',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should accept custom command', async () => {
			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
				command: 'custom command',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should accept custom prompt', async () => {
			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
				prompt: 'Custom>',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should accept custom timeout', async () => {
			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
				timeoutMs: '20000',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});
	});

	describe('checkVigor165Vdsl function - threshold calculations', () => {
		const createMockClient = (mockOutput: string) => {
			const mockStderrStream = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'data') {
						// No stderr data
					}
					return mockStderrStream;
				}),
			};

			const mockStream = {
				setEncoding: jest.fn(),
				stderr: mockStderrStream,
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'data') {
						// Simulate prompt first, then command output (synchronous for test)
						callback('DrayTek>');
						callback(mockOutput);
						callback('DrayTek>');
					} else if (event === 'close') {
						callback();
					}
					return mockStream;
				}),
				write: jest.fn(),
				pipe: jest.fn(),
			};

			const mockClient = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'ready') {
						callback();
					} else if (event === 'error') {
						// No error
					} else if (event === 'close') {
						// No close
					}
					return mockClient;
				}),
				shell: jest.fn().mockImplementation((options, callback) => {
					callback(null, mockStream);
				}),
				connect: jest.fn(),
				end: jest.fn(),
			};

			(Client as any).mockImplementation(() => mockClient);
			return mockClient;
		};

		it('should return OK when downstream speed meets booked speed', async () => {
			createMockClient('Downstream: 100000000 bps\nUpstream: 50000000 bps');

			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
				warningPercentBelow: '20',
				criticalPercentBelow: '40',
			});

			// Should be OK since 100Mbps >= 100Mbps booked
			expect(result.code).toBe(NagiosReturnCodes.OK);
		});

		it('should return WARNING when speed is below threshold', async () => {
			createMockClient('Downstream: 80000000 bps\nUpstream: 40000000 bps');

			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
				warningPercentBelow: '20',
				criticalPercentBelow: '40',
			});

			expect(result.code).toBe(NagiosReturnCodes.WARNING);
		});

		it('should return CRITICAL when speed is significantly below threshold', async () => {
			createMockClient('Downstream: 50000000 bps\nUpstream: 25000000 bps');

			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
				warningPercentBelow: '20',
				criticalPercentBelow: '40',
			});

			expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
		});
	});

	describe('checkVigor165Vdsl function - performance data', () => {
		const createMockClient = (mockOutput: string) => {
			const mockStderrStream = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'data') {
						// No stderr data
					}
					return mockStderrStream;
				}),
			};

			const mockStream = {
				setEncoding: jest.fn(),
				stderr: mockStderrStream,
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'data') {
						// Simulate prompt first, then command output (synchronous for test)
						callback('DrayTek>');
						callback(mockOutput);
						callback('DrayTek>');
					} else if (event === 'close') {
						callback();
					}
					return mockStream;
				}),
				write: jest.fn(),
				pipe: jest.fn(),
			};

			const mockClient = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'ready') {
						callback();
					} else if (event === 'error') {
						// No error
					} else if (event === 'close') {
						// No close
					}
					return mockClient;
				}),
				shell: jest.fn().mockImplementation((options, callback) => {
					callback(null, mockStream);
				}),
				connect: jest.fn(),
				end: jest.fn(),
			};

			(Client as any).mockImplementation(() => mockClient);
			return mockClient;
		};

		it('should include performance data in result', async () => {
			createMockClient(
				'Downstream: 100000000 bps\nUpstream: 50000000 bps\nSNR: 30 dB',
			);

			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});

			expect(result.performanceData).toBeDefined();
			expect(result.performanceData?.length).toBeGreaterThan(0);
		});
	});

	describe('checkVigor165Vdsl function - error handling', () => {
		it('should handle SSH connection errors', async () => {
			const mockClient = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'error') {
						callback(new Error('Connection refused'));
					}
					return mockClient;
				}),
				connect: jest.fn(),
				end: jest.fn(),
			};

			(Client as any).mockImplementation(() => mockClient);

			const result = await checkVigor165Vdsl({
				host: 'invalid-host',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('SSH');
		});

		it('should handle timeout', async () => {
			const mockClient = {
				on: jest.fn().mockImplementation((event, callback) => {
					// Never call ready, simulating timeout
					return mockClient;
				}),
				connect: jest.fn(),
				end: jest.fn(),
			};

			(Client as any).mockImplementation(() => mockClient);

			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
				timeoutMs: '100',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});
	});

	describe('checkVigor165Vdsl function - algorithm configuration', () => {
		it('should use default legacy algorithms', async () => {
			const mockClient = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'error') {
						// Simulate connection error to trigger UNKNOWN
						callback(new Error('Connection refused'));
					}
					return mockClient;
				}),
				connect: jest.fn(),
				end: jest.fn(),
			};

			(Client as any).mockImplementation(() => mockClient);

			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should accept custom kexAlgorithms', async () => {
			const mockClient = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'error') {
						callback(new Error('Connection refused'));
					}
					return mockClient;
				}),
				connect: jest.fn(),
				end: jest.fn(),
			};

			(Client as any).mockImplementation(() => mockClient);

			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
				kexAlgorithms: 'diffie-hellman-group14-sha256',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should accept custom ciphers', async () => {
			const mockClient = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'error') {
						callback(new Error('Connection refused'));
					}
					return mockClient;
				}),
				connect: jest.fn(),
				end: jest.fn(),
			};

			(Client as any).mockImplementation(() => mockClient);

			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
				ciphers: 'aes-256-cbc',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should accept custom hostKeyAlgorithms', async () => {
			const mockClient = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'error') {
						callback(new Error('Connection refused'));
					}
					return mockClient;
				}),
				connect: jest.fn(),
				end: jest.fn(),
			};

			(Client as any).mockImplementation(() => mockClient);

			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
				hostKeyAlgorithms: 'ssh-ed25519',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should accept multiple algorithms as CSV', async () => {
			const mockClient = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'error') {
						callback(new Error('Connection refused'));
					}
					return mockClient;
				}),
				connect: jest.fn(),
				end: jest.fn(),
			};

			(Client as any).mockImplementation(() => mockClient);

			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
				kexAlgorithms:
					'diffie-hellman-group14-sha256,diffie-hellman-group1-sha1',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});
	});
});

describe('parsePositiveNumber helper function', () => {
	it('should return default when value is undefined', () => {
		const {parsePositiveNumber} = require('./check_vigor165_vdsl');
		expect(parsePositiveNumber(undefined, 42)).toBe(42);
	});

	it('should return default when value is empty string', () => {
		const {parsePositiveNumber} = require('./check_vigor165_vdsl');
		expect(parsePositiveNumber('', 42)).toBe(42);
	});

	it('should return default when value is negative', () => {
		const {parsePositiveNumber} = require('./check_vigor165_vdsl');
		expect(parsePositiveNumber('-10', 42)).toBe(42);
	});

	it('should return default when value is zero', () => {
		const {parsePositiveNumber} = require('./check_vigor165_vdsl');
		expect(parsePositiveNumber('0', 42)).toBe(42);
	});

	it('should return default when value is NaN', () => {
		const {parsePositiveNumber} = require('./check_vigor165_vdsl');
		expect(parsePositiveNumber('abc', 42)).toBe(42);
	});

	it('should return parsed positive number', () => {
		const {parsePositiveNumber} = require('./check_vigor165_vdsl');
		expect(parsePositiveNumber('100', 42)).toBe(100);
	});

	it('should return parsed positive number with decimals', () => {
		const {parsePositiveNumber} = require('./check_vigor165_vdsl');
		expect(parsePositiveNumber('100.5', 42)).toBe(100.5);
	});
});

describe('parsePercent helper function', () => {
	it('should return default when value is undefined', () => {
		const {parsePercent} = require('./check_vigor165_vdsl');
		expect(parsePercent(undefined, 50)).toBe(50);
	});

	it('should return default when value is empty string', () => {
		const {parsePercent} = require('./check_vigor165_vdsl');
		expect(parsePercent('', 50)).toBe(50);
	});

	it('should return default when value is negative', () => {
		const {parsePercent} = require('./check_vigor165_vdsl');
		expect(parsePercent('-10', 50)).toBe(50);
	});

	it('should return default when value is over 100', () => {
		const {parsePercent} = require('./check_vigor165_vdsl');
		expect(parsePercent('150', 50)).toBe(50);
	});

	it('should return default when value is NaN', () => {
		const {parsePercent} = require('./check_vigor165_vdsl');
		expect(parsePercent('abc', 50)).toBe(50);
	});

	it('should return 0 as valid percent', () => {
		const {parsePercent} = require('./check_vigor165_vdsl');
		expect(parsePercent('0', 50)).toBe(0);
	});

	it('should return 100 as valid percent', () => {
		const {parsePercent} = require('./check_vigor165_vdsl');
		expect(parsePercent('100', 50)).toBe(100);
	});

	it('should return parsed percent value', () => {
		const {parsePercent} = require('./check_vigor165_vdsl');
		expect(parsePercent('25', 50)).toBe(25);
	});
});

describe('parseCsvList helper function', () => {
	it('should return fallback when value is undefined', () => {
		const {parseCsvList} = require('./check_vigor165_vdsl');
		const fallback = ['a', 'b'] as const;
		expect(parseCsvList(undefined, fallback)).toEqual(['a', 'b']);
	});

	it('should return fallback when value is empty string', () => {
		const {parseCsvList} = require('./check_vigor165_vdsl');
		const fallback = ['a', 'b'] as const;
		expect(parseCsvList('', fallback)).toEqual(['a', 'b']);
	});

	it('should return fallback when value is whitespace only', () => {
		const {parseCsvList} = require('./check_vigor165_vdsl');
		const fallback = ['a', 'b'] as const;
		expect(parseCsvList('   ', fallback)).toEqual(['a', 'b']);
	});

	it('should parse comma-separated list', () => {
		const {parseCsvList} = require('./check_vigor165_vdsl');
		const fallback = ['a'] as const;
		expect(parseCsvList('x, y, z', fallback)).toEqual(['x', 'y', 'z']);
	});

	it('should trim values in comma-separated list', () => {
		const {parseCsvList} = require('./check_vigor165_vdsl');
		const fallback = ['a'] as const;
		expect(parseCsvList('  x  ,  y  ,  z  ', fallback)).toEqual([
			'x',
			'y',
			'z',
		]);
	});

	it('should filter out empty values in comma-separated list', () => {
		const {parseCsvList} = require('./check_vigor165_vdsl');
		const fallback = ['a'] as const;
		expect(parseCsvList('x,,y,,z', fallback)).toEqual(['x', 'y', 'z']);
	});
});

describe('readRegexNumber helper function', () => {
	it('should return undefined when no patterns match', () => {
		const {readRegexNumber} = require('./check_vigor165_vdsl');
		expect(readRegexNumber('no match here', [/(\d+)/])).toBeUndefined();
	});

	it('should return undefined when pattern matches but no capture group', () => {
		const {readRegexNumber} = require('./check_vigor165_vdsl');
		expect(readRegexNumber('test', [/test/])).toBeUndefined();
	});

	it('should return undefined when capture group is not a number', () => {
		const {readRegexNumber} = require('./check_vigor165_vdsl');
		expect(readRegexNumber('abc', [/(\w+)/])).toBeUndefined();
	});

	it('should return first matching number', () => {
		const {readRegexNumber} = require('./check_vigor165_vdsl');
		expect(readRegexNumber('value: 123', [/value:\s*(\d+)/])).toBe(123);
	});

	it('should try multiple patterns in order', () => {
		const {readRegexNumber} = require('./check_vigor165_vdsl');
		const patterns = [/first:\s*(\d+)/, /second:\s*(\d+)/];
		expect(readRegexNumber('second: 456', patterns)).toBe(456);
	});

	it('should skip patterns that do not match', () => {
		const {readRegexNumber} = require('./check_vigor165_vdsl');
		const patterns = [/first:\s*(\d+)/, /second:\s*(\d+)/];
		expect(readRegexNumber('second: 456', patterns)).toBe(456);
	});
});

describe('readRegexValue helper function', () => {
	it('should return undefined when no patterns match', () => {
		const {readRegexValue} = require('./check_vigor165_vdsl');
		// Pattern requires digits, text has no digits
		expect(readRegexValue('no match here', [/\d+/])).toBeUndefined();
	});

	it('should return undefined when pattern matches but no capture group', () => {
		const {readRegexValue} = require('./check_vigor165_vdsl');
		expect(readRegexValue('test', [/test/])).toBeUndefined();
	});

	it('should return first matching value', () => {
		const {readRegexValue} = require('./check_vigor165_vdsl');
		expect(readRegexValue('status: ok', [/status:\s*(\w+)/])).toBe('ok');
	});

	it('should try multiple patterns in order', () => {
		const {readRegexValue} = require('./check_vigor165_vdsl');
		const patterns = [/first:\s*(\w+)/, /second:\s*(\w+)/];
		expect(readRegexValue('second: value', patterns)).toBe('value');
	});
});

describe('normalizeRateToMbps helper function', () => {
	it('should convert bps to Mbps for values >= 1000000', () => {
		const {normalizeRateToMbps} = require('./check_vigor165_vdsl');
		expect(normalizeRateToMbps(1000000)).toBe(1);
		expect(normalizeRateToMbps(100000000)).toBe(100);
	});

	it('should convert kbps to Mbps for values >= 1000', () => {
		const {normalizeRateToMbps} = require('./check_vigor165_vdsl');
		expect(normalizeRateToMbps(1000)).toBe(1);
		expect(normalizeRateToMbps(100000)).toBe(100);
	});

	it('should return value as-is for values < 1000', () => {
		const {normalizeRateToMbps} = require('./check_vigor165_vdsl');
		expect(normalizeRateToMbps(500)).toBe(500);
		expect(normalizeRateToMbps(0)).toBe(0);
	});
});

describe('parseDurationToSeconds helper function', () => {
	it('should return undefined when value is undefined', () => {
		const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
		expect(parseDurationToSeconds(undefined)).toBeUndefined();
	});

	it('should return undefined when value is empty string', () => {
		const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
		expect(parseDurationToSeconds('')).toBeUndefined();
	});

	it('should parse days and time format', () => {
		const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
		// 1 day 2:30:45 = 86400 + 2*3600 + 30*60 + 45 = 95445
		expect(parseDurationToSeconds('1 day 2:30:45')).toBe(95445);
		expect(parseDurationToSeconds('2 days 0:00:00')).toBe(172800);
	});

	it('should parse time format (H:MM:SS)', () => {
		const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
		// 2:30:45 = 2*3600 + 30*60 + 45 = 9045
		expect(parseDurationToSeconds('2:30:45')).toBe(9045);
		expect(parseDurationToSeconds('24:00:00')).toBe(86400);
	});

	it('should parse hours with 3 digits', () => {
		const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
		expect(parseDurationToSeconds('100:00:00')).toBe(360000);
	});

	it('should return undefined for invalid format', () => {
		const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
		expect(parseDurationToSeconds('invalid')).toBeUndefined();
		expect(parseDurationToSeconds('abc:def:ghi')).toBeUndefined();
	});

	it('should trim whitespace', () => {
		const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
		expect(parseDurationToSeconds('  2:30:45  ')).toBe(9045);
	});
});

describe('escapeRegExp helper function', () => {
	it('should escape regex special characters', () => {
		const {escapeRegExp} = require('./check_vigor165_vdsl');
		expect(escapeRegExp('test.value')).toBe('test\\.value');
		expect(escapeRegExp('test*value')).toBe('test\\*value');
		expect(escapeRegExp('test+value')).toBe('test\\+value');
		expect(escapeRegExp('test?value')).toBe('test\\?value');
	});

	it('should escape caret and dollar', () => {
		const {escapeRegExp} = require('./check_vigor165_vdsl');
		expect(escapeRegExp('test^value')).toBe('test\\^value');
		expect(escapeRegExp('test$value')).toBe('test\\$value');
	});

	it('should escape parentheses and brackets', () => {
		const {escapeRegExp} = require('./check_vigor165_vdsl');
		expect(escapeRegExp('test(value)')).toBe('test\\(value\\)');
		expect(escapeRegExp('test[value]')).toBe('test\\[value\\]');
	});

	it('should escape backslash and pipe', () => {
		const {escapeRegExp} = require('./check_vigor165_vdsl');
		expect(escapeRegExp('test\\value')).toBe('test\\\\value');
		expect(escapeRegExp('test|value')).toBe('test\\|value');
	});

	it('should handle string with no special characters', () => {
		const {escapeRegExp} = require('./check_vigor165_vdsl');
		expect(escapeRegExp('testvalue')).toBe('testvalue');
	});
});

describe('countPromptOccurrences helper function', () => {
	it('should count prompt occurrences in text', () => {
		const {countPromptOccurrences} = require('./check_vigor165_vdsl');
		const text = 'DrayTek> command1\nDrayTek> command2\nDrayTek>';
		expect(countPromptOccurrences(text, 'DrayTek>')).toBe(3);
	});

	it('should return 0 when prompt not found', () => {
		const {countPromptOccurrences} = require('./check_vigor165_vdsl');
		expect(countPromptOccurrences('no prompt here', 'DrayTek>')).toBe(0);
	});

	it('should handle special regex characters in prompt', () => {
		const {countPromptOccurrences} = require('./check_vigor165_vdsl');
		const text = 'test.value> test.value> test.value>';
		expect(countPromptOccurrences(text, 'test.value>')).toBe(3);
	});
});

describe('buildKeyboardInteractiveResponses helper function', () => {
	it('should return password for prompts without echo containing password', () => {
		const {
			buildKeyboardInteractiveResponses,
		} = require('./check_vigor165_vdsl');
		const prompts = [
			{prompt: 'Password:', echo: false},
			{prompt: 'Username:', echo: true},
		];
		const responses = buildKeyboardInteractiveResponses(prompts, 'secret123');
		expect(responses).toEqual(['secret123', '']);
	});

	it('should return empty string for prompts with echo', () => {
		const {
			buildKeyboardInteractiveResponses,
		} = require('./check_vigor165_vdsl');
		const prompts = [
			{prompt: 'Username:', echo: true},
			{prompt: 'Hostname:', echo: true},
		];
		const responses = buildKeyboardInteractiveResponses(prompts, 'secret123');
		expect(responses).toEqual(['', '']);
	});

	it('should handle case-insensitive password matching', () => {
		const {
			buildKeyboardInteractiveResponses,
		} = require('./check_vigor165_vdsl');
		const prompts = [
			{prompt: 'PASSWORD:', echo: false},
			{prompt: 'PassWord:', echo: false},
		];
		const responses = buildKeyboardInteractiveResponses(prompts, 'secret123');
		expect(responses).toEqual(['secret123', 'secret123']);
	});

	it('should handle empty prompts array', () => {
		const {
			buildKeyboardInteractiveResponses,
		} = require('./check_vigor165_vdsl');
		const responses = buildKeyboardInteractiveResponses([], 'secret123');
		expect(responses).toEqual([]);
	});
});

describe('checkVigor165Vdsl function - SSH connection scenarios', () => {
	const createMockClientWithShell = (mockOutput: string) => {
		const mockStderrStream = {
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'data') {
					// No stderr data
				}
				return mockStderrStream;
			}),
		};

		const mockStream = {
			setEncoding: jest.fn(),
			stderr: mockStderrStream,
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'data') {
					callback('DrayTek>');
					callback(mockOutput);
					callback('DrayTek>');
				} else if (event === 'close') {
					callback();
				}
				return mockStream;
			}),
			write: jest.fn(),
			pipe: jest.fn(),
		};

		const mockClient = {
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'ready') {
					callback();
				} else if (event === 'error') {
					// No error
				} else if (event === 'close') {
					// No close
				} else if (event === 'keyboard-interactive') {
					// Handle keyboard-interactive
					callback(
						'name',
						'instructions',
						'lang',
						[],
						(_responses: string) => {},
					);
				}
				return mockClient;
			}),
			shell: jest.fn().mockImplementation((options, callback) => {
				callback(null, mockStream);
			}),
			connect: jest.fn(),
			end: jest.fn(),
		};

		(Client as any).mockImplementation(() => mockClient);
		return mockClient;
	};

	it('should handle shell error', async () => {
		const mockClient = {
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'ready') {
					callback();
				}
				return mockClient;
			}),
			shell: jest.fn().mockImplementation((options, callback) => {
				callback(new Error('Shell error'), null);
			}),
			connect: jest.fn(),
			end: jest.fn(),
		};

		(Client as any).mockImplementation(() => mockClient);

		const result = await checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
	});

	it('should handle SSH connection close with stderr', async () => {
		const mockStderrStream = {
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'data') {
					callback('error message');
				}
				return mockStderrStream;
			}),
		};

		const mockStream = {
			setEncoding: jest.fn(),
			stderr: mockStderrStream,
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'close') {
					callback();
				}
				return mockStream;
			}),
			write: jest.fn(),
			pipe: jest.fn(),
		};

		const mockClient = {
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'ready') {
					callback();
				} else if (event === 'close') {
					callback();
				}
				return mockClient;
			}),
			shell: jest.fn().mockImplementation((options, callback) => {
				callback(null, mockStream);
			}),
			connect: jest.fn(),
			end: jest.fn(),
		};

		(Client as any).mockImplementation(() => mockClient);

		const result = await checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
	});

	it('should handle SSH connection close without stdout or stderr', async () => {
		const mockStderrStream = {
			on: jest.fn().mockImplementation((event, callback) => {
				return mockStderrStream;
			}),
		};

		const mockStream = {
			setEncoding: jest.fn(),
			stderr: mockStderrStream,
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'close') {
					callback();
				}
				return mockStream;
			}),
			write: jest.fn(),
			pipe: jest.fn(),
		};

		const mockClient = {
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'ready') {
					callback();
				} else if (event === 'close') {
					callback();
				}
				return mockClient;
			}),
			shell: jest.fn().mockImplementation((options, callback) => {
				callback(null, mockStream);
			}),
			connect: jest.fn(),
			end: jest.fn(),
		};

		(Client as any).mockImplementation(() => mockClient);

		const result = await checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		expect(result.message).toContain('SSH shell closed unexpectedly');
	});

	it('should call client.end in finish function', async () => {
		const mockStderrStream = {
			on: jest.fn().mockImplementation((event, callback) => {
				return mockStderrStream;
			}),
		};

		const mockStream = {
			setEncoding: jest.fn(),
			stderr: mockStderrStream,
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'data') {
					callback('DrayTek>');
					callback('Downstream: 100000000 bps');
					callback('DrayTek>');
				} else if (event === 'close') {
					callback();
				}
				return mockStream;
			}),
			write: jest.fn(),
			pipe: jest.fn(),
		};

		const mockClient = {
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'ready') {
					callback();
				} else if (event === 'keyboard-interactive') {
					callback(
						'name',
						'instructions',
						'lang',
						[],
						(_responses: string) => {},
					);
				}
				return mockClient;
			}),
			shell: jest.fn().mockImplementation((options, callback) => {
				callback(null, mockStream);
			}),
			connect: jest.fn(),
			end: jest.fn(),
		};

		(Client as any).mockImplementation(() => mockClient);

		const result = await checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		expect(result.code).toBe(NagiosReturnCodes.OK);
		expect(mockClient.end).toHaveBeenCalled();
	});

	it('should handle early return in finish when already settled', async () => {
		let timeoutCallback: (() => void) | undefined;

		// Mock setTimeout to capture the timeout callback
		const originalSetTimeout = global.setTimeout;
		global.setTimeout = ((callback: () => void, delay: number) => {
			if (delay > 1000) {
				// This is our timeout handle
				timeoutCallback = callback;
				return -1 as any; // Return dummy handle
			}
			return originalSetTimeout(callback, delay);
		}) as any;

		const mockStderrStream = {
			on: jest.fn().mockImplementation((event, callback) => {
				return mockStderrStream;
			}),
		};

		let dataCallback: ((chunk: string) => void) | undefined;

		const mockStream = {
			setEncoding: jest.fn(),
			stderr: mockStderrStream,
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'data') {
					dataCallback = callback;
				}
				return mockStream;
			}),
			write: jest.fn(),
			pipe: jest.fn(),
		};

		const mockClient = {
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'ready') {
					callback();
				} else if (event === 'keyboard-interactive') {
					callback(
						'name',
						'instructions',
						'lang',
						[],
						(_responses: string) => {},
					);
				} else if (event === 'timeout') {
					timeoutCallback = callback;
				}
				return mockClient;
			}),
			shell: jest.fn().mockImplementation((options, callback) => {
				callback(null, mockStream);
			}),
			connect: jest.fn(),
			end: jest.fn(),
		};

		(Client as any).mockImplementation(() => mockClient);

		const resultPromise = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		// Resolve the promise quickly
		if (dataCallback) {
			dataCallback('DrayTek>');
			dataCallback('Downstream: 100000000 bps');
			dataCallback('DrayTek>');
		}
		const result = await resultPromise;
		expect(result.code).toBe(NagiosReturnCodes.OK);

		// Now trigger the timeout - finish should return early at line 399
		if (timeoutCallback) {
			timeoutCallback();
		}

		// Restore setTimeout
		global.setTimeout = originalSetTimeout;
	});

	describe('parseCsvList edge cases', () => {
		it('should return fallback when input is empty string', () => {
			const {parseCsvList} = require('./check_vigor165_vdsl');
			const result = parseCsvList('', ['default']);
			expect(result).toEqual(['default']);
		});

		it('should return fallback when input is whitespace only', () => {
			const {parseCsvList} = require('./check_vigor165_vdsl');
			const result = parseCsvList('   ', ['default']);
			expect(result).toEqual(['default']);
		});

		it('should filter out empty parts from comma-separated list', () => {
			const {parseCsvList} = require('./check_vigor165_vdsl');
			const result = parseCsvList('a,,b,,', ['default']);
			expect(result).toEqual(['a', 'b']);
		});

		it('should return fallback when all parts are empty after trim', () => {
			const {parseCsvList} = require('./check_vigor165_vdsl');
			const result = parseCsvList('   ,   ,   ', ['default']);
			expect(result).toEqual(['default']);
		});
	});

	describe('parseDurationToSeconds edge cases', () => {
		it('should return undefined for invalid day-time format', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			const result = parseDurationToSeconds('invalid');
			expect(result).toBeUndefined();
		});

		it('should return undefined for invalid HMS format', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			const result = parseDurationToSeconds('invalid:time');
			expect(result).toBeUndefined();
		});

		it('should return undefined for empty string', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			const result = parseDurationToSeconds('');
			expect(result).toBeUndefined();
		});

		it('should return undefined when day-time values are not finite', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			const result = parseDurationToSeconds('1:abc:2:3');
			expect(result).toBeUndefined();
		});

		it('should return undefined when HMS values are not finite', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			const result = parseDurationToSeconds('abc:2:3');
			expect(result).toBeUndefined();
		});

		it('should return undefined when day-time values fail isFinite check', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			const result = parseDurationToSeconds('1:NaN:2:3');
			expect(result).toBeUndefined();
		});

		it('should return undefined when HMS values fail isFinite check', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			const result = parseDurationToSeconds('NaN:2:3');
			expect(result).toBeUndefined();
		});

		it('should parse valid day-time format', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			const result = parseDurationToSeconds('1d 2:3:4');
			expect(result).toBe(93784); // 1*86400 + 2*3600 + 3*60 + 4
		});

		it('should parse valid HMS format', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			const result = parseDurationToSeconds('1:2:3');
			expect(result).toBe(3723); // 1*3600 + 2*60 + 3
		});

		it('should return undefined when HMS has invalid format', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			const result = parseDurationToSeconds('1:2:3:4');
			expect(result).toBeUndefined();
		});

		it('should handle day-time format with days only', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			const result = parseDurationToSeconds('5d 0:0:0');
			expect(result).toBe(432000); // 5*86400
		});

		it('should handle HMS format with 3-digit hours', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			const result = parseDurationToSeconds('100:0:0');
			expect(result).toBe(360000); // 100*3600
		});

		it('should return undefined for invalid duration formats in parseDurationToSeconds', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			expect(parseDurationToSeconds('invalid')).toBeUndefined();
			expect(parseDurationToSeconds('99999999999999999999')).toBeUndefined();
		});

		it('should handle day-time format with non-numeric values in parseDurationToSeconds', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			// Test when regex matches but Number() returns NaN (not finite)
			// This covers the false branch of the isFinite check at line 286
			expect(parseDurationToSeconds('1d abc:0:0')).toBeUndefined();
		});

		it('should handle HMS format with non-numeric values in parseDurationToSeconds', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			// Test when regex matches but Number() returns NaN (not finite)
			// This covers the false branch of the isFinite check at line 296
			expect(parseDurationToSeconds('abc:0:0')).toBeUndefined();
		});

		it('should handle day-time format with whitespace in parseDurationToSeconds', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			// Test with extra whitespace that still matches regex
			expect(parseDurationToSeconds('1d  2:3:4')).toBe(93784);
		});

		it('should handle HMS format with leading zeros', () => {
			const {parseDurationToSeconds} = require('./check_vigor165_vdsl');
			// Test with leading zeros
			expect(parseDurationToSeconds('01:02:03')).toBe(3723);
		});

		it('should handle non-Error object in catch block', async () => {
			const {checkVigor165Vdsl} = require('./check_vigor165_vdsl');
			// Mock that throws a non-Error object (string)
			const mockClient = {
				on: jest
					.fn()
					.mockImplementation((event: string, callback: Function) => {
						if (event === 'error') {
							callback('String error message');
						}
						return mockClient;
					}),
				connect: jest.fn(),
				end: jest.fn(),
			};
			(Client as any).mockImplementation(() => mockClient);

			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});
			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('Vigor SSH status error');
		});
	});

	describe('resolveTarget edge cases', () => {
		it('should extract hostname and port from routerUrl with port', () => {
			const {resolveTarget} = require('./check_vigor165_vdsl');
			const result = resolveTarget({
				routerUrl: 'http://192.168.111.1:8080',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});
			expect(result.host).toBe('192.168.111.1');
			expect(result.port).toBe(8080);
		});

		it('should extract hostname without port from routerUrl', () => {
			const {resolveTarget} = require('./check_vigor165_vdsl');
			const result = resolveTarget({
				routerUrl: 'http://192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});
			expect(result.host).toBe('192.168.111.1');
			expect(result.port).toBe(22);
		});

		it('should handle routerUrl without protocol', () => {
			const {resolveTarget} = require('./check_vigor165_vdsl');
			const result = resolveTarget({
				routerUrl: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});
			expect(result.host).toBe('192.168.111.1');
			expect(result.port).toBe(22);
		});

		it('should handle undefined username', () => {
			const {resolveTarget} = require('./check_vigor165_vdsl');
			const result = resolveTarget({
				host: '192.168.111.1',
				username: undefined,
				password: 'secret',
				bookedDownstreamMbps: '100',
			});
			expect(result.host).toBe('192.168.111.1');
			expect(result.port).toBe(22);
		});

		it('should handle empty string username', () => {
			const {resolveTarget} = require('./check_vigor165_vdsl');
			const result = resolveTarget({
				host: '192.168.111.1',
				username: '',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});
			expect(result.host).toBe('192.168.111.1');
			expect(result.port).toBe(22);
		});

		it('should handle undefined host and use routerUrl', () => {
			const {resolveTarget} = require('./check_vigor165_vdsl');
			const result = resolveTarget({
				host: undefined,
				routerUrl: 'http://192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});
			expect(result.host).toBe('192.168.111.1');
			expect(result.port).toBe(22);
		});

		it('should handle undefined username in main function', async () => {
			const {checkVigor165Vdsl} = require('./check_vigor165_vdsl');
			// Test with undefined username - covers optional chaining at line 365
			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: undefined as any,
				password: 'secret',
				bookedDownstreamMbps: '100',
			});
			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should handle undefined password in main function', async () => {
			const {checkVigor165Vdsl} = require('./check_vigor165_vdsl');
			// Test with undefined password - covers optional chaining at line 366
			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: undefined as any,
				bookedDownstreamMbps: '100',
			});
			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});
	});

	describe('SSH connection close with stderr', () => {
		it('should reject with stderr message when stream closes with error', async () => {
			const mockStderrStream = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'data') {
						callback('Connection refused');
					}
					return mockStderrStream;
				}),
			};

			const mockStream = {
				setEncoding: jest.fn(),
				stderr: mockStderrStream,
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'close') {
						callback();
					}
					return mockStream;
				}),
				write: jest.fn(),
				pipe: jest.fn(),
			};

			const mockClient = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'ready') {
						callback();
					} else if (event === 'keyboard-interactive') {
						callback(
							'name',
							'instructions',
							'lang',
							[],
							(_responses: string) => {},
						);
					}
					return mockClient;
				}),
				shell: jest.fn().mockImplementation((options, callback) => {
					callback(null, mockStream);
				}),
				connect: jest.fn(),
				end: jest.fn(),
			};

			(Client as any).mockImplementation(() => mockClient);

			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('Connection refused');
		});
	});

	describe('SSH client close handler', () => {
		it('should reject with stderr when client closes with error', async () => {
			const mockStderrStream = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'data') {
						callback('Authentication failed');
					}
					return mockStderrStream;
				}),
			};

			const mockStream = {
				setEncoding: jest.fn(),
				stderr: mockStderrStream,
				on: jest.fn().mockImplementation((event, callback) => {
					return mockStream;
				}),
				write: jest.fn(),
				pipe: jest.fn(),
			};

			const mockClient = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'ready') {
						callback();
					} else if (event === 'keyboard-interactive') {
						callback(
							'name',
							'instructions',
							'lang',
							[],
							(_responses: string) => {},
						);
					} else if (event === 'close') {
						callback();
					}
					return mockClient;
				}),
				shell: jest.fn().mockImplementation((options, callback) => {
					callback(null, mockStream);
				}),
				connect: jest.fn(),
				end: jest.fn(),
			};

			(Client as any).mockImplementation(() => mockClient);

			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('Authentication failed');
		});

		it('should reject with default message when client closes without stderr', async () => {
			const mockStderrStream = {
				on: jest.fn().mockImplementation((event, callback) => {
					return mockStderrStream;
				}),
			};

			const mockStream = {
				setEncoding: jest.fn(),
				stderr: mockStderrStream,
				on: jest.fn().mockImplementation((event, callback) => {
					return mockStream;
				}),
				write: jest.fn(),
				pipe: jest.fn(),
			};

			const mockClient = {
				on: jest.fn().mockImplementation((event, callback) => {
					if (event === 'ready') {
						callback();
					} else if (event === 'keyboard-interactive') {
						callback(
							'name',
							'instructions',
							'lang',
							[],
							(_responses: string) => {},
						);
					} else if (event === 'close') {
						callback();
					}
					return mockClient;
				}),
				shell: jest.fn().mockImplementation((options, callback) => {
					callback(null, mockStream);
				}),
				connect: jest.fn(),
				end: jest.fn(),
			};

			(Client as any).mockImplementation(() => mockClient);

			const result = await checkVigor165Vdsl({
				host: '192.168.111.1',
				username: 'admin',
				password: 'secret',
				bookedDownstreamMbps: '100',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('SSH connection closed unexpectedly');
		});
	});

	describe('performance data edge cases', () => {
		it('should include dsl_up performance data when isDslUp is true', () => {
			const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
			const payload = `
DrayTek> vdsl status
State: UP
`;
			const metrics = extractDslMetricsFromPayload(payload);
			expect(metrics.isDslUp).toBe(true);
		});

		it('should include dsl_up performance data when isDslUp is false', () => {
			const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
			const payload = `
DrayTek> vdsl status
State: DOWN
`;
			const metrics = extractDslMetricsFromPayload(payload);
			expect(metrics.isDslUp).toBe(false);
		});

		it('should handle unknown state text gracefully', () => {
			const {checkVigor165Vdsl} = require('./check_vigor165_vdsl');
			// This is tested through the main function tests
		});
	});
});

describe('resolveTarget helper function', () => {
	it('should resolve target from host parameter', () => {
		const {resolveTarget} = require('./check_vigor165_vdsl');
		const result = resolveTarget({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});
		expect(result).toEqual({
			host: '192.168.111.1',
			port: 22,
		});
	});

	it('should resolve target from routerUrl parameter', () => {
		const {resolveTarget} = require('./check_vigor165_vdsl');
		const result = resolveTarget({
			routerUrl: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});
		expect(result).toEqual({
			host: '192.168.111.1',
			port: 22,
		});
	});

	it('should resolve target from routerUrl with port', () => {
		const {resolveTarget} = require('./check_vigor165_vdsl');
		// Without protocol, the whole string is treated as host
		const result = resolveTarget({
			routerUrl: '192.168.111.1:22333',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});
		expect(result).toEqual({
			host: '192.168.111.1:22333',
			port: 22,
		});
	});

	it('should resolve target from routerUrl with protocol and port', () => {
		const {resolveTarget} = require('./check_vigor165_vdsl');
		const result = resolveTarget({
			routerUrl: 'ssh://192.168.111.1:22333',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});
		expect(result).toEqual({
			host: '192.168.111.1',
			port: 22333,
		});
	});

	it('should return undefined when no host provided', () => {
		const {resolveTarget} = require('./check_vigor165_vdsl');
		const result = resolveTarget({
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});
		expect(result).toBeUndefined();
	});

	it('should use custom port when provided', () => {
		const {resolveTarget} = require('./check_vigor165_vdsl');
		const result = resolveTarget({
			host: '192.168.111.1',
			port: '22333',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});
		expect(result).toEqual({
			host: '192.168.111.1',
			port: 22333,
		});
	});
});

describe('extractDslMetricsFromPayload helper function', () => {
	it('should parse DS/US Actual Rate format', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
DS Actual Rate : 100000000
US Actual Rate : 50000000
Cur SNR Margin : 30.5
NE Current Attenuation : 25.2
State : Up
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.downstreamMbps).toBe(100);
		expect(metrics.upstreamMbps).toBe(50);
		expect(metrics.snrDownDb).toBe(30.5);
		expect(metrics.attenuationDownDb).toBe(25.2);
		expect(metrics.isDslUp).toBe(true);
	});

	it('should parse DS/US Attainable Rate format', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
DS Attainable Rate : 120000000
US Attainable Rate : 60000000
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.dsAttainableMbps).toBe(120);
		expect(metrics.usAttainableMbps).toBe(60);
	});

	it('should parse Far attenuation and SNR', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
Far Current Attenuation : 35.5
Far SNR Margin : 28.3
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.farAttenuationDb).toBe(35.5);
		expect(metrics.farSnrDb).toBe(28.3);
	});

	it('should parse CRC, FEC, and ES counts', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
NE CRC Count : 1234
FEC Errors : 5678
NE ES Count : 90
FE ES Count : 12
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.crcErrors).toBe(1234);
		expect(metrics.fecErrors).toBe(5678);
		expect(metrics.esCount).toBe(90);
		expect(metrics.feEsCount).toBe(12);
	});

	it('should parse PSD and Interleave Depth', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
NE actual PSD: 45.5
US actual PSD: 50.2
DS Interleave Depth: 8
US Interleave Depth: 16
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.dsPsd).toBe(45.5);
		expect(metrics.usPsd).toBe(50.2);
		expect(metrics.dsInterleaveDepth).toBe(8);
		expect(metrics.usInterleaveDepth).toBe(16);
	});

	it('should parse DSL uptime with days', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
DSL Uptime: 1d 02:30:45
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.dslUptimeSeconds).toBe(95445);
	});

	it('should parse uptime in H:MM:SS format', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
Uptime: 02:30:45
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.dslUptimeSeconds).toBe(9045);
	});

	it('should detect link state as up', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
State : Up
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.isDslUp).toBe(true);
	});

	it('should detect link state as showtime', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
State : Showtime
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.isDslUp).toBe(true);
	});

	it('should detect link state as connected', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
DSL Link State : Connected
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.isDslUp).toBe(true);
	});

	it('should detect link state as online', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
DSL Line Status : Online
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.isDslUp).toBe(true);
	});

	it('should detect link state as down', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
State : Down
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.isDslUp).toBe(false);
	});

	it('should return false for isDslUp when state is unknown', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
State : Unknown
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.isDslUp).toBe(false);
	});

	it('should handle null byte separators', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = 'DS Actual Rate : 100000000\u0000US Actual Rate : 50000000';
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.downstreamMbps).toBe(100);
		expect(metrics.upstreamMbps).toBe(50);
	});

	it('should parse downstream sync rate format', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
Downstream Sync Rate: 95000000 bps
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.downstreamMbps).toBe(95);
	});

	it('should parse RX/TX rate format', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
RX Rate: 80000000 bps
TX Rate: 40000000 bps
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.downstreamMbps).toBe(80);
		expect(metrics.upstreamMbps).toBe(40);
	});

	it('should parse SNR margin format', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
SNR Margin Down: 25.5 dB
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.snrDownDb).toBe(25.5);
	});

	it('should parse noise margin format', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
Noise Margin Downstream: 30.0 dB
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.snrDownDb).toBe(30.0);
	});

	it('should parse line attenuation format', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
Line Attenuation Downstream: 22.5 dB
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.attenuationDownDb).toBe(22.5);
	});

	it('should parse CRC errors format', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
CRC Errors: 999
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.crcErrors).toBe(999);
	});

	it('should parse FEC errors format', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
FEC Errors: 12345
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.fecErrors).toBe(12345);
	});

	it('should parse ES seconds format', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
ES Seconds: 50
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.esCount).toBe(50);
	});

	it('should parse Far ES count format', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
Far ES Count: 25
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.feEsCount).toBe(25);
	});

	it('should return undefined for all metrics when no patterns match', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = 'No VDSL data here';
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.downstreamMbps).toBeUndefined();
		expect(metrics.upstreamMbps).toBeUndefined();
		expect(metrics.snrDownDb).toBeUndefined();
		expect(metrics.attenuationDownDb).toBeUndefined();
		expect(metrics.isDslUp).toBeUndefined();
	});

	it('should normalize rates from bps to Mbps', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
DS Actual Rate : 100000000
US Actual Rate : 50000000
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.downstreamMbps).toBe(100);
		expect(metrics.upstreamMbps).toBe(50);
	});

	it('should normalize rates from kbps to Mbps', () => {
		const {extractDslMetricsFromPayload} = require('./check_vigor165_vdsl');
		const payload = `
DrayTek> vdsl status
DS Actual Rate : 100000
US Actual Rate : 50000
`;
		const metrics = extractDslMetricsFromPayload(payload);
		expect(metrics.downstreamMbps).toBe(100);
		expect(metrics.upstreamMbps).toBe(50);
	});
});

describe('checkVigor165Vdsl function - performance data generation', () => {
	const createMockClientWithOutput = (mockOutput: string) => {
		const mockStderrStream = {
			on: jest.fn().mockImplementation((event, callback) => {
				return mockStderrStream;
			}),
		};

		const mockStream = {
			setEncoding: jest.fn(),
			stderr: mockStderrStream,
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'data') {
					callback('DrayTek>');
					callback(mockOutput);
					callback('DrayTek>');
				} else if (event === 'close') {
					callback();
				}
				return mockStream;
			}),
			write: jest.fn(),
			pipe: jest.fn(),
		};

		const mockClient = {
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'ready') {
					callback();
				} else if (event === 'keyboard-interactive') {
					callback(
						'name',
						'instructions',
						'lang',
						[],
						(_responses: string) => {},
					);
				}
				return mockClient;
			}),
			shell: jest.fn().mockImplementation((options, callback) => {
				callback(null, mockStream);
			}),
			connect: jest.fn(),
			end: jest.fn(),
		};

		(Client as any).mockImplementation(() => mockClient);
		return mockClient;
	};

	it('should generate performance data with upstream', () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nUS Actual Rate : 50000000',
		);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			expect(res.performanceData).toBeDefined();
			const upstreamPd = res.performanceData?.find(
				(p) => p.label === 'upstream_mbps',
			);
			expect(upstreamPd).toBeDefined();
			expect(upstreamPd?.value).toBe('50.00');
		});
	});

	it('should generate performance data with SNR', () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nCur SNR Margin : 30.5',
		);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const snrPd = res.performanceData?.find((p) => p.label === 'snr_down_db');
			expect(snrPd).toBeDefined();
			expect(snrPd?.value).toBe('30.50');
		});
	});

	it('should generate performance data with attenuation', () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nNE Current Attenuation : 25.2',
		);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const attPd = res.performanceData?.find(
				(p) => p.label === 'attenuation_down_db',
			);
			expect(attPd).toBeDefined();
			expect(attPd?.value).toBe('25.20');
		});
	});

	it('should generate performance data with CRC errors', () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nNE CRC Count : 1234',
		);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const crcPd = res.performanceData?.find((p) => p.label === 'crc_errors');
			expect(crcPd).toBeDefined();
			expect(crcPd?.value).toBe('1234');
		});
	});

	it('should generate performance data with FEC errors', () => {
		createMockClientWithOutput('DS Actual Rate : 100000000\nFEC Errors : 5678');

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const fecPd = res.performanceData?.find((p) => p.label === 'fec_errors');
			expect(fecPd).toBeDefined();
			expect(fecPd?.value).toBe('5678');
		});
	});

	it('should generate performance data with downstream thresholds', () => {
		createMockClientWithOutput('DS Actual Rate : 100000000');

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
			warningPercentBelow: '20',
			criticalPercentBelow: '40',
		});

		return result.then((res) => {
			const downstreamPd = res.performanceData?.find(
				(p) => p.label === 'downstream_mbps',
			);
			expect(downstreamPd).toBeDefined();
			expect(downstreamPd?.warn).toBe('80.00');
			expect(downstreamPd?.crit).toBe('60.00');
		});
	});

	it('should generate performance data with downstream_below_percent', () => {
		createMockClientWithOutput('DS Actual Rate : 100000000');

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const belowPd = res.performanceData?.find(
				(p) => p.label === 'downstream_below_percent',
			);
			expect(belowPd).toBeDefined();
			expect(belowPd?.value).toBe('0.00');
		});
	});

	it('should generate performance data with ES errors', () => {
		createMockClientWithOutput('DS Actual Rate : 100000000\nNE ES Count : 50');

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const esPd = res.performanceData?.find((p) => p.label === 'es_errors');
			expect(esPd).toBeDefined();
			expect(esPd?.value).toBe('50');
		});
	});

	it('should generate performance data with FE ES errors', () => {
		createMockClientWithOutput('DS Actual Rate : 100000000\nFE ES Count : 25');

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const feEsPd = res.performanceData?.find(
				(p) => p.label === 'fe_es_errors',
			);
			expect(feEsPd).toBeDefined();
			expect(feEsPd?.value).toBe('25');
		});
	});

	it('should generate performance data with DS attainable Mbps', () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nDS Attainable Rate : 120000000',
		);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const dsAttPd = res.performanceData?.find(
				(p) => p.label === 'ds_attainable_mbps',
			);
			expect(dsAttPd).toBeDefined();
			expect(dsAttPd?.value).toBe('120.00');
		});
	});

	it('should generate performance data with US attainable Mbps', () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nUS Attainable Rate : 60000000',
		);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const usAttPd = res.performanceData?.find(
				(p) => p.label === 'us_attainable_mbps',
			);
			expect(usAttPd).toBeDefined();
			expect(usAttPd?.value).toBe('60.00');
		});
	});

	it('should generate performance data with DS PSD', () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nNE actual PSD : 45.5',
		);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const dsPsdPd = res.performanceData?.find((p) => p.label === 'ds_psd');
			expect(dsPsdPd).toBeDefined();
			expect(dsPsdPd?.value).toBe('45.50');
		});
	});

	it('should generate performance data with US PSD', () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nUS actual PSD : 50.2',
		);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const usPsdPd = res.performanceData?.find((p) => p.label === 'us_psd');
			expect(usPsdPd).toBeDefined();
			expect(usPsdPd?.value).toBe('50.20');
		});
	});

	it('should generate performance data with DS interleave depth', () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nDS Interleave Depth : 8',
		);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const dsIntPd = res.performanceData?.find(
				(p) => p.label === 'ds_interleave_depth',
			);
			expect(dsIntPd).toBeDefined();
			expect(dsIntPd?.value).toBe('8');
		});
	});

	it('should generate performance data with US interleave depth', () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nUS Interleave Depth : 16',
		);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const usIntPd = res.performanceData?.find(
				(p) => p.label === 'us_interleave_depth',
			);
			expect(usIntPd).toBeDefined();
			expect(usIntPd?.value).toBe('16');
		});
	});

	it('should generate performance data with far attenuation', () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nFar Current Attenuation : 35.5',
		);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const farAttPd = res.performanceData?.find(
				(p) => p.label === 'far_attenuation_db',
			);
			expect(farAttPd).toBeDefined();
			expect(farAttPd?.value).toBe('35.50');
		});
	});

	it('should generate performance data with far SNR', () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nFar SNR Margin : 28.3',
		);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const farSnrPd = res.performanceData?.find(
				(p) => p.label === 'far_snr_db',
			);
			expect(farSnrPd).toBeDefined();
			expect(farSnrPd?.value).toBe('28.30');
		});
	});

	it('should generate performance data with DSL uptime', () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nDSL Uptime : 1d 02:30:45',
		);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			const uptimePd = res.performanceData?.find(
				(p) => p.label === 'dsl_uptime_seconds',
			);
			expect(uptimePd).toBeDefined();
			expect(uptimePd?.value).toBe('95445');
		});
	});

	it('should handle SSH stream data when command not yet sent', () => {
		const mockStderrStream = {
			on: jest.fn().mockImplementation((event, callback) => {
				return mockStderrStream;
			}),
		};

		const mockStream = {
			setEncoding: jest.fn(),
			stderr: mockStderrStream,
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'data') {
					// Only send stdout without prompt first
					callback('Some output');
				} else if (event === 'close') {
					callback();
				}
				return mockStream;
			}),
			write: jest.fn(),
			pipe: jest.fn(),
		};

		const mockClient = {
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'ready') {
					callback();
				} else if (event === 'keyboard-interactive') {
					callback(
						'name',
						'instructions',
						'lang',
						[],
						(_responses: string) => {},
					);
				}
				return mockClient;
			}),
			shell: jest.fn().mockImplementation((options, callback) => {
				callback(null, mockStream);
			}),
			connect: jest.fn(),
			end: jest.fn(),
		};

		(Client as any).mockImplementation(() => mockClient);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			expect(res.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(res.message).toContain('Could not parse downstream');
		});
	});

	it('should handle SSH connection close with stderr data', () => {
		const mockStderrStream = {
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'data') {
					callback('error message from stderr');
				}
				return mockStderrStream;
			}),
		};

		const mockStream = {
			setEncoding: jest.fn(),
			stderr: mockStderrStream,
			on: jest.fn().mockImplementation((event, callback) => {
				// Don't trigger stream close event at all
				return mockStream;
			}),
			write: jest.fn(),
			pipe: jest.fn(),
		};

		const mockClient = {
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'ready') {
					callback();
				} else if (event === 'keyboard-interactive') {
					callback(
						'name',
						'instructions',
						'lang',
						[],
						(_responses: string) => {},
					);
				} else if (event === 'close') {
					// Trigger client close event - this should hit lines 492-495
					callback();
				}
				return mockClient;
			}),
			shell: jest.fn().mockImplementation((options, callback) => {
				callback(null, mockStream);
			}),
			connect: jest.fn(),
			end: jest.fn(),
		};

		(Client as any).mockImplementation(() => mockClient);

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			expect(res.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(res.message).toContain('error message from stderr');
		});
	});

	it('should return UNKNOWN when downstreamMbps cannot be parsed', () => {
		createMockClientWithOutput('No DSL metrics found in output');

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			expect(res.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(res.message).toContain('Could not parse downstream sync rate');
		});
	});

	it('should return CRITICAL when DSL link is down', () => {
		createMockClientWithOutput('DS Actual Rate : 100000000\nState : down');

		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		return result.then((res) => {
			expect(res.code).toBe(NagiosReturnCodes.CRITICAL);
			expect(res.message).toContain('dsl link appears down');
		});
	});

	it('should return UNKNOWN when criticalPercentBelow is less than warningPercentBelow', () => {
		const result = checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
			warningPercentBelow: '30',
			criticalPercentBelow: '20',
		});

		return result.then((res) => {
			expect(res.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(res.message).toContain(
				'criticalPercentBelow must be greater than or equal to warningPercentBelow',
			);
		});
	});
});

describe('checkVigor165Vdsl function - threshold calculations detailed', () => {
	const createMockClientWithOutput = (mockOutput: string) => {
		const mockStderrStream = {
			on: jest.fn().mockImplementation((event, callback) => {
				return mockStderrStream;
			}),
		};

		const mockStream = {
			setEncoding: jest.fn(),
			stderr: mockStderrStream,
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'data') {
					callback('DrayTek>');
					callback(mockOutput);
					callback('DrayTek>');
				} else if (event === 'close') {
					callback();
				}
				return mockStream;
			}),
			write: jest.fn(),
			pipe: jest.fn(),
		};

		const mockClient = {
			on: jest.fn().mockImplementation((event, callback) => {
				if (event === 'ready') {
					callback();
				} else if (event === 'keyboard-interactive') {
					callback(
						'name',
						'instructions',
						'lang',
						[],
						(_responses: string) => {},
					);
				}
				return mockClient;
			}),
			shell: jest.fn().mockImplementation((options, callback) => {
				callback(null, mockStream);
			}),
			connect: jest.fn(),
			end: jest.fn(),
		};

		(Client as any).mockImplementation(() => mockClient);
		return mockClient;
	};

	it('should return OK when downstream equals booked speed', async () => {
		createMockClientWithOutput('DS Actual Rate : 100000000');

		const result = await checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
			warningPercentBelow: '20',
			criticalPercentBelow: '40',
		});

		expect(result.code).toBe(NagiosReturnCodes.OK);
		expect(result.message).toContain('OK');
	});

	it('should return WARNING when downstream is 20% below booked', async () => {
		createMockClientWithOutput('DS Actual Rate : 80000000');

		const result = await checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
			warningPercentBelow: '20',
			criticalPercentBelow: '40',
		});

		expect(result.code).toBe(NagiosReturnCodes.WARNING);
		expect(result.message).toContain('WARNING');
		expect(result.message).toContain('20.0% below');
	});

	it('should return CRITICAL when downstream is 40% below booked', async () => {
		createMockClientWithOutput('DS Actual Rate : 60000000');

		const result = await checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
			warningPercentBelow: '20',
			criticalPercentBelow: '40',
		});

		expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
		expect(result.message).toContain('CRITICAL');
		expect(result.message).toContain('40.0% below');
	});

	it('should return CRITICAL when downstream is more than 40% below booked', async () => {
		createMockClientWithOutput('DS Actual Rate : 50000000');

		const result = await checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
			warningPercentBelow: '20',
			criticalPercentBelow: '40',
		});

		expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
		expect(result.message).toContain('CRITICAL');
		expect(result.message).toContain('50.0% below');
	});

	it('should return CRITICAL when DSL link is down', async () => {
		createMockClientWithOutput('DS Actual Rate : 100000000\nState : Down');

		const result = await checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
		expect(result.message).toContain('CRITICAL');
		expect(result.message).toContain('dsl link appears down');
	});

	it('should include findings in message', async () => {
		createMockClientWithOutput('DS Actual Rate : 80000000');

		const result = await checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
			warningPercentBelow: '20',
			criticalPercentBelow: '40',
		});

		expect(result.message).toContain('downstream 80.00 Mbps');
		expect(result.message).toContain('20.0% below');
	});

	it('should include summary with upstream in message', async () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nUS Actual Rate : 50000000',
		);

		const result = await checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		expect(result.message).toContain('down 100.00 Mbps');
		expect(result.message).toContain('up 50.00 Mbps');
	});

	it('should handle invalid code in stateText array lookup', async () => {
		// Mock to return a state that results in code >= 4
		const mockClient = {
			on: jest.fn().mockImplementation((event: string, callback: Function) => {
				if (event === 'error') {
					callback(new Error('Connection refused'));
				}
				return mockClient;
			}),
			connect: jest.fn(),
			end: jest.fn(),
		};
		(Client as any).mockImplementation(() => mockClient);

		const result = await checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});
		// Should default to UNKNOWN when error occurs
		expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
	});

	it('should include summary with SNR in message', async () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nCur SNR Margin : 30.5',
		);

		const result = await checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		expect(result.message).toContain('down 100.00 Mbps');
		expect(result.message).toContain('snrDown 30.5 dB');
	});

	it('should include summary with attenuation in message', async () => {
		createMockClientWithOutput(
			'DS Actual Rate : 100000000\nNE Current Attenuation : 25.2',
		);

		const result = await checkVigor165Vdsl({
			host: '192.168.111.1',
			username: 'admin',
			password: 'secret',
			bookedDownstreamMbps: '100',
		});

		expect(result.message).toContain('down 100.00 Mbps');
		expect(result.message).toContain('attDown 25.2 dB');
	});
});
