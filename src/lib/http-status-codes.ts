/**
 * HTTP Status Code Constants
 *
 * Centralized definitions for HTTP status codes used throughout the application.
 * Using constants instead of magic numbers improves code readability and maintainability.
 */

export const HttpStatusCodes = {
	// Success
	OK: 200,
	NO_CONTENT: 204,

	// Client Errors
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	CONFLICT: 409,

	// Server Errors
	INTERNAL_SERVER_ERROR: 500,
} as const;

/**
 * HTTP Status Code Descriptions
 * Human-readable descriptions for each status code
 */
export const HttpStatusDescriptions = {
	// Success
	[HttpStatusCodes.OK]: 'Success',
	[HttpStatusCodes.NO_CONTENT]: 'No Content',

	// Client Errors
	[HttpStatusCodes.BAD_REQUEST]: 'Bad Request',
	[HttpStatusCodes.UNAUTHORIZED]: 'Unauthorized',
	[HttpStatusCodes.FORBIDDEN]: 'Forbidden',
	[HttpStatusCodes.NOT_FOUND]: 'Not Found',
	[HttpStatusCodes.CONFLICT]: 'Conflict',

	// Server Errors
	[HttpStatusCodes.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
} as const;
