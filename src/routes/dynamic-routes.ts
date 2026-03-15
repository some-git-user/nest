import express from 'express';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import {env} from '../config/env';
import {createPluginRouteHandler} from '../controllers/dynamic-routes';
import {logger} from '../lib/logger';

const router = express.Router();
const pluginsDir = path.join(process.cwd(), env.PLUGINS_DIR);

logger.info(`Use plugins directory: ${pluginsDir}`);

fs.readdirSync(pluginsDir)?.forEach((file) => {
	const filePath = path.join(pluginsDir, file);
	const jsFilePath = filePath.replace(/\.ts$/, '.js');

	const tsCode = fs.readFileSync(filePath, 'utf-8');
	const result = ts.transpileModule(tsCode, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ESNext,
			esModuleInterop: true,
			allowSyntheticDefaultImports: true,
			outDir: path.dirname(jsFilePath),
		},
	});

	fs.writeFileSync(jsFilePath, result.outputText);

	const fileStat = fs.statSync(filePath);

	if (fileStat.isFile() && filePath.endsWith('.ts')) {
		const kebabCasePath = `/${path
			.basename(file, path.extname(file))
			.replace(/[^a-zA-Z0-9]/g, '-')
			.toLowerCase()}`;
		logger.info(
			`GET route initialized for plugin: ${filePath}: http://${env.HOST}:${env.PORT}${kebabCasePath}`,
		);

		router.get(
			kebabCasePath,
			createPluginRouteHandler(jsFilePath, kebabCasePath),
		);
	}
});

export default router;
