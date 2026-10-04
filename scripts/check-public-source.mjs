import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ignoredDirectories = new Set([
  '.git', '.tmp', '.cache', '.native-deps', 'node_modules', 'out', 'release', 'resources',
  'openmtp-upstream', 'android-file-transfer-linux', 'aft-build', 'transfer-test', 'graphify-out'
]);
const forbiddenPatterns = [
  /Mac Android Transfer/i,
  /macAndroidTransfer/,
  /dev\.macandroidtransfer/,
  /\bR[0-9A-Z]{10}\b/,
  /\b(?=[A-Z0-9]{14}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{14}\b/,
  /\b(?:photo_)?20\d{6}[_-]\d{6}\b/i,
  /\/Users\/t\//,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[opsu]_[A-Za-z0-9_]{20,}\b/
];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    const name = relative(root, path);
    if (
      entry.isDirectory() &&
      (ignoredDirectories.has(entry.name) || name === 'src/native/file-promise-drag/build')
    ) return [];
    if (entry.isDirectory()) return walk(path);
    if (entry.isSymbolicLink()) return [];
    return [path];
  });
}

for (const path of walk(root)) {
  const name = relative(root, path);
  if (name === 'scripts/check-public-source.mjs') continue;
  const size = statSync(path).size;
  assert.ok(size <= 10 * 1024 * 1024, `${name} is larger than the 10 MiB public-source limit`);
  if (/\.(?:icns|png|jpg|jpeg|gif|webp)$/i.test(name)) continue;
  const contents = readFileSync(path, 'utf8');
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(contents, pattern, `${name} contains private, generated, or obsolete release data`);
  }
}

console.log('Public source privacy and size checks passed.');
