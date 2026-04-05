import {Request, Response} from 'express';
import {createRequire} from 'module';
import {env} from '../config/env';
import {getErrorMessage} from '../lib/error-message';
import {
	appendExternalLinkGuard,
	applyHelpPageSecurityHeaders,
	sanitizeHelpHtml,
	wrapFullHelpDocumentInSandbox,
} from '../lib/help-page';
import {sendNagiosUnknownError} from '../lib/http-nagios';
import {logger} from '../lib/logger';
import {createNagiosReturnMessage} from '../lib/nagios';
import {
	buildInvalidCodeResponse,
	clearPluginRequireCache,
	getPluginFunction,
	isKnownNagiosCode,
	normalizePluginResult,
	parseUrlParams,
} from './dynamic-routes/helpers';

export type PluginHelpContext = {
	helpHtml?: string;
	usageHttp?: string;
	usageShell?: string;
	pluginName?: string;
};

const escapeHtml = (str: string): string =>
	str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

const SHELL_AUTH_PREFIX = 'NEST_HOST=SERVER_IP_OR_DNS NEST_API_KEY=API_KEY ';

const hasShellAuthVariables = (text: string | undefined): boolean => {
	if (!text) {
		return false;
	}

	return /NEST_HOST=/.test(text) && /NEST_API_KEY=/.test(text);
};

const normalizeCheckNestShellExamples = (text: string): string => {
	if (!/check_nest\.sh/.test(text) || hasShellAuthVariables(text)) {
		return text;
	}

	return text.replace(
		/(^|[\s>])(\.\/check_nest\.sh|check_nest\.sh)(?=\s)/g,
		(_match, prefix: string, command: string) =>
			`${prefix}${SHELL_AUTH_PREFIX}${command}`,
	);
};

const buildShellEnvHintHtml = (): string => {
	return `<section class="shell-auth-hint">
<h2>check_nest.sh Authentication</h2>
<p>When calling this route from <code>check_nest.sh</code>, provide the target host and API key:</p>
<pre>NEST_HOST=&lt;server-ip-or-dns&gt; NEST_API_KEY=&lt;api-key&gt; ./check_nest.sh &lt;command-or-route&gt;</pre>
<p>Examples:</p>
<ul>
<li><code>./check_nest.sh NEST_HOST=192.168.1.10 NEST_API_KEY=secret check-test</code></li>
<li><code>./check_nest.sh NEST_HOST=192.168.1.10 NEST_API_KEY=secret /nagios/honey-pot</code></li>
</ul>
</section>`;
};

export const insertBeforeBodyEnd = (
	html: string,
	sectionHtml: string,
): string => {
	if (/<\/body>/i.test(html)) {
		return html.replace(/<\/body>/i, `${sectionHtml}</body>`);
	}

	return `${html}${sectionHtml}`;
};

