import express from 'express';
import request from 'supertest';
import appInfo from './app-info';

describe('/nagios route', () => {
	let app: express.Application;
	type NagiosBody = {
		message: string;
		code: number;
		performanceData?: string;
	};

	beforeAll(() => {
		app = express();
		app.use(express.json());
		app.use('/nagios', appInfo);
	});

	test('returns Nagios JSON with performanceData and OK/WARNING/CRITICAL codes', async () => {
		const res = await request(app).get('/nagios');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body).toHaveProperty('message');
		expect(body).toHaveProperty('code');
		expect([0, 1, 2, 3]).toContain(body.code);
		expect(body).toHaveProperty('performanceData');
	});

	test('can force WARNING via query overrides', async () => {
		// set cpuWarn low to trigger WARNING for any non-zero CPU
		const res = await request(app)
			.get('/nagios')
			.query({cpuWarn: '0', cpuCrit: '1000', memWarn: '1000', memCrit: '1000'});
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body.code).toBe(1);
	});

	test('can force CRITICAL via query overrides', async () => {
		// set cpuCrit to 0 to make any CPU usage critical
		const res = await request(app)
			.get('/nagios')
			.query({cpuWarn: '0', cpuCrit: '0', memWarn: '1000', memCrit: '1000'});
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body.code).toBe(2);
	});
});
