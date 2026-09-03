import express, {Application, Request, Response} from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import helmet from 'helmet';
import https from 'https';
// Verify config files against whitelist
import path from 'path';
import {env} from './config/env';
import {ADMIN_UI_MOUNT_PATH} from './lib/admin-auth';
import {
	EXTERNAL_LINK_GUARD_SCRIPT,
	PLUGIN_EXAMPLE_FORM_SCRIPT,
	THEME_TOGGLE_SCRIPT,
	THEME_TOGGLE_SCRIPT_PATH,
} from './lib/client-scripts';
import {runScheduler} from './lib/cron/scheduler';
import {createCsrfGuardMiddleware} from './lib/csrf-guard';
import {getErrorMessage} from './lib/error-message';
import {
	EXTERNAL_LINK_GUARD_SCRIPT_PATH,
	appendExternalLinkGuard,
	applyHelpPageSecurityHeaders,
} from './lib/help-page';
import {recordHoneypotSignal, recordNetworkProbeSignal} from './lib/honey-pot';
import {escapeHtml} from './lib/html-escape';
import {sendNagiosUnknownError} from './lib/http-nagios';
import {HttpStatusCodes} from './lib/http-status-codes';
import {
	getConfigDrift,
	hasRuntimeValidationFailed,
	loadConfigAtStartup,
	parseConfigFile,
	setWhitelistCache,
} from './lib/local-config';
import {logger} from './lib/logger';
import {verifyConfigFiles} from './lib/plugin-whitelist';
import {parseTrustProxy} from './lib/request-ip';
import {
	createAccessControlMiddleware,
	getRecommendedSecurityWarnings,
} from './lib/security';
import {validateStartup} from './lib/startup-check';
import {
	getStartupWarningHelpTopic,
	renderStartupWarningHelpHtml,
	renderStartupWarningListItems,
} from './lib/startup-warning-help';
import {
	getStartupWarnings,
	recordStartupWarnings,
} from './lib/startup-warning-registry';
import {ensureTlsCertificate} from './lib/tls';
import {
	renderButton,
	renderField,
	renderHtmlDocument,
	renderMetaList,
} from './lib/ui-components';
import {getAppVersion} from './lib/version';
import adminLocalConfig from './routes/admin-local-config';
import appInfo from './routes/app-info';
import dynamicRoutes, {
	pluginStartupWarnings,
	registeredPluginRouteExamples,
	registeredPluginRoutes,
} from './routes/dynamic-routes';
import honeyPot from './routes/honey-pot';
import localConfig from './routes/local-config';
import type {PluginRouteExample} from './types/plugin';

validateStartup();

const app: Application = express();
// Only honour `X-Forwarded-For` when the operator declares a reverse proxy
// (TRUST_PROXY). Otherwise Express keeps `req.ip` on the real socket address,
// so the ALLOWED_IPS allowlist cannot be bypassed with a spoofed header.
app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
const PROJECT_ORIGIN_URL = 'https://github.com/some-git-user/nest';
const PLUGIN_EXAMPLE_FORM_SCRIPT_PATH = '/help/plugin-example-form.js';
const APP_VERSION = getAppVersion();

/**
 * One runnable example for a plugin route.
 *
 * The `plugin-example-form` class and the `method`/`action` attribute order are
 * load-bearing: the client script dispatches on the class, and the overview
 * page is the only place that markup is produced. Everything visual comes from
 * the shared stylesheet, so an example form is the same card everywhere.
 */
const renderExampleFormHtml = (example: PluginRouteExample): string => {
	if (example.kind === 'link') {
		return `<a class="plugin-example-link" href="${example.href}">${escapeHtml(example.label)}</a>`;
	}

	const fieldsHtml = example.fields
		.map((field) =>
			renderField({
				name: field.name,
				type: field.type,
				label: field.label,
				required: field.required,
				value: field.defaultValue,
			}),
		)
		.join('');

	return `<form class="plugin-example-form" method="${example.method.toLowerCase()}" action="${example.path}"><div class="plugin-example-header"><span class="plugin-example-title">${escapeHtml(example.label)}</span><span class="plugin-example-method">${example.method}</span></div><div class="plugin-example-fields">${fieldsHtml}</div><div class="plugin-example-actions">${renderButton(
		{
			label: 'Run',
			type: 'submit',
		},
	)}</div></form>`;
};

/**
 * Warning shown while the file on disk and the whitelist disagree.
 *
 * Saving through the admin UI rewrites the file without touching the whitelist,
 * so this state is expected after every edit and must stay visible: an operator
 * who forgets to approve the hash loses *all* presets at the next restart, not
 * just the ones they changed. The message embeds the exact whitelist line so it
 * can be copied verbatim.
 */
