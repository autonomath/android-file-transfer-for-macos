import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'src/main/macMtpCamera.ts');
const outDir = resolve(root, '.tmp');
const outPath = resolve(outDir, 'mac-mtp-camera-check.mjs');

const source = await readFile(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;

await mkdir(outDir, { recursive: true });
await writeFile(outPath, compiled, 'utf8');

const { findMacMtpCameraOwner } = await import(`${pathToFileURL(outPath).href}?t=${Date.now()}`);

const sample = `
+-o MTP@0  <class IOUSBHostInterface, id 0x101fcf17d>
  | {
  |   "idProduct" = 26720
  |   "bInterfaceClass" = 6
  |   "bInterfaceSubClass" = 1
  |   "UsbExclusiveOwner" = "pid 36792, ptpcamerad"
  |   "idVendor" = 1256
  |   "USB Serial Number" = "SYNTHETIC-MTP-0001"
  | }
  +-o ptpcamerad  <class AppleUSBHostInterfaceUserClient, id 0x101fcf18e>
      {
        "IOUserClientCreator" = "pid 36792, ptpcamerad"
      }

+-o Still Image Capture@0  <class IOUSBHostInterface, id 0x101fcf17f>
    {
      "idProduct" = 26720
      "bInterfaceClass" = 6
      "bInterfaceSubClass" = 1
      "UsbExclusiveOwner" = "pid 40000, another-process"
      "idVendor" = 1256
      "USB Serial Number" = "SYNTHETIC-MTP-0002"
    }
`;

assert.deepEqual(
  findMacMtpCameraOwner(sample, {
    vendorId: 1256,
    productId: 26720,
    serial: 'SYNTHETIC-MTP-0001'
  }),
  { pid: 36792, processName: 'ptpcamerad' }
);

assert.equal(
  findMacMtpCameraOwner(sample, {
    vendorId: 1256,
    productId: 26720,
    serial: 'SYNTHETIC-MTP-9999'
  }),
  null
);

assert.equal(
  findMacMtpCameraOwner(sample.replace('ptpcamerad"', 'Photos"'), {
    vendorId: 1256,
    productId: 26720,
    serial: 'SYNTHETIC-MTP-0001'
  }),
  null
);

console.log('Mac MTP camera owner parser check passed.');

const { findMacCameraClients, MacCameraConflicts, cameraProcessAgeSeconds } = await import(`${pathToFileURL(outPath).href}?t=${Date.now()}`);
assert.equal(cameraProcessAgeSeconds('  26:15 '), 1575);
assert.equal(cameraProcessAgeSeconds('01:02:03'), 3723);
assert.equal(cameraProcessAgeSeconds('2-01:02:03'), 176523);
assert.equal(cameraProcessAgeSeconds(''), null);
const owner = { pid: 101, processName: 'ptpcamerad', locationId: 1234 };
const processes = new Map([[201, '/Applications/Google Drive.app/Contents/MacOS/Google Drive']]);
const log = `
2026-01-01 00:00:00 Df ptpcamerad[101:a] PTPCameraDevice | + 201-com.google.drivefs:[00001]
2026-01-01 00:00:00 Df ptpcamerad[101:a] PTPCameraDevice | > New Device: LOC:1234
2026-01-01 00:00:00 Df ptpcamerad[101:a] requestStart | Process: com.google.drivefs, Request Order Ascending: NO
2026-01-01 00:00:00 Df ptpcamerad[99:a] requestStart | Process: com.apple.Preview, Request Order Ascending: NO
`;
const client = { pid: 201, bundleId: 'com.google.drivefs', appName: 'Google Drive', bundlePath: '/Applications/Google Drive.app' };
assert.deepEqual(findMacCameraClients(log, owner, processes), [client]);
assert.deepEqual(findMacCameraClients(log + '\nptpcamerad[101:a] PTPCameraDevice | - 201-com.google.drivefs:[00001]', owner, processes), [], 'A client that released its camera session must not be offered Quit even when the app is still running.');
assert.deepEqual(findMacCameraClients(log, { ...owner, pid: 102 }, processes), []);
assert.deepEqual(findMacCameraClients(log, { ...owner, locationId: 9999 }, processes), []);
assert.deepEqual(findMacCameraClients(log, owner, new Map()), [], 'Quit clients must not be blamed from old logs.');
assert.deepEqual(findMacCameraClients(log, owner, new Map([[201, '/usr/bin/unrelated']])), [], 'A reused PID is not the old client.');
assert.deepEqual(findMacCameraClients(log + '\nptpcamerad[101:a] New Device: LOC:5678', owner, processes), [], 'Do not attribute an ambiguous multi-camera log.');
assert.equal(findMacMtpCameraOwner(sample.replace('"USB Serial Number" = "SYNTHETIC-MTP-0001"', ''), {
  vendorId: 1256, productId: 26720, serial: 'SYNTHETIC-MTP-0001'
}), null, 'Do not release an interface with no matching serial.');

let nextId = 0;
const conflicts = new MacCameraConflicts(() => `offer-${++nextId}`);
let quitCalls = 0;
const actions = {
  inspect: async () => ({ owner, clients: [client] }),
  quitNormally: () => { quitCalls += 1; return 'requested'; }
};
for (let i = 0; i < 50; i++) conflicts.observe('phone-A', { owner, clients: [client] });
assert.equal(quitCalls, 0, 'Observing a busy phone never closes any process.');
const offered = conflicts.get('phone-A');
assert.equal(offered.apps[0].id, 'offer-1', 'Polling keeps the displayed choice stable.');
assert.match(offered.apps[0].quitImpact, /pauses Google Drive syncing/);
assert.equal(JSON.stringify(offered).includes('201'), false, 'The renderer gets an opaque offer, not a PID.');
const request = { connectionId: 'phone-A', appId: offered.apps[0].id };
assert.equal((await conflicts.requestQuit({ ...request, appId: '201' }, actions)).ok, false);
assert.equal((await conflicts.requestQuit({ ...request, connectionId: 'phone-B' }, actions)).ok, false);
assert.equal(quitCalls, 0, 'Arbitrary or mismatched targets cannot be closed.');
assert.equal((await conflicts.requestQuit(request, { ...actions, inspect: async () => null })).ok, false);
assert.equal((await conflicts.requestQuit(request, {
  ...actions, inspect: async () => ({ owner: { ...owner, pid: 999 }, clients: [client] })
})).ok, false);
assert.equal((await conflicts.requestQuit(request, {
  ...actions, inspect: async () => ({ owner, clients: [{ ...client, pid: 999 }] })
})).ok, false);
assert.equal((await conflicts.requestQuit(request, {
  ...actions, inspect: async () => ({ owner, clients: [{ ...client, bundlePath: '/Other/Google Drive.app' }] })
})).ok, false);
assert.equal(quitCalls, 0, 'Changed device owners, client PIDs, and app paths are rejected.');
const result = await conflicts.requestQuit(request, actions);
assert.equal(result.ok, true);
assert.match(result.message, /Quit requested/);
assert.doesNotMatch(result.message, /has quit|was closed/);
assert.equal(quitCalls, 1);
const refused = await conflicts.requestQuit(request, { ...actions, quitNormally: () => 'refused' });
assert.equal(refused.ok, false);
assert.match(refused.message, /Nothing was force-quit/);
let resolveInspection;
const pending = conflicts.requestQuit(request, {
  ...actions, inspect: () => new Promise((resolve) => { resolveInspection = resolve; })
});
assert.equal((await conflicts.requestQuit(request, actions)).ok, false);
conflicts.observe('phone-A', null);
resolveInspection({ owner, clients: [client] });
assert.equal((await pending).ok, false, 'A disconnected phone cancels a pending Quit request.');
assert.equal(quitCalls, 1);
conflicts.observe('unknown', { owner, clients: [] });
assert.deepEqual(conflicts.get('unknown').apps, [], 'Unknown clients never get an app-closing action.');
conflicts.retainConnections(new Set());
assert.equal(conflicts.get('unknown'), undefined);
console.log('Passive USB conflict and explicit normal-Quit regression checks passed.');
