import {Request, Response} from 'express';
import os from 'os';
import {createNagiosReturnMessage, getNagiosStatusText} from '../lib/nagios';
import {NagiosReturnValuesEnum, PerformanceData} from '../types/nagios';

export const getAppInfo = (req: Request, res: Response) => {
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
