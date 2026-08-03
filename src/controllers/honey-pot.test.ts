import {Request, Response} from 'express';
import * as honeyPotLib from '../lib/honey-pot';
import type {NagiosReturnMessage} from '../lib/nagios';
import {getHoneypotStatus} from './honey-pot';

jest.mock('../lib/honey-pot');

describe('honey-pot controller', () => {
	const mockGetHoneypotStats =
		honeyPotLib.getHoneypotStats as jest.MockedFunction<
			typeof honeyPotLib.getHoneypotStats
		>;

	beforeEach(() => {
		jest.clearAllMocks();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('getHoneypotStatus function', () => {
		let capturedResponse: NagiosReturnMessage | undefined;

		const createMockResponse = () => {
			const mockRes: Partial<Response> = {};
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
			capturedResponse = undefined;
		});

		it('should return help HTML when help query parameter is present', () => {
			const mockReq = {
				query: {help: ''},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			expect(mockRes.setHeader).toHaveBeenCalledWith(
				'Content-Type',
				'text/html; charset=utf-8',
			);
		});

		it('should return OK when no honeypot hits detected', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 0,
				suspiciousHits: 0,
				uniqueIps: 0,
				uniquePaths: 0,
				probableScanIps: 0,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 0,
				protocolErrorHits: 0,
				mostActiveIp: '',
				latest: undefined,
			});

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('OK');
		});

		it('should return WARNING when hits exceed warning threshold', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 2,
				suspiciousHits: 0,
				uniqueIps: 1,
				uniquePaths: 1,
				probableScanIps: 0,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 0,
				protocolErrorHits: 0,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('WARNING');
		});

		it('should return CRITICAL when hits exceed critical threshold', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 10,
				suspiciousHits: 0,
				uniqueIps: 1,
				uniquePaths: 1,
				probableScanIps: 0,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 0,
				protocolErrorHits: 0,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('CRITICAL');
		});

		it('should return WARNING when suspicious hits exceed warning threshold', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 0,
				suspiciousHits: 2,
				uniqueIps: 1,
				uniquePaths: 1,
				probableScanIps: 0,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 0,
				protocolErrorHits: 0,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('WARNING');
		});

		it('should return CRITICAL when suspicious hits exceed critical threshold', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 0,
				suspiciousHits: 10,
				uniqueIps: 1,
				uniquePaths: 1,
				probableScanIps: 0,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 0,
				protocolErrorHits: 0,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('CRITICAL');
		});

		it('should return WARNING when scan IPs exceed warning threshold', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 0,
				suspiciousHits: 0,
				uniqueIps: 2,
				uniquePaths: 2,
				probableScanIps: 1,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 1,
				protocolErrorHits: 0,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('WARNING');
		});

		it('should return CRITICAL when scan IPs exceed critical threshold', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 0,
				suspiciousHits: 0,
				uniqueIps: 3,
				uniquePaths: 3,
				probableScanIps: 3,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 1,
				protocolErrorHits: 0,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('CRITICAL');
		});

		it('should return WARNING when port scan IPs exceed warning threshold', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 0,
				suspiciousHits: 0,
				uniqueIps: 2,
				uniquePaths: 2,
				probableScanIps: 0,
				probablePortScanIps: 1,
				maxUniquePathsFromSingleIp: 1,
				protocolErrorHits: 0,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {
					warnPortScanIps: '1',
					critPortScanIps: '2',
				},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('WARNING');
		});

		it('should return CRITICAL when port scan IPs exceed critical threshold', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 0,
				suspiciousHits: 0,
				uniqueIps: 2,
				uniquePaths: 2,
				probableScanIps: 0,
				probablePortScanIps: 2,
				maxUniquePathsFromSingleIp: 1,
				protocolErrorHits: 0,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {
					critPortScanIps: '1',
				},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('CRITICAL');
		});

		it('should accept custom warnHits threshold', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 5,
				suspiciousHits: 0,
				uniqueIps: 1,
				uniquePaths: 1,
				probableScanIps: 0,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 0,
				protocolErrorHits: 0,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {
					warnHits: '10',
					critHits: '15',
				},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			// 5 hits with 10 warning threshold = OK
			expect(response?.message).toContain('OK');
		});

		it('should accept custom critHits threshold', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 10,
				suspiciousHits: 0,
				uniqueIps: 1,
				uniquePaths: 1,
				probableScanIps: 0,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 0,
				protocolErrorHits: 0,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {
					critHits: '20',
				},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			// 10 hits with 20 critical threshold = WARNING (default is 5)
			expect(response?.message).toContain('WARNING');
		});

		it('should include latest hit details when available', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 1,
				suspiciousHits: 0,
				uniqueIps: 1,
				uniquePaths: 1,
				probableScanIps: 0,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 0,
				protocolErrorHits: 0,
				mostActiveIp: '192.168.1.1',
				latest: {
					path: '/admin',
					ip: '192.168.1.100',
					reason: 'unknown-route',
				},
			});

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('latest=/admin');
			expect(response?.message).toContain('ip=192.168.1.100');
			expect(response?.message).toContain('reason=unknown-route');
		});

		it('should not include latest details when none available', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 0,
				suspiciousHits: 0,
				uniqueIps: 0,
				uniquePaths: 0,
				probableScanIps: 0,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 0,
				protocolErrorHits: 0,
				mostActiveIp: '',
				latest: undefined,
			});

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).not.toContain('latest=');
		});

		it('should include scan details when scan IPs detected', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 5,
				suspiciousHits: 0,
				uniqueIps: 2,
				uniquePaths: 5,
				probableScanIps: 2,
				probablePortScanIps: 1,
				maxUniquePathsFromSingleIp: 3,
				protocolErrorHits: 1,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('scan_ips=2');
			expect(response?.message).toContain('max_paths_per_ip=3');
			expect(response?.message).toContain('most_active_ip=192.168.1.1');
			expect(response?.message).toContain('port_scan_ips=1');
			expect(response?.message).toContain('protocol_errors=1');
		});

		it('should include scan details with zeros when no scans detected', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 0,
				suspiciousHits: 0,
				uniqueIps: 0,
				uniquePaths: 0,
				probableScanIps: 0,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 0,
				protocolErrorHits: 0,
				mostActiveIp: '',
				latest: undefined,
			});

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('scan_ips=0');
			expect(response?.message).toContain('max_paths_per_ip=0');
		});

		it('should include all performance data metrics', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 10,
				suspiciousHits: 5,
				uniqueIps: 3,
				uniquePaths: 8,
				probableScanIps: 2,
				probablePortScanIps: 1,
				maxUniquePathsFromSingleIp: 4,
				protocolErrorHits: 2,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			// Message contains short-form metrics (unique_paths not in message)
			expect(response?.message).toContain('probes=10');
			expect(response?.message).toContain('suspicious=5');
			expect(response?.message).toContain('unique_ips=3');
			expect(response?.message).toContain('scan_ips=2');
			expect(response?.message).toContain('max_paths_per_ip=4');
			expect(response?.message).toContain('port_scan_ips=1');
			expect(response?.message).toContain('protocol_errors=2');
			// Performance data contains full labels with format 'label':valueuom
			expect(response?.performanceData).toContain("'honeypot_probes':10c");
			expect(response?.performanceData).toContain("'honeypot_suspicious':5c");
			expect(response?.performanceData).toContain("'honeypot_unique_paths':8c");
		});

		it('should prioritize CRITICAL over WARNING for multiple metrics', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 10, // CRITICAL (default critHits=5)
				suspiciousHits: 5, // WARNING (default critSuspicious=3)
				uniqueIps: 1,
				uniquePaths: 1,
				probableScanIps: 0,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 0,
				protocolErrorHits: 0,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			expect(response?.message).toContain('CRITICAL');
			expect(response?.message).not.toContain('WARNING');
		});

		it('should handle invalid threshold values gracefully', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 10,
				suspiciousHits: 0,
				uniqueIps: 1,
				uniquePaths: 1,
				probableScanIps: 0,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 0,
				protocolErrorHits: 0,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {
					warnHits: 'invalid',
					critHits: 'also-invalid',
				},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			// Should use defaults (warnHits=1, critHits=5)
			expect(response?.message).toContain('CRITICAL');
		});

		it('should handle zero thresholds', () => {
			mockGetHoneypotStats.mockReturnValue({
				totalHits: 1,
				suspiciousHits: 0,
				uniqueIps: 1,
				uniquePaths: 1,
				probableScanIps: 0,
				probablePortScanIps: 0,
				maxUniquePathsFromSingleIp: 0,
				protocolErrorHits: 0,
				mostActiveIp: '192.168.1.1',
				latest: undefined,
			});

			const mockReq = {
				query: {
					warnHits: '0',
					critHits: '0',
				},
			} as unknown as Request;

			const mockRes = createMockResponse();

			getHoneypotStatus(mockReq, mockRes);

			const response = capturedResponse;
			// 0 thresholds means any hit triggers CRITICAL
			expect(response?.message).toContain('CRITICAL');
		});
	});
});
