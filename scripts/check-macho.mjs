import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const archIndex = args.indexOf('--arch');
const maxIndex = args.indexOf('--max-macos');
const allowBuildPaths = args.includes('--allow-build-paths');
assert.ok(rootIndex >= 0 && args[rootIndex + 1], 'Usage: check-macho.mjs --root PATH --arch arm64|x64 [--max-macos 13.0]');

const root = resolve(args[rootIndex + 1]);
assert.ok(existsSync(root), `Mach-O validation root does not exist: ${root}`);
const requestedArch = archIndex >= 0 ? args[archIndex + 1] : process.arch;
assert.ok(
  requestedArch === 'arm64' || requestedArch === 'x64' || requestedArch === 'x86_64',
  `Unsupported Mach-O architecture: ${requestedArch}`
);
const expectedArch = requestedArch === 'x64' ? 'x86_64' : requestedArch;
const maximumMacOS = maxIndex >= 0 ? args[maxIndex + 1] : '13.0';
assert.match(maximumMacOS, /^\d+(?:\.\d+){0,2}$/, `Invalid maximum macOS version: ${maximumMacOS}`);

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || `${command} failed`);
  return result.stdout.trim();
}

function versionParts(value) {
  return value.split('.').map((part) => Number(part));
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function walk(path) {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return [];
  if (!stat.isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    return walk(resolve(path, entry.name));
  });
}

const machOFiles = walk(root).filter((path) => {
  const result = spawnSync('file', ['-b', path], { encoding: 'utf8' });
  return result.status === 0 && /Mach-O/.test(result.stdout);
});

assert.ok(machOFiles.length > 0, `No Mach-O files found under ${root}`);

for (const path of machOFiles) {
  const architectures = run('lipo', ['-archs', path]).split(/\s+/);
  assert.ok(
    architectures.includes(expectedArch),
    `${path} does not contain expected architecture ${expectedArch}: ${architectures.join(', ')}`
  );

  // Electron helper names contain parenthesized role names such as "(GPU)".
  // Without -m, otool parses those paths as archive(member) syntax.
  const loadCommands = run('otool', ['-m', '-l', path]);
  const minimumVersions = [
    ...loadCommands.matchAll(/\bminos\s+([0-9.]+)/g),
    ...loadCommands.matchAll(/\bversion\s+([0-9.]+)\n\s+sdk/g)
  ].map((match) => match[1]);
  assert.ok(minimumVersions.length > 0, `${path} does not declare a macOS deployment target`);

  for (const minimumVersion of minimumVersions) {
    assert.ok(
      compareVersions(minimumVersion, maximumMacOS) <= 0,
      `${path} requires macOS ${minimumVersion}, newer than declared ${maximumMacOS}`
    );
  }

  if (!allowBuildPaths) {
    const links = run('otool', ['-m', '-L', path]);
    assert.doesNotMatch(links, /\/opt\/homebrew|\/usr\/local|\.native-deps/, `${path} has a non-portable runtime dependency`);
  }
}

console.log(`Verified ${machOFiles.length} Mach-O files for ${expectedArch} and macOS ${maximumMacOS}+ compatibility.`);
