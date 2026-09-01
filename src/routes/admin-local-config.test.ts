import type {NextFunction, Request, Response} from 'express';
import express from 'express';
import request from 'supertest';
import * as controller from '../controllers/admin-local-config';
import {ADMIN_API_HEADER} from '../controllers/admin-local-config';
import * as adminAuth from '../lib/admin-auth';
import * as httpNagios from '../lib/http-nagios';
import {HttpStatusCodes} from '../lib/http-status-codes';
import adminRouter from './admin-local-config';

jest.mock('../controllers/admin-local-config');
jest.mock('../lib/admin-auth');
jest.mock('../lib/http-nagios');
jest.mock('../lib/admin-scripts', () => ({
	ADMIN_CONFIG_SCRIPT: 'console.log(1);',
	ADMIN_CONFIG_SCRIPT_PATH: '/admin/local-config.js',
}));
jest.mock('express-rate-limit', () => ({
	__esModule: true,
	default: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
jest.mock('../config/env', () => ({
	env: {
		ADMIN_UI_MOUNT_PATH: '/admin',
		ADMIN_LOGIN_RATE_LIMIT_MAX: 5,
		RATE_LIMIT_WINDOW_MS: 60_000,
		PLUGINS_DIR: 'plugins',
		API_KEY: '',
		API_KEY_HEADER: 'x-api-key',
	},
}));

const mockedHasValidAdminSession = jest.mocked(adminAuth.hasValidAdminSession);
const mockedHasValidAdminPassword = jest.mocked(
	adminAuth.hasValidAdminPassword,
);
const mockedSendNagiosUnknownError = jest.mocked(
	httpNagios.sendNagiosUnknownError,
);

// Make the nagios helper actually finish the response so supertest resolves.
const stubNagios = (): void => {
	mockedSendNagiosUnknownError.mockImplementation(
		(res: Response, code: number) => {
			return res.status(code).json({code: 3, message: 'error'});
		},
	);
};

const buildApp = (): express.Application => {
	const app = express();
	app.use(express.json());
	app.use('/admin', adminRouter);
	return app;
};

describe('admin-local-config route', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockedHasValidAdminSession.mockReturnValue(true);
		mockedHasValidAdminPassword.mockReturnValue(false);
		stubNagios();
		// Default: every controller handler finishes with 204.
		(
			[
				controller.postAdminLogin,
				controller.postAdminLogout,
				controller.getAdminConfigPage,
				controller.getAdminCommands,
				controller.getAdminEntries,
				controller.postAdminValidate,
				controller.postAdminTest,
				controller.postAdminSave,
				controller.postAdminRevert,
			] as unknown as jest.Mock[]
		).forEach((handler) => {
			handler.mockImplementation((_req: Request, res: Response) => {
				res.status(HttpStatusCodes.NO_CONTENT).end();
			});
		});
	});

	describe('script route', () => {
		it('serves the client script with no-store', async () => {
			const res = await request(buildApp()).get('/admin/local-config.js');

			expect(res.status).toBe(HttpStatusCodes.OK);
			expect(res.headers['content-type']).toContain('application/javascript');
			expect(res.headers['cache-control']).toBe('no-store');
			expect(res.text).toBe('console.log(1);');
		});
	});

	describe('POST /login', () => {
		it('is reachable without admin auth and forwards to the handler', async () => {
			mockedHasValidAdminSession.mockReturnValue(false);
			const res = await request(buildApp()).post('/admin/login').send({});

			expect(controller.postAdminLogin).toHaveBeenCalled();
			expect(res.status).toBe(HttpStatusCodes.NO_CONTENT);
		});
	});

	describe('GET / and /local-config (page)', () => {
		it('serves the page handler at the mount root without auth', async () => {
			mockedHasValidAdminSession.mockReturnValue(false);
			const res = await request(buildApp()).get('/admin');

			expect(controller.getAdminConfigPage).toHaveBeenCalled();
			expect(res.status).toBe(HttpStatusCodes.NO_CONTENT);
		});

		it('serves the page handler at /local-config without auth', async () => {
			mockedHasValidAdminSession.mockReturnValue(false);
			const res = await request(buildApp()).get('/admin/local-config');

			expect(controller.getAdminConfigPage).toHaveBeenCalled();
			expect(res.status).toBe(HttpStatusCodes.NO_CONTENT);
		});
	});

	describe('requireAdminAuth', () => {
		it('rejects with 401 when neither session nor password is valid', async () => {
			mockedHasValidAdminSession.mockReturnValue(false);
			mockedHasValidAdminPassword.mockReturnValue(false);

			const res = await request(buildApp()).get('/admin/api/commands');

			expect(res.status).toBe(HttpStatusCodes.UNAUTHORIZED);
			expect(mockedSendNagiosUnknownError).toHaveBeenCalledWith(
				expect.anything(),
				HttpStatusCodes.UNAUTHORIZED,
				expect.stringContaining('Admin authentication required'),
			);
		});

		it('allows access via a valid admin password header even without a session', async () => {
			mockedHasValidAdminSession.mockReturnValue(false);
			mockedHasValidAdminPassword.mockReturnValue(true);

			const res = await request(buildApp()).get('/admin/api/commands');

			expect(res.status).toBe(HttpStatusCodes.NO_CONTENT);
			expect(controller.getAdminCommands).toHaveBeenCalled();
		});
	});

	describe('GET /api/commands & /api/entries', () => {
		it('forwards commands requests', async () => {
			const res = await request(buildApp()).get('/admin/api/commands');

			expect(controller.getAdminCommands).toHaveBeenCalled();
			expect(res.status).toBe(HttpStatusCodes.NO_CONTENT);
		});

		it('forwards entries requests', async () => {
			const res = await request(buildApp()).get('/admin/api/entries');

			expect(controller.getAdminEntries).toHaveBeenCalled();
			expect(res.status).toBe(HttpStatusCodes.NO_CONTENT);
		});
	});

	describe('POST /logout', () => {
		it('forwards logout requests', async () => {
			const res = await request(buildApp()).post('/admin/logout');

			expect(controller.postAdminLogout).toHaveBeenCalled();
			expect(res.status).toBe(HttpStatusCodes.NO_CONTENT);
		});
	});

	describe('requireAdminApiHeader', () => {
		const apiPaths = ['/validate', '/test', '/save', '/revert'];

		it.each(apiPaths)(
			'rejects POST /api%s with 403 when the header is missing',
			async (path) => {
				const res = await request(buildApp())
					.post(`/admin/api${path}`)
					.send({});

				expect(res.status).toBe(HttpStatusCodes.FORBIDDEN);
				expect(mockedSendNagiosUnknownError).toHaveBeenCalledWith(
					expect.anything(),
					HttpStatusCodes.FORBIDDEN,
					expect.stringContaining(
						`Missing required header ${ADMIN_API_HEADER}`,
					),
				);
			},
		);

		it.each(apiPaths)(
			'forwards POST /api%s when the header is present',
			async (path) => {
				const res = await request(buildApp())
					.post(`/admin/api${path}`)
					.set(ADMIN_API_HEADER, '1')
					.send({});

				expect(res.status).toBe(HttpStatusCodes.NO_CONTENT);
			},
		);

		it('uses the first value when the admin header is an array', async () => {
			const app = express();
			app.use(express.json());
			app.use((req: Request, _res: Response, next: NextFunction) => {
				req.headers[ADMIN_API_HEADER] = ['1', 'other'];
				next();
			});
			app.use('/admin', adminRouter);

			const res = await request(app).post('/admin/api/validate').send({});

			expect(res.status).toBe(HttpStatusCodes.NO_CONTENT);
		});
	});
});
