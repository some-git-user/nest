import type {NagiosReturnCode} from '../src/types/nagios';
import type {
	HtmlTemplateString,
	PluginMeta,
	PluginReturn,
} from '../src/types/plugin';

export const meta: PluginMeta = {
	usage: {
		http: '/plugins/check-test?nagiosReturnMessage=<string>&nagiosReturnValue=<0 | 1 | 2 | 3>&performanceData=<true | false>',
		shell:
			'./check_nest.sh check-test nagiosReturnMessage=<string> nagiosReturnValue=<0 | 1 | 2 | 3> performanceData=<true | false>',
	},
	help: `<h1>check-test</h1>
<p>A test plugin for verifying the NEST plugin system and Nagios integration.</p>

<h2>Parameters</h2>
<table>
  <thead><tr><th>Name</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
    <tr>
      <td><code>nagiosReturnMessage</code></td>
      <td>string</td>
      <td>-</td>
      <td>The message to return in the Nagios check result</td>
    </tr>
    <tr>
      <td><code>nagiosReturnValue</code></td>
      <td>number</td>
      <td>-</td>
      <td>Nagios return code: 0=OK, 1=WARNING, 2=CRITICAL, 3=UNKNOWN</td>
    </tr>
    <tr>
      <td><code>performanceData</code></td>
      <td>boolean</td>
      <td>false</td>
      <td>When true, includes sample performance data in the result</td>
    </tr>
  </tbody>
</table>

<h2>Return Codes</h2>
<table>
  <tr><th>Code</th><th>Status</th><th>Description</th></tr>
  <tr><td>0</td><td>OK</td><td>Check passed successfully</td></tr>
  <tr><td>1</td><td>WARNING</td><td>Warning condition</td></tr>
  <tr><td>2</td><td>CRITICAL</td><td>Critical condition</td></tr>
  <tr><td>3</td><td>UNKNOWN</td><td>Unknown error or invalid parameters</td></tr>
</table>

<h2>Examples</h2>
<h3>Basic OK check</h3>
<pre><code>GET /plugins/check-test?nagiosReturnMessage=All+systems+operational&nagiosReturnValue=0</code></pre>

<h3>Warning with performance data</h3>
<pre><code>GET /plugins/check-test?nagiosReturnMessage=High+load+detected&nagiosReturnValue=1&performanceData=true</code></pre>

<h3>Using check_nest.sh</h3>
<pre><code>./check_nest.sh check-test nagiosReturnMessage=Test+message nagiosReturnValue=0 performanceData=false</code></pre>` as HtmlTemplateString,
	examples: [
		{
			label: 'Quick GET example',
			method: 'GET',
			path: '/plugins/check-test',
			fields: [
				{
					name: 'nagiosReturnMessage',
					label: 'Message',
					defaultValue: 'Example-OK',
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
					defaultValue: 'Example-Warning',
				},
				{name: 'nagiosReturnValue', label: 'Code', defaultValue: '1'},
			],
		},
	],
};

export const checkTest = (params: {
	nagiosReturnMessage?: string;
	nagiosReturnValue?: NagiosReturnCode;
	performanceData?: boolean;
}): PluginReturn => {
	const {
		nagiosReturnMessage,
		nagiosReturnValue,
		performanceData = false,
	} = params;
	console.log(
		`Test plugin received: nagiosReturnMessage=${nagiosReturnMessage}, nagiosReturnValue=${nagiosReturnValue}, performanceData=${performanceData}`,
	);

	const returnObject: PluginReturn = {
		message: nagiosReturnMessage ?? `Usage: ${meta.usage?.http}`,
		code: nagiosReturnValue ?? 3,
		performanceData: [],
	};

	if (performanceData) {
		let label = 'WATER BOILER TEMP';
		let value = '55';
		let uom = 'C°';
		let warn = '80';
		let crit = '90';
		let min = '0';
		let max = '100';
		returnObject.performanceData?.push({
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
		returnObject.performanceData?.push({
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
