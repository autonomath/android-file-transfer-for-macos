import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const phoneMutationSource = await readProjectFile('src/shared/phoneMutation.ts');
const outDir = resolve(root, '.tmp');
const outPath = resolve(outDir, 'phone-mutation-check.mjs');
const compiled = ts.transpileModule(phoneMutationSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
await mkdir(outDir, { recursive: true });
await writeFile(outPath, compiled, 'utf8');
const { encodePhoneCommandName, validatePhoneItemName } = await import(
  `${pathToFileURL(outPath).href}?t=${Date.now()}`
);

assert.equal(validatePhoneItemName('Camera'), null);
assert.equal(validatePhoneItemName('Résumé 2026.jpg'), null);
assert.match(validatePhoneItemName('') ?? '', /Enter a name/);
assert.match(validatePhoneItemName('.') ?? '', /reserved/);
assert.match(validatePhoneItemName('../photo.jpg') ?? '', /cannot contain/);
assert.match(validatePhoneItemName('bad\nname') ?? '', /control characters/);
assert.match(validatePhoneItemName('\ud800') ?? '', /invalid Unicode/);
assert.match(validatePhoneItemName('é'.repeat(128)) ?? '', /255 UTF-8 bytes/);
assert.equal(encodePhoneCommandName('A b'), '412062');
assert.equal(encodePhoneCommandName('é'), 'c3a9');

const [types, main, preload, app, native, styles, packageJson] = await Promise.all([
  readProjectFile('src/shared/types.ts'),
  readProjectFile('src/main/index.ts'),
  readProjectFile('src/preload/index.ts'),
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('src/native/mtp-json.c'),
  readProjectFile('src/renderer/src/styles.css'),
  readProjectFile('package.json')
]);

assert.match(types, /interface PhoneMutationTarget[\s\S]*objectId[\s\S]*storageId[\s\S]*parentId[\s\S]*name[\s\S]*kind[\s\S]*size\?: number[\s\S]*modified\?: number/);
assert.match(types, /renamePhoneItem: \(request: RenamePhoneItemRequest\)/);
assert.match(types, /deletePhoneItems: \(request: DeletePhoneItemsRequest\)/);

assert.match(native, /decode_phone_item_name/);
assert.match(native, /parse_optional_u64/);
assert.match(native, /verified_phone_mutation_target[\s\S]*LIBMTP_Get_Filemetadata/);
assert.match(native, /metadata->parent_id != parent_id/);
assert.match(native, /metadata->storage_id == storage_id/);
assert.match(native, /strcmp\(metadata->filename, expected_name\) != 0/);
assert.match(native, /expected_folder != actual_folder/);
assert.match(native, /metadata->filesize == expected_size/);
assert.match(native, /metadata->modificationdate[\s\S]*expected_modified/);
assert.match(native, /expected_folder[\s\S]*!expected_size_available && !expected_modified_available/);
assert.match(native, /session_rename_item[\s\S]*LIBMTP_Set_File_Name/);
assert.match(native, /session_delete_item[\s\S]*LIBMTP_Delete_Object/);
assert.match(native, /strcmp\(command, "rename-item"\).*strcmp\(command, "delete-item"\)/s);
assert.doesNotMatch(native, /static void session_delete\(/);
assert.doesNotMatch(native, /strcmp\(command, "delete"\)/);

assert.match(main, /phoneMutationTargetError[\s\S]*target\.kind === 'file'[\s\S]*target\.size[\s\S]*target\.modified/);
assert.match(main, /target\.kind === 'file' \? String\(target\.size\) : '-'/);
assert.match(main, /target\.kind === 'file' && target\.modified !== undefined \? String\(target\.modified\) : '-'/);
assert.match(main, /phoneMutationUnavailableMessage[\s\S]*pendingPromisePlanningCount/);
assert.match(main, /phoneMutationUnavailableMessage[\s\S]*job\.status === 'queued'.*job\.status === 'active'/s);
assert.match(main, /phoneMutationInProgress = true/);
assert.match(main, /confirmPhoneDeletion[\s\S]*There is no Trash or Undo/);
assert.match(main, /defaultId:\s*1[\s\S]*cancelId:\s*1/);
assert.match(main, /ipcMain\.handle\('mtp:renamePhoneItem'/);
assert.match(main, /ipcMain\.handle\('mtp:deletePhoneItems'/);
assert.match(preload, /ipcRenderer\.invoke\('mtp:renamePhoneItem'/);
assert.match(preload, /ipcRenderer\.invoke\('mtp:deletePhoneItems'/);

assert.match(app, /function openRenamePhoneItemDialog/);
assert.match(app, /function renamePhoneItemFromDialog/);
assert.match(app, /function deletePhoneRows/);
assert.match(app, /phoneMutationTargetForRow[\s\S]*size: row\.object\.kind === 'file'[\s\S]*modified: row\.object\.kind === 'file'/);
assert.match(app, /existingDestination:[\s\S]*size: existing\.size[\s\S]*modified: existing\.modified/);
assert.match(app, /Delete Permanently\.\.\./);
assert.match(app, /event\.key === 'F2'/);
assert.match(app, /event\.key === 'Backspace'.*event\.key === 'Delete'/s);
assert.match(styles, /\.context-menu button\.danger/);
assert.match(packageJson, /"check:phone-mutations"/);

console.log('Phone mutation behavior and contract check passed.');
