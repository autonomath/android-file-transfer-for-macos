import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readProjectFile = (path) => readFile(resolve(root, path), 'utf8');

const validatorSource = await readProjectFile('src/shared/localMutation.ts');
const outDir = resolve(root, '.tmp');
const outPath = resolve(outDir, 'local-mutation-check.mjs');
await mkdir(outDir, { recursive: true });
await writeFile(outPath, ts.transpileModule(validatorSource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText, 'utf8');
const { validateLocalItemName } = await import(`${pathToFileURL(outPath).href}?t=${Date.now()}`);

assert.equal(validateLocalItemName('Folder: 2026'), null);
assert.equal(validateLocalItemName('Résumé'), null);
assert.match(validateLocalItemName('') ?? '', /Enter a name/);
assert.match(validateLocalItemName('../escape') ?? '', /cannot contain/);
assert.match(validateLocalItemName('\ud800') ?? '', /invalid Unicode/);
assert.match(validateLocalItemName('é'.repeat(128)) ?? '', /255 UTF-8 bytes/);

const [types, main, preload, app, packageJson] = await Promise.all([
  readProjectFile('src/shared/types.ts'),
  readProjectFile('src/main/index.ts'),
  readProjectFile('src/preload/index.ts'),
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('package.json')
]);

assert.match(types, /identity: LocalSourceIdentity/);
assert.match(types, /createLocalFolder: \(request: CreateLocalFolderRequest\)/);
assert.match(types, /renameLocalItem: \(request: RenameLocalItemRequest\)/);
assert.match(types, /trashLocalItems: \(request: TrashLocalItemsRequest\)/);
assert.match(main, /function verifiedLocalMutationPath[\s\S]*dirname\(sourcePath\) !== directory/);
assert.match(main, /localIdentityMatches[\s\S]*current\.dev === target\.identity\.device[\s\S]*current\.ino === target\.identity\.inode/);
assert.match(main, /function renameLocalItem[\s\S]*existsSync\(destinationPath\)[\s\S]*renameSync/);
assert.match(main, /async function trashLocalItems[\s\S]*shell\.trashItem\(sourcePath\)/);
assert.match(main, /localMutationUnavailableMessage[\s\S]*job\.status === 'queued'.*job\.status === 'active'/s);
assert.match(preload, /ipcRenderer\.invoke\('local:createFolder'/);
assert.match(preload, /ipcRenderer\.invoke\('local:renameItem'/);
assert.match(preload, /ipcRenderer\.invoke\('local:trashItems'/);
assert.match(app, /function openLocalNewFolderDialog/);
assert.match(app, /function openRenameLocalItemDialog/);
assert.match(app, /function trashLocalEntries/);
assert.match(app, /Move to Trash/);
assert.match(packageJson, /"check:local-mutations"/);

console.log('Local mutation behavior and contract check passed.');
