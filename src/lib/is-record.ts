/**
 * Type guard for a plain object record.
 *
 * Narrows `unknown` to `Record<string, unknown>` so untrusted values (parsed
 * JSON, plugin metadata) can be read by key without a cast. Arrays are excluded:
 * they are objects too, but treating one as a keyed record is always a bug, and
 * reading a named property off an array yields `undefined` anyway.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
