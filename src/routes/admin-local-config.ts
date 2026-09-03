import express, {NextFunction, Request, Response} from 'express';
import rateLimit from 'express-rate-limit';
import {env} from '../config/env';
import {
	ADMIN_API_HEADER,
	getAdminCommands,
	getAdminConfigPage,
	getAdminEntries,
	postAdminLogin,
	postAdminLogout,
	postAdminRevert,
	postAdminSave,
	postAdminTest,
	postAdminValidate,
} from '../controllers/admin-local-config';
import {
	ADMIN_UI_MOUNT_PATH,
	hasValidAdminPassword,
	hasValidAdminSession,
} from '../lib/admin-auth';
import {
	ADMIN_CONFIG_SCRIPT,
	ADMIN_CONFIG_SCRIPT_PATH,
} from '../lib/admin-scripts';
import {sendNagiosUnknownError} from '../lib/http-nagios';
import {HttpStatusCodes} from '../lib/http-status-codes';

/**
 * Login attempts are the only unauthenticated write endpoint in the whole
 * server, so it gets its own much stricter bucket than the global rate limit.
 */
const loginRateLimiter = rateLimit({
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	max: env.ADMIN_LOGIN_RATE_LIMIT_MAX,
	standardHeaders: true,
	legacyHeaders: false,
	message: 'Too many login attempts. Try again later.',
});

/**
 * Guards every authenticated admin route against brute-forcing the password
 * header. Without this, `POST /login` is the only throttled entry point and an
 * attacker could hammer any admin endpoint with guessed `x-nest-admin-password`
 * values at the (much higher) global rate limit. Only failed attempts count, so
 * a legitimately authenticated client is never throttled.
 */
const adminAuthRateLimiter = rateLimit({
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	max: env.ADMIN_LOGIN_RATE_LIMIT_MAX,
	skipSuccessfulRequests: true,
	standardHeaders: true,
	legacyHeaders: false,
	message: 'Too many failed admin authentication attempts. Try again later.',
});

/**
 * Session cookie or admin password header - either is enough.
 *
 * The page itself is served to a header-authenticated caller too, because every
 * endpoint below re-checks; the page leaks nothing that the API does not.
 */
const requireAdminAuth = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	if (hasValidAdminSession(req) || hasValidAdminPassword(req)) {
		next();
		return;
	}
	sendNagiosUnknownError(
		res,
		HttpStatusCodes.UNAUTHORIZED,
		'Admin authentication required.',
	);
};

/**
 * JSON API calls must carry the admin API header.
 *
 * A custom request header makes the call a preflighted CORS request, which a
 * cross-site document cannot issue silently - the cheap half of the CSRF story,
 * the `SameSite=Strict` cookie being the other half.
 */
const requireAdminApiHeader = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	const header = req.headers[ADMIN_API_HEADER];
	const provided = Array.isArray(header) ? header[0] : header;
	if (provided === '1') {
		next();
		return;
	}
	sendNagiosUnknownError(
		res,
		HttpStatusCodes.FORBIDDEN,
		`Missing required header ${ADMIN_API_HEADER}: 1.`,
	);
};

const router = express.Router();

// The router is mounted at ADMIN_UI_MOUNT_PATH, so the script is served at the
// absolute path the page references minus that prefix.
router.get(
	ADMIN_CONFIG_SCRIPT_PATH.slice(ADMIN_UI_MOUNT_PATH.length),
	(_req: Request, res: Response) => {
		res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
		res.setHeader('Cache-Control', 'no-store');
		res.send(ADMIN_CONFIG_SCRIPT);
	},
);

// The editor page handler performs its own authentication and renders the
// "not configured" page, the login form, or the editor depending on state, so
// it must run before requireAdminAuth (which would otherwise answer a bare 401
// and hide those pages). Mounted at both the mount root and /local-config so the
// overview page links to /admin and /admin/local-config both resolve.
router.get('/', getAdminConfigPage);
router.get('/local-config', getAdminConfigPage);

// Login is the one POST that cannot require the admin API header or a session:
// it runs before either exists. Its CSRF surface is accepted risk and covered
// three ways - the global CSRF guard rejects cross-origin state changes, the
// session cookie is SameSite=Strict, and a successful login still needs the
// out-of-band ADMIN_UI_PASSWORD, which a cross-site form cannot supply.
router.post('/login', loginRateLimiter, postAdminLogin);

router.use(adminAuthRateLimiter, requireAdminAuth);

router.post('/logout', postAdminLogout);

router.get('/api/commands', getAdminCommands);
router.get('/api/entries', getAdminEntries);
router.post('/api/validate', requireAdminApiHeader, postAdminValidate);
router.post('/api/test', requireAdminApiHeader, postAdminTest);
router.post('/api/save', requireAdminApiHeader, postAdminSave);
router.post('/api/revert', requireAdminApiHeader, postAdminRevert);

export default router;
