import express from 'express';
import request from 'supertest';

type NagiosBody = {
	message: string;
	code: number;
	performanceData?: string;
};

describe('app-info route (branch coverage)', () => {
	afterEach(() => {
		jest.restoreAllMocks();
		jest.resetModules();
	});

	test('falls back to zero cpu and memory percentages when cpu list and total memory are empty', async () => {
		jest.resetModules();

		jest.doMock('os', () => ({
			__esModule: true,
			default: {
				cpus: () => [],
				loadavg: () => [99, 0, 0],
				totalmem: () => 0,
				freemem: () => 0,
			},
			cpus: () => [],
			loadavg: () => [99, 0, 0],
			totalmem: () => 0,
			freemem: () => 0,
		}));

		jest.spyOn(process, 'uptime').mockReturnValue(12.34);
		jest.spyOn(process, 'memoryUsage').mockReturnValue({
			rss: 123456,
			heapTotal: 0,
			heapUsed: 0,
			external: 0,
			arrayBuffers: 0,
		});

		let appInfoRouter: express.Router;
		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const appInfoModule = require('./app-info') as {default: express.Router};
			appInfoRouter = appInfoModule.default;
		});

		const app = express();
		app.use('/nagios', appInfoRouter!);

		const res = await request(app).get('/nagios');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body).toHaveProperty('code', 0);
		expect(String(body.message)).toContain('cpu%=0.00');
		expect(String(body.message)).toContain('mem%=0.00');
		expect(String(body.performanceData)).toContain("'cpu_load_1min':");
		expect(String(body.performanceData)).toContain(
			"'process_rss_bytes':123456B",
		);
	});

	test('handles null cpu list and missing load average value', async () => {
		jest.resetModules();

		jest.doMock('os', () => ({
			__esModule: true,
			default: {
				cpus: () => null,
				loadavg: () => [],
				totalmem: () => 1024,
				freemem: () => 1024,
			},
			cpus: () => null,
			loadavg: () => [],
			totalmem: () => 1024,
			freemem: () => 1024,
		}));

		jest.spyOn(process, 'uptime').mockReturnValue(1);
		jest.spyOn(process, 'memoryUsage').mockReturnValue({
			rss: 1,
			heapTotal: 0,
			heapUsed: 0,
			external: 0,
			arrayBuffers: 0,
		});

		let appInfoRouter: express.Router;
		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const appInfoModule = require('./app-info') as {default: express.Router};
			appInfoRouter = appInfoModule.default;
		});

		const app = express();
		app.use('/nagios', appInfoRouter!);

		const res = await request(app).get('/nagios');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(String(body.message)).toContain('cpu%=0.00');
		expect(String(body.message)).toContain('mem%=0.00');
	});
});
