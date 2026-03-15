export const meta = {
	usage: {
		http: '/check-test?nagiosReturnMessage=<string>&nagiosReturnValue=<0 | 1 | 2 | 3>&performanceData=<true | false>',
		shell:
			'./check_nest.sh check-test nagiosReturnMessage=<string> nagiosReturnValue=<0 | 1 | 2 | 3> performanceData=<true | false>',
	},
};

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
