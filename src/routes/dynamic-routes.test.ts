import express from 'express';
import request from 'supertest';
import dynamicRoutes from './dynamic-routes';

describe('dynamic routes (plugins)', () => {
	let app: express.Application;

	beforeAll(() => {
		app = express();
		app.use(express.json());
		app.use('/', dynamicRoutes);
	});

	test('check-test plugin returns a Nagios-style JSON object', async () => {
		const res = await request(app).get('/check-test').query({
			nagiosReturnMessage: 'hello',
			nagiosReturnValue: '0',
			performanceData: 'true',
		});

		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty('message', 'hello');
		expect(res.body).toHaveProperty('code', 0);
		expect(res.body).toHaveProperty(
			'performanceData',
			"'WATER BOILER TEMP':55C°;WARN=80;CRIT=90;MIN=0;MAX=100 'OUTDOOR TEMP':21C°;WARN=30;CRIT=40;MIN=-20;MAX=50",
		);
	});

	test('check-test plugin returns usage and UNKNOWN code when required parameters are missing', async () => {
		const res = await request(app).get('/check-test').query({
			performanceData: 'true',
		});

		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty(
			'message',
			'Usage: /check-test?nagiosReturnMessage=<string>&nagiosRetunValue=<0 | 1 | 2 | 3>&performanceData=<true | false>',
		);
		expect(res.body).toHaveProperty('code', 3);
		expect(res.body).toHaveProperty(
			'performanceData',
			"'WATER BOILER TEMP':55C°;WARN=80;CRIT=90;MIN=0;MAX=100 'OUTDOOR TEMP':21C°;WARN=30;CRIT=40;MIN=-20;MAX=50",
		);
	});

	test('check-test plugin omits perfdata when performanceData is omitted', async () => {
		const res = await request(app).get('/check-test').query({
			nagiosReturnMessage: 'plain',
			nagiosReturnValue: '1',
		});

		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty('message', 'plain');
		expect(res.body).toHaveProperty('code', 1);
		expect(res.body).toHaveProperty('performanceData', '');
	});

	test('check-test plugin normalizes invalid plugin code to UNKNOWN', async () => {
		const res = await request(app).get('/check-test').query({
			nagiosReturnMessage: 'invalid-code',
			nagiosReturnValue: '9',
			performanceData: 'true',
		});

		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty('message', 'invalid-code');
		expect(res.body).toHaveProperty('code', 3);
	});
});
