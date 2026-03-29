import {Request, Response} from 'express';
import {
	appendExternalLinkGuard,
	applyHelpPageSecurityHeaders,
} from '../lib/help-page';
import {getHoneypotStats} from '../lib/honey-pot';
import {createNagiosReturnMessage, getNagiosStatusText} from '../lib/nagios';
import {NagiosReturnValuesEnum, PerformanceData} from '../types/nagios';

const getHoneypotHelpHtml = (): string => {
	return appendExternalLinkGuard(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Help: /nagios/honey-pot</title>
<style>
body{font-family:sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;line-height:1.5}
code{background:#f4f4f4;padding:.2rem .4rem;border-radius:4px}
li{margin:.35rem 0}
</style>
</head>
<body>
<h1>Built-in Help: /nagios/honey-pot</h1>
<p>Returns honeypot probe metrics and detection severity as Nagios JSON.</p>
<h2>Endpoint</h2>
<ul>
<li><code>/nagios/honey-pot</code></li>
<li><code>/nagios/honey-pot?help</code></li>
</ul>
<h2>Optional Query Parameters</h2>
<ul>
<li><code>warnHits</code> (default: 1)</li>
<li><code>critHits</code> (default: 5)</li>
<li><code>warnSuspicious</code> (default: 1)</li>
<li><code>critSuspicious</code> (default: 3)</li>
<li><code>warnScanIps</code> (default: 1)</li>
<li><code>critScanIps</code> (default: 2)</li>
<li><code>warnPortScanIps</code> (default: 1)</li>
<li><code>critPortScanIps</code> (default: 1)</li>
</ul>
<h2>Examples</h2>
<ul>
<li><code>/nagios/honey-pot</code></li>
<li><code>/nagios/honey-pot?warnHits=2&critHits=8&warnSuspicious=2&critSuspicious=4</code></li>
</ul>
<p>Use these thresholds to tune warning and critical transitions for probe activity.</p>
</body>
</html>`);
};

const parseThreshold = (value: unknown, fallback: number): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

export const getHoneypotStatus = (req: Request, res: Response) => {
	if ('help' in req.query) {
		applyHelpPageSecurityHeaders(res);
		res.setHeader('Content-Type', 'text/html; charset=utf-8');
		return res.send(getHoneypotHelpHtml());
	}

	const stats = getHoneypotStats();

	const warnHits = parseThreshold(req.query.warnHits, 1);
	const critHits = parseThreshold(req.query.critHits, 5);
	const warnSuspicious = parseThreshold(req.query.warnSuspicious, 1);
	const critSuspicious = parseThreshold(req.query.critSuspicious, 3);
	const warnScanIps = parseThreshold(req.query.warnScanIps, 1);
	const critScanIps = parseThreshold(req.query.critScanIps, 2);
	const warnPortScanIps = parseThreshold(req.query.warnPortScanIps, 1);
	const critPortScanIps = parseThreshold(req.query.critPortScanIps, 1);

	let status = NagiosReturnValuesEnum.OK;
	if (
		stats.totalHits >= critHits ||
		stats.suspiciousHits >= critSuspicious ||
		stats.probableScanIps >= critScanIps ||
		stats.probablePortScanIps >= critPortScanIps
	) {
		status = NagiosReturnValuesEnum.CRITICAL;
	} else if (
		stats.totalHits >= warnHits ||
		stats.suspiciousHits >= warnSuspicious ||
		stats.probableScanIps >= warnScanIps ||
		stats.probablePortScanIps >= warnPortScanIps
	) {
		status = NagiosReturnValuesEnum.WARNING;
	}

	const statusText = getNagiosStatusText(status);
	const latestDetails = stats.latest
		? ` latest=${stats.latest.path} ip=${stats.latest.ip} reason=${stats.latest.reason}`
		: '';
	const scanDetails =
		stats.maxUniquePathsFromSingleIp > 0
			? ` scan_ips=${stats.probableScanIps} max_paths_per_ip=${stats.maxUniquePathsFromSingleIp} most_active_ip=${stats.mostActiveIp} port_scan_ips=${stats.probablePortScanIps} protocol_errors=${stats.protocolErrorHits}`
			: ` scan_ips=0 max_paths_per_ip=0 port_scan_ips=${stats.probablePortScanIps} protocol_errors=${stats.protocolErrorHits}`;

	const message = `${statusText} - probes=${stats.totalHits} suspicious=${stats.suspiciousHits} unique_ips=${stats.uniqueIps}${scanDetails}${latestDetails}`;

	const performanceData: PerformanceData[] = [
		{label: 'honeypot_probes', value: stats.totalHits, uom: 'c'},
		{label: 'honeypot_suspicious', value: stats.suspiciousHits, uom: 'c'},
		{label: 'honeypot_unique_ips', value: stats.uniqueIps, uom: 'c'},
		{label: 'honeypot_unique_paths', value: stats.uniquePaths, uom: 'c'},
		{
			label: 'honeypot_probable_scan_ips',
			value: stats.probableScanIps,
			uom: 'c',
		},
		{
			label: 'honeypot_max_paths_per_ip',
			value: stats.maxUniquePathsFromSingleIp,
			uom: 'c',
		},
		{
			label: 'honeypot_probable_port_scan_ips',
			value: stats.probablePortScanIps,
			uom: 'c',
		},
		{
			label: 'honeypot_protocol_errors',
			value: stats.protocolErrorHits,
			uom: 'c',
		},
	];

	return res.send(createNagiosReturnMessage(message, status, performanceData));
};
