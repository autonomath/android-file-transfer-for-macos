import assert from 'node:assert/strict';
import { existsSync, lstatSync, renameSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [types, preload, app, main, localMoveSource, native, styles, checklist, architecture] = await Promise.all([
  'src/shared/types.ts',
  'src/preload/index.ts',
  'src/renderer/src/App.tsx',
  'src/main/index.ts',
  'src/main/localMoveSource.ts',
  'src/native/mtp-json.c',
  'src/renderer/src/styles.css',
  'docs/manual-test-checklist.md',
  'docs/architecture.md'
].map((path) => readFile(resolve(root, path), 'utf8')));

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing CSS block for ${selector}.`);
  return match[1];
}

assert.match(types, /export type TransferOperation = 'copy' \| 'move'/);
assert.match(types, /sourceRemovalStatus\?: SourceRemovalStatus/);
assert.match(types, /sourceIdentity\?: LocalSourceIdentity/);
assert.match(preload, /startMoveDownloads/);
assert.match(preload, /startMoveUploads/);

assert.match(app, /phoneTransferOperation/);
assert.match(app, /macTransferOperation/);
assert.match(app, /className="phone-path-bar"/);
assert.match(app, /<ArrowRight[\s\S]*<Folder[\s\S]*macDestinationLabel/);
assert.match(app, /phoneDestinationLabel[\s\S]*<ArrowLeft/);
assert.match(app, /Move works with files only\. Choose Copy for folders\./);
assert.match(app, /startMoveDownloads\(plan\.requests\)/);
assert.match(app, /startMoveUploads\(requests\)/);

assert.match(main, /function enqueueDownloads\([\s\S]*operation: TransferOperation = 'copy'/);
assert.match(main, /function enqueueUploads\([\s\S]*operation: TransferOperation = 'copy'/);
assert.match(main, /confirmFileMove/);
assert.match(main, /buttons: \['Move Files', 'Cancel'\]/);
assert.match(main, /defaultId: 1/);
assert.match(localMoveSource, /current\.dev === identity\.device/);
assert.match(localMoveSource, /current\.ino === identity\.inode/);
assert.match(localMoveSource, /current\.mtimeMs === identity\.modifiedMs/);
assert.match(localMoveSource, /current\.ctimeMs === identity\.changedMs/);
assert.match(main, /transferResult\.verified !== true[\s\S]*source file is kept|transferResult\.verified !== true/);
assert.match(localMoveSource, /renameSync\(sourcePath, quarantinePath\)/);
assert.match(localMoveSource, /matchesStableIdentity/);
assert.match(localMoveSource, /unlinkSync\(quarantinePath\)/);
assert.match(main, /removeVerifiedLocalMoveSource\(job\.sourcePath, job\.sourceIdentity\)/);
assert.match(
  main,
  /finalizeDownloadedFile\(job\);[\s\S]*job\.operation === 'move'[\s\S]*removeMoveSource/,
  'A phone source must be removed only after the atomic Mac destination is published.'
);
assert.match(main, /job\.sourceRemovalStatus = 'kept'/);
const removeMoveSourceBlock = main.match(
  /async function removeMoveSource\([\s\S]*?(?=\nasync function runTransferJob)/
)?.[0];
assert.ok(removeMoveSourceBlock, 'Move source cleanup implementation must remain present.');
assert.match(removeMoveSourceBlock, /phoneFileMutationTarget\(job, job\.objectId, job\.name, job\.modified\)/);
assert.match(removeMoveSourceBlock, /runTransferPhoneMutation\([\s\S]*'delete-item'[\s\S]*sourceTarget/);
assert.doesNotMatch(
  removeMoveSourceBlock,
  /runSessionCommand[\s\S]*['"]delete['"]/,
  'Move-to-Mac cleanup must never use the legacy object-id-only delete command.'
);
assert.doesNotMatch(native, /static void session_delete\(/, 'The legacy object-id-only delete function must not exist.');
assert.doesNotMatch(native, /strcmp\(command, "delete"\)/, 'The legacy object-id-only delete command must not exist.');
assert.match(main, /queueDownloads\(requests, 'move'\)/);
assert.match(main, /queueUploads\(requests, 'move'\)/);

const retryTransferBlock = main.match(
  /function retryTransfer\(jobId: string\): TransferJob \| null \{[\s\S]*?(?=\nfunction cancelTransfer)/
)?.[0];
assert.ok(retryTransferBlock, 'Transfer retry implementation must remain present.');
assert.match(
  retryTransferBlock,
  /job\.collisionAction = destination\.renamedDestination \? 'keep-both' : undefined;/
);
assert.match(
  retryTransferBlock,
  /job\.destinationIdentity = undefined;/,
  'A Mac Replace retry must discard the stale destination identity after choosing a new path.'
);

assert.match(native, /verified_phone_mutation_target[\s\S]*LIBMTP_Get_Filemetadata/);
assert.match(native, /metadata->filesize == expected_size/);
assert.match(native, /metadata->modificationdate[\s\S]*expected_modified/);
assert.match(native, /strcmp\(command, "rename-item"\).*strcmp\(command, "delete-item"\)/s);

const phoneBreadcrumbs = cssBlock('.breadcrumbs');
const localBreadcrumbs = cssBlock('.local-breadcrumbs');
assert.match(phoneBreadcrumbs, /overflow-x:\s*auto/);
assert.match(cssBlock('.phone-path-bar'), /display:\s*flex/);
assert.match(localBreadcrumbs, /overflow-x:\s*auto/);
assert.doesNotMatch(cssBlock('.breadcrumbs button'), /text-overflow:\s*ellipsis/);
assert.doesNotMatch(cssBlock('.local-breadcrumbs button'), /text-overflow:\s*ellipsis/);
assert.doesNotMatch(styles, /\.auto-check-status/, 'Removed persistent auto-check UI must not leave dead styles.');

assert.match(checklist, /Move/);
assert.match(architecture, /[Vv]erified file Move/);

const compiled = ts.transpileModule(localMoveSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022
  }
}).outputText;
const behaviorRoot = await mkdtemp(join(tmpdir(), 'android-file-transfer-for-macos-move-check-'));
const compiledPath = join(behaviorRoot, 'localMoveSource.mjs');
await writeFile(compiledPath, compiled);
const { removeVerifiedLocalMoveSource } = await import(pathToFileURL(compiledPath).href);

function identityFor(path) {
  const stat = lstatSync(path);
  return {
    device: stat.dev,
    inode: stat.ino,
    size: stat.size,
    modifiedMs: stat.mtimeMs,
    changedMs: stat.ctimeMs
  };
}

try {
  const removable = join(behaviorRoot, 'remove-me.txt');
  await writeFile(removable, 'verified contents');
  removeVerifiedLocalMoveSource(removable, identityFor(removable));
  assert.equal(existsSync(removable), false, 'An unchanged verified source should be removed.');
  assert.deepEqual(
    (await readdir(behaviorRoot)).filter((name) => name.startsWith('.android-file-transfer-for-macos-move-')),
    [],
    'Successful source removal must not leave a quarantine file.'
  );

  const changed = join(behaviorRoot, 'changed.txt');
  await writeFile(changed, 'first');
  const changedIdentity = identityFor(changed);
  await writeFile(changed, 'different contents');
  assert.throws(
    () => removeVerifiedLocalMoveSource(changed, changedIdentity),
    /changed while it was copying/,
    'A changed source must be kept.'
  );
  assert.equal(existsSync(changed), true, 'A changed source must remain at its original path.');

  const replaced = join(behaviorRoot, 'replaced.txt');
  const replacedOld = join(behaviorRoot, 'replaced-old.txt');
  await writeFile(replaced, 'original');
  const replacedIdentity = identityFor(replaced);
  renameSync(replaced, replacedOld);
  await writeFile(replaced, 'replacement');
  assert.throws(
    () => removeVerifiedLocalMoveSource(replaced, replacedIdentity),
    /changed while it was copying/,
    'A replacement at the same path must not be deleted.'
  );
  assert.equal(await readFile(replaced, 'utf8'), 'replacement');
} finally {
  await rm(behaviorRoot, { recursive: true, force: true });
}

console.log('Verified file Move and readable path layout contract check passed.');
