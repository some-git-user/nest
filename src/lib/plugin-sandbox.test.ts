import vm from 'vm';
import {buildPluginSandbox} from './plugin-sandbox';

const g = globalThis as Record<string, unknown>;
const PROBE = '__probe_global__';

/** Runs `typeof <name>` inside a real vm context built from the sandbox. */
const typeOfInSandbox = (name: string): string => {
	const context = vm.createContext(buildPluginSandbox({}));
	return vm.runInContext(`typeof ${name}`, context) as string;
};

describe('buildPluginSandbox', () => {
	afterEach(() => {
		delete g[PROBE];
	});

	it('copies enumerable globals from globalThis', () => {
		// `fetch` is an enumerable own property of globalThis on Node.
		expect(typeOfInSandbox('fetch')).toBe('function');
	});

	it('copies non-enumerable data globals that a spread drops', () => {
		// These are the globals that caused "ReferenceError: URL is not defined".
		expect(typeOfInSandbox('URL')).toBe('function');
		expect(typeOfInSandbox('URLSearchParams')).toBe('function');
		expect(typeOfInSandbox('console')).toBe('object');
		expect(typeOfInSandbox('TextEncoder')).toBe('function');
	});

	it('exposes Buffer even though it is a non-enumerable accessor', () => {
		expect(typeOfInSandbox('Buffer')).toBe('function');
		const sandbox = buildPluginSandbox({});
		expect(sandbox.Buffer).toBe(Buffer);
	});

	it('applies overrides on top of the copied globals', () => {
		const sandbox = buildPluginSandbox({
			require: () => undefined,
			module: {exports: {}},
			__filename: 'memory://plugin/x.ts',
		});
		expect(typeof sandbox.require).toBe('function');
		expect(sandbox.module).toEqual({exports: {}});
		expect(sandbox.__filename).toBe('memory://plugin/x.ts');
	});

	it('lets overrides win over a same-named global', () => {
		const sandbox = buildPluginSandbox({URL: 'not-the-global'});
		expect(sandbox.URL).toBe('not-the-global');
	});

	it('copies a non-enumerable data property defined at runtime', () => {
		Object.defineProperty(g, PROBE, {
			value: 'copied',
			enumerable: false,
			configurable: true,
			writable: true,
		});
		const sandbox = buildPluginSandbox({});
		expect(sandbox[PROBE]).toBe('copied');
	});

	it('skips a non-enumerable accessor so its getter is never invoked', () => {
		const getter = jest.fn((): string => 'should-not-be-copied');
		Object.defineProperty(g, PROBE, {
			get: getter,
			enumerable: false,
			configurable: true,
		});
		const sandbox = buildPluginSandbox({});
		expect(getter).not.toHaveBeenCalled();
		expect(PROBE in sandbox).toBe(false);
	});

	it('does not re-copy an enumerable accessor (the spread already handled it)', () => {
		// Enumerable accessor: the spread invokes the getter, but the explicit
		// loop must not treat it as a data property.
		Object.defineProperty(g, PROBE, {
			get: () => 'from-getter',
			enumerable: true,
			configurable: true,
		});
		const sandbox = buildPluginSandbox({});
		expect(sandbox[PROBE]).toBe('from-getter');
	});
});