const getConfigDriftWarning = (): string | undefined => {
	const drift = getConfigDrift();
	if (!drift.drifted) {
		return undefined;
	}

	if (drift.currentHash === undefined) {
		return (
			'Config drift: the local config presets file on disk is awaiting whitelist approval ' +
			'because the file was removed after startup. Restore it from a backup, or write it ' +
			'again and approve the new hash, then restart the service.'
		);
	}

	return (
		'Config drift: the local config presets file on disk is awaiting whitelist approval. ' +
		`The presets currently served are the previously approved ones. Add "configs/local-presets.conf ${drift.currentHash}" to ` +
		'plugins/plugin-whitelist.txt and restart the service to activate the file on disk.'
	);
};

const buildOverviewPageHtml = (
	host: string,
	port: number,
	warnings: string[],
	pluginRoutes: string[],
	adminUiPath: string,
	pluginRouteExamples?: Record<string, PluginRouteExample[]>,
	localConfigPresets?: Map<
		string,
		{command: string; params: Record<string, string>}
	>,
	runtimeValidationFailed?: boolean,
): string => {
	const baseUrl = `https://${host}:${port}`;
	const staticRoutes = [
		{path: '/nagios', helpPath: '/nagios?help'},
		{path: '/nagios/honey-pot', helpPath: '/nagios/honey-pot?help'},
		// The admin UI is always mounted; when no password is configured it
		// serves a "not configured" page rather than 404, so the link is always
		// reachable. It has no `?help` page of its own, so no helpPath is set:
		// pointing one at the editor would just duplicate the path link.
		{path: adminUiPath},
	];

	/**
	 * The heading row of a route list item: the route path, linking to a runnable
	 * URL, plus a link to whatever explains it. Callers wrap it in their own
	 * `<li>`, which may also hold example forms for the same route.
	 */
	const renderRouteHeader = (options: {
		path: string;
		href?: string;
		helpPath?: string;
	}): string => {
		const helpHtml = options.helpPath
			? `<a class="route-help" href="${options.helpPath}">help</a>`
			: '';

		return `<div class="route-header"><a class="route-path" href="${
			options.href ?? options.path
		}">${options.path}</a>${helpHtml}</div>`;
	};

	const staticRouteItems = staticRoutes
		.map((routeInfo) => {
			return `<li>${renderRouteHeader({
				path: routeInfo.path,
				helpPath: routeInfo.helpPath,
			})}</li>`;
		})
		.join('');

	// Local Config Presets section - hidden if runtime validation failed
	const localConfigItems = runtimeValidationFailed
		? ''
		: localConfigPresets && localConfigPresets.size > 0
			? Array.from(localConfigPresets.keys())
					.map((key) => {
						return `<li>${renderRouteHeader({
							path: `/local-config?config=${escapeHtml(key)}`,
						})}</li>`;
					})
					.join('')
			: '';
	const examplesByRoute = pluginRouteExamples ?? {};
	const pluginRouteItems = pluginRoutes
		.map((routePath) => {
			const examples = examplesByRoute[routePath] ?? [];
			// A plugin that offers a link example has a sensible no-argument call, so
			// the route name itself becomes that shortcut.
			const firstLinkExample = examples.find(
				(example) => example.kind === 'link',
			);
			const examplesHtml = examples.map(renderExampleFormHtml).join('');

			return `<li>${renderRouteHeader({
				path: routePath,
				href: firstLinkExample?.href,
				helpPath: `${routePath}?help`,
			})}${examplesHtml ? `<div class="plugin-examples">${examplesHtml}</div>` : ''}</li>`;
		})
		.join('');

	const warningsHtml =
		warnings.length > 0
			? `<section class="warnings">
<h2>Startup Warnings</h2>
<ul>${renderStartupWarningListItems(warnings)}</ul>
</section>`
			: '';

	return renderHtmlDocument({
		title: 'Nest Route Overview',
		headHtml: `\n<script src="${PLUGIN_EXAMPLE_FORM_SCRIPT_PATH}" defer></script>`,
		metaHtml: renderMetaList([
			{
				label: 'Project Origin',
				valueHtml: `<a href="${PROJECT_ORIGIN_URL}">${PROJECT_ORIGIN_URL}</a>`,
			},
			{label: 'Version', valueHtml: `<code>${APP_VERSION}</code>`},
			{label: 'Base URL', valueHtml: `<code>${baseUrl}</code>`},
		]),
		contentHtml: `${warningsHtml}
<section class="route-section">
<h2>Built-in Routes</h2>
<ul class="route-list">${staticRouteItems}</ul>
</section>${
			localConfigItems
				? `
<section class="route-section">
<h2>Local Config Presets</h2>
<ul class="route-list">${localConfigItems}</ul>
</section>`
				: ''
		}
<section class="route-section">
<h2>Plugin Routes</h2>
<ul class="route-list route-list--single">${
			pluginRouteItems || '<li>No plugins found</li>'
		}</ul>
</section>`,
	});
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

app.use(
	rateLimit({
		windowMs: env.RATE_LIMIT_WINDOW_MS,
		max: env.RATE_LIMIT_MAX,
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
// After access control: an unauthenticated caller is rejected before the CSRF
// guard spends work on it, and the guard only ever adds a rejection on top.
app.use(createCsrfGuardMiddleware());

const securityWarnings = getRecommendedSecurityWarnings(env);

const pluginsDir = path.resolve(process.cwd(), env.PLUGINS_DIR);
const pluginWhitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');
const configFiles = ['configs/local-presets.conf'];

const configVerification = verifyConfigFiles({
	pluginsDir,
	configFiles,
	whitelistPath: pluginWhitelistPath,
});
recordStartupWarnings(configVerification.warnings);
for (const warning of configVerification.warnings) {
	logger.warn(warning);
}

// Cache whitelist entries for runtime verification
setWhitelistCache(configVerification.whitelistEntries);

// Load config once at startup (hash validation integrated)
loadConfigAtStartup();

const getStartupWarningsAtRuntime = (): string[] => {
	const driftWarning = getConfigDriftWarning();
	return Array.from(
		new Set([
			...getStartupWarnings(),
			...pluginStartupWarnings,
			...securityWarnings,
			...configVerification.warnings,
			// A drift that appears after startup - typically an edit made through the
			// admin UI - has to be as visible as one detected during boot.
			...(driftWarning ? [driftWarning] : []),
		]),
	);
};
for (const warning of securityWarnings) {
	logger.warn(warning);
}

// route files
app.get('/favicon.ico', (_req: Request, res: Response) => {
	return res.status(HttpStatusCodes.NO_CONTENT).end();
});

app.get(EXTERNAL_LINK_GUARD_SCRIPT_PATH, (_req: Request, res: Response) => {
	res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
	return res.send(EXTERNAL_LINK_GUARD_SCRIPT);
});
app.get(PLUGIN_EXAMPLE_FORM_SCRIPT_PATH, (_req: Request, res: Response) => {
	res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
	return res.send(PLUGIN_EXAMPLE_FORM_SCRIPT);
});
app.get(THEME_TOGGLE_SCRIPT_PATH, (_req: Request, res: Response) => {
	res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
	return res.send(THEME_TOGGLE_SCRIPT);
});
app.get('/help/startup-warnings/:warningId', (req: Request, res: Response) => {
	const warningId = String(req.params?.warningId ?? '');
	const topic = getStartupWarningHelpTopic(warningId);
	if (!topic) {
		return sendNagiosUnknownError(
			res,
			HttpStatusCodes.NOT_FOUND,
			`Warning help topic not found: ${warningId}`,
		);
	}

	applyHelpPageSecurityHeaders(res);
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	return res.send(appendExternalLinkGuard(renderStartupWarningHelpHtml(topic)));
});
app.get('/', (_req: Request, res: Response) => {
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	// Check validation status first to avoid throwing
	const validationFailed = hasRuntimeValidationFailed();
	// Only parse config if validation succeeded
	const localConfigPresets = validationFailed ? new Map() : parseConfigFile();
	const html = buildOverviewPageHtml(
		env.HOST,
		env.PORT,
		getStartupWarningsAtRuntime(),
		registeredPluginRoutes,
		ADMIN_UI_MOUNT_PATH,
		registeredPluginRouteExamples,
		localConfigPresets,
		validationFailed,
	);
	return res.send(appendExternalLinkGuard(html));
});
app.use('/', dynamicRoutes);
app.use('/nagios', appInfo);
app.use('/nagios/honey-pot', honeyPot);
app.use('/local-config', localConfig);
// Mounted after access control on purpose: reaching the admin UI requires the
// global API key *and* the admin credential, so a leaked monitoring key alone
// can never rewrite the config file.
app.use(ADMIN_UI_MOUNT_PATH, adminLocalConfig);
// 404 handler for unknown routes
app.use((req: Request, res: Response) => {
	recordHoneypotSignal(req, 'unknown-route');
	return sendNagiosUnknownError(
		res,
		HttpStatusCodes.NOT_FOUND,
		`Route not found: ${req.url}`,
	);
});

const tlsPaths = ensureTlsCertificate();
const server = https.createServer(
	{
		cert: fs.readFileSync(tlsPaths.certPath, 'utf8'),
		key: fs.readFileSync(tlsPaths.keyPath, 'utf8'),
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
