import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [main, app, readme, checklist, architecture] = await Promise.all([
  readProjectFile('src/main/index.ts'),
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('README.md'),
  readProjectFile('docs/manual-test-checklist.md'),
  readProjectFile('docs/architecture.md')
]);

assert.match(main, /statfsSync,/, 'Main process must import statfsSync for native free-space checks.');
assert.match(main, /function availableBytesForDirectory\(directory: string\)/, 'Main process must have a Mac free-space helper.');
assert.match(main, /statfsSync\(directory\)/, 'Free-space helper must read the target filesystem.');
assert.match(main, /statSync\(directory\)[\s\S]*\.dev/, 'Free-space reservations must group folders by filesystem device.');
assert.match(main, /function downloadSpaceError\([\s\S]*reservedBytesByVolume: Map<string, number>/, 'Mac-side phone transfers must reserve free space across a batch.');
assert.match(
  main,
  /job\.direction !== 'download' \|\| job\.size <= 0/,
  'Free-space preflight must cover every phone-to-Mac download.'
);
assert.match(main, /Not enough free space on the Mac\./, 'Free-space failures must use plain user-facing language.');
assert.match(main, /Choose another Mac folder or free space, then Retry\./, 'Free-space failures must tell users how to recover.');
assert.match(main, /Free space on the Mac, then drag the item again\./, 'Promised drag failures must tell users to drag again.');
assert.match(main, /function applyDownloadSpacePreflight/, 'Main process must mark impossible Mac-side transfers before starting transfer workers.');
assert.match(
  main,
  /function enqueueDownloads[\s\S]*const reservedBytesByVolume = new Map<string, number>\(\)[\s\S]*applyDownloadSpacePreflight\(job, reservedBytesByVolume\)[\s\S]*sendTransferEvent\(canQueue \? 'queued' : 'failed', job\)/,
  'Queued downloads must run free-space preflight and emit failed jobs immediately when blocked.'
);
assert.match(
  main,
  /function enqueuePromisedDownloads[\s\S]*const reservedBytesByVolume = new Map<string, number>\(\)[\s\S]*applyDownloadSpacePreflight\(job, reservedBytesByVolume\)/,
  'Destination-aware promised downloads must run free-space preflight.'
);
assert.match(
  main,
  /job\.direction === 'download' && !applyDownloadSpacePreflight\(job, new Map\(\)\)/,
  'Retrying an ordinary phone download must re-check free space.'
);

assert.match(app, /failedBeforeTracking/, 'Folder-copy tracking must account for jobs that fail before tracking starts.');
assert.match(
  app,
  /job\.status !== 'completed' && job\.status !== 'failed' && job\.status !== 'canceled'/,
  'Folder-copy tracking must not wait forever on preflight-failed jobs.'
);
assert.match(app, /attention before copying/, 'Copy-to-Mac notices must explain when files were not queued.');
assert.match(app, /job\.promiseId \? ' Drag again\.'/ , 'Promised transfer failures must tell users to drag again.');

assert.match(readme, /checks the actual destination volume for enough free space/i, 'README must document the free-space preflight.');
assert.match(checklist, /not enough free space/i, 'Manual checklist must cover the free-space failure path.');
assert.match(architecture, /downloadSpaceError/, 'Architecture docs must describe the free-space preflight helper.');
assert.match(architecture, /filesystem device/i, 'Architecture docs must mention volume-level reservation behavior.');
assert.match(architecture, /file promise/i, 'Architecture docs must describe promised-destination free-space behavior.');

console.log('Download free-space contract check passed.');
