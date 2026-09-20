import {existsSync, readFileSync, rmSync} from 'fs';
import {
	WORKSPACE_STATE_FILE,
	type WorkspaceState,
	stopWorkspace,
} from './workspace.mts';

/**
 * Stop the server and delete the scratch workspace.
 *
 * Reads the handoff file rather than module state, because globalTeardown is
 * not guaranteed to share a module instance with globalSetup.
 */
export default async function globalTeardown(): Promise<void> {
	if (!existsSync(WORKSPACE_STATE_FILE)) {
		return;
	}

	try {
		const state = JSON.parse(
			readFileSync(WORKSPACE_STATE_FILE, 'utf8'),
		) as WorkspaceState;
		await stopWorkspace(state);
	} catch {
		// A corrupt record must not fail the suite; the next setup also cleans up.
	}

	rmSync(WORKSPACE_STATE_FILE, {force: true});
}
