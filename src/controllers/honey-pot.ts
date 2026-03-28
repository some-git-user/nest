import {Request, Response} from 'express';
import {getHoneypotStats, recordHoneypotSignal} from '../lib/honey-pot';
import {createNagiosReturnMessage} from '../lib/nagios';
import {NagiosReturnValuesEnum, PerformanceData} from '../types/nagios';

const parseThreshold = (value: unknown, fallback: number): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

export const getHoneypotStatus = (req: Request, res: Response) => {
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

	const statusText =
		status === NagiosReturnValuesEnum.OK
			? 'OK'
			: status === NagiosReturnValuesEnum.WARNING
				? 'WARNING'
				: 'CRITICAL';
	const latestDetails = stats.latestPath
		? ` latest=${stats.latestPath} ip=${stats.latestIp ?? 'unknown'} reason=${stats.latestReason ?? 'unknown'}`
		: '';
	const scanDetails =
		stats.maxUniquePathsFromSingleIp > 0
			? ` scan_ips=${stats.probableScanIps} max_paths_per_ip=${stats.maxUniquePathsFromSingleIp} most_active_ip=${stats.mostActiveIp ?? 'unknown'} port_scan_ips=${stats.probablePortScanIps} protocol_errors=${stats.protocolErrorHits}`
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

export const triggerHoneypot = (req: Request, res: Response) => {
	recordHoneypotSignal(req, 'honeypot-route');

	const response = createNagiosReturnMessage(
		`Unknown route ${req.originalUrl || req.url}`,
		NagiosReturnValuesEnum.UNKNOWN,
	);

	return res.status(404).send(response);
};
