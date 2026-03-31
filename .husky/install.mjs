// Skip Husky hook installation in CI/production where dev dependencies may be omitted.
if (
	globalThis.process?.env.NODE_ENV === 'production' ||
	globalThis.process?.env.CI
) {
	globalThis.process.exit(0);
}

const husky = (await import('husky')).default;
husky();
