import {startUiTestServer} from './workspace.mts';

/**
 * Boot the Nest server once for the whole UI suite.
 *
 * Deliberately started here rather than through Playwright's `webServer` option:
 * the workspace path is discovered at runtime, and `webServer.env` is read when
 * the config is loaded — before globalSetup runs. Owning the spawn removes that
 * ordering question entirely and lets the specs read the URL from a state file.
 *
 * One server for the whole run, because the admin session cookie is signed with
 * a per-process ephemeral secret: a restart mid-suite invalidates every session.
 */
export default async function globalSetup(): Promise<void> {
	const workspace = await startUiTestServer();
	// Surfaced in the report so a failure to reach the server is easy to debug.
	process.env.NEST_UI_BASE_URL = workspace.baseUrl;
	console.log(`Nest UI test server ready at ${workspace.baseUrl}`);
}
