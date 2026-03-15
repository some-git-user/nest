export default {
	roots: ['<rootDir>/src', '<rootDir>/plugins'],
	coveragePathIgnorePatterns: ['<rootDir>/logs/plugin-cache/'],
	testMatch: [
		'**/__tests__/**/*.+(ts|tsx|js)',
		'**/?(*.)+(spec|test).+(ts|tsx|js)',
	],
	transform: {
		'^.+\\.(ts|tsx)$': 'ts-jest',
	},
};
