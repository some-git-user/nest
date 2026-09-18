import {
	checkBatteryHealth,
	discoverBatteries,
	evaluateBattery,
	getStatusText,
} from './check_battery_health';

type FsLike = {
	readdirSync: (path: string) => string[];
	readFileSync: (path: string, encoding: 'utf-8') => string;
};

type Result = {
	message: string;
	code: number;
	performanceData?: {label: string; value: number | string; uom: string}[];
};

const ROOT = '/sys/class/power_supply';

/**
 * Build a fake power_supply sysfs. `supplies` maps a device name to its file
 * contents; any file not listed reports as missing (throws ENOENT), matching
 * how optional attributes are simply absent on real batteries.
 */
const makeFs = (
	supplies: Record<string, Record<string, string>>,
	opts: {readdirThrows?: boolean} = {},
): FsLike => ({
	readdirSync: (path: string) => {
		if (opts.readdirThrows) {
			throw new Error(`ENOENT: ${path}`);
		}
		if (path !== ROOT) {
			throw new Error(`not a directory: ${path}`);
		}
		return Object.keys(supplies);
	},
	readFileSync: (path: string) => {
		const rest = path.slice(ROOT.length + 1);
		const slash = rest.indexOf('/');
		const name = rest.slice(0, slash);
		const file = rest.slice(slash + 1);
		const content = supplies[name]?.[file];
		if (content === undefined) {
			throw new Error(`ENOENT: ${path}`);
		}
		return content;
	},
});

/**
 * A healthy battery on a charger. charge_full / charge_full_design = 90 % so
 * it sits comfortably above the default 80 % warning threshold.
 */
const HEALTHY_BATTERY: Record<string, string> = {
	type: 'Battery',
	present: '1',
	status: 'Full',
	technology: 'Li-ion',
	capacity: '100',
	charge_full: '4113000',
	charge_full_design: '4570000',
	charge_now: '4113000',
	voltage_now: '12784000',
	cycle_count: '0',
	alarm: '0',
};

const perf = (result: Result, label: string): string | number | undefined =>
	result.performanceData?.find((entry) => entry.label === label)?.value;

/** A copy of HEALTHY_BATTERY with `status` removed, plus any overrides. */
const batteryWithoutStatus = (
	overrides: Record<string, string> = {},
): Record<string, string> => {
	const copy: Record<string, string> = {...HEALTHY_BATTERY};
	delete copy.status;
	return {...copy, ...overrides};
};

