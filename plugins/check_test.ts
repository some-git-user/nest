import type {PluginMeta} from '../src/types/plugin-meta';

export const meta = {
	usage: {
		http: '/plugins/check-test?nagiosReturnMessage=<string>&nagiosReturnValue=<0 | 1 | 2 | 3>&performanceData=<true | false>',
		shell:
			'./check_nest.sh check-test nagiosReturnMessage=<string> nagiosReturnValue=<0 | 1 | 2 | 3> performanceData=<true | false>',
	},
	examples: [
		{
			label: 'Quick GET example',
			method: 'GET',
			path: '/plugins/check-test',
			fields: [
				{
					name: 'nagiosReturnMessage',
					label: 'Message',
					defaultValue: 'Example OK',
				},
				{name: 'nagiosReturnValue', label: 'Code', defaultValue: '0'},
				{
					name: 'performanceData',
					label: 'Include Perf Data',
					defaultValue: 'true',
				},
			],
		},
		{
			label: 'POST body example',
			method: 'POST',
			path: '/plugins/check-test',
			fields: [
				{
					name: 'nagiosReturnMessage',
					label: 'Message',
					defaultValue: 'Example Warning',
				},
				{name: 'nagiosReturnValue', label: 'Code', defaultValue: '1'},
			],
		},
	],
} satisfies PluginMeta;

export const checkTest = (params: {
	nagiosReturnMessage: string;
	nagiosReturnValue: 0 | 1 | 2 | 3;
	performanceData: boolean;
}) => {
	const {nagiosReturnMessage, nagiosReturnValue, performanceData} = params;
	console.log(
		`Testplugin received: nagiosReturnMessage=${nagiosReturnMessage}, nagiosReturnValue=${nagiosReturnValue}, performanceData=${performanceData}`,
	);

	const returnObject: {
		message: string;
		code: number;
		performanceData: Array<{
			label: string;
			value: number | string;
			uom?: string;
			warn?: string | null;
			crit?: string | null;
			min?: number | string | null;
			max?: number | string | null;
		}>;
	} = {
		message: nagiosReturnMessage,
		code: Number.isInteger(Number(nagiosReturnValue))
			? Number(nagiosReturnValue)
			: 3,
		performanceData: [],
	};

	if (
		!nagiosReturnMessage ||
		nagiosReturnValue === undefined ||
		nagiosReturnValue === null
	) {
		returnObject.message = `Usage: ${meta.usage.http}`;
		returnObject.code = 3;
	}

	if (performanceData) {
		let label = 'WATER BOILER TEMP';
		let value = '55';
		let uom = 'C°';
		let warn = '80';
		let crit = '90';
		let min = '0';
		let max = '100';
		returnObject.performanceData.push({
			label,
			value,
			uom,
			warn,
			crit,
			min,
			max,
		});

		label = 'OUTDOOR TEMP';
		value = '21';
		uom = 'C°';
		warn = '30';
		crit = '40';
		min = '-20';
		max = '50';
		returnObject.performanceData.push({
			label,
			value,
			uom,
			warn,
			crit,
			min,
			max,
		});
	}

	console.log(`Testplugin will return: ${JSON.stringify(returnObject)}`);
	return returnObject;
};
