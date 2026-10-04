import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'src/main/androidUsb.ts');
const outDir = resolve(root, '.tmp');
const outPath = resolve(outDir, 'androidUsb-parser-check.mjs');

const source = await readFile(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;

await mkdir(outDir, { recursive: true });
await writeFile(outPath, compiled, 'utf8');

const { androidUsbFallbackKey, parseAndroidUsbDevicesFromIoreg } = await import(
  `${pathToFileURL(outPath).href}?t=${Date.now()}`
);

const sampleIoreg = `
+-o AppleT8132USBXHCI@00000000  <class AppleT8132USBXHCI, id 0x1000004bf>
  +-o USB3.2 Hub@02100000  <class IOUSBHostDevice, id 0x1000004c1>
    {
      "idProduct" = 1573
      "USB Vendor Name" = "GenesysLogic"
      "idVendor" = 1507
      "kUSBProductString" = "USB3.2 Hub"
      "kUSBAddress" = 1
      "kUSBVendorString" = "GenesysLogic"
    }
  +-o SAMSUNG_Android@02200000  <class IOUSBHostDevice, id 0x101f30615>
    {
      "sessionID" = 31327301415980
      "idProduct" = 26720
      "USB Product Name" = "SAMSUNG_Android"
      "locationID" = 35651584
      "USB Vendor Name" = "SAMSUNG"
      "idVendor" = 1256
      "kUSBProductString" = "SAMSUNG_Android"
      "USB Serial Number" = "TESTMTP0001"
      "kUSBAddress" = 1
      "kUSBVendorString" = "SAMSUNG"
      "NeedsDeviceAccessEntitlement" = Yes
    }
`;

const devices = parseAndroidUsbDevicesFromIoreg(sampleIoreg);

assert.equal(devices.length, 1);
assert.deepEqual(devices[0], {
  index: 0,
  vendorId: 1256,
  productId: 26720,
  bus: 2,
  device: 1,
  serial: 'TESTMTP0001',
  usbSessionId: '31327301415980',
  vendor: 'SAMSUNG',
  product: 'SAMSUNG_Android',
  connectionMode: 'mtp',
  needsDeviceAccessEntitlement: true
});
assert.equal(androidUsbFallbackKey(devices), '4e8:6860@2:1');

const chargeOnlyIoreg = `
+-o AppleT8132USBXHCI@00000000  <class AppleT8132USBXHCI, id 0x1000004bf>
  +-o SAMSUNG_Android@02200000  <class IOUSBHostDevice, id 0x101f30615>
    {
      "idProduct" = 26725
      "USB Product Name" = "SAMSUNG_Android"
      "locationID" = 35651584
      "USB Vendor Name" = "SAMSUNG"
      "idVendor" = 1256
      "kUSBAddress" = 1
    }
`;
const chargeOnlyDevices = parseAndroidUsbDevicesFromIoreg(chargeOnlyIoreg);
assert.equal(chargeOnlyDevices[0].connectionMode, 'usb-only');

const nestedLiveIoreg = `
  | | +-o SAMSUNG_Android@00220000  <class IOUSBHostDevice, id 0x101f4a1d4, registered, matched, active, busy 0 (264 ms), retain 129>
  | |     {
  | |       "kUSBSerialNumberString" = "TESTMTP0002"
  | |       "locationID" = 2162688
  | |       "kUSBAddress" = 3
  | |       "kUSBSerialNumberString" = "TESTMTP0002"
  | |       "USB Vendor Name" = "SAMSUNG"
  | |       "kUSBProductString" = "SAMSUNG_Android"
  | |       "USB Product Name" = "SAMSUNG_Android"
  | |       "idVendor" = 1256
  | |       "idProduct" = 26720
  | |     }
`;

const nestedDevices = parseAndroidUsbDevicesFromIoreg(nestedLiveIoreg);
assert.equal(nestedDevices.length, 1);
assert.equal(nestedDevices[0].serial, 'TESTMTP0002');
assert.equal(nestedDevices[0].product, 'SAMSUNG_Android');
assert.equal(nestedDevices[0].connectionMode, 'mtp');
assert.equal(androidUsbFallbackKey(nestedDevices), '4e8:6860@0:3');

const samsungWrongConfigurationIoreg = `
  | +-o SAMSUNG_Android@01200000  <class IOUSBHostDevice, id 0x100004e94>
  |     {
  |       "USB Product Name" = "SAMSUNG_Android"
  |       "USB Vendor Name" = "SAMSUNG"
  |       "idVendor" = 1256
  |       "idProduct" = 26720
  |       "locationID" = 18874368
  |       "USB Address" = 2
  |       "kUSBCurrentConfiguration" = 1
  |       "kUSBPreferredConfiguration" = 2
  |     }
`;

const samsungWrongConfigurationDevices = parseAndroidUsbDevicesFromIoreg(samsungWrongConfigurationIoreg);
assert.equal(samsungWrongConfigurationDevices.length, 1);
assert.equal(samsungWrongConfigurationDevices[0].connectionMode, 'usb-only');
assert.equal(samsungWrongConfigurationDevices[0].usbCurrentConfiguration, 1);
assert.equal(samsungWrongConfigurationDevices[0].usbPreferredConfiguration, 2);

console.log('Android USB parser check passed.');
