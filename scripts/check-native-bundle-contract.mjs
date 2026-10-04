import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const helperPath = resolve(root, 'resources/bin/mtp-json');
const filePromiseAddonPath = resolve(root, 'resources/bin/file-promise-drag.node');
const libmtpPath = resolve(root, 'resources/lib/libmtp.9.dylib');
const libusbPath = resolve(root, 'resources/lib/libusb-1.0.0.dylib');

function otool(path) {
  const result = spawnSync('otool', ['-L', path], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || `otool failed for ${path}`);
  return result.stdout;
}

function verifyCodeSignature(path) {
  const result = spawnSync('codesign', ['--verify', '--verbose=2', path], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || `codesign failed for ${path}`);
}

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const packageMacScript = packageJson.scripts?.['package:mac'] ?? '';
const extraResources = packageJson.build?.extraResources ?? [];
const nativeHelperSource = readFileSync(resolve(root, 'src/native/mtp-json.c'), 'utf8');
const buildScript = readFileSync(resolve(root, 'scripts/build-native.mjs'), 'utf8');
const mainSource = readFileSync(resolve(root, 'src/main/index.ts'), 'utf8');
const packagedSmokeScript = readFileSync(resolve(root, 'scripts/smoke-packaged-app.sh'), 'utf8');
const currentPackageSmokeScript = readFileSync(resolve(root, 'scripts/smoke-current-package.mjs'), 'utf8');

assert.ok(existsSync(helperPath), 'Native helper must exist.');
assert.ok(existsSync(filePromiseAddonPath), 'Native AppKit file-promise addon must exist.');
assert.ok(existsSync(libmtpPath), 'Bundled libmtp dylib must exist.');
assert.ok(existsSync(libusbPath), 'Bundled libusb dylib must exist.');
assert.ok(
  extraResources.some((entry) => entry.from === 'resources/lib' && entry.to === 'lib'),
  'macOS package must include bundled native libraries.'
);
assert.ok(
  extraResources.some((entry) => entry.from === 'resources/bin' && entry.to === 'bin'),
  'macOS package must include the native helper and file-promise addon.'
);

const helperLinks = otool(helperPath);
const libmtpLinks = otool(libmtpPath);
const libusbLinks = otool(libusbPath);
const filePromiseLinks = otool(filePromiseAddonPath);
const combinedLinks = `${helperLinks}\n${libmtpLinks}\n${libusbLinks}`;

assert.doesNotMatch(
  combinedLinks,
  /\/opt\/homebrew/,
  'Packaged native helper must not depend on Homebrew runtime library paths.'
);
assert.match(
  helperLinks,
  /@loader_path\/\.\.\/lib\/libmtp\.9\.dylib/,
  'Native helper must load bundled libmtp relative to its bin directory.'
);
assert.match(filePromiseLinks, /AppKit\.framework/, 'File-promise addon must link AppKit.');
assert.match(buildScript, /file-promise-drag\.node/, 'Native build must package the file-promise addon.');
assert.match(
  buildScript,
  /NATIVE_BUILD_FOR_PACKAGE[\s\S]*\.native-deps[\s\S]*targetArch[\s\S]*check-macho\.mjs[\s\S]*allow-build-paths/,
  'Packaging builds must select the repository architecture-scoped native dependencies.'
);
assert.match(
  buildScript,
  /PKG_CONFIG_LIBDIR/,
  'Packaging builds must isolate pkg-config from ambient Homebrew metadata.'
);
assert.match(
  packageMacScript,
  /MACOSX_DEPLOYMENT_TARGET=13\.0 NATIVE_BUILD_FOR_PACKAGE=1 npm run build[\s\S]*smoke-current-package\.mjs --prepare[\s\S]*electron-builder[\s\S]*smoke-current-package\.mjs$/,
  'Local macOS packaging must pin the declared deployment target, use prepared native dependencies, and bracket electron-builder with package smoke preparation and validation.'
);
assert.match(mainSource, /--file-promise-smoke/, 'The packaged app must expose a native addon load smoke mode.');
assert.match(
  packagedSmokeScript,
  /--file-promise-smoke[\s\S]*PACKAGED_FILE_PROMISE_DRAG_OK/,
  'The packaged smoke test must load the addon inside the signed Electron host.'
);
assert.match(currentPackageSmokeScript, /arch === 'arm64'.*\['mac-arm64'\].*\['mac', 'mac-x64'\]/s, 'Local package smoke must resolve both Apple Silicon and Intel outputs.');
assert.match(currentPackageSmokeScript, /expectedArchitecture.*x86_64/s, 'Local package smoke must reject a wrong Intel executable architecture.');
assert.match(
  currentPackageSmokeScript,
  /--prepare[\s\S]*rmSync[\s\S]*recursive: true[\s\S]*markerPath/,
  'Local package smoke must clear current-architecture unpacked outputs and write a run marker before packaging.'
);
assert.match(
  currentPackageSmokeScript,
  /check-macho\.mjs[\s\S]*--root[\s\S]*appPath[\s\S]*--max-macos[\s\S]*minimumSystemVersion/,
  'Local package smoke must validate Mach-O deployment targets in the exact app produced by the current packaging run.'
);
assert.match(
  helperLinks,
  /@loader_path\/\.\.\/lib\/libusb-1\.0\.0\.dylib/,
  'Native helper must load bundled libusb relative to its bin directory.'
);
assert.match(
  libmtpLinks,
  /@loader_path\/libusb-1\.0\.0\.dylib/,
  'Bundled libmtp must load bundled libusb from the same directory.'
);
assert.match(
  helperLinks,
  /CoreFoundation\.framework/,
  'Native helper must link CoreFoundation for the macOS IOKit fallback.'
);

assert.match(
  nativeHelperSource,
  /IOServiceMatching\("IOUSBHostDevice"\)/,
  'Native helper status must use IOKit to see Android USB devices that libmtp/libusb miss.'
);
assert.match(
  nativeHelperSource,
  /emit_iokit_android_usb_fallback_status\(\)[\s\S]*emit_libusb_android_usb_fallback_status\(\)/,
  'Native helper status must try IOKit before falling back to libusb-only USB detection.'
);
assert.match(
  buildScript,
  /'-framework',\s*'CoreFoundation'/,
  'Native build must explicitly link CoreFoundation for IOKit property reads.'
);

verifyCodeSignature(helperPath);
verifyCodeSignature(filePromiseAddonPath);
verifyCodeSignature(libmtpPath);
verifyCodeSignature(libusbPath);

console.log('Native bundle contract check passed.');
