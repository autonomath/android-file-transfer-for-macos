import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(resolve(root, 'src/main/index.ts'), 'utf8');

function section(startMarker, endMarker) {
  const start = main.indexOf(startMarker);
  const end = main.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return main.slice(start, end);
}

const childExitWait = section('function waitForChildProcessExit(', 'function destroyMtpSession(');
assert.match(childExitWait, /child\.once\('exit', finish\)/);
assert.match(childExitWait, /child\.once\('close', finish\)/);
assert.match(childExitWait, /timeout = setTimeout\(\(\) => \{[\s\S]*child\.kill\('SIGKILL'\);[\s\S]*finish\(\);/);

const destroy = section('function destroyMtpSession(', 'function finishActiveSessionCommand(');
assert.match(destroy, /trackMtpSessionTeardown\([\s\S]*waitForChildProcessExit/);
assert.ok(
  destroy.indexOf('trackMtpSessionTeardown') < destroy.indexOf('rejectSessionCommands(error)'),
  'Teardown must register its child-exit barrier before rejecting commands.'
);
assert.match(destroy, /requestGracefulQuit &&/);
assert.match(
  main,
  /void destroyMtpSession\(message, true, false\);/,
  'A helper that already reported a failed open must exit without a competing quit command.'
);

const startup = section('async function ensureMtpSession(', 'async function runSessionCommand<');
assert.match(startup, /await waitForMtpSessionTeardown\(\);/);
assert.match(startup, /if \(sessionProcess\) \{\s*await destroyMtpSession/);
assert.equal((startup.match(/spawn\(helperPath, \['session'/g) ?? []).length, 1);

const transferRunner = section('async function runTransferJob(', 'function processTransferQueue(');
assert.match(
  transferRunner,
  /finally \{\s*await waitForMtpSessionTeardown\(\);[\s\S]*activeJobId = null;/,
  'The active transfer slot must stay occupied until the helper exits.'
);

const queuePump = section('function processTransferQueue(', 'function enqueueDownloads(');
assert.match(queuePump, /mtpSessionTeardown !== null/);
assert.match(main, /destroyMtpSession\('MTP raw device disappeared\.', true\)/);
assert.doesNotMatch(main, /AdminSession|destroyAdmin|startAdmin|protected session/i);

console.log('Single MTP session teardown queue check passed.');
