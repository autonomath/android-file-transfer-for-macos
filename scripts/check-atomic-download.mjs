import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'src/main/atomicDownload.ts');
const outDir = resolve(root, '.tmp');
const outPath = resolve(outDir, 'atomic-download-check.mjs');
const source = await readFile(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
await mkdir(outDir, { recursive: true });
await writeFile(outPath, compiled, 'utf8');
const { fileIdentitySnapshot, publishTemporaryFile, replaceTemporaryFile } = await import(
  `${pathToFileURL(outPath).href}?t=${Date.now()}`
);

let exchangeIndex = 0;
function exchangePathsForCheck(leftPath, rightPath) {
  const scratchPath = `${leftPath}.exchange-${exchangeIndex++}`;
  renameSync(leftPath, scratchPath);
  renameSync(rightPath, leftPath);
  renameSync(scratchPath, rightPath);
}

function replaceForCheck(options) {
  return replaceTemporaryFile({ ...options, exchangePaths: exchangePathsForCheck });
}

function expectReplaceFailureWithTransferCleanup(options, pattern) {
  let failure;
  try {
    replaceForCheck(options);
  } catch (error) {
    failure = error;
  } finally {
    rmSync(options.temporaryPath, { force: true });
  }
  assert.ok(failure instanceof Error, 'Replacement must fail.');
  assert.match(failure.message, pattern);
  assert.doesNotMatch(failure.message, /partial.*kept/i);
}

const directory = await mkdtemp(join(tmpdir(), 'android-file-transfer-for-macos-atomic-check-'));
try {
  const firstPartial = join(directory, 'first.partial');
  const firstFinal = join(directory, 'first.txt');
  await writeFile(firstPartial, 'complete');
  const first = publishTemporaryFile({
    temporaryPath: firstPartial,
    destinationPath: firstFinal,
    expectedSize: 8
  });
  assert.equal(first.destinationPath, firstFinal);
  assert.equal(await readFile(firstFinal, 'utf8'), 'complete');
  assert.equal(existsSync(firstPartial), false);

  const collisionPartial = join(directory, 'collision.partial');
  const occupied = join(directory, 'occupied.txt');
  const renamed = join(directory, 'occupied 2.txt');
  await writeFile(collisionPartial, 'new bytes');
  await writeFile(occupied, 'old bytes');
  const collision = publishTemporaryFile({
    temporaryPath: collisionPartial,
    destinationPath: occupied,
    expectedSize: 9,
    onCollision: () => renamed
  });
  assert.equal(collision.destinationPath, renamed);
  assert.equal(await readFile(occupied, 'utf8'), 'old bytes');
  assert.equal(await readFile(renamed, 'utf8'), 'new bytes');

  const replacePartial = join(directory, 'replace.partial');
  const replaceFinal = join(directory, 'replace.txt');
  await writeFile(replacePartial, 'replacement');
  await writeFile(replaceFinal, 'original');
  const replaceIdentity = fileIdentitySnapshot(replaceFinal);
  replaceForCheck({
    temporaryPath: replacePartial,
    destinationPath: replaceFinal,
    expectedSize: 11,
    expectedExisting: replaceIdentity
  });
  assert.equal(await readFile(replaceFinal, 'utf8'), 'replacement');
  assert.equal(existsSync(replacePartial), false);

  const changedPartial = join(directory, 'changed.partial');
  const changedFinal = join(directory, 'changed.txt');
  await writeFile(changedPartial, 'incoming');
  await writeFile(changedFinal, 'old');
  const changedIdentity = fileIdentitySnapshot(changedFinal);
  await writeFile(changedFinal, 'changed after prompt');
  expectReplaceFailureWithTransferCleanup(
    {
      temporaryPath: changedPartial,
      destinationPath: changedFinal,
      expectedSize: 8,
      expectedExisting: changedIdentity
    },
    /changed while/
  );
  assert.equal(await readFile(changedFinal, 'utf8'), 'changed after prompt');
  assert.equal(existsSync(changedPartial), false);

  const insertedPartial = join(directory, 'inserted.partial');
  const insertedFinal = join(directory, 'inserted.txt');
  const insertedApproved = join(directory, 'inserted-approved.txt');
  await writeFile(insertedPartial, 'incoming insertion');
  await writeFile(insertedFinal, 'approved insertion');
  const insertedIdentity = fileIdentitySnapshot(insertedFinal);
  expectReplaceFailureWithTransferCleanup(
    {
      temporaryPath: insertedPartial,
      destinationPath: insertedFinal,
      expectedSize: 18,
      expectedExisting: insertedIdentity,
      beforeExchange: () => {
        renameSync(insertedFinal, insertedApproved);
        writeFileSync(insertedFinal, 'concurrent insertion');
      }
    },
    /changed while/
  );
  assert.equal(await readFile(insertedFinal, 'utf8'), 'concurrent insertion');
  assert.equal(existsSync(insertedPartial), false);
  assert.equal(await readFile(insertedApproved, 'utf8'), 'approved insertion');

  const swappedPartial = join(directory, 'swapped.partial');
  const swappedFinal = join(directory, 'swapped.txt');
  const swappedApproved = join(directory, 'swapped-approved.txt');
  await writeFile(swappedPartial, 'incoming path swap');
  await writeFile(swappedFinal, 'approved path swap');
  const swappedIdentity = fileIdentitySnapshot(swappedFinal);
  expectReplaceFailureWithTransferCleanup(
    {
      temporaryPath: swappedPartial,
      destinationPath: swappedFinal,
      expectedSize: 18,
      expectedExisting: swappedIdentity,
      beforeExchange: () => {
        renameSync(swappedFinal, swappedApproved);
        symlinkSync(swappedApproved, swappedFinal);
      }
    },
    /changed while/
  );
  assert.equal(lstatSync(swappedFinal).isSymbolicLink(), true);
  assert.equal(readlinkSync(swappedFinal), swappedApproved);
  assert.equal(existsSync(swappedPartial), false);
  assert.equal(await readFile(swappedApproved, 'utf8'), 'approved path swap');

  const shortPartial = join(directory, 'short.partial');
  const shortFinal = join(directory, 'short.txt');
  await writeFile(shortPartial, 'short');
  assert.throws(
    () => publishTemporaryFile({ temporaryPath: shortPartial, destinationPath: shortFinal, expectedSize: 10 }),
    /10 bytes were expected/
  );
  assert.equal(existsSync(shortFinal), false);

  const symlinkPartial = join(directory, 'link.partial');
  await symlink(firstFinal, symlinkPartial);
  assert.throws(
    () => publishTemporaryFile({ temporaryPath: symlinkPartial, destinationPath: join(directory, 'link.txt'), expectedSize: 8 }),
    /not a regular file/
  );

  const cachedPartial = join(directory, 'cached.partial');
  const cachedFinal = join(directory, 'cached.txt');
  await writeFile(cachedPartial, 'same');
  await writeFile(cachedFinal, 'same');
  const cached = publishTemporaryFile({
    temporaryPath: cachedPartial,
    destinationPath: cachedFinal,
    expectedSize: 4,
    allowExistingEquivalent: true
  });
  assert.equal(cached.usedExisting, true);
  assert.equal(existsSync(cachedPartial), false);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Atomic download behavior check passed.');
