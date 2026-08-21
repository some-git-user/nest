// Version is embedded at build time from package.json
// In development, we read it from package.json directly
import * as pkg from '../../package.json';

export const getAppVersion = (): string => {
	if (typeof globalThis.__VERSION__ !== 'undefined') {
		// Production: version was injected by esbuild
		return globalThis.__VERSION__;
	}
	// Development: read from package.json
	return pkg.version;
};
