import assert from 'node:assert/strict';
import { existsSync, lstatSync, renameSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [types, preload, app, main, localMoveSource, moveCleanup, native, styles, checklist, architecture] = await Promise.all([
  'src/shared/types.ts',
  'src/preload/index.ts',
  'src/renderer/src/App.tsx',
  'src/main/index.ts',
  'src/main/localMoveSource.ts',
  'src/shared/moveCleanup.ts',
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
assert.doesNotMatch(app, /Move works with files only|Move supports files only/, 'Folders can be moved; the files-only limit is gone.');
assert.match(
  app,
  /runMoveFolderCleanup\(\s*cleanup,\s*window\.mtp\.removeEmptyLocalFolders,\s*window\.mtp\.deletePhoneItems\s*\)[\s\S]*if \(retry\) \{\s*pendingMoveCleanups\.current\.push\(retry\);/,
  'Move cleanups that were refused or failed must go back in line for a later drain.'
);
assert.match(
  app,
  /if \(pendingMoveCleanups\.current\.length\) \{[\s\S]*?window\.setTimeout\(\(\) => setMoveCleanupRetry\(\(count\) => count \+ 1\), 5000\)[\s\S]*?\}, \[queueSummary\.cancellable, currentFolderKey, moveCleanupRetry\]\);/,
  'A retried cleanup must run again after a pause even when no further transfer drains the queue.'
);
assert.match(main, /request\.emptyFoldersOnly \? 'delete-empty-folder' : 'delete-item'/);
assert.match(
  main,
  /!request\.emptyFoldersOnly && !\(await confirmPhoneDeletion\(targets\)\)/,
  'Only emptied-folder cleanup may skip the delete dialog; the Move dialog already confirmed it.'
);
assert.match(
  native,
  /if \(require_empty\)[\s\S]*LIBMTP_Get_Children\(device, children_storage_id, object_id, &children\)[\s\S]*if \(count != 0\)[\s\S]*LIBMTP_Delete_Object/,
  'Deleting an MTP folder can delete its contents, so the phone must report it empty right before deletion.'
);
assert.match(
  native,
  /children_storage_id = metadata->storage_id != 0 \? metadata->storage_id : storage_id;[\s\S]*int count = -1;\s*if \(children_storage_id != INFERRED_STORAGE_ID\) \{\s*count = LIBMTP_Get_Children\(device, children_storage_id,/,
  'An emptied folder must be counted on its own storage; with only the inferred Samsung storage it must be kept, since a phone can answer 0 children for a storage it does not have.'
);
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
const { removeEmptyLocalFolders, removeVerifiedLocalMoveSource } = await import(pathToFileURL(compiledPath).href);
const moveCleanupPath = join(behaviorRoot, 'moveCleanup.mjs');
await writeFile(moveCleanupPath, ts.transpileModule(moveCleanup, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText);
const { runMoveFolderCleanup } = await import(pathToFileURL(moveCleanupPath).href);

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

  const emptied = join(behaviorRoot, 'emptied');
  const emptiedChild = join(emptied, 'child');
  const keptFolder = join(behaviorRoot, 'kept');
  await mkdir(emptiedChild, { recursive: true });
  await writeFile(join(emptiedChild, '.DS_Store'), '');
  await mkdir(keptFolder);
  await writeFile(join(keptFolder, 'failed-move.txt'), 'still here');
  const cleanup = removeEmptyLocalFolders([emptiedChild, emptied, keptFolder]);
  assert.deepEqual(cleanup.removedPaths, [emptiedChild, emptied], 'Emptied folders go deepest first; .DS_Store does not keep them.');
  assert.equal(cleanup.kept.length, 1, 'A folder with anything left in it must be kept.');
  assert.equal(await readFile(join(keptFolder, 'failed-move.txt'), 'utf8'), 'still here');

  // Folder Move cleanup. The fake phone deletes a folder only when nothing is left in it, like the helper.
  const ROOT = 4294967295;
  const folder = (objectId, parentId, name) => ({ objectId, storageId: 65537, parentId, name, kind: 'folder' });
  function fakePhone(parents) {
    const requests = [];
    return {
      requests,
      async deletePhoneItems(request) {
        requests.push({ ...request, targets: request.targets.map((target) => target.objectId) });
        const deletedObjectIds = [];
        const failures = [];
        for (const target of request.targets) {
          const left = [...parents.values()].filter((parentId) => parentId === target.objectId).length;
          if (left) {
            failures.push({ target, message: `It still has ${left} items.` });
          } else {
            parents.delete(target.objectId);
            deletedObjectIds.push(target.objectId);
          }
        }
        return { ok: !failures.length, message: '', deletedObjectIds, failures };
      }
    };
  }
  const notCalled = async () => assert.fail('The other side must not be called.');
  const refused = (requests) => async (request) => {
    requests.push(request.targets.length);
    return { ok: false, message: 'Another phone change is still in progress.', deletedObjectIds: [], failures: [] };
  };
  // Moved/Done/Deeper emptied; Moved/Failed still holds a file (99) whose move failed.
  const movedTree = () => new Map([[10, ROOT], [11, 10], [12, 11], [13, 10], [99, 13]]);
  const phoneCleanup = {
    side: 'phone',
    deviceIndex: 2,
    deviceConnectionId: 'connection-a',
    folders: [folder(10, ROOT, 'Moved'), folder(11, 10, 'Done'), folder(12, 11, 'Deeper'), folder(13, 10, 'Failed')].reverse()
  };

  const phone = fakePhone(movedTree());
  const phoneResult = await runMoveFolderCleanup(phoneCleanup, notCalled, phone.deletePhoneItems);
  assert.deepEqual(phone.requests, [
    { deviceIndex: 2, deviceConnectionId: 'connection-a', targets: [13, 12, 11, 10], emptyFoldersOnly: true }
  ], 'Phone folders go deepest first, through the empty-only delete, on the moved-from connection.');
  assert.deepEqual(phoneResult.deletedTargets.map((target) => target.objectId), [12, 11]);
  assert.deepEqual(
    phoneResult.kept,
    ['Failed: It still has 1 items.', 'Moved: It still has 1 items.'],
    'A folder whose move left a file is kept, and so is every folder above it.'
  );
  assert.equal(phoneResult.retry, null);

  const refusedRequests = [];
  const refusedResult = await runMoveFolderCleanup(phoneCleanup, notCalled, refused(refusedRequests));
  assert.deepEqual(refusedResult.kept, [], 'A refused cleanup tried no folder, so none may be reported kept.');
  assert.deepEqual(refusedResult.retry, phoneCleanup, 'A refused cleanup must be retried in full.');
  const retriedPhone = fakePhone(movedTree());
  const retriedResult = await runMoveFolderCleanup(refusedResult.retry, notCalled, retriedPhone.deletePhoneItems);
  assert.deepEqual(retriedResult.deletedTargets.map((target) => target.objectId), [12, 11]);
  assert.equal(retriedResult.kept.length, 2);

  const thrownResult = await runMoveFolderCleanup(phoneCleanup, notCalled, async () => {
    throw new Error('IPC failed');
  });
  assert.deepEqual(thrownResult, { removedPaths: [], deletedTargets: [], kept: [], retry: phoneCleanup }, 'A failed call must be retried, not lost.');

  const manyFolders = Array.from({ length: 1001 }, (_, index) => folder(1000 + index, ROOT, `Empty ${index}`));
  const manyCleanup = { ...phoneCleanup, folders: manyFolders };
  const batched = fakePhone(new Map(manyFolders.map((target) => [target.objectId, ROOT])));
  const batchedResult = await runMoveFolderCleanup(manyCleanup, notCalled, batched.deletePhoneItems);
  assert.deepEqual(batched.requests.map((request) => request.targets.length), [1000, 1], 'Phone deletes go in batches of 1000.');
  assert.equal(batchedResult.deletedTargets.length, 1001);

  const partlyRefused = fakePhone(new Map(manyFolders.map((target) => [target.objectId, ROOT])));
  let firstBatch = true;
  const partlyRefusedResult = await runMoveFolderCleanup(manyCleanup, notCalled, async (request) => {
    if (firstBatch) {
      firstBatch = false;
      return partlyRefused.deletePhoneItems(request);
    }
    return refused([])(request);
  });
  assert.equal(partlyRefusedResult.deletedTargets.length, 1000);
  assert.deepEqual(partlyRefusedResult.retry, { ...manyCleanup, folders: manyFolders.slice(1000) }, 'Only the refused batch and later ones are retried.');
  const firstRefusedRequests = [];
  await runMoveFolderCleanup(manyCleanup, notCalled, refused(firstRefusedRequests));
  assert.deepEqual(firstRefusedRequests, [1000], 'After a refusal no shallower batch may be tried before its children.');

  const macMoved = join(behaviorRoot, 'mac-moved');
  const macDone = join(macMoved, 'done');
  const macFailed = join(macMoved, 'failed');
  await mkdir(macDone, { recursive: true });
  await mkdir(macFailed);
  await writeFile(join(macFailed, 'kept.txt'), 'move failed');
  const macCleanup = { side: 'mac', folders: [macFailed, macDone, macMoved] };
  const macResult = await runMoveFolderCleanup(macCleanup, async (paths) => removeEmptyLocalFolders(paths), notCalled);
  assert.deepEqual(macResult.removedPaths, [macDone]);
  assert.deepEqual(macResult.kept, [
    'failed: It still has 1 item, so it was kept.',
    'mac-moved: It still has 1 item, so it was kept.'
  ]);
  assert.equal(macResult.retry, null);
  const macThrown = await runMoveFolderCleanup(macCleanup, async () => {
    throw new Error('IPC failed');
  }, notCalled);
  assert.deepEqual(macThrown.retry, macCleanup, 'A failed Mac cleanup call must be retried, not lost.');
  assert.deepEqual(macThrown.kept, []);
} finally {
  await rm(behaviorRoot, { recursive: true, force: true });
}

console.log('Verified file Move and readable path layout contract check passed.');
