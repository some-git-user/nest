// Standalone RuleTester sanity check for no-shell-exec (eslint-rules/ is not in
// the jest roots). Run from the project root so `eslint` resolves:
//   node eslint-rules/no-shell-exec.ruletester.mjs
import {RuleTester} from 'eslint';
import rule from './no-shell-exec.mjs';

const parserOptions = {ecmaVersion: 2022, sourceType: 'module'};

const t = new RuleTester({languageOptions: {parserOptions}});

t.run('no-shell-exec', rule, {
	valid: [
		// Safe: execFile with argv array, no shell option.
		{
			code: `import {execFile} from 'child_process';
			       execFile('docker', ['ps'], {timeout: 1000});`,
		},
		// Safe: promisify(execFile) alias with argv array, no shell option.
		{
			code: `import {execFile} from 'child_process';
			       import {promisify} from 'util';
			       const execFileAsync = promisify(execFile);
			       await execFileAsync('docker', ['ps'], {timeout: 1000});`,
		},
		// Safe: promisify of a non-child_process function is ignored.
		{
			code: `import {promisify} from 'util';
			       const delayed = promisify((cb) => cb(null));
			       await delayed({shell: true});`,
		},
		// Safe: a local function named promisify that is NOT util.promisify.
		{
			code: `const promisify = (fn) => fn;
			       const run = promisify(someOtherFn);
			       run('x', ['y'], {shell: true});`,
		},
		// Safe: namespaced util, promisify of non-child_process fn.
		{
			code: `import * as util from 'util';
			       const run = util.promisify(someOtherFn);
			       run('x', ['y'], {shell: true});`,
		},
	],
	invalid: [
		// Direct exec is always banned.
		{
			code: `import {exec} from 'child_process'; exec('ls');`,
			errors: [{messageId: 'noShellExec'}],
		},
		// shell:true on a promisify(execFile) alias is now caught.
		{
			code: `import {execFile} from 'child_process';
			       import {promisify} from 'util';
			       const execFileAsync = promisify(execFile);
			       await execFileAsync('sh', ['-c', cmd], {shell: true});`,
			errors: [{messageId: 'noShellOption', data: {name: 'execFile'}}],
		},
		// shell:true on a promisify(execFileSync) alias is caught too.
		{
			code: `import {execFileSync} from 'child_process';
			       import {promisify} from 'util';
			       const runSync = promisify(execFileSync);
			       runSync('sh', ['-c', cmd], {shell: '/bin/bash'});`,
			errors: [{messageId: 'noShellOption', data: {name: 'execFileSync'}}],
		},
		// Inline promisify(execFile)(...) with shell:true is caught.
		{
			code: `import {execFile} from 'child_process';
			       import {promisify} from 'util';
			       await promisify(execFile)('sh', ['-c', cmd], {shell: true});`,
			errors: [{messageId: 'noShellOption', data: {name: 'execFile'}}],
		},
		// Namespaced child_process + named promisify.
		{
			code: `import * as cp from 'child_process';
			       import {promisify} from 'util';
			       const spawnAsync = promisify(cp.spawn);
			       spawnAsync('sh', ['-c', cmd], {shell: true});`,
			errors: [{messageId: 'noShellOption', data: {name: 'spawn'}}],
		},
		// require('util') destructured promisify.
		{
			code: `const {execFile} = require('child_process');
			       const {promisify} = require('util');
			       const run = promisify(execFile);
			       run('sh', ['-c', cmd], {shell: true});`,
			errors: [{messageId: 'noShellOption', data: {name: 'execFile'}}],
		},
		// Namespaced util.promisify of a child_process fn.
		{
			code: `import * as cp from 'child_process';
			       import * as util from 'util';
			       const run = util.promisify(cp.execFile);
			       run('sh', ['-c', cmd], {shell: true});`,
			errors: [{messageId: 'noShellOption', data: {name: 'execFile'}}],
		},
	],
});

console.log('no-shell-exec RuleTester: all cases passed');
