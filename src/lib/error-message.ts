export const getErrorMessage = (error: unknown): string => {
	if (error instanceof Error) {
		return error.message;
	}

	if (
		typeof error === 'object' &&
		error !== null &&
		'message' in error &&
		typeof (error as {message?: unknown}).message === 'string'
	) {
		return (error as {message: string}).message;
	}

	// Handle cases where error is undefined, null, or other types
	if (error === undefined) {
		return 'Undefined error';
	}

	if (error === null) {
		return 'Null error';
	}

	// For strings, numbers, booleans, etc., convert to string
	if (
		typeof error === 'string' ||
		typeof error === 'number' ||
		typeof error === 'boolean'
	) {
		return String(error);
	}

	// For other object types, try to get a meaningful string representation
	return '[Unknown error]';
};
