import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

// Get version from package.json
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
	fs.readFileSync(path.join(scriptDir, 'package.json'), 'utf8'),
);
const APP_VERSION = packageJson.version;

/**
 * Custom esbuild plugin to handle native .node files
 * Replaces native addon requires with stubs that will be intercepted at runtime
 *
 * Based on esbuild plugin documentation: https://esbuild.github.io/plugins/
 * Uses namespaces to create virtual modules for native addons
 */
const nativeAddonPlugin = {
	name: 'native-addon-handler',
	setup(build) {
		// Step 1: Intercept .node file imports and redirect to a virtual namespace
		build.onResolve({filter: /\.node$/}, (args) => {
			// Mark these as external so they're not bundled as files
			// Instead, we'll provide stub implementations
			return {
				path: args.path,
				external: true,
			};
		});

		// Step 2: Intercept ssh2's crypto.js and replace the native require
		build.onLoad({filter: /crypto\.js$/}, async (args) => {
			if (args.path.includes('ssh2') && args.path.includes('protocol')) {
				// Read the original file and replace the native require with a stub
				const contents = await fs.promises.readFile(args.path, 'utf8');
				// Replace the native addon require with a stub that will be populated at runtime
				// The native require is in a try-catch, so we replace just the require line
				const modifiedContents = contents.replace(
					/binding\s*=\s*require\(['"]\.\/crypto\/build\/Release\/sshcrypto\.node['"]\)/,
					'binding = (globalThis.__SSH2_CRYPTO_STUB__ || {})',
				);
				return {
					contents: modifiedContents,
					loader: 'js',
				};
			}
		});

		// Step 3: Intercept cpu-features and replace the native require
		build.onLoad({filter: /cpufeatures\.js$/}, async (args) => {
			if (args.path.includes('cpu-features')) {
				const contents = await fs.promises.readFile(args.path, 'utf8');
				const modifiedContents = contents.replace(
					/binding\s*=\s*require\(['"]\.\.\/build\/Release\/cpufeatures\.node['"]\)/,
					'binding = globalThis.__CPU_FEATURES_STUB__ || {}',
				);
				return {
					contents: modifiedContents,
					loader: 'js',
				};
			}
		});
	},
};

async function build() {
	const cwd = process.cwd();
	const distDir = path.join(cwd, 'dist');
	const standaloneDir = path.join(cwd, 'standalone');

	// Ensure dist directory exists
	if (!fs.existsSync(distDir)) {
		console.error(
			'Error: dist directory does not exist. Run "npm run build" first.',
		);
		process.exit(1);
	}

	console.log('Bundling server-preload.js with esbuild...');

	try {
		await esbuild.build({
			entryPoints: [path.join(distDir, 'server-preload.js')],
			bundle: true,
			platform: 'node',
			outfile: path.join(standaloneDir, 'server-bundled.js'),
			plugins: [nativeAddonPlugin],
			logLevel: 'info',
			external: [], // Bundle everything (native addons will be stubbed)
			banner: {
				js: `process.argv[1] = process.argv[1] || "dist/server-preload.js";\nglobalThis.__VERSION__ = ${JSON.stringify(APP_VERSION)};`,
			},
		});

		console.log('✓ esbuild bundling complete');
	} catch (error) {
		console.error('✗ esbuild bundling failed:', error);
		process.exit(1);
	}
}

build();