describe('check_battery_health plugin', () => {
	afterEach(() => {
		jest.resetModules();
		jest.restoreAllMocks();
	});

	describe('getStatusText', () => {
		test('maps every Nagios code to its label', () => {
			expect(getStatusText(0)).toBe('OK');
			expect(getStatusText(1)).toBe('WARNING');
			expect(getStatusText(2)).toBe('CRITICAL');
			expect(getStatusText(3)).toBe('UNKNOWN');
		});
	});

	describe('discoverBatteries', () => {
		test('returns only devices whose type is Battery, sorted', () => {
			const fsImpl = makeFs({
				AC0: {type: 'Mains'},
				BAT1: {type: 'Battery'},
				BAT0: {type: 'Battery'},
				'ucsi-source-psy-USBC000:001': {type: 'USB'},
			});
			expect(discoverBatteries(fsImpl)).toEqual(['BAT0', 'BAT1']);
		});

		test('returns an empty list when the directory cannot be read', () => {
			expect(discoverBatteries(makeFs({}, {readdirThrows: true}))).toEqual([]);
		});

		test('treats an unreadable root as no battery (UNKNOWN)', () => {
			const result = checkBatteryHealth({}, makeFs({}, {readdirThrows: true}));
			expect(result.code).toBe(3);
			expect(result.message).toContain('no battery found');
		});
	});

	describe('checkBatteryHealth - configuration', () => {
		test('rejects a non-numeric warningHealthPercent', () => {
			const result = checkBatteryHealth(
				{warningHealthPercent: 'abc'},
				makeFs({BAT0: HEALTHY_BATTERY}),
			);
			expect(result.code).toBe(3);
			expect(result.message).toContain(
				'warningHealthPercent must be a valid number',
			);
		});

		test('rejects a non-numeric criticalHealthPercent', () => {
			const result = checkBatteryHealth(
				{criticalHealthPercent: 'x'},
				makeFs({BAT0: HEALTHY_BATTERY}),
			);
			expect(result.code).toBe(3);
			expect(result.message).toContain(
				'criticalHealthPercent must be a valid number',
			);
		});

		test('rejects a non-numeric warningChargePercent', () => {
			const result = checkBatteryHealth(
				{warningChargePercent: 'x'},
				makeFs({BAT0: HEALTHY_BATTERY}),
			);
			expect(result.code).toBe(3);
			expect(result.message).toContain(
				'warningChargePercent must be a valid number',
			);
		});

		test('rejects a non-numeric criticalChargePercent', () => {
			const result = checkBatteryHealth(
				{criticalChargePercent: 'x'},
				makeFs({BAT0: HEALTHY_BATTERY}),
			);
			expect(result.code).toBe(3);
			expect(result.message).toContain(
				'criticalChargePercent must be a valid number',
			);
		});

		test('rejects an unknown treatNoBatteryAs value', () => {
			const result = checkBatteryHealth(
				{treatNoBatteryAs: 'sometimes'},
				makeFs({BAT0: HEALTHY_BATTERY}),
			);
			expect(result.code).toBe(3);
			expect(result.message).toContain('treatNoBatteryAs must be either');
		});

		test('rejects warningHealthPercent below criticalHealthPercent', () => {
			const result = checkBatteryHealth(
				{warningHealthPercent: '50', criticalHealthPercent: '70'},
				makeFs({BAT0: HEALTHY_BATTERY}),
			);
			expect(result.code).toBe(3);
			expect(result.message).toContain('warningHealthPercent must be greater');
		});

		test('rejects warningChargePercent below criticalChargePercent', () => {
			const result = checkBatteryHealth(
				{warningChargePercent: '5', criticalChargePercent: '15'},
				makeFs({BAT0: HEALTHY_BATTERY}),
			);
			expect(result.code).toBe(3);
			expect(result.message).toContain('warningChargePercent must be greater');
		});
	});

	describe('checkBatteryHealth - no battery', () => {
		test('is UNKNOWN by default when no battery exists', () => {
			const result = checkBatteryHealth({}, makeFs({AC0: {type: 'Mains'}}));
			expect(result.code).toBe(3);
			expect(result.message).toContain('no battery found');
			expect(perf(result, 'battery_count')).toBe('0');
		});

		test('is CRITICAL when treatNoBatteryAs is critical', () => {
			const result = checkBatteryHealth(
				{treatNoBatteryAs: 'critical'},
				makeFs({AC0: {type: 'Mains'}}),
			);
			expect(result.code).toBe(2);
			expect(result.message).toContain('treatNoBatteryAs is critical');
		});

		test('accepts treatNoBatteryAs as a mixed-case string', () => {
			const result = checkBatteryHealth(
				{treatNoBatteryAs: ' CRITICAL '},
				makeFs({}),
			);
			expect(result.code).toBe(2);
		});
	});

	describe('checkBatteryHealth - healthy', () => {
		test('reports OK with health and charge perfdata for a healthy battery', () => {
			const result = checkBatteryHealth({}, makeFs({BAT0: HEALTHY_BATTERY}));
			expect(result.code).toBe(0);
			expect(result.message).toContain('OK: 1 battery(s)');
			expect(result.message).toContain('worst health 90%');
			expect(result.message).toContain('worst charge 100%');
			expect(perf(result, 'health_percent')).toBe('90');
			expect(perf(result, 'charge_percent')).toBe('100');
			expect(perf(result, 'BAT0_health_percent')).toBe('90');
			expect(perf(result, 'BAT0_charge_percent')).toBe('100');
			expect(perf(result, 'BAT0_voltage')).toBe('12.784');
			expect(perf(result, 'BAT0_cycle_count')).toBe('0');
		});

		test('falls back to energy_full when charge_full is absent', () => {
			const fsImpl = makeFs({
				BAT0: {
					type: 'Battery',
					present: '1',
					status: 'Full',
					capacity: '90',
					energy_full: '39474000',
					energy_full_design: '53057700',
				},
			});
			const result = checkBatteryHealth({warningHealthPercent: '70'}, fsImpl);
			expect(result.code).toBe(0);
			expect(perf(result, 'health_percent')).toBe('74.4');
		});

		test('reports health as n/a when no design capacity is available', () => {
			const fsImpl = makeFs({
				BAT0: {
					type: 'Battery',
					present: '1',
					status: 'Full',
					capacity: '88',
				},
			});
			const result = checkBatteryHealth({}, fsImpl);
			expect(result.code).toBe(0);
			expect(result.message).toContain('worst health n/a');
			expect(perf(result, 'health_percent')).toBe('');
			expect(perf(result, 'BAT0_health_percent')).toBeUndefined();
			expect(perf(result, 'BAT0_voltage')).toBeUndefined();
			expect(perf(result, 'BAT0_cycle_count')).toBeUndefined();
		});
	});

	describe('checkBatteryHealth - wear (SOH)', () => {
		test('warns when health is at or below the warning threshold', () => {
			const fsImpl = makeFs({
				BAT0: {
					...HEALTHY_BATTERY,
					charge_full: '3200000', // 70% of 4570000
				},
			});
			const result = checkBatteryHealth({}, fsImpl);
			expect(result.code).toBe(1);
			expect(result.message).toContain('health 70% <= warning 80%');
		});

		test('is critical when health is at or below the critical threshold', () => {
			const fsImpl = makeFs({
				BAT0: {
					...HEALTHY_BATTERY,
					charge_full: '2285000', // 50% of 4570000
				},
			});
			const result = checkBatteryHealth({}, fsImpl);
			expect(result.code).toBe(2);
			expect(result.message).toContain('health 50% <= critical 60%');
		});

		test('ignores a zero design capacity instead of dividing by zero', () => {
			const fsImpl = makeFs({
				BAT0: {
					type: 'Battery',
					present: '1',
					status: 'Full',
					capacity: '50',
					charge_full: '1000',
					charge_full_design: '0',
				},
			});
			const result = checkBatteryHealth({}, fsImpl);
			expect(result.code).toBe(0);
			expect(perf(result, 'health_percent')).toBe('');
		});
	});

	describe('checkBatteryHealth - charge while discharging', () => {
		const dischargingFs = (capacity: string): FsLike =>
			makeFs({
				BAT0: {
					...HEALTHY_BATTERY,
					status: 'Discharging',
					capacity,
				},
			});

		test('warns on low charge while discharging', () => {
			const result = checkBatteryHealth({}, dischargingFs('15'));
			expect(result.code).toBe(1);
			expect(result.message).toContain(
				'charge 15% <= warning 20% while discharging',
			);
		});

		test('is critical on very low charge while discharging', () => {
			const result = checkBatteryHealth({}, dischargingFs('5'));
			expect(result.code).toBe(2);
			expect(result.message).toContain(
				'charge 5% <= critical 10% while discharging',
			);
		});

		test('ignores a non-numeric capacity and reports it as absent', () => {
			// A discharging battery with an unparsable capacity and no
			// charge/energy figures: no health, no charge, so nothing to alert
			// on and both perfdata values fall back to empty.
			const fsImpl = makeFs({
				BAT0: {
					type: 'Battery',
					present: '1',
					status: 'Discharging',
					capacity: 'N/A',
				},
			});
			const result = checkBatteryHealth({}, fsImpl);
			expect(result.code).toBe(0);
			expect(result.message).toContain('worst health n/a');
			expect(result.message).toContain('worst charge n/a');
			expect(perf(result, 'health_percent')).toBe('');
			expect(perf(result, 'charge_percent')).toBe('');
			expect(perf(result, 'BAT0_charge_percent')).toBeUndefined();
		});

		test('does not alert on charge while charging', () => {
			const result = checkBatteryHealth(
				{},
				makeFs({BAT0: {...HEALTHY_BATTERY, status: 'Charging', capacity: '5'}}),
			);
			expect(result.code).toBe(0);
		});

		test('skips charge checks entirely when checkCharge is false', () => {
			const result = checkBatteryHealth(
				{checkCharge: 'false'},
				dischargingFs('2'),
			);
			expect(result.code).toBe(0);
		});

		test('accepts checkCharge as a real boolean', () => {
			const result = checkBatteryHealth(
				{checkCharge: false},
				dischargingFs('2'),
			);
			expect(result.code).toBe(0);
		});

		test('accepts checkCharge as the string true', () => {
			const result = checkBatteryHealth(
				{checkCharge: 'true'},
				dischargingFs('2'),
			);
			expect(result.code).toBe(2);
		});

		test('treats a battery with no status as discharging when AC is offline', () => {
			const fsImpl = makeFs({
				BAT0: batteryWithoutStatus({capacity: '8'}),
				AC0: {type: 'Mains', online: '0'},
			});
			const result = checkBatteryHealth({}, fsImpl);
			expect(result.code).toBe(2);
			expect(result.message).toContain(
				'charge 8% <= critical 10% while discharging',
			);
		});

		test('treats a battery with no status as plugged in when AC is online', () => {
			const fsImpl = makeFs({
				BAT0: batteryWithoutStatus({capacity: '8'}),
				AC0: {type: 'Mains', online: '1'},
			});
			const result = checkBatteryHealth({}, fsImpl);
			expect(result.code).toBe(0);
		});

		test('treats a status-less battery as discharging when the AC scan fails', () => {
			// readdir succeeds for battery discovery, then throws for the AC
			// scan, so no mains can be found online and the battery is assumed
			// to be running on battery.
			const base = makeFs({BAT0: batteryWithoutStatus({capacity: '8'})});
			let calls = 0;
			const fsImpl: FsLike = {
				...base,
				readdirSync: (path: string) => {
					calls += 1;
					if (calls > 1) {
						throw new Error('readdir failed');
					}
					return base.readdirSync(path);
				},
			};
			const result = checkBatteryHealth({}, fsImpl);
			expect(result.code).toBe(2);
			expect(result.message).toContain(
				'charge 8% <= critical 10% while discharging',
			);
		});
	});

	describe('checkBatteryHealth - presence and alarm', () => {
		test('is critical when a battery reports present=0', () => {
			const fsImpl = makeFs({
				BAT0: {...HEALTHY_BATTERY, present: '0'},
			});
			const result = checkBatteryHealth({}, fsImpl);
			expect(result.code).toBe(2);
			expect(result.message).toContain('BAT0: battery is not present');
		});

		test('is critical when the battery alarm flag is set', () => {
			const fsImpl = makeFs({
				BAT0: {...HEALTHY_BATTERY, alarm: '1'},
			});
			const result = checkBatteryHealth({}, fsImpl);
			expect(result.code).toBe(2);
			expect(result.message).toContain('battery alarm flag is set');
		});
	});

	describe('checkBatteryHealth - multiple batteries', () => {
		test('aggregates the worst status across batteries and sums perfdata', () => {
			const fsImpl = makeFs({
				BAT0: {...HEALTHY_BATTERY},
				BAT1: {...HEALTHY_BATTERY, charge_full: '2285000'}, // 50% health
			});
			const result = checkBatteryHealth({}, fsImpl);
			expect(result.code).toBe(2);
			expect(result.message).toContain('found 1 issue(s)');
			expect(perf(result, 'battery_count')).toBe('2');
			expect(perf(result, 'health_percent')).toBe('50');
		});

		test('reports OK when every battery is healthy', () => {
			const fsImpl = makeFs({
				BAT0: {...HEALTHY_BATTERY},
				BAT1: {...HEALTHY_BATTERY, charge_full: '4400000'},
			});
			const result = checkBatteryHealth({}, fsImpl);
			expect(result.code).toBe(0);
			expect(result.message).toContain('2 battery(s)');
		});
	});

	describe('evaluateBattery (unit)', () => {
		const config = {
			warningHealthPercent: 80,
			criticalHealthPercent: 60,
			warningChargePercent: 20,
			criticalChargePercent: 10,
			checkCharge: true,
			treatNoBatteryAs: 'unknown' as const,
		};

		test('raises CRITICAL once and keeps the higher code on multiple issues', () => {
			const fsImpl = makeFs({
				BAT0: {...HEALTHY_BATTERY, alarm: '1', charge_full: '3200000'},
			});
			const evaluation = evaluateBattery(
				fsImpl,
				{
					name: 'BAT0',
					present: 1,
					alarm: 1,
					capacity: 100,
					healthPercent: 70,
					status: 'Full',
				},
				config,
			);
			expect(evaluation.code).toBe(2);
			expect(evaluation.issues).toHaveLength(2);
		});

		test('returns OK for a healthy charging battery', () => {
			const evaluation = evaluateBattery(
				makeFs({}),
				{
					name: 'BAT0',
					present: 1,
					alarm: 0,
					capacity: 100,
					healthPercent: 95,
					status: 'Full',
				},
				config,
			);
			expect(evaluation.code).toBe(0);
			expect(evaluation.issues).toHaveLength(0);
		});
	});

	describe('default filesystem', () => {
		test('uses the real fs binding when none is supplied', () => {
			jest.resetModules();
			let isolated:
				| {checkBatteryHealth: (p?: Record<string, unknown>) => Result}
				| undefined;
			jest.isolateModules(() => {
				jest.doMock('fs', () => makeFs({BAT0: HEALTHY_BATTERY}));
				isolated = jest.requireActual<typeof import('./check_battery_health')>(
					'./check_battery_health',
				);
			});

			if (!isolated) {
				throw new Error('Failed to load isolated module');
			}
			const result = isolated.checkBatteryHealth();
			expect(result.code).toBe(0);
			expect(result.message).toContain('OK: 1 battery(s)');

			jest.dontMock('fs');
			jest.resetModules();
		});
	});
});
