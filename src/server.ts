import express, {Application, Request, Response} from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import helmet from 'helmet';
import https from 'https';
import path from 'path';
import {env} from './config/env';
import {runScheduler} from './lib/cron/scheduler';
import {getErrorMessage} from './lib/error-message';
import {
	EXTERNAL_LINK_GUARD_SCRIPT_PATH,
	getExternalLinkGuardScriptContent,
} from './lib/help-page';
import {recordHoneypotSignal, recordNetworkProbeSignal} from './lib/honey-pot';
import {sendNagiosUnknownError} from './lib/http-nagios';
import {logger} from './lib/logger';
import {
	createAccessControlMiddleware,
	getRecommendedSecurityWarnings,
} from './lib/security';
import {ensureTlsCertificate} from './lib/tls';
import appInfo from './routes/app-info';
import dynamicRoutes from './routes/dynamic-routes';
import honeyPot from './routes/honey-pot';

const app: Application = express();
const PROJECT_ORIGIN_URL = 'https://github.com/some-git-user/nest';

const isIgnoredPluginFile = (file: string): boolean => {
	return (
		file.endsWith('.test.ts') ||
		file.endsWith('.spec.ts') ||
		file.endsWith('.test.js') ||
		file.endsWith('.spec.js') ||
		file.endsWith('.d.ts')
	);
};

const isSupportedPluginFile = (file: string): boolean => {
	if (isIgnoredPluginFile(file)) {
		return false;
	}

	return file.endsWith('.ts') || file.endsWith('.js');
};

const buildPluginRoutePath = (file: string): string => {
	const normalizedPathSegment = path
		.basename(file, path.extname(file))
		.replace(/[^a-zA-Z0-9]/g, '-')
		.toLowerCase();

	return `/plugins/${normalizedPathSegment}`;
};

const getPluginOverviewRoutes = (): string[] => {
	const pluginFiles = fs.readdirSync(path.join(process.cwd(), env.PLUGINS_DIR));
	const supported = pluginFiles.filter(isSupportedPluginFile);
	const tsPluginBaseNames = new Set(
		supported
			.filter((file) => file.endsWith('.ts'))
			.map((file) => path.basename(file, '.ts')),
	);

	const routes = new Set<string>();
	for (const file of supported) {
		if (
			file.endsWith('.js') &&
			tsPluginBaseNames.has(path.basename(file, '.js'))
		) {
			continue;
		}
		routes.add(buildPluginRoutePath(file));
	}

	return [...routes].sort((a, b) => a.localeCompare(b));
};

