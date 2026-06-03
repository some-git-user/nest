import express, {Application, Request, Response} from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import helmet from 'helmet';
import https from 'https';
import {env} from './config/env';
import {runScheduler} from './lib/cron/scheduler';
import {getErrorMessage} from './lib/error-message';
import {
	EXTERNAL_LINK_GUARD_SCRIPT_PATH,
	appendExternalLinkGuard,
	applyHelpPageSecurityHeaders,
	getExternalLinkGuardScriptContent,
} from './lib/help-page';
import {recordHoneypotSignal, recordNetworkProbeSignal} from './lib/honey-pot';
import {sendNagiosUnknownError} from './lib/http-nagios';
import {logger} from './lib/logger';
import {
	createAccessControlMiddleware,
	getRecommendedSecurityWarnings,
} from './lib/security';
import {
	getStartupWarningHelpTopic,
	renderStartupWarningHelpHtml,
	renderStartupWarningListItems,
} from './lib/startup-warning-help';
import {getStartupWarnings} from './lib/startup-warning-registry';
import {ensureTlsCertificate} from './lib/tls';
import appInfo from './routes/app-info';
import dynamicRoutes, {
	pluginStartupWarnings,
	registeredPluginRouteExamples,
	registeredPluginRoutes,
} from './routes/dynamic-routes';
import honeyPot from './routes/honey-pot';
import type {PluginRouteExample} from './types/plugin-meta';

const app: Application = express();
const PROJECT_ORIGIN_URL = 'https://github.com/some-git-user/nest';

const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

