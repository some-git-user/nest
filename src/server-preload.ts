// Preload entry point: sets up ssh2 interception before server loads
import {setupSsh2Interception} from './preload/ssh2-preload.js';

setupSsh2Interception();
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./server');
