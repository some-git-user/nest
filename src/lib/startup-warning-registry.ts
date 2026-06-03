const startupWarnings: string[] = [];
const seenWarnings = new Set<string>();

export const recordStartupWarning = (warning: string): void => {
	const normalizedWarning = warning.trim();
	if (normalizedWarning.length === 0 || seenWarnings.has(normalizedWarning)) {
		return;
	}

	seenWarnings.add(normalizedWarning);
	startupWarnings.push(normalizedWarning);
};

export const recordStartupWarnings = (warnings: string[]): void => {
	for (const warning of warnings) {
		recordStartupWarning(warning);
	}
};

export const getStartupWarnings = (): string[] => [...startupWarnings];

export const resetStartupWarnings = (): void => {
	startupWarnings.length = 0;
	seenWarnings.clear();
};