const buildOverviewPageHtml = (
	host: string,
	port: number,
	warnings: string[],
	pluginRoutes: string[],
	pluginRouteExamples?: Record<string, PluginRouteExample[]>,
): string => {
	const baseUrl = `https://${host}:${port}`;
	const staticRoutes = [
		{path: '/nagios', helpPath: '/nagios?help'},
		{path: '/nagios/honey-pot', helpPath: '/nagios/honey-pot?help'},
	];

	const staticRouteItems = staticRoutes
		.map(
			(routeInfo) =>
				`<li><a href="${routeInfo.path}">${routeInfo.path}</a> - <a href="${routeInfo.helpPath}">help</a></li>`,
		)
		.join('');
	const examplesByRoute = pluginRouteExamples ?? {};
	const pluginRouteItems = pluginRoutes
		.map((routePath) => {
			const examples = examplesByRoute[routePath] ?? [];
			const firstLinkExample = examples.find(
				(example) => example.kind === 'link',
			);
			const primaryHref = firstLinkExample ? firstLinkExample.href : routePath;
			const examplesHtml = examples
				.map((example) => {
					if (example.kind === 'link') {
						return `<a class="plugin-example-link" href="${example.href}">${escapeHtml(example.label)}</a>`;
					}

					const fieldsHtml = example.fields
						.map((field) => {
							const requiredAttr = field.required ? ' required' : '';
							const valueAttr = field.defaultValue
								? ` value="${escapeHtml(field.defaultValue)}"`
								: '';
							const requiredLabel = field.required
								? ' <span class="plugin-example-required" title="Required field">*</span>'
								: '';
							return `<label class="plugin-example-field"><span class="plugin-example-field-label">${escapeHtml(
								field.label,
							)}${requiredLabel}</span><input name="${escapeHtml(
								field.name,
							)}" type="${escapeHtml(field.type)}"${requiredAttr}${valueAttr}></label>`;
						})
						.join('');

					return `<form class="plugin-example-form" method="${example.method.toLowerCase()}" action="${example.path}"><div class="plugin-example-header"><span class="plugin-example-title">${escapeHtml(example.label)}</span><span class="plugin-example-method">${example.method}</span></div><div class="plugin-example-fields">${fieldsHtml}</div><div class="plugin-example-actions"><button type="submit">Run</button></div></form>`;
				})
				.join('');

			return `<li class="plugin-route-item"><div class="plugin-route-header"><a href="${primaryHref}">${routePath}</a> - <a href="${routePath}?help">help</a></div>${examplesHtml ? `<div class="plugin-examples">${examplesHtml}</div>` : ''}</li>`;
		})
		.join('');

	const warningsHtml =
		warnings.length > 0
			? `<section class="warnings">
<h2>Startup Warnings</h2>
<ul>${renderStartupWarningListItems(warnings)}</ul>
</section>`
			: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Nest Route Overview</title>
<style>
body{font-family:sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;line-height:1.5}
h1,h2{margin-bottom:.5rem}
.title-row{display:flex;align-items:center;gap:.6rem}
code{background:#f4f4f4;padding:.2rem .4rem;border-radius:4px}
li{margin:.35rem 0}
.plugin-route-item{margin-bottom:.8rem}
.plugin-route-header{font-weight:600}
.plugin-examples{margin-top:.5rem;display:grid;grid-template-columns:1fr;gap:.5rem}
.plugin-example-link{display:inline-block;padding:.35rem .55rem;background:#f7f7f7;border:1px solid #d9d9d9;border-radius:6px;text-decoration:none}
.plugin-example-form{display:grid;grid-template-columns:1fr;gap:.5rem;background:#f7f7f7;border:1px solid #d9d9d9;border-radius:8px;padding:.6rem .7rem;max-width:100%}
.plugin-example-header{display:flex;align-items:center;justify-content:space-between;gap:.5rem}
.plugin-example-title{font-weight:600}
.plugin-example-method{font-size:.82rem;letter-spacing:.02em;padding:.12rem .45rem;border:1px solid #c8c8c8;border-radius:999px;background:#fff}
.plugin-example-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.45rem .7rem}
.plugin-example-field{display:grid;grid-template-columns:1fr;gap:.2rem}
.plugin-example-field-label{font-size:.9rem;color:#333}
.plugin-example-required{display:inline-block;margin-left:.28rem;font-size:1rem;line-height:1;color:#b3261e;vertical-align:middle;font-weight:700}
.plugin-example-field input{width:100%;box-sizing:border-box;padding:.34rem .42rem}
.plugin-example-actions{display:flex;justify-content:flex-end}
.plugin-example-actions button{padding:.3rem .75rem}
.warnings{background:#fff8e1;border-left:4px solid #f9a825;padding:.75rem 1rem;margin:1rem 0}
.warnings h2{color:#7b5800;margin-top:0}
.warnings ul{margin:.5rem 0;padding-left:1.5rem}
.startup-warning-whitelist-entry{background:#fff3cd;border:1px solid #f2d28b;border-radius:4px;padding:.55rem .7rem;overflow-x:auto;white-space:pre;margin:.5rem 0}
.startup-warning-whitelist-entry code{background:transparent;padding:0}
</style>
</head>
<body>
<h1 class="title-row">Nest Route Overview</h1>
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
app.use(
	express.urlencoded({
		extended: false,
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
const startupWarnings = Array.from(
	new Set([
		...getStartupWarnings(),
		...pluginStartupWarnings,
		...securityWarnings,
	]),
);
for (const warning of securityWarnings) {
	logger.warn(warning);
}

// route files
app.get('/favicon.ico', (_req: Request, res: Response) => {
	return res.status(204).end();
});
app.get(EXTERNAL_LINK_GUARD_SCRIPT_PATH, (_req: Request, res: Response) => {
	res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
	return res.send(getExternalLinkGuardScriptContent());
});
app.get('/help/startup-warnings/:warningId', (req: Request, res: Response) => {
	const warningId = String(req.params?.warningId ?? '');
	const topic = getStartupWarningHelpTopic(warningId);
	if (!topic) {
		return sendNagiosUnknownError(
			res,
			404,
			`Warning help topic not found: ${warningId}`,
		);
	}

	applyHelpPageSecurityHeaders(res);
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	return res.send(appendExternalLinkGuard(renderStartupWarningHelpHtml(topic)));
});
app.get('/', (_req: Request, res: Response) => {
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	return res.send(
		buildOverviewPageHtml(
			env.HOST,
			env.PORT,
			startupWarnings,
			registeredPluginRoutes,
			registeredPluginRouteExamples,
		),
	);
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
