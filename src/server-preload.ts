import 'ssh2';
import {setupSsh2Interception} from './preload/ssh2-preload.js';

// Preload entry point: sets up ssh2 interception before server loads
console.log('[PRELOAD] Starting');
setupSsh2Interception();
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./server');
console.log('[PRELOAD] Done');
