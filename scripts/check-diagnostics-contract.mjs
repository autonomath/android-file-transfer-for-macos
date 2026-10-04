import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [types, main, preload, app, styles, readme, checklist, architecture] = await Promise.all([
  readProjectFile('src/shared/types.ts'),
  readProjectFile('src/main/index.ts'),
  readProjectFile('src/preload/index.ts'),
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('src/renderer/src/styles.css'),
  readProjectFile('README.md'),
  readProjectFile('docs/manual-test-checklist.md'),
  readProjectFile('docs/architecture.md')
]);

assert.match(types, /export interface DiagnosticsCopyResult/, 'Shared types must expose a diagnostics copy result.');
assert.match(types, /copyDiagnostics: \(\) => Promise<DiagnosticsCopyResult>/, 'Renderer API must expose copyDiagnostics.');
assert.match(types, /usbSessionId\?: string/, 'Raw USB devices must expose the macOS USB session identity when IOKit reports it.');

assert.match(preload, /copyDiagnostics: \(\) => ipcRenderer\.invoke\('mtp:copyDiagnostics'\)/, 'Preload must bridge diagnostics copying.');

assert.match(main, /clipboard,\s*\n\s*dialog,/, 'Main process must import Electron clipboard.');
assert.match(main, /function buildDiagnosticsReport\(status: DeviceStatus, generatedAt: string\): string/, 'Main process must build the diagnostics report.');
assert.match(main, /function connectionDiagnosis\(status: DeviceStatus\): string/, 'Main process must compute a plain-language connection diagnosis.');
assert.match(main, /function enrichRawDevicesWithAndroidUsbMetadata\(rawDevices: RawDevice\[\]\): Promise<RawDevice\[\]>/, 'Main process must merge IOKit USB metadata into libmtp raw-device status.');
assert.match(main, /rawDevices: withRawDeviceConnectionIds\(\s*await enrichRawDevicesWithAndroidUsbMetadata\(status\.rawDevices\)/, 'Status responses must include enriched USB session metadata and connection identity before Details or Copy Report use them.');
assert.match(main, /USB and File Transfer mode are visible, but the MTP file session is not open\./, 'Diagnostics report must name the USB-visible but file-session-closed state.');
assert.match(main, /Diagnosis: \$\{connectionDiagnosis\(status\)\}/, 'Diagnostics report must include the plain-language connection diagnosis.');
assert.match(main, /usb session \$\{device\.usbSessionId \|\| 'unknown'\}/, 'Diagnostics report must include the raw USB session identity for reconnect comparisons.');
assert.match(main, /This report includes connection state, USB metadata, helper paths, and recent native error text\. It does not include a phone file listing\./, 'Diagnostics report must carry a privacy note.');
assert.match(main, /clipboard\.writeText\(text\)/, 'Diagnostics report must be copied to the clipboard by the main process.');
assert.match(main, /ipcMain\.handle\('mtp:copyDiagnostics', copyDiagnostics\)/, 'Main process must register the diagnostics IPC handler.');
assert.doesNotMatch(main, /objects:\s*MtpObject\[\]/, 'Diagnostics code must not add phone object listings to the report type.');

assert.match(app, /const \[diagnosticsBusy, setDiagnosticsBusy\] = useState\(false\)/, 'Renderer must show a busy state while copying diagnostics.');
assert.match(app, /async function copyDiagnosticReport\(\): Promise<void>/, 'Renderer must own a copy diagnostics action.');
assert.match(app, /window\.mtp\.copyDiagnostics\(\)/, 'Renderer action must call the diagnostics IPC bridge.');
assert.match(app, /className="diagnostics-header"[\s\S]*Copy Report/, 'Copy Report must live inside the Details panel.');
assert.match(app, /USB session[\s\S]*rawDevice\.usbSessionId/, 'Details must show the raw USB session identity when available.');
assert.match(styles, /\.diagnostics-header/, 'Diagnostics panel must have a stable header layout.');
assert.match(styles, /\.diagnostic-copy-button/, 'Diagnostics copy button must have explicit compact styling.');

assert.match(readme, /Copy Report/, 'README must document the user-facing diagnostics copy action.');
assert.match(checklist, /Copy Report/, 'Manual checklist must cover copying diagnostics.');
assert.match(architecture, /copyDiagnostics/, 'Architecture docs must describe the diagnostics IPC path.');
assert.match(architecture, /does not include phone file listings/, 'Architecture docs must preserve the diagnostics privacy boundary.');

console.log('Diagnostics contract check passed.');
