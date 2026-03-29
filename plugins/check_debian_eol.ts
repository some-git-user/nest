import fs from 'fs';

type endoflifeResponseType = {
	result: {
		label: 'Debian';
		name: 'debian';
		releases: {
			codename: string;
			eoesFrom: string;
			eolFrom: string;
			isEoes: boolean;
			isEol: boolean;
			isLts: boolean;
			isMaintained: boolean;
			label: string;
			latest: {
				date: string;
				name: string;
			};
			ltsFrom: string;
			name: string;
			releaseDate: string;
		}[];
	};
};

export const meta = {
	usage: {
		http: '/plugins/check-debian-eol?warningEolRemainingDays=<number>&criticalEolRemainingDays=<number>',
		shell:
			'./check_nest.sh check-debian-eol warningEolRemainingDays=<number> criticalEolRemainingDays=<number>',
	},
};

const isEndoflifeResponse = (
	value: unknown,
): value is endoflifeResponseType => {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const record = value as Record<string, unknown>;
	if (typeof record.result !== 'object' || record.result === null) {
		return false;
	}

	const result = record.result as Record<string, unknown>;
	return Array.isArray(result.releases);
};

// Usage: check_nest.sh check-debian-eol [warningEolRemainingDays=30] [criticalEolRemainingDays=60]
// Check the end of life (EOL) of the Debian OS and return a Nagios compatible string
// The parameters are optional and default to 30 and 60 days respectively
export const checkDebianEol = async (params: {
	warningEolRemainingDays: number;
	criticalEolRemainingDays: number;
}) => {
	const {warningEolRemainingDays = 60, criticalEolRemainingDays = 30} = params;
	const returnObject = {
		message: 'Should not be here',
		code: 3,
	};
	const debianVersionFile = '/etc/os-release';
	const debianVersion = await fs.promises
		.readFile(debianVersionFile, 'utf-8')
		.then((data) => {
			const versionIdMatch = data.match(/VERSION_ID="?([^"]+)"/);
			if (versionIdMatch) {
				return versionIdMatch[1];
			} else {
				throw new Error('VERSION_ID not found in /etc/os-release');
			}
		})
		.catch((error) => {
			console.error(`Error reading debian version file: ${error}`);
			return null;
		});

	const eolUrl = 'https://endoflife.date/api/v1/products/debian/';
	const response = await fetch(eolUrl);
	if (!response.ok) {
		returnObject.message = `Error: ${response.status} ${response.statusText}`;
		return returnObject;
	}
	const jsonResponseUnknown: unknown = await response.json();
	if (!isEndoflifeResponse(jsonResponseUnknown)) {
		returnObject.message = `Error: invalid response format from ${eolUrl}`;
		return returnObject;
	}

	const jsonResponse = jsonResponseUnknown;

	if (
		jsonResponse?.result?.releases &&
		Array.isArray(jsonResponse.result.releases) &&
		jsonResponse.result.releases.length > 0
	) {
		const latestMatchingRelease = jsonResponse.result.releases.find(
			(release) => release.name === debianVersion,
		);

		if (!latestMatchingRelease) {
			returnObject.message = `Debian version "${debianVersion}" does not match any releases from ${eolUrl}`;
			return returnObject;
		}
		if (latestMatchingRelease.isEol) {
			returnObject.message = `Debian version "${debianVersion}" is EOL since ${latestMatchingRelease.eolFrom}`;
			returnObject.code = 2;
		}
		const eolDate = new Date(latestMatchingRelease.eolFrom);
		const today = new Date();
		const daysRemaining = Math.ceil(
			(eolDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
		);

		if (daysRemaining <= criticalEolRemainingDays) {
			returnObject.message = `Debian version "${debianVersion}" is EOL in ${daysRemaining} days`;
			returnObject.code = 2; // CRITICAL
		} else if (daysRemaining <= warningEolRemainingDays) {
			returnObject.message = `Debian version "${debianVersion}" is EOL in ${daysRemaining} days`;
			returnObject.code = 1; // WARNING
		} else if (daysRemaining > warningEolRemainingDays) {
			returnObject.message = `Debian version "${debianVersion}" is not EOL. Remaining days: ${daysRemaining}`;
			returnObject.code = 0; // OK
		}
	}

	return returnObject;
};
