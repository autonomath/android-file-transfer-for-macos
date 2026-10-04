#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const [mode, directoryArg, version] = process.argv.slice(2);
assert.ok(mode === 'write' || mode === 'verify', 'Usage: write-update-manifest.mjs write|verify ASSET_DIRECTORY VERSION');
assert.ok(directoryArg, 'Missing asset directory');
assert.match(version ?? '', /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, 'Invalid release version');

const directory = resolve(directoryArg);
const manifestPath = join(directory, 'latest-mac.yml');
const entries = [];

for (const arch of ['arm64', 'x64']) {
  const url = `Android-File-Transfer-for-macOS-${version}-${arch}.zip`;
  const path = join(directory, url);
  const metadata = await stat(path);
  assert.ok(metadata.isFile() && metadata.size > 0, `Missing or empty update ZIP: ${path}`);

  const hash = createHash('sha512');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  entries.push({ url, sha512: hash.digest('base64'), size: metadata.size });
}

// Modern electron-updater reads the files array and selects a ZIP by the
// architecture in its URL. Legacy path/sha512 fields name only one file and
// would be misleading for a two-architecture release.
const content = [
  `version: ${version}`,
  'files:',
  ...entries.flatMap(({ url, sha512, size }) => [
    `  - url: ${url}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`
  ]),
  ''
].join('\n');

if (mode === 'write') {
  await writeFile(manifestPath, content, { flag: 'w' });
  console.log(`Wrote two-architecture update manifest: ${manifestPath}`);
} else {
  assert.equal(await readFile(manifestPath, 'utf8'), content, 'Update manifest does not match the release ZIPs');
  console.log(`Verified update manifest and both ZIP hashes: ${manifestPath}`);
}
