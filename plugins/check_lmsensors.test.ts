import {
	checkLmSensors,
	evaluateReadings,
	getStatusText,
	meta,
	parseTemperatureReadings,
} from './check_lmsensors';

const okJson = JSON.stringify({
	'coretemp-isa-0000': {
		Adapter: 'ISA adapter',
		'Package id 0': {
			temp1_input: 57,
			temp1_max: 100,
			temp1_crit: 100,
			temp1_crit_alarm: 0,
		},
		'Core 0': {
			temp2_input: 49,
			temp2_max: 100,
			temp2_crit: 100,
			temp2_crit_alarm: 0,
		},
	},
	'acpitz-acpi-0': {
		Adapter: 'ACPI interface',
		temp1: {temp1_input: 40},
	},
});

const runner =
	(stdout: string, stderr = '') =>
	() =>
		Promise.resolve({stdout, stderr});

const baseConfig = {
	warningTempC: 80,
	criticalTempC: 95,
	useChipLimits: true,
	checkAlarms: true,
	includeChips: [],
	excludeChips: [],
};

describe('checkLmSensors plugin', () => {
	test('exports usage metadata', () => {
		expect(meta.usage.http).toContain('/plugins/check-lmsensors');
		expect(meta.usage.shell).toContain('./check_nest.sh check-lmsensors');
		expect(meta.usage.http).toContain('warningTempC');
		expect(meta.usage.http).toContain('criticalTempC');
		expect(meta.examples?.[0]).toEqual(
			expect.objectContaining({path: '/plugins/check-lmsensors'}),
		);
		if (
			typeof meta.examples?.[0] === 'object' &&
			'fields' in meta.examples[0]
		) {
			expect(meta.examples[0].fields).toEqual(
				expect.arrayContaining([
					expect.objectContaining({name: 'warningTempC', required: false}),
					expect.objectContaining({name: 'criticalTempC', required: false}),
				]),
			);
		}
	});

	test('getStatusText maps all codes', () => {
		expect(getStatusText(0)).toBe('OK');
		expect(getStatusText(1)).toBe('WARNING');
		expect(getStatusText(2)).toBe('CRITICAL');
		expect(getStatusText(999)).toBe('UNKNOWN');
	});

	test('returns OK with default thresholds and perf data', async () => {
		const result = await checkLmSensors({}, runner(okJson));

		expect(result.code).toBe(0);
		expect(result.message).toContain('OK: lm-sensors checked 2 chip(s), 3');
		expect(result.message).toContain(
			'hottest coretemp-isa-0000 "Package id 0" 57C',
		);
		expect(result.performanceData).toEqual(
			expect.arrayContaining([
				expect.objectContaining({label: 'temp_sensor_count', value: '3'}),
				expect.objectContaining({
					label: 'coretemp_isa_0000_Package_id_0_temp',
					value: '57',
					uom: 'C',
					warn: '80',
					crit: '95',
				}),
			]),
		);
	});

	test('returns WARNING when a sensor exceeds global warning threshold', async () => {
		const json = JSON.stringify({
			'chip-0': {Adapter: 'x', temp1: {temp1_input: 82}},
		});
		const result = await checkLmSensors({}, runner(json));

		expect(result.code).toBe(1);
		expect(result.message).toContain('WARNING: lm-sensors detected 1 issue(s)');
		expect(result.message).toContain('chip-0 "temp1" 82C >= warning 80C');
	});

	test('returns CRITICAL when a sensor exceeds global critical threshold', async () => {
		const json = JSON.stringify({
			'chip-0': {Adapter: 'x', temp1: {temp1_input: 96}},
		});
		const result = await checkLmSensors({}, runner(json));

		expect(result.code).toBe(2);
		expect(result.message).toContain('chip-0 "temp1" 96C >= critical 95C');
	});

	test('honours chip critical limit before global warning', async () => {
		const json = JSON.stringify({
			'chip-0': {
				Adapter: 'x',
				temp1: {temp1_input: 85, temp1_crit: 84},
			},
		});
		const result = await checkLmSensors({}, runner(json));

		expect(result.code).toBe(2);
		expect(result.message).toContain('chip-0 "temp1" 85C >= chip critical 84C');
	});

	test('honours chip max limit as warning', async () => {
		const json = JSON.stringify({
			'chip-0': {
				Adapter: 'x',
				temp1: {temp1_input: 82, temp1_max: 82},
			},
		});
		const result = await checkLmSensors({}, runner(json));

		expect(result.code).toBe(1);
		expect(result.message).toContain('chip-0 "temp1" 82C >= chip max 82C');
	});

	test('treats raised hardware alarm as CRITICAL', async () => {
		const json = JSON.stringify({
			'chip-0': {
				Adapter: 'x',
				temp1: {temp1_input: 30, temp1_alarm: 1},
			},
		});
		const result = await checkLmSensors({}, runner(json));

		expect(result.code).toBe(2);
		expect(result.message).toContain(
			'chip-0 "temp1" 30C hardware alarm raised',
		);
	});

	test('ignores alarms when checkAlarms=false', async () => {
		const json = JSON.stringify({
			'chip-0': {
				Adapter: 'x',
				temp1: {temp1_input: 30, temp1_alarm: 1},
			},
		});
		const result = await checkLmSensors({checkAlarms: false}, runner(json));

		expect(result.code).toBe(0);
	});

	test('ignores chip limits when useChipLimits=false', async () => {
		const json = JSON.stringify({
			'chip-0': {
				Adapter: 'x',
				temp1: {temp1_input: 70, temp1_crit: 60},
			},
		});
		const result = await checkLmSensors({useChipLimits: false}, runner(json));

		expect(result.code).toBe(0);
	});

	test('accepts boolean parameters as strings', async () => {
		const json = JSON.stringify({
			'chip-0': {
				Adapter: 'x',
				temp1: {temp1_input: 70, temp1_crit: 60},
			},
		});
		const result = await checkLmSensors(
			{useChipLimits: 'false', checkAlarms: 'true'},
			runner(json),
		);

		expect(result.code).toBe(0);
	});

	test('filters chips with includeChips', async () => {
		const result = await checkLmSensors(
			{includeChips: 'acpitz'},
			runner(okJson),
		);

		expect(result.code).toBe(0);
		expect(result.message).toContain('checked 1 chip(s), 1 temperature sensor');
	});

	test('filters chips with excludeChips', async () => {
		const result = await checkLmSensors(
			{excludeChips: 'coretemp'},
			runner(okJson),
		);

		expect(result.code).toBe(0);
		expect(result.message).toContain('checked 1 chip(s), 1 temperature sensor');
	});

	test('returns UNKNOWN when filtering removes all sensors', async () => {
		const result = await checkLmSensors(
			{excludeChips: 'coretemp,acpitz'},
			runner(okJson),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain('no temperature sensors were found');
	});

	test('ignores non-numeric temp input readings', async () => {
		const json = JSON.stringify({
			'chip-0': {
				Adapter: 'x',
				temp1: {temp1_input: 'not-a-number'},
				temp2: {temp2_input: 40},
			},
		});
		const result = await checkLmSensors({}, runner(json));

		expect(result.code).toBe(0);
		expect(result.message).toContain('1 temperature sensor');
	});

	test('skips non-object feature and chip entries', () => {
		const readings = parseTemperatureReadings(
			{
				'chip-str': 'not-an-object',
				'chip-arr': {Adapter: 'x', feat: [1, 2, 3]},
				'chip-ok': {Adapter: 'x', temp1: {temp1_input: 42}},
			},
			baseConfig,
		);

		expect(readings).toHaveLength(1);
		expect(readings[0]).toEqual(
			expect.objectContaining({chip: 'chip-ok', feature: 'temp1', value: 42}),
		);
	});

	test('detects crit_alarm flag as alarm', () => {
		const readings = parseTemperatureReadings(
			{
				'chip-0': {
					Adapter: 'x',
					temp1: {temp1_input: 10, temp1_crit_alarm: 1},
				},
			},
			baseConfig,
		);

		expect(readings[0].alarm).toBe(true);
	});

	test('evaluateReadings returns OK when nothing is triggered', () => {
		const evaluation = evaluateReadings(
			[{chip: 'c', feature: 'f', value: 10, alarm: false}],
			baseConfig,
		);

		expect(evaluation.status).toBe(0);
		expect(evaluation.issues).toHaveLength(0);
	});

	test('reports the hottest sensor when it is not the first reading', async () => {
		const json = JSON.stringify({
			'chip-a': {Adapter: 'x', temp1: {temp1_input: 30}},
			'chip-b': {Adapter: 'x', temp1: {temp1_input: 55}},
		});
		const result = await checkLmSensors({}, runner(json));

		expect(result.code).toBe(0);
		expect(result.message).toContain('hottest chip-b "temp1" 55C');
	});

	test('returns UNKNOWN for empty sensors output', async () => {
		const result = await checkLmSensors({}, runner('   '));

		expect(result.code).toBe(3);
		expect(result.message).toContain('returned no output');
	});

	test('returns UNKNOWN for invalid JSON output', async () => {
		const result = await checkLmSensors({}, runner('this is not json'));

		expect(result.code).toBe(3);
		expect(result.message).toContain('not valid JSON');
	});

	test('returns UNKNOWN for JSON array output', async () => {
		const result = await checkLmSensors({}, runner('[1,2,3]'));

		expect(result.code).toBe(3);
		expect(result.message).toContain('unexpected structure');
	});

	test('returns UNKNOWN for JSON null output', async () => {
		const result = await checkLmSensors({}, runner('null'));

		expect(result.code).toBe(3);
		expect(result.message).toContain('unexpected structure');
	});

	test('returns UNKNOWN when sensors binary is missing', async () => {
		const enoent = Object.assign(new Error('spawn sensors ENOENT'), {
			code: 'ENOENT',
		});
		const result = await checkLmSensors({}, () => Promise.reject(enoent));

		expect(result.code).toBe(3);
		expect(result.message).toContain('sensors command was not found');
	});

	test('returns UNKNOWN on generic execution error', async () => {
		const result = await checkLmSensors({}, () =>
			Promise.reject(new Error('Command failed')),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain(
			'failed to execute sensors: Command failed',
		);
	});

	test('returns UNKNOWN on non-Error rejection', async () => {
		const result = await checkLmSensors({}, () => Promise.reject('boom'));

		expect(result.code).toBe(3);
		expect(result.message).toContain('failed to execute sensors: boom');
	});

	test('returns UNKNOWN for invalid warningTempC', async () => {
		const result = await checkLmSensors({warningTempC: 'abc'}, runner(okJson));

		expect(result.code).toBe(3);
		expect(result.message).toContain('warningTempC must be a valid number');
	});

	test('returns UNKNOWN for invalid criticalTempC', async () => {
		const result = await checkLmSensors({criticalTempC: 'xyz'}, runner(okJson));

		expect(result.code).toBe(3);
		expect(result.message).toContain('criticalTempC must be a valid number');
	});

	test('returns UNKNOWN when warningTempC below absolute zero', async () => {
		const result = await checkLmSensors({warningTempC: '-300'}, runner(okJson));

		expect(result.code).toBe(3);
		expect(result.message).toContain('greater than or equal to -273.15');
	});

	test('returns UNKNOWN when criticalTempC below absolute zero', async () => {
		const result = await checkLmSensors(
			{criticalTempC: '-300'},
			runner(okJson),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain('greater than or equal to -273.15');
	});

	test('returns UNKNOWN when warning exceeds critical', async () => {
		const result = await checkLmSensors(
			{warningTempC: '90', criticalTempC: '80'},
			runner(okJson),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain(
			'warningTempC must be less than or equal to criticalTempC',
		);
	});

	test('ignores non-string includeChips value', async () => {
		const result = await checkLmSensors({includeChips: 123}, runner(okJson));

		expect(result.code).toBe(0);
	});

	test('uses default runner when no custom runner is provided', async () => {
		jest.resetModules();
		const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');
		const execFileMock = jest.fn();
		(execFileMock as unknown as Record<symbol, unknown>)[promisifyCustom] =
			() => Promise.resolve({stdout: okJson, stderr: ''});

		let isolatedModule:
			| {checkLmSensors: () => Promise<{code: number; message: string}>}
			| undefined;
		jest.isolateModules(() => {
			jest.doMock('child_process', () => ({execFile: execFileMock}));
			isolatedModule =
				jest.requireActual<typeof import('./check_lmsensors')>(
					'./check_lmsensors',
				);
		});

		if (!isolatedModule) {
			throw new Error('Failed to load isolated module');
		}
		const result = await isolatedModule.checkLmSensors();

		expect(result.code).toBe(0);
		expect(result.message).toContain('OK: lm-sensors checked');

		jest.dontMock('child_process');
		jest.resetModules();
	});
});
