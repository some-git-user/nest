import {HttpStatusCodes, HttpStatusDescriptions} from './http-status-codes';

describe('HTTP Status Codes', () => {
	describe('HttpStatusCodes', () => {
		it('should define success status codes', () => {
			expect(HttpStatusCodes.OK).toBe(200);
			expect(HttpStatusCodes.NO_CONTENT).toBe(204);
		});

		it('should define client error status codes', () => {
			expect(HttpStatusCodes.BAD_REQUEST).toBe(400);
			expect(HttpStatusCodes.UNAUTHORIZED).toBe(401);
			expect(HttpStatusCodes.FORBIDDEN).toBe(403);
			expect(HttpStatusCodes.NOT_FOUND).toBe(404);
			expect(HttpStatusCodes.CONFLICT).toBe(409);
		});

		it('should define server error status codes', () => {
			expect(HttpStatusCodes.INTERNAL_SERVER_ERROR).toBe(500);
		});
	});

	describe('HttpStatusDescriptions', () => {
		it('should have descriptions for all status codes', () => {
			expect(HttpStatusDescriptions[200]).toBe('Success');
			expect(HttpStatusDescriptions[204]).toBe('No Content');
			expect(HttpStatusDescriptions[400]).toBe('Bad Request');
			expect(HttpStatusDescriptions[401]).toBe('Unauthorized');
			expect(HttpStatusDescriptions[403]).toBe('Forbidden');
			expect(HttpStatusDescriptions[404]).toBe('Not Found');
			expect(HttpStatusDescriptions[409]).toBe('Conflict');
			expect(HttpStatusDescriptions[500]).toBe('Internal Server Error');
		});
	});
});
