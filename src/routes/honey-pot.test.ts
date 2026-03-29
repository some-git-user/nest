import express from 'express';
import request from 'supertest';
import {
	recordHoneypotSignal,
	recordNetworkProbeSignal,
	resetHoneypotSignals,
} from '../lib/honey-pot';
import honeyPot from './honey-pot';

type NagiosBody = {
	message: string;
	code: number;
	performanceData?: string;
};

describe('/nagios/honey-pot route', () => {
	let app: express.Application;

	beforeEach(() => {
		resetHoneypotSignals();
		app = express();
		app.use(express.json());
		app.use('/nagios/honey-pot', honeyPot);
		app.use((req, res) => {
			recordHoneypotSignal(req, 'unknown-route');
			res.status(404).send({message: 'not-found'});
		});
	});

	afterEach(() => {
		resetHoneypotSignals();
	});

	test('returns OK when no probes were recorded', async () => {
		const res = await request(app).get('/nagios/honey-pot');
		const body = res.body as NagiosBody;

		expect(res.status).toBe(200);
		expect(body.code).toBe(0);
		expect(String(body.message)).toContain('OK - probes=0 suspicious=0');
		expect(String(body.message)).toContain('scan_ips=0 max_paths_per_ip=0');
		expect(String(body.message)).toContain('port_scan_ips=0 protocol_errors=0');
		expect(body.performanceData).toBeDefined();
	});

	test('returns WARNING after a single unknown route probe', async () => {
		await request(app).get('/does-not-exist');

		const res = await request(app).get('/nagios/honey-pot');
		const body = res.body as NagiosBody;

		expect(res.status).toBe(200);
		expect(body.code).toBe(1);
		expect(String(body.message)).toContain('WARNING - probes=1 suspicious=0');
	});

	test('returns CRITICAL when suspicious probing is detected', async () => {
		await request(app).get('/wp-admin');
		await request(app).get('/phpmyadmin');
		await request(app).get('/.env');

		const res = await request(app).get('/nagios/honey-pot');
		const body = res.body as NagiosBody;

		expect(res.status).toBe(200);
		expect(body.code).toBe(2);
		expect(String(body.message)).toContain('CRITICAL - probes=3 suspicious=3');
	});

	test('flags probable route scan when one IP probes many unknown paths', async () => {
		const scanHeaders = {'x-forwarded-for': '198.51.100.44'};
		await request(app).get('/a1').set(scanHeaders);
		await request(app).get('/a2').set(scanHeaders);
		await request(app).get('/a3').set(scanHeaders);
		await request(app).get('/a4').set(scanHeaders);
		await request(app).get('/a5').set(scanHeaders);
		await request(app).get('/a6').set(scanHeaders);

		const res = await request(app).get('/nagios/honey-pot').query({
			critHits: 100,
			critSuspicious: 100,
			critScanIps: 100,
			critPortScanIps: 100,
		});
		const body = res.body as NagiosBody;

		expect(res.status).toBe(200);
		expect(body.code).toBe(1);
		expect(String(body.message)).toContain('scan_ips=1');
		expect(String(body.message)).toContain('max_paths_per_ip=6');
		expect(String(body.message)).toContain('most_active_ip=198.51.100.44');
		expect(String(body.performanceData)).toContain(
			"'honeypot_probable_scan_ips':1c",
		);
		expect(String(body.performanceData)).toContain(
			"'honeypot_max_paths_per_ip':6c",
		);
	});

	test('flags probable port scan from repeated protocol errors on one IP', async () => {
		recordNetworkProbeSignal('203.0.113.9', 'tls-client-error');
		recordNetworkProbeSignal('203.0.113.9', 'http-client-error');
		recordNetworkProbeSignal('203.0.113.9', 'tls-client-error');

		const res = await request(app).get('/nagios/honey-pot');
		const body = res.body as NagiosBody;

		expect(res.status).toBe(200);
		expect(body.code).toBe(2);
		expect(String(body.message)).toContain('port_scan_ips=1');
		expect(String(body.message)).toContain('protocol_errors=3');
		expect(String(body.performanceData)).toContain(
			"'honeypot_probable_port_scan_ips':1c",
		);
		expect(String(body.performanceData)).toContain(
			"'honeypot_protocol_errors':3c",
		);
	});
});
