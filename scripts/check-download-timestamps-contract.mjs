import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [types, main, app, readme, checklist, architecture] = await Promise.all([
  readProjectFile('src/shared/types.ts'),
  readProjectFile('src/main/index.ts'),
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('README.md'),
  readProjectFile('docs/manual-test-checklist.md'),
  readProjectFile('docs/architecture.md')
]);

assert.match(types, /export interface TransferRequest[\s\S]*modified\?: number;/, 'Download requests must carry phone modified timestamps.');
assert.match(types, /export interface TransferJob[\s\S]*modified\?: number;/, 'Transfer jobs must carry phone modified timestamps.');

assert.match(app, /modified: object\.modified/, 'Renderer download planning must pass MTP object modified time.');

assert.match(main, /utimesSync,/, 'Main process must import utimesSync.');
assert.match(main, /function preserveDownloadedModifiedTime\(job: TransferJob\): void/, 'Main process must have a download timestamp preservation helper.');
assert.match(main, /job\.direction !== 'download'/, 'Timestamp preservation must only apply to Mac-side downloads.');
assert.match(main, /new Date\(job\.modified \* 1000\)/, 'MTP modified timestamps must be converted from Unix seconds.');
assert.match(main, /utimesSync\(job\.destinationPath, fileStat\.atime, modifiedAt\)/, 'Main process must restore the Mac file modified time.');
assert.match(main, /warning: unable to preserve phone modified time/, 'Timestamp preservation failure must be logged as a non-fatal warning.');
assert.match(
  main,
  /result\.ok && result\.event === 'complete'[\s\S]*preserveDownloadedModifiedTime\(job\)/,
  'Completed downloads must restore modified time before reporting completion.'
);
assert.match(
  main,
  /function enqueueDownloads[\s\S]*modified: request\.modified/,
  'Queued phone-to-Mac downloads must keep the request modified time.'
);
assert.match(main, /function enqueuePromisedDownloads[\s\S]*modified: request\.modified/, 'Promised downloads must keep phone modified time.');

assert.match(readme, /preserve the phone file's modified date/, 'README must document preserved modified dates.');
assert.match(checklist, /modified date matches the phone row/, 'Manual checklist must test preserved modified dates.');
assert.match(architecture, /preserveDownloadedModifiedTime/, 'Architecture docs must describe the timestamp preservation path.');
assert.match(architecture, /non-fatal warning/, 'Architecture docs must explain timestamp failure behavior.');

console.log('Download timestamp contract check passed.');
