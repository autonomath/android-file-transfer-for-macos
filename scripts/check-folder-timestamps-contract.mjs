import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [types, preload, main, app, readme, checklist, architecture] = await Promise.all([
  readProjectFile('src/shared/types.ts'),
  readProjectFile('src/preload/index.ts'),
  readProjectFile('src/main/index.ts'),
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('README.md'),
  readProjectFile('docs/manual-test-checklist.md'),
  readProjectFile('docs/architecture.md')
]);

assert.match(types, /export interface LocalModifiedTimeResult/, 'Shared types must expose local modified-time result.');
assert.match(types, /setLocalModifiedTime: \(path: string, modified: number\) => Promise<LocalModifiedTimeResult>/, 'Renderer API must expose local timestamp setting.');

assert.match(preload, /setLocalModifiedTime: \(path: string, modified: number\) =>[\s\S]*ipcRenderer\.invoke\('local:setModifiedTime', path, modified\)/, 'Preload must bridge local timestamp setting.');

assert.match(main, /function setLocalModifiedTime\(localPath: string, modified: number\): LocalModifiedTimeResult/, 'Main process must set local path modified time.');
assert.match(main, /ipcMain\.handle\('local:setModifiedTime'[\s\S]*setLocalModifiedTime\(localPath, modified\)/, 'Main process must register local timestamp IPC.');
assert.match(main, /warning: unable to preserve phone folder modified time/, 'Folder timestamp failures must be logged as warnings.');

assert.match(app, /interface PlannedLocalDirectory[\s\S]*path: string;[\s\S]*modified: number;/, 'Renderer must track planned local folders with modified time.');
assert.match(app, /directories: PlannedLocalDirectory\[\]/, 'Download folder plans must carry planned local directories.');
assert.match(app, /const directoryMap = new Map<string, number>\(\)/, 'Download planning must map folder paths to modified times.');
assert.match(app, /directoryMap\.set\(folderDirectory, object\.modified\)/, 'Folder planning must capture phone folder modified time.');
assert.match(app, /function directoryDepth\(directoryPath: string\): number/, 'Folder timestamp preservation must sort by path depth.');
assert.match(app, /async function preservePlannedLocalDirectories\(directories: PlannedLocalDirectory\[\]\): Promise<void>/, 'Renderer must preserve planned folder timestamps.');
assert.match(app, /sort\(\(a, b\) => directoryDepth\(b\.path\) - directoryDepth\(a\.path\)\)/, 'Folder timestamps must be restored deepest-first.');
assert.match(app, /window\.mtp\.setLocalModifiedTime\(directory\.path, directory\.modified\)/, 'Renderer must call the local timestamp IPC for planned folders.');
assert.match(app, /downloadFolderPlans/, 'Normal Copy to Mac folder batches must track pending folder timestamps.');
assert.match(main, /interface PromiseFulfillment[\s\S]*directories: PromisedDirectory\[\]/, 'Promised folder batches must track pending folder timestamps.');
assert.match(app, /preservePlannedLocalDirectories\(plan\.directories\)/, 'Folder timestamps must be restored after queued folder work finishes.');
assert.match(main, /function preservePromisedDirectories[\s\S]*utimesSync\(directory\.path/, 'Promised folder timestamps must be restored in main.');
assert.match(main, /!plan\.files\.length[\s\S]*completePromiseFulfillment\(promiseId\)/, 'Empty promised folders must complete without file jobs.');

assert.match(readme, /copied folders keep their phone modified dates/, 'README must document copied folder modified dates.');
assert.match(checklist, /empty phone folder[\s\S]*modified date matches/, 'Manual checklist must cover empty folder modified dates.');
assert.match(architecture, /setLocalModifiedTime/, 'Architecture docs must describe local folder timestamp IPC.');
assert.match(architecture, /deepest-first/, 'Architecture docs must describe folder timestamp ordering.');

console.log('Folder timestamp contract check passed.');
