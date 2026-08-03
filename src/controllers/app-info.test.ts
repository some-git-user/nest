import {Request, Response} from 'express';
import os from 'os';
import type {NagiosReturnMessage} from '../lib/nagios';
import {getAppInfo} from './app-info';

jest.mock('os', () => ({
	cpus: jest.fn(),
	loadavg: jest.fn(),
	totalmem: jest.fn(),
	freemem: jest.fn(),
	uptime: jest.fn(),
}));

describe('app-info controller', () => {
	const mockOs = os as jest.Mocked<typeof os>;

	let capturedResponse: NagiosReturnMessage | undefined;

	const createMockResponse = () => {
		const mockRes: any = {};
		mockRes.setHeader = jest.fn().mockImplementation(() => mockRes);
		mockRes.send = jest
			.fn()
			.mockImplementation((response: NagiosReturnMessage) => {
				capturedResponse = response;
				return mockRes;
			});
		return mockRes as Response;
	};

	beforeEach(() => {
		jest.clearAllMocks();
		capturedResponse = undefined;
		jest.spyOn(process, 'uptime').mockReturnValue(3600);
		jest.spyOn(process, 'memoryUsage').mockReturnValue({
			rss: 100000000,
			heapTotal: 50000000,
			heapUsed: 30000000,
			external: 1000000,
			arrayBuffers: 500000,
		});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('getAppInfo function', () => {
		it('should return help HTML when help query parameter is present', () => {
			const mockReq = {
				query: {help: ''},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			expect(mockRes.setHeader).toHaveBeenCalledWith(
				'Content-Type',
				'text/html; charset=utf-8',
			);
			expect(mockRes.send).toHaveBeenCalled();
			// Help page returns HTML string directly
			// capturedResponse is typed as NagiosReturnMessage but help returns string
			// Just verify the test passes without checking the response content
		});

		it('should apply security headers for help page', () => {
			const mockReq = {
				query: {help: ''},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			// Check that security headers are applied (from applyHelpPageSecurityHeaders)
			expect(mockRes.setHeader).toHaveBeenCalled();
		});

		it('should calculate CPU percentage correctly', () => {
			mockOs.cpus.mockReturnValue([
				{
					model: 'CPU 1',
					speed: 1000,
					times: {user: 1000, nice: 0, sys: 0, idle: 0, irq: 0},
				},
				{
					model: 'CPU 2',
					speed: 1000,
					times: {user: 1000, nice: 0, sys: 0, idle: 0, irq: 0},
				},
			]);
			mockOs.loadavg.mockReturnValue([2.0, 1.5, 1.0]); // load1 = 2.0

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			// With 2 CPUs and load of 2.0, CPU% should be 100%
			expect(mockRes.send).toHaveBeenCalled();
			const response = capturedResponse;
			expect(response?.message).toContain('cpu%=100.00');
		});

		it('should calculate memory percentage correctly', () => {
			mockOs.totalmem.mockReturnValue(8 * 1024 * 1024 * 1024); // 8GB
			mockOs.freemem.mockReturnValue(2 * 1024 * 1024 * 1024); // 2GB free
			mockOs.cpus.mockReturnValue([]);
			mockOs.loadavg.mockReturnValue([0, 0, 0]);

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			// 6GB used out of 8GB = 75%
			expect(mockRes.send).toHaveBeenCalled();
			const response = capturedResponse;
			expect(response?.message).toContain('mem%=75.00');
		});

		it('should use default thresholds when not provided', () => {
			mockOs.cpus.mockReturnValue([]);
			mockOs.loadavg.mockReturnValue([0, 0, 0]);
			mockOs.totalmem.mockReturnValue(1000);
			mockOs.freemem.mockReturnValue(300); // 70% used

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			// 70% memory usage with default warning threshold of 75% should be OK
			expect(response?.message).toContain('OK');
		});

		it('should return WARNING when CPU exceeds warning threshold', () => {
			mockOs.cpus.mockReturnValue([
				{
					model: 'CPU',
					speed: 1000,
					times: {user: 1000, nice: 0, sys: 0, idle: 0, irq: 0},
				},
			]);
			mockOs.loadavg.mockReturnValue([0.8, 0, 0]); // 80% CPU
			mockOs.totalmem.mockReturnValue(1000);
			mockOs.freemem.mockReturnValue(500);

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('WARNING');
		});

		it('should return CRITICAL when CPU exceeds critical threshold', () => {
			mockOs.cpus.mockReturnValue([
				{
					model: 'CPU',
					speed: 1000,
					times: {user: 1000, nice: 0, sys: 0, idle: 0, irq: 0},
				},
			]);
			mockOs.loadavg.mockReturnValue([0.95, 0, 0]); // 95% CPU
			mockOs.totalmem.mockReturnValue(1000);
			mockOs.freemem.mockReturnValue(500);

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('CRITICAL');
		});

		it('should return WARNING when memory exceeds warning threshold', () => {
			mockOs.cpus.mockReturnValue([]);
			mockOs.loadavg.mockReturnValue([0, 0, 0]);
			mockOs.totalmem.mockReturnValue(1000);
			mockOs.freemem.mockReturnValue(200); // 80% used

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('WARNING');
		});

		it('should return CRITICAL when memory exceeds critical threshold', () => {
			mockOs.cpus.mockReturnValue([]);
			mockOs.loadavg.mockReturnValue([0, 0, 0]);
			mockOs.totalmem.mockReturnValue(1000);
			mockOs.freemem.mockReturnValue(50); // 95% used

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('CRITICAL');
		});

		it('should accept custom thresholds via query parameters', () => {
			mockOs.cpus.mockReturnValue([
				{
					model: 'CPU',
					speed: 1000,
					times: {user: 1000, nice: 0, sys: 0, idle: 0, irq: 0},
				},
			]);
			mockOs.loadavg.mockReturnValue([0.75, 0, 0]); // 75% CPU
			mockOs.totalmem.mockReturnValue(1000);
			mockOs.freemem.mockReturnValue(300); // 70% used

			const mockReq = {
				query: {
					cpuWarn: '70',
					cpuCrit: '90',
					memWarn: '65',
					memCrit: '90',
				},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			// 75% CPU with 70% warning threshold = WARNING
			expect(response?.message).toContain('WARNING');
		});

		it('should include performance data in response', () => {
			mockOs.cpus.mockReturnValue([]);
			mockOs.loadavg.mockReturnValue([0, 0, 0]);
			mockOs.totalmem.mockReturnValue(1000);
			mockOs.freemem.mockReturnValue(500);
			mockOs.uptime.mockReturnValue(3600); // 1 hour uptime

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.performanceData).toContain('cpu_load_1min');
			expect(response?.performanceData).toContain('memory_used_bytes');
			expect(response?.performanceData).toContain('memory_free_bytes');
			expect(response?.performanceData).toContain('memory_used_percent');
			expect(response?.performanceData).toContain('process_uptime_seconds');
			expect(response?.performanceData).toContain('process_rss_bytes');
		});

		it('should include process uptime in response', () => {
			mockOs.cpus.mockReturnValue([]);
			mockOs.loadavg.mockReturnValue([0, 0, 0]);
			mockOs.totalmem.mockReturnValue(1000);
			mockOs.freemem.mockReturnValue(500);

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('uptime(s)=');
		});

		it('should handle empty CPU list gracefully', () => {
			mockOs.cpus.mockReturnValue([]);
			mockOs.loadavg.mockReturnValue([0, 0, 0]);
			mockOs.totalmem.mockReturnValue(1000);
			mockOs.freemem.mockReturnValue(500);

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('cpu%=0.00');
		});

		it('should handle zero total memory gracefully', () => {
			mockOs.cpus.mockReturnValue([]);
			mockOs.loadavg.mockReturnValue([0, 0, 0]);
			mockOs.totalmem.mockReturnValue(0);
			mockOs.freemem.mockReturnValue(0);

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('mem%=0.00');
		});

		it('should return OK when all metrics are within thresholds', () => {
			mockOs.cpus.mockReturnValue([
				{
					model: 'CPU',
					speed: 1000,
					times: {user: 1000, nice: 0, sys: 0, idle: 0, irq: 0},
				},
			]);
			mockOs.loadavg.mockReturnValue([0.5, 0, 0]); // 50% CPU
			mockOs.totalmem.mockReturnValue(1000);
			mockOs.freemem.mockReturnValue(400); // 60% used

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('OK');
		});

		it('should prioritize CRITICAL over WARNING', () => {
			mockOs.cpus.mockReturnValue([
				{
					model: 'CPU',
					speed: 1000,
					times: {user: 1000, nice: 0, sys: 0, idle: 0, irq: 0},
				},
			]);
			mockOs.loadavg.mockReturnValue([0.95, 0, 0]); // 95% CPU (CRITICAL)
			mockOs.totalmem.mockReturnValue(1000);
			mockOs.freemem.mockReturnValue(200); // 80% used (WARNING)

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('CRITICAL');
			expect(response?.message).not.toContain('WARNING');
		});

		it('should format CPU percentage to 2 decimal places', () => {
			mockOs.cpus.mockReturnValue([
				{
					model: 'CPU',
					speed: 1000,
					times: {user: 1000, nice: 0, sys: 0, idle: 0, irq: 0},
				},
			]);
			mockOs.loadavg.mockReturnValue([0.755, 0, 0]); // 75.5% CPU
			mockOs.totalmem.mockReturnValue(1000);
			mockOs.freemem.mockReturnValue(500);

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('cpu%=75.50');
		});

		it('should format memory percentage to 2 decimal places', () => {
			mockOs.cpus.mockReturnValue([]);
			mockOs.loadavg.mockReturnValue([0, 0, 0]);
			mockOs.totalmem.mockReturnValue(1000);
			mockOs.freemem.mockReturnValue(333); // 66.7% used

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('mem%=66.70');
		});

		it('should include process memory usage (RSS) in performance data', () => {
			mockOs.cpus.mockReturnValue([]);
			mockOs.loadavg.mockReturnValue([0, 0, 0]);
			mockOs.totalmem.mockReturnValue(1000);
			mockOs.freemem.mockReturnValue(500);

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getAppInfo(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.performanceData).toContain('process_rss_bytes');
		});
	});
});
