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
 * One browser quirk makes the third rule need an exception. A page with an
 * opaque origin sends the literal `Origin: null`, and `Referrer-Policy:
 * no-referrer` - which helmet puts on every response here - is enough to make
 * a document opaque for this purpose. A form POST from the Web UI therefore
 * arrives as `Origin: null` even though it is same-origin, and comparing that
 * string against this server would reject the operator's own form. A `null`
 * origin is therefore read as "no origin information", exactly like a missing
 * `Origin`.
 *
 * That does not open a hole, because the rejection of an attacker never depends
 * on `Origin` alone: a page on another site is stamped `Sec-Fetch-Site:
 * cross-site` by the browser whether or not it hides its referrer, and that
 * check runs first. Measured against headless Chromium, a cross-site form POST
 * from a `no-referrer` page arrives as `Origin: null` + `Sec-Fetch-Site:
 * cross-site` (rejected), while the Web UI's own form arrives as `Origin:
 * null` + `Sec-Fetch-Site: same-origin` (allowed). Both headers are forbidden
 * for scripts, so trusting them is the same trust the rules above already place
 * in them.
 *
 * Only state-changing methods are guarded. Guarding GET would break following
 * a link to the Web UI from another site, which arrives as `cross-site`.
 */

/** Value of Sec-Fetch-Site for requests originating from another site. */
const SEC_FETCH_SITE_CROSS_SITE = 'cross-site';

/** Default port of the HTTPS listener; a Host header may or may not carry it. */
const HTTPS_DEFAULT_PORT_SUFFIX = ':443';

/**
 * The `Origin` a browser sends for a document with an opaque origin, e.g. one
 * served with `Referrer-Policy: no-referrer`. It says nothing about where the
 * request came from, so it is treated as a missing `Origin`.
 */
const OPAQUE_ORIGIN = 'null';

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

/**
 * Request `Origin`, normalised: the opaque `null` origin is reported as empty,
 * because it carries no information about where the request came from and must
 * not be compared against this server. See the header comment.
 */
const readOrigin = (req: Request): string => {
	const origin = readHeader(req, 'origin');
	return origin.toLowerCase() === OPAQUE_ORIGIN ? '' : origin;
};

/** True when the request carries no trace of having been made by a browser. */
const looksLikeNonBrowserClient = (req: Request): boolean =>
	readOrigin(req).length === 0 &&
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

		const origin = readOrigin(req);
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
