export default {
	roots: ['<rootDir>/src', '<rootDir>/plugins'],
	moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
	coverageThreshold: {
		global: {
			branches: 100,
			functions: 100,
			lines: 100,
			statements: 100,
		},
	},
	coverageReporters: ['text', 'lcov', 'html'],
	testMatch: [
		'**/__tests__/**/*.+(ts|tsx|js)',
		'**/?(*.)+(spec|test).+(ts|tsx|js)',
	],
	transform: {
		'^.+\\.(ts|tsx)$': 'ts-jest',
	},
	testEnvironment: 'node',
	moduleNameMapper: {
		'^sanitize-html$': '<rootDir>/src/test/mocks/sanitize-html.ts',
	},
};
