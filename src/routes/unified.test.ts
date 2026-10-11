import express from 'express';
import request from 'supertest';
import {unifiedCheck} from '../controllers/unified';
import {HttpStatusCodes} from '../lib/http-status-codes';
import unifiedRouter from './unified';

jest.mock('../controllers/unified');

const mockedUnifiedCheck = jest.mocked(unifiedCheck);

const app = express();
app.use(express.json());
app.use('/unified', unifiedRouter);

describe('unified route', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockedUnifiedCheck.mockImplementation(async (_req, res) => {
			res.status(HttpStatusCodes.OK).json({code: 0, message: 'ok'});
		});
	});

	it('routes GET /unified to the handler', async () => {
		const response = await request(app).get('/unified');

		expect(mockedUnifiedCheck).toHaveBeenCalledTimes(1);
		expect(response.status).toBe(HttpStatusCodes.OK);
		expect(response.body).toEqual({code: 0, message: 'ok'});
	});

	it('routes POST /unified to the handler', async () => {
		const response = await request(app).post('/unified').send({});

		expect(mockedUnifiedCheck).toHaveBeenCalledTimes(1);
		expect(response.status).toBe(HttpStatusCodes.OK);
	});
});
