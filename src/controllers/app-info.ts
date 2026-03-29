import {Request, Response} from 'express';
import os from 'os';
import {
	appendExternalLinkGuard,
	applyHelpPageSecurityHeaders,
} from '../lib/help-page';
import {createNagiosReturnMessage, getNagiosStatusText} from '../lib/nagios';
import {NagiosReturnValuesEnum, PerformanceData} from '../types/nagios';

const getAppInfoHelpHtml = (): string => {
	return appendExternalLinkGuard(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Help: /nagios</title>
<style>
body{font-family:sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;line-height:1.5}
code{background:#f4f4f4;padding:.2rem .4rem;border-radius:4px}
li{margin:.35rem 0}
</style>
</head>
<body>
<p><a href="/">Back to route overview</a></p>
<h1>Built-in Help: /nagios</h1>
<p>Returns process and host health as a Nagios JSON payload.</p>
<h2>Endpoint</h2>
<ul>
<li><code>/nagios</code></li>
<li><code>/nagios?help</code></li>
</ul>
<h2>Optional Query Parameters</h2>
<ul>
<li><code>cpuWarn</code> (default: 70)</li>
<li><code>cpuCrit</code> (default: 90)</li>
<li><code>memWarn</code> (default: 75)</li>
<li><code>memCrit</code> (default: 90)</li>
</ul>
<h2>Examples</h2>
<ul>
<li><code>/nagios</code></li>
<li><code>/nagios?cpuWarn=60&cpuCrit=85&memWarn=70&memCrit=90</code></li>
</ul>
<p>The route emits performance data for CPU load, memory, uptime, and process RSS.</p>
</body>
</html>`);
};

export const getAppInfo = (req: Request, res: Response) => {
	if ('help' in req.query) {
		applyHelpPageSecurityHeaders(res);
		res.setHeader('Content-Type', 'text/html; charset=utf-8');
		return res.send(getAppInfoHelpHtml());
	}

	const cpus = os.cpus() || [];
	const load1 = os.loadavg()[0] ?? 0;
	const cpuPercent = cpus.length > 0 ? (load1 / cpus.length) * 100 : 0;

	const totalMem = os.totalmem();
	const freeMem = os.freemem();
	const usedMem = totalMem - freeMem;
	const usedMemPercent = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;

	const procUptime = process.uptime();
	const procMem = process.memoryUsage();

	// thresholds can be overridden via query params for testing or runtime tuning
	const cpuWarn = Number(req.query.cpuWarn ?? 70);
	const cpuCrit = Number(req.query.cpuCrit ?? 90);
	const memWarn = Number(req.query.memWarn ?? 75);
	const memCrit = Number(req.query.memCrit ?? 90);

	// determine highest-severity state across metrics
	let status = NagiosReturnValuesEnum.OK;
	if (cpuPercent >= cpuCrit || usedMemPercent >= memCrit) {
		status = NagiosReturnValuesEnum.CRITICAL;
	} else if (cpuPercent >= cpuWarn || usedMemPercent >= memWarn) {
		status = NagiosReturnValuesEnum.WARNING;
	}

	const perf: PerformanceData[] = [
		{label: 'cpu_load_1min', value: Number(cpuPercent.toFixed(2)), uom: '%'},
		{label: 'memory_used_bytes', value: usedMem, uom: 'B'},
		{label: 'memory_free_bytes', value: freeMem, uom: 'B'},
		{
			label: 'memory_used_percent',
			value: Number(usedMemPercent.toFixed(2)),
			uom: '%',
		},
		{label: 'process_uptime_seconds', value: Math.floor(procUptime), uom: 's'},
		{label: 'process_rss_bytes', value: procMem.rss, uom: 'B'},
	];

	const message = `${getNagiosStatusText(status)} - uptime(s)=${Math.floor(procUptime)} cpu%=${cpuPercent.toFixed(2)} mem%=${usedMemPercent.toFixed(2)}`;

	const nagios = createNagiosReturnMessage(message, status, perf);
	return res.send(nagios);
};
