import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'src/shared/deviceIdentity.ts');
const outDir = resolve(root, '.tmp');
const outPath = resolve(outDir, 'device-identity-check.mjs');
const source = await readFile(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;

await mkdir(outDir, { recursive: true });
await writeFile(outPath, compiled, 'utf8');
const { deviceConnectionId, stableDeviceIdentity } = await import(
  `${pathToFileURL(outPath).href}?t=${Date.now()}`
);

const firstAddress = {
  vendorId: 1256,
  productId: 26720,
  serial: ' TESTMTP0002 ',
  usbSessionId: '1001',
  bus: 2,
  device: 3
};
const sameAttachmentNewAddress = { ...firstAddress, bus: 4, device: 9 };
const replugged = { ...firstAddress, usbSessionId: '1002', bus: 2, device: 4 };

assert.equal(stableDeviceIdentity(firstAddress), '1256:26720:serial:testmtp0002');
assert.equal(deviceConnectionId(firstAddress), deviceConnectionId(sameAttachmentNewAddress));
assert.notEqual(deviceConnectionId(firstAddress), deviceConnectionId(replugged));
assert.equal(stableDeviceIdentity(firstAddress), stableDeviceIdentity(replugged));

const noSerialA = { vendorId: 1256, productId: 26720, bus: 2, device: 3 };
const noSerialB = { vendorId: 1256, productId: 26720, bus: 2, device: 4 };
assert.notEqual(deviceConnectionId(noSerialA), deviceConnectionId(noSerialB));

console.log('Device identity behavior check passed.');