const buildPluginHelpHtml = (ctx: PluginHelpContext): string => {
	const title = ctx.pluginName ?? 'Plugin Help';
	const normalizedHelpHtml = ctx.helpHtml
		? normalizeCheckNestShellExamples(ctx.helpHtml)
		: undefined;
	const normalizedUsageShell = ctx.usageShell
		? normalizeCheckNestShellExamples(ctx.usageShell)
		: undefined;
	const includeShellHint =
		!hasShellAuthVariables(normalizedHelpHtml) &&
		!hasShellAuthVariables(normalizedUsageShell);
	const shellHintSection = includeShellHint ? buildShellEnvHintHtml() : '';

	if (normalizedHelpHtml) {
		// Plugin provides a full HTML document — serve it as-is
		if (
			/^\s*<!DOCTYPE/i.test(normalizedHelpHtml) ||
			/^\s*<html/i.test(normalizedHelpHtml)
		) {
			const sanitizedFullDoc = sanitizeHelpHtml(normalizedHelpHtml);
			const wrapped = wrapFullHelpDocumentInSandbox(title, sanitizedFullDoc);
			return appendExternalLinkGuard(
				insertBeforeBodyEnd(wrapped, shellHintSection),
			);
		}

		// Plugin provides a partial HTML fragment — wrap in a minimal shell
		const sanitizedFragment = sanitizeHelpHtml(normalizedHelpHtml);
		return appendExternalLinkGuard(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem}pre{background:#f4f4f4;padding:1rem;border-radius:4px;overflow-x:auto}code{background:#f4f4f4;padding:.2em .4em;border-radius:3px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:.5rem;text-align:left}th{background:#f4f4f4}.shell-auth-hint{margin-top:1.5rem;padding:1rem;border-left:4px solid #2c7a7b;background:#f3fbfb}</style>
</head><body>
<p><a href="/">Back to route overview</a></p>
${sanitizedFragment}
${shellHintSection}
</body></html>`);
	}

	// Auto-generate a fallback page from usage metadata
	const httpRow = ctx.usageHttp
		? `<dt>HTTP</dt><dd><code>${escapeHtml(ctx.usageHttp)}</code></dd>`
		: '';
	const shellRow = normalizedUsageShell
		? `<dt>Shell</dt><dd><code>${escapeHtml(normalizedUsageShell)}</code></dd>`
		: '';
	const usageSection =
		httpRow || shellRow ? `<h2>Usage</h2><dl>${httpRow}${shellRow}</dl>` : '';

	return appendExternalLinkGuard(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem}dt{font-weight:bold;margin-top:1rem}code{background:#f4f4f4;padding:.2em .4em;border-radius:3px}.shell-auth-hint{margin-top:1.5rem;padding:1rem;border-left:4px solid #2c7a7b;background:#f3fbfb}</style>
</head><body>
<p><a href="/">Back to route overview</a></p>
<h1>${escapeHtml(title)}</h1>
${usageSection}<p>No extended help is available for this plugin.</p>
${shellHintSection}</body>
</html>`);
};

export const createPluginRouteHandler = (
	jsFilePath: string,
	kebabCasePath: string,
	helpContext: PluginHelpContext = {},
) => {
	return async (req: Request, res: Response) => {
		if ('help' in (req.query ?? {})) {
			const html = buildPluginHelpHtml(helpContext);
			applyHelpPageSecurityHeaders(res);
			res.setHeader('Content-Type', 'text/html; charset=utf-8');
			return res.send(html);
		}

		try {
			const warn = (message: string) => {
				logger.warn(message);
			};

			const requireFn = createRequire(__filename);
			clearPluginRequireCache(requireFn, jsFilePath, warn);

			const pluginModule: unknown = requireFn(jsFilePath);
			const pluginFunc = getPluginFunction(pluginModule);

			if (!pluginFunc) {
				logger.error('Plugin must export a function');
				return sendNagiosUnknownError(
					res,
					500,
					`Plugin ${jsFilePath} must export a function`,
				);
			}

			logger.debug(req.url);
			const paramsObj = parseUrlParams(req.url);

			try {
				const result = await pluginFunc(paramsObj);
				const normalized = normalizePluginResult(result, jsFilePath, warn);

				if (res.headersSent) {
					return;
				}

				const isValidCode = isKnownNagiosCode(normalized.code);
				if (!isValidCode) {
					const invalidCodeResponse = buildInvalidCodeResponse(
						normalized.code,
						jsFilePath,
						kebabCasePath,
						env.HOST,
						env.PORT,
					);
					logger.warn(invalidCodeResponse.errorMessage);
					return res.send(invalidCodeResponse.nagiosReturn);
				}

				const debugTemplate = `Debug: message=${normalized.message}, code=${normalized.code}, performanceData=${
					normalized.performanceData
						? JSON.stringify(normalized.performanceData)
						: undefined
				}`;
				logger.debug(debugTemplate);

				if (isValidCode && typeof normalized.message === 'string') {
					const nagiosReturn = createNagiosReturnMessage(
						normalized.message,
						normalized.code,
						normalized.performanceData,
					);
					logger.debug(nagiosReturn);

					return res.send(nagiosReturn);
				}

				return res.send(
					createNagiosReturnMessage(
						normalized.message ?? `Unknown command ${req.url}`,
						3,
					),
				);
			} catch (err) {
				logger.error(err);
				const errorMessage = getErrorMessage(err);
				return sendNagiosUnknownError(
					res,
					500,
					`Plugin ${jsFilePath} failed: ${errorMessage}`,
				);
			}
		} catch (err) {
			logger.error(err);
			const errorMessage = getErrorMessage(err);
			return sendNagiosUnknownError(
				res,
				500,
				`Error loading plugin: ${jsFilePath}. Error: ${errorMessage}`,
			);
		}
	};
};
