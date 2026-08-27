/**
 * Hostnames/addresses that describe *where the server listens* rather than
 * *how it is reached*, shared by TLS certificate generation and internal
 * self-requests so the two can never disagree.
 */

// Bind addresses that accept connections on every interface. They are not valid
// certificate identities and they are not connectable destinations.
export const WILDCARD_HOSTS = ['0.0.0.0', '::', '*'];

// The server always has to be reachable from itself (internal plugin requests),
// so these identities are part of every certificate regardless of HOST.
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];

/**
 * The address to dial when the server calls itself.
 *
 * `HOST` is the bind address; a wildcard bind address is replaced by loopback,
 * while a specific bind address is kept as-is because loopback is not
 * necessarily listening when the server binds to a single interface.
 */
export const resolveSelfRequestHost = (bindHost: string): string => {
	return WILDCARD_HOSTS.includes(bindHost) ? 'localhost' : bindHost;
};
