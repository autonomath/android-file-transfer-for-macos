import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const { parseUpdateInfo, resolveFiles } = createRequire(import.meta.url)('electron-updater/out/providers/Provider.js');

const script = resolve('scripts/write-update-manifest.mjs');
const directory = await mkdtemp(join(tmpdir(), 'android-update-manifest-test-'));
const version = '0.2.0';

function run(mode, expectedStatus) {
  const result = spawnSync(process.execPath, [script, mode, directory, version], { encoding: 'utf8' });
  assert.equal(result.status === 0, expectedStatus === 0, result.stderr || result.stdout);
}

try {
  const arm = join(directory, `Android-File-Transfer-for-macOS-${version}-arm64.zip`);
  const intel = join(directory, `Android-File-Transfer-for-macOS-${version}-x64.zip`);
  await writeFile(arm, 'arm64 app payload');
  await writeFile(intel, 'x64 app payload');
  run('write', 0);
  run('verify', 0);
  const manifest = await readFile(join(directory, 'latest-mac.yml'), 'utf8');
  const update = parseUpdateInfo(manifest, 'latest-mac.yml', 'https://example.com/latest-mac.yml');
  assert.equal(update.version, version);
  assert.deepEqual(
    resolveFiles(update, new URL('https://example.com/')).map((file) => file.info.url),
    [
      `Android-File-Transfer-for-macOS-${version}-arm64.zip`,
      `Android-File-Transfer-for-macOS-${version}-x64.zip`
    ]
  );
  assert.ok(update.files.every((file) => file.sha512 && file.size > 0));

  await writeFile(intel, 'altered x64 app payload');
  run('verify', 1);
  await rm(intel);
  run('verify', 1);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Update manifest write, verification, tamper, and missing-ZIP checks passed.');
