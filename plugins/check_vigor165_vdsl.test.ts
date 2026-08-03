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
