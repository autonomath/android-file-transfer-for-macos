import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [app, main, readme, checklist, architecture] = await Promise.all([
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('src/main/index.ts'),
  readProjectFile('README.md'),
  readProjectFile('docs/manual-test-checklist.md'),
  readProjectFile('docs/architecture.md')
]);

assert.match(app, /function reportedConnectionPhase\(/);
assert.match(app, /interface ConnectionStageItem/);
assert.match(app, /const connectionStages = useMemo<ConnectionStageItem\[\]>/);
assert.match(app, /className="connection-stages main"/);
assert.match(app, /File session[\s\S]*fileSessionStatus/);

assert.match(app, /Opening your phone files\.\.\./);
assert.match(app, /Connected\. Reading phone storage\.\.\./);
assert.match(app, /Reset File transfer on your phone/);
assert.match(app, /Your phone stopped responding/);
assert.match(app, /stopped sending its file list/);
assert.match(app, /Waiting for your phone to share its files\.\.\./);
assert.match(app, /keeps checking on its own for as long as the cable is in/);
assert.match(app, /Trying for[\s\S]*The app will keep[\s\S]*trying until it connects or you press Cancel/);
assert.doesNotMatch(app, /STORAGE_WAIT_MAX_ATTEMPTS/, 'Storage waiting must not have an attempt cap.');
assert.match(
  app,
  /connectionIssue === 'storage-unavailable' && nextStatus\.sessionOpen\) \{[\s\S]{0,200}return nextInventory;/,
  'A session that opened but has not yet shared storage must keep polling automatically without giving up.'
);
assert.match(app, /keeps checking on its own for as long as the cable is in/);
assert.match(app, /openingStillPending[\s\S]*!openingStillPending\) \{[\s\S]*rememberAutomaticScanFailure/);
assert.match(app, /<UsbConflictPanel/);
assert.match(app, /Opening was canceled/);
assert.match(app, /tap <strong>Allow<\/strong> if Android asks/);
assert.match(app, /className="primary-button connection-gate-primary"[\s\S]*<span>Try again<\/span>/);
assert.match(app, /className="text-button connection-gate-primary"[\s\S]*<span>Cancel<\/span>/);
assert.doesNotMatch(app, /stopped this attempt instead of resetting the phone/i);
assert.doesNotMatch(app, /connection-gate-error/);

assert.match(
  app,
  /inventory\?\.connectionPhase === 'ready'[\s\S]*inventory\.state === 'connected'[\s\S]*status\?\.sessionOpen === true/,
  'Readable storage and a live session are both required before showing the browser.'
);
assert.match(
  app,
  /!hasDevice \? \([\s\S]*className=.{0,2}connection-gate[\s\S]*\) : \([\s\S]*className=\{`workspace/,
  'The file browser must stay hidden until the phone is ready.'
);
assert.match(app, /showDiagnostics && \([\s\S]*className="connection-gate-details"/);

assert.match(app, /blockedAutoDeviceKeys = useRef<Set<string>>\(new Set\(\)\)/);
assert.match(app, /automaticScanBlocked\(nextStatus\)/);
assert.match(app, /rememberAutomaticScanFailure\(nextStatus\)/);
assert.match(app, /lastVisibleConnectionKey\.current !== nextConnectionKey/);
assert.match(app, /lastVisibleMode\.current !== nextMode/);
assert.match(app, /nextInventory\.ok \|\| nextInventory\.connectionIssue !== 'phone-not-responding'/,
  'A busy USB interface must retain its actual result instead of becoming an opening attempt.');
assert.match(app, /connectionPhase: 'opening'/);
assert.match(app, /keeps trying automatically; you do not need to\s+reconnect or press Retry/);
assert.doesNotMatch(app, /connectionAttemptCounts/);
assert.doesNotMatch(app, /FILE_ACCESS_RETRY_INTERVAL_MS|setTimeout\([^)]*scanDevice/);

assert.match(main, /const normalSessionOpen = !!sessionProcess && !!sessionConnectionId && !!sessionDeviceIdentityKey/);
assert.match(main, /connectionPhase: hasMtpUsbDevice \? 'opening' : 'file-transfer-off'/);
assert.match(main, /connectionPhase: 'ready'/);
assert.match(main, /inferredStorages[\s\S]*MTP_ROOT_PARENT_ID[\s\S]*fileAccessUnavailable = true/);
assert.match(main, /session root listing failed[\s\S]*keeping the persistent session open for an explicit storage retry/);
assert.doesNotMatch(main, /closing the unusable session/);
assert.match(main, /function cancelConnectionAttempt\(\): boolean/);
assert.doesNotMatch(main, /password|administrator|osascript|recoverWithAdmin/i);

assert.match(readme, /automatically opens one MTP session/i);
assert.match(checklist, /Charging.*File transfer.*ready/is);
assert.match(architecture, /structured connection phases/i);
assert.match(readme, /never asks for the Mac login password/i);
assert.doesNotMatch(readme, /may request the Mac login password|protected USB session/i);
assert.doesNotMatch(checklist, /macOS password prompt|osascript/i);
assert.doesNotMatch(architecture, /recoverWithAdmin|administrator permission|protected session/i);

console.log('Connection states contract check passed.');
