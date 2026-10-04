import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [app, main, styles, readme, checklist, architecture] = await Promise.all([
  readFile(resolve(root, 'src/renderer/src/App.tsx'), 'utf8'),
  readFile(resolve(root, 'src/main/index.ts'), 'utf8'),
  readFile(resolve(root, 'src/renderer/src/styles.css'), 'utf8'),
  readFile(resolve(root, 'README.md'), 'utf8'),
  readFile(resolve(root, 'docs/manual-test-checklist.md'), 'utf8'),
  readFile(resolve(root, 'docs/architecture.md'), 'utf8')
]);

assert.match(app, /selectedDeviceConnectionId/, 'Selection must use the physical connection ID.');
assert.match(
  app,
  /inventoryDevices\.find\(\(candidate\) => candidate\.connectionId === selectedDeviceConnectionId\)/,
  'The active inventory must be resolved by connection ID.'
);
assert.doesNotMatch(app, /const device = inventory\?\.devices\[0\] \?\? null/, 'The first phone must not be hard-coded.');
assert.match(app, /function selectDevice\(nextDevice: MtpDeviceInventory\)/, 'The sidebar must switch phones explicitly.');
assert.match(app, /device\?\.connectionId === candidate\.connectionId/, 'The active phone must be highlighted by identity.');
assert.match(app, /folderKey\(device\.connectionId/, 'Folder caches must be namespaced by connection.');
assert.match(app, /objectRowKey\(device\.connectionId/, 'Object row keys must be namespaced by connection.');
assert.match(main, /function rawDeviceForConnection[\s\S]*rawDeviceConnectionId\(device\) === connectionId/, 'Current device indices must be resolved from connection identity.');
assert.match(main, /waitForChildProcessExit/, 'Switching normal sessions must wait for USB release.');
assert.match(styles, /\.device-choice/, 'The connected-phone selector must remain styled.');
assert.match(readme, /Multiple connected phones/, 'README must document multiple phones.');
assert.match(checklist, /If two phones are connected/, 'Manual checks must cover two phones.');
assert.match(architecture, /selected physical connection ID/, 'Architecture must describe identity rather than a stable index.');

console.log('Device selection contract check passed.');
