#!/usr/bin/env node
import {readdir, stat} from 'fs/promises';
import {basename, dirname, extname, join} from 'path';
import {fileURLToPath} from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

interface UntestedFile {
	file: string;
	testPath: string;
}

async function findTsFiles(
	dir: string,
	excludePatterns: string[],
): Promise<string[]> {
	const files: string[] = [];
	const entries = await readdir(dir);

	for (const entry of entries) {
		const fullPath = join(dir, entry);
		const statInfo = await stat(fullPath);

		if (statInfo.isDirectory()) {
			if (!excludePatterns.some((pattern) => fullPath.includes(pattern))) {
				const subFiles = await findTsFiles(fullPath, excludePatterns);
				files.push(...subFiles);
			}
		} else if (extname(entry) === '.ts' && !entry.endsWith('.test.ts')) {
			files.push(fullPath);
		}
	}

	return files;
}

function hasTestFile(filePath: string): string | false {
	const dir = dirname(filePath);
	const base = basename(filePath, '.ts');
	const testPath = join(dir, `${base}.test.ts`);

	// For type definition files, check if they have tests
	if (base.endsWith('.d')) {
		return false; // Type definitions typically don't need tests
	}

	return testPath;
}

async function main(): Promise<void> {
	const pluginsDir = join(rootDir, 'plugins');
	const srcDir = join(rootDir, 'src');

	console.log('🔍 Finding TypeScript files without test files...\n');

	const excludePatterns = ['node_modules', 'src/test'];
	const [pluginFiles, srcFiles] = await Promise.all([
		findTsFiles(pluginsDir, excludePatterns),
		findTsFiles(srcDir, excludePatterns),
	]);

	const allFiles = [...pluginFiles, ...srcFiles];
	const untestedFiles: UntestedFile[] = [];

	for (const file of allFiles) {
		const testPath = hasTestFile(file);
		if (testPath) {
			try {
				await stat(testPath);
			} catch {
				untestedFiles.push({file, testPath});
			}
		}
	}

	if (untestedFiles.length === 0) {
		console.log('✅ All TypeScript files have corresponding test files!');
		process.exit(0);
	} else {
		console.log(`❌ Found ${untestedFiles.length} file(s) without tests:\n`);

		for (const {file, testPath} of untestedFiles) {
			const relativePath = file.replace(rootDir, '.');
			const relativeTestPath = testPath.replace(rootDir, '.');
			console.log(`  - ${relativePath}`);
			console.log(`    → Missing: ${relativeTestPath}\n`);
		}

		console.log(
			'\n💡 Tip: Type definition files (.d.ts) typically do not need tests.',
		);
		process.exit(1);
	}
}

main().catch(console.error);
