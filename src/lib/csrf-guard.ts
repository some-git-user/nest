import {NextFunction, Request, Response} from 'express';
import {sendNagiosUnknownError} from './http-nagios';
import {HttpStatusCodes} from './http-status-codes';

/**
 * Cross-site request forgery guard for state-changing requests.
 *
 * Why this is needed on top of the API key
 * ────────────────────────────────────────
 * An empty `API_KEY` is an accepted default: a fresh install is reachable from
 * loopback only and no plugin is whitelisted, so there is nothing to exploit.
 * That default has a consequence for browsers, though. A page on the internet
 * can make a *simple* cross-origin POST (urlencoded or a CORS-preflight-free
 * body) to `http(s)://127.0.0.1:5000/...` without a preflight, and with no key
 * configured the access control middleware lets it through. Once an operator
 * whitelists plugins - and `local-config` presets carry plugin credentials -
 * that page can invoke them from the operator's own browser.
 *
 * Why an Origin check is the right cut here
 * ──────────────────────────────────────────
 * The primary client is `check_nest.sh`, i.e. curl run by Nagios. curl sends
 * neither `Origin` nor `Sec-Fetch-Site`, so a check keyed on those headers is
 * invisible to it and needs no change to the script or to the key model.
 * A browser, on the other hand, always attaches `Origin` to a non-GET request
 * and never lets a script read or forge it, and `Sec-Fetch-Site` is a
 * forbidden header too. So:
 *
 *   - no `Origin` and no `Sec-Fetch-Site`  -> non-browser client, allowed
 *   - `Sec-Fetch-Site: cross-site`         -> rejected
 *   - `Origin` that is not this server     -> rejected
 *
 * Only state-changing methods are guarded. Guarding GET would break following
 * a link to the Web UI from another site, which arrives as `cross-site`.
 */

/** Value of Sec-Fetch-Site for requests originating from another site. */
const SEC_FETCH_SITE_CROSS_SITE = 'cross-site';

/** Default port of the HTTPS listener; a Host header may or may not carry it. */
const HTTPS_DEFAULT_PORT_SUFFIX = ':443';

/**
 * Reads a request header as a single string. Node lowercases header names, and
 * a repeated header arrives as an array, of which the first value is used.
 */
const readHeader = (req: Request, name: string): string => {
	const raw = req.headers[name];
	if (Array.isArray(raw)) {
		return String(raw[0] ?? '');
	}
	return typeof raw === 'string' ? raw : '';
};

/**
 * Origin the request was addressed to, rebuilt from the Host header. The
 * listener is HTTPS-only, so the scheme is fixed rather than derived.
 */
const expectedOrigin = (req: Request): string => {
	const host = readHeader(req, 'host').replace(HTTPS_DEFAULT_PORT_SUFFIX, '');
	return `https://${host}`;
};

/** True when the request carries no trace of having been made by a browser. */
const looksLikeNonBrowserClient = (req: Request): boolean =>
	readHeader(req, 'origin').length === 0 &&
	readHeader(req, 'sec-fetch-site').length === 0;

export const createCsrfGuardMiddleware = () => {
	return (req: Request, res: Response, next: NextFunction): void | Response => {
		if (req.method === 'GET' || req.method === 'HEAD') {
			return next();
		}

		// curl, wget and the internal self-request send neither header, and they
		// are the intended non-browser callers.
		if (looksLikeNonBrowserClient(req)) {
			return next();
		}

		if (
			readHeader(req, 'sec-fetch-site').toLowerCase() ===
			SEC_FETCH_SITE_CROSS_SITE
		) {
			return sendNagiosUnknownError(
				res,
				HttpStatusCodes.FORBIDDEN,
				'Forbidden: cross-site requests are not accepted',
			);
		}

		const origin = readHeader(req, 'origin');
		if (origin.length > 0 && origin !== expectedOrigin(req)) {
			return sendNagiosUnknownError(
				res,
				HttpStatusCodes.FORBIDDEN,
				'Forbidden: request origin does not match this server',
			);
		}

		return next();
	};
};
