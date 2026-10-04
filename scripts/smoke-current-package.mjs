import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arch = process.arch;
if (arch !== 'arm64' && arch !== 'x64') {
  throw new Error(`Unsupported packaging host architecture: ${arch}`);
}

const product = 'Android File Transfer for macOS.app';
const outputDirectories = arch === 'arm64' ? ['mac-arm64'] : ['mac', 'mac-x64'];
const releaseRoot = resolve(root, 'release');
const markerPath = resolve(releaseRoot, `.package-mac-${arch}.json`);
const appCandidates = outputDirectories.map((directory) =>
  resolve(releaseRoot, directory, product)
);

if (process.argv[2] === '--prepare') {
  mkdirSync(releaseRoot, { recursive: true });
  for (const directory of outputDirectories) {
    rmSync(resolve(releaseRoot, directory), { recursive: true, force: true });
  }
  writeFileSync(markerPath, `${JSON.stringify({ arch, preparedAt: new Date().toISOString() })}\n`);
  console.log(`Prepared clean ${arch} package output under ${releaseRoot}`);
  process.exit(0);
}

if (process.argv.length > 2) {
  throw new Error('Usage: smoke-current-package.mjs [--prepare]');
}
if (!existsSync(markerPath)) {
  throw new Error(
    `No current ${arch} package marker found. Run this script with --prepare immediately before electron-builder.`
  );
}

const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
if (marker.arch !== arch) {
  throw new Error(`Package marker architecture mismatch: expected ${arch}, found ${marker.arch}.`);
}

const currentApps = appCandidates.filter((candidate) => existsSync(candidate));
if (currentApps.length !== 1) {
  throw new Error(
    `Expected exactly one newly packaged ${arch} app under release/${outputDirectories.join(' or release/')}; found ${currentApps.length}.`
  );
}
const [appPath] = currentApps;

const executable = resolve(appPath, 'Contents', 'MacOS', 'Android File Transfer for macOS');
const fileResult = spawnSync('file', [executable], { encoding: 'utf8' });
if (fileResult.status !== 0) {
  throw new Error(fileResult.stderr || `Could not inspect ${executable}.`);
}
const expectedArchitecture = arch === 'arm64' ? 'arm64' : 'x86_64';
if (!fileResult.stdout.includes(expectedArchitecture)) {
  throw new Error(`Packaged app architecture mismatch: expected ${expectedArchitecture}; ${fileResult.stdout.trim()}`);
}

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const minimumSystemVersion = packageJson.build?.mac?.minimumSystemVersion;
if (!minimumSystemVersion) {
  throw new Error('package.json must declare build.mac.minimumSystemVersion.');
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

try {
  run(process.execPath, [
    resolve(root, 'scripts/check-macho.mjs'),
    '--root',
    appPath,
    '--arch',
    arch,
    '--max-macos',
    minimumSystemVersion
  ]);
  run('bash', [resolve(root, 'scripts/smoke-packaged-app.sh'), appPath, arch]);
} finally {
  rmSync(markerPath, { force: true });
}
