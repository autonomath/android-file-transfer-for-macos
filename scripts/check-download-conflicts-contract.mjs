import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [types, main, atomicDownload, nativeAddon, app, styles, readme, checklist, architecture] = await Promise.all([
  readProjectFile('src/shared/types.ts'),
  readProjectFile('src/main/index.ts'),
  readProjectFile('src/main/atomicDownload.ts'),
  readProjectFile('src/native/file-promise-drag/file_promise_drag.mm'),
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('src/renderer/src/styles.css'),
  readProjectFile('README.md'),
  readProjectFile('docs/manual-test-checklist.md'),
  readProjectFile('docs/architecture.md')
]);

assert.match(types, /originalDestinationPath\?: string;/, 'Transfer jobs must expose the originally requested Mac path.');
assert.match(types, /renamedDestination\?: boolean;/, 'Transfer jobs must expose whether a Mac download was renamed.');
assert.match(types, /temporaryPath\?: string;/, 'Mac downloads must track a non-final partial path.');
assert.match(types, /TransferCollisionAction = 'none' \| 'keep-both' \| 'replace' \| 'skip' \| 'cancel'/, 'Collision choices must be explicit in the IPC contract.');

assert.match(main, /function downloadDestinationPlan/, 'Main process must build a download destination plan.');
assert.match(main, /originalDestinationPath = join\(directory, sanitizeFileName\(name\)\)/, 'Download planning must preserve the originally requested Mac path.');
assert.match(main, /renamedDestination: destinationPath !== originalDestinationPath/, 'Download planning must detect conflict renames.');
assert.match(
  main,
  /function enqueueDownloads[\s\S]*destinationPath: destination\.destinationPath[\s\S]*originalDestinationPath: destination\.originalDestinationPath[\s\S]*renamedDestination: destination\.renamedDestination/,
  'Queued downloads must include destination rename metadata.'
);
assert.match(main, /publishTemporaryFile\(/, 'Completed downloads must use the atomic publication helper.');
assert.match(atomicDownload, /linkSync\(options\.temporaryPath, destinationPath\)/, 'Publication must atomically link a complete same-volume file.');
assert.match(atomicDownload, /nodeError\.code !== 'EEXIST'/, 'A late destination collision must never turn into overwrite.');
assert.match(atomicDownload, /function replaceTemporaryFile/, 'Explicit Mac replacement must have a separate atomic publication path.');
assert.match(atomicDownload, /identitiesMatch\(currentExisting, options\.expectedExisting\)/, 'Mac replacement must reject a destination that changed during transfer.');
assert.match(atomicDownload, /loadAtomicExchangeAddon/, 'Mac replacement must load the packaged native addon.');
assert.doesNotMatch(atomicDownload, /\/usr\/bin\/ruby|Fiddle|spawnSync/, 'Mac replacement must not depend on a system interpreter.');
assert.match(nativeAddon, /renamex_np\(leftPath\.c_str\(\), rightPath\.c_str\(\), RENAME_SWAP\)/, 'The native addon must use the macOS atomic rename-exchange primitive.');
assert.match(nativeAddon, /exports\.Set\("atomicExchangePaths"/, 'The native addon must export atomic path exchange to Node.');
assert.match(atomicDownload, /identitiesMatchAfterExchange\(swappedExisting, options\.expectedExisting\)/, 'Mac replacement must verify the exact displaced destination after the atomic exchange.');
assert.match(atomicDownload, /if \(!publicationMatches\)[\s\S]*exchangePaths\(options\.temporaryPath, options\.destinationPath\)/, 'A mismatched atomic exchange must be rolled back without consuming the destination.');
assert.doesNotMatch(atomicDownload, /partial and current destination were kept|downloaded partial was kept/i, 'Publication errors must not claim transfer cleanup preserves the partial file.');
assert.match(main, /finally \{[\s\S]*cleanupTemporaryDownload\(job\)/, 'Transfer failure cleanup must remove an unpublished partial file.');
assert.match(main, /finalizeDownloadedFile\(job\)[\s\S]*await removeMoveSource\(job, result\)/, 'A failed download publication must stop before a move can delete the phone source.');
assert.match(main, /buttons: \['Keep Both', 'Replace', 'Skip Existing', 'Cancel'\]/, 'Same-name downloads must require one native batch choice.');
assert.match(main, /collisionAction === 'replace'[\s\S]*fileIdentitySnapshot\(originalDestinationPath\)/, 'Replace must snapshot the existing Mac file before transfer.');
assert.match(
  main,
  /function retryTransfer[\s\S]*job\.destinationPath = destination\.destinationPath[\s\S]*job\.originalDestinationPath = destination\.originalDestinationPath[\s\S]*job\.renamedDestination = destination\.renamedDestination/,
  'Retrying a failed download must recompute destination rename metadata.'
);

assert.match(app, /function downloadRenameSummary\(jobs: TransferJob\[\]\): string/, 'Renderer must summarize download rename conflicts.');
assert.match(app, /function fileNameFromPath\(filePath: string\): string/, 'Renderer must derive a display name from the final Mac path.');
assert.match(app, /downloadRenameSummary\([\s\S]*queued\.filter/, 'Copy-to-Mac notices must include a compact rename summary.');
assert.match(app, /job\.direction === 'download' && job\.renamedDestination/, 'Queue rows must identify renamed downloads.');
assert.match(app, /Saved as \{fileNameFromPath\(job\.destinationPath\)\} so nothing is overwritten\./, 'Queue rows must explain the final Mac filename.');
assert.match(styles, /\.queue-main \.queue-rename-note/, 'Renamed-download queue note must have compact styling.');

assert.match(readme, /Keep Both, Replace, Skip Existing, or Cancel/, 'README must document explicit collision choices.');
assert.match(checklist, /Copy the same phone file to the same Mac folder twice/, 'Manual checklist must cover repeated download conflict behavior.');
assert.match(architecture, /renamedDestination/, 'Architecture docs must describe rename metadata.');
assert.match(architecture, /never silently overwritten/i, 'Architecture docs must preserve the no-silent-overwrite guarantee.');

console.log('Download conflict contract check passed.');
