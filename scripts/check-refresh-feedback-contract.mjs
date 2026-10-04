import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [app, checklist, architecture] = await Promise.all([
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('docs/manual-test-checklist.md'),
  readProjectFile('docs/architecture.md')
]);

assert.match(app, /function renderRefreshFeedback\(\): JSX\.Element \| null/, 'Refresh feedback must render from one shared compact helper.');
assert.match(app, /className=\{`refresh-feedback \$\{refreshFeedback\.phase\} sidebar`\}/, 'Refresh feedback must render only in the sidebar.');
assert.doesNotMatch(app, /renderRefreshFeedback\('banner'\)/, 'Refresh feedback must not be duplicated in the main browser banner.');
assert.match(app, /const WAITING_PHONE_CHECK_INTERVAL_MS = 400;/, 'Waiting-state checks must catch short Samsung MTP connection windows.');
assert.match(app, /const CONNECTED_PHONE_CHECK_INTERVAL_MS = 3000;/, 'Connected-state checks must remain lightweight.');
assert.match(app, /scheduleNextPhoneCheck[\s\S]*pollForPhone\(\)[\s\S]*scheduleNextPhoneCheck\(\)/, 'Polling must reschedule itself after each single-flight check.');
assert.match(app, /const pollInFlight = useRef\(false\)/, 'Automatic checks must have a dedicated single-flight guard.');
assert.doesNotMatch(app, /scanInFlight\.current \|\| pollInFlight\.current/, 'USB status checks must continue while storage opening is pending.');
assert.match(app, /if \(scanInFlight\.current\) \{[\s\S]*if \(!hasMtpDevice\)[\s\S]*clearDeviceFromStatus\(nextStatus\)/, 'A mode change must interrupt stale opening UI without waiting for inventory.');
assert.match(app, /finally \{\s*pollInFlight\.current = false;/, 'The polling guard must reset on success and failure.');
assert.doesNotMatch(app, /autoCheckStatusText|auto-check-status|Auto-checks every 3 sec\./, 'Automatic polling must not add persistent status noise to the sidebar.');
assert.match(app, /className="auto-check-note"[\s\S]*No need to refresh\./, 'Simple waiting panels must not make manual refresh the primary action.');
assert.match(
  app,
  /Checked \$\{checkedAt\}: \$\{rawDeviceName\} did not answer\. Switch USB to Charging, then back to File transfer\./,
  'Manual check failure copy must stay concise and state the next physical action.'
);
assert.match(app, /Optional: check now instead of waiting for the next automatic check\./, 'Sidebar check button must be framed as optional.');
assert.match(
  app,
  /shouldShowRetry[\s\S]*className="primary-button connection-gate-primary"[\s\S]*<span>Retry<\/span>/,
  'A stopped connection attempt must expose one clear Retry action.'
);
assert.match(checklist, /Check now feedback appears once/, 'Manual checklist must cover single-location Check now feedback.');
assert.match(architecture, /checks every 400 milliseconds while waiting/, 'Architecture docs must explain the fast pre-connection check interval.');

console.log('Refresh feedback contract check passed.');