const buildOverviewPageHtml = (
	host: string,
	port: number,
	warnings: string[],
): string => {
	const baseUrl = `https://${host}:${port}`;
	const staticRoutes = [
		{path: '/nagios', helpPath: '/nagios?help'},
		{path: '/nagios/honey-pot', helpPath: '/nagios/honey-pot?help'},
	];
	const pluginRoutes = getPluginOverviewRoutes();

	const staticRouteItems = staticRoutes
		.map(
			(routeInfo) =>
				`<li><a href="${routeInfo.path}">${routeInfo.path}</a> - <a href="${routeInfo.helpPath}">help</a></li>`,
		)
		.join('');
	const pluginRouteItems = pluginRoutes
		.map(
			(routePath) =>
				`<li><a href="${routePath}">${routePath}</a> - <a href="${routePath}?help">help</a></li>`,
		)
		.join('');

	const warningsHtml =
		warnings.length > 0
			? `<section class="warnings">
<h2>Configuration Warnings</h2>
<ul>${warnings.map((w) => `<li>${w}</li>`).join('')}</ul>
</section>`
			: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Nest Route Overview</title>
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<style>
body{font-family:sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;line-height:1.5}
h1,h2{margin-bottom:.5rem}
.title-row{display:flex;align-items:center;gap:.6rem}
.title-icon{width:28px;height:28px;display:block}
code{background:#f4f4f4;padding:.2rem .4rem;border-radius:4px}
li{margin:.35rem 0}
.warnings{background:#fff8e1;border-left:4px solid #f9a825;padding:.75rem 1rem;margin:1rem 0}
.warnings h2{color:#7b5800;margin-top:0}
.warnings ul{margin:.5rem 0;padding-left:1.5rem}
</style>
</head>
<body>
<h1 class="title-row"><img src="/favicon.ico" alt="Nest favicon" class="title-icon">Nest Route Overview</h1>
<p>Project Origin: <a href="${PROJECT_ORIGIN_URL}">${PROJECT_ORIGIN_URL}</a></p>
<p>Base URL: <code>${baseUrl}</code></p>
${warningsHtml}
<h2>Built-in Routes</h2>
<ul>${staticRouteItems}</ul>
<h2>Plugin Routes</h2>
<ul>${pluginRouteItems || '<li>No plugins found</li>'}</ul>
</body>
</html>`;
};

app.use(
	express.json({
		limit: '16kb',
	}),
);
app.use(helmet());

if (env.ENABLE_SECURITY_MIDDLEWARE) {
	app.use(
		rateLimit({
			windowMs: env.RATE_LIMIT_WINDOW_MS || 60_000,
			max: env.RATE_LIMIT_MAX || 120,
			standardHeaders: true,
			legacyHeaders: false,
		}),
	);
	app.use(
		createAccessControlMiddleware({
			apiKey: env.API_KEY,
			apiKeyHeader: env.API_KEY_HEADER,
			allowedIps: env.ALLOWED_IPS,
		}),
	);
}

const securityWarnings = getRecommendedSecurityWarnings(env);
for (const warning of securityWarnings) {
	logger.warn(warning);
}

// route files
app.get('/favicon.ico', (_req: Request, res: Response) => {
	return res.sendFile(path.join(process.cwd(), 'favicon.ico'));
});
app.get(EXTERNAL_LINK_GUARD_SCRIPT_PATH, (_req: Request, res: Response) => {
	res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
	return res.send(getExternalLinkGuardScriptContent());
});
app.get('/', (_req: Request, res: Response) => {
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	return res.send(buildOverviewPageHtml(env.HOST, env.PORT, securityWarnings));
});
app.use('/', dynamicRoutes);
app.use('/nagios', appInfo);
app.use('/nagios/honey-pot', honeyPot);
// 404 handler for unknown routes
app.use((req: Request, res: Response) => {
	recordHoneypotSignal(req, 'unknown-route');
	return sendNagiosUnknownError(res, 404, `Route not found: ${req.url}`);
});

const tlsPaths = ensureTlsCertificate();
const server = https.createServer(
	{
		cert: fs.readFileSync(tlsPaths.certPath),
		key: fs.readFileSync(tlsPaths.keyPath),
	},
	app,
);

const getRemoteIp = (socket: unknown): string => {
	if (typeof socket !== 'object' || socket === null) {
		return 'unknown';
	}

	if (!('remoteAddress' in socket)) {
		return 'unknown';
	}

	const remoteAddress = (socket as {remoteAddress?: unknown}).remoteAddress;
	if (typeof remoteAddress === 'string' && remoteAddress.length > 0) {
		return remoteAddress;
	}

	return 'unknown';
};

server.on('tlsClientError', (_err, socket) => {
	recordNetworkProbeSignal(getRemoteIp(socket), 'tls-client-error');
});

server.on('clientError', (_err, socket) => {
	recordNetworkProbeSignal(getRemoteIp(socket), 'http-client-error');
});

server.listen(env.PORT, env.HOST, () => {
	logger.info(
		`HTTPS server running in ${env.NODE_ENV} mode on host ${env.HOST} and port ${env.PORT} with PID ${process.pid}. URL: https://${env.HOST}:${env.PORT}`,
	);
});

const bindFatalHandler = (
	eventName: 'unhandledRejection' | 'uncaughtException' | 'SIGTERM',
) => {
	process.on(eventName, (err: unknown) => {
		logger.error(`Error: ${getErrorMessage(err)}`);
		// close server & exit process
		server.close(() => process.exit(1));
	});
};

bindFatalHandler('unhandledRejection');
bindFatalHandler('uncaughtException');
bindFatalHandler('SIGTERM');

// start cron scheduler
runScheduler();

logger.info(`Started application in ${env.NODE_ENV} mode...`);
