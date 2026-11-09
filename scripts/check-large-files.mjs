import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporaryDirectory = resolve(root, '.tmp');
await mkdir(temporaryDirectory, { recursive: true });
const source = await readFile(resolve(root, 'src/shared/largeFiles.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText;
const modulePath = resolve(temporaryDirectory, 'largeFiles-check.mjs');
await writeFile(modulePath, compiled, 'utf8');
const largeFiles = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);

const MB = 1024 * 1024;
const ROOT = 0xffffffff;
const STORAGE = { id: 65537, name: 'Internal storage' };

// Folders are objects and files are sizes in MB. Each call builds a fresh phone with new object IDs.
function phoneTree() {
  return {
    DCIM: { Camera: { 'VID_1.mp4': 900, 'IMG_1.jpg': 4 }, '.thumbnails': { 'cache.bin': 120 } },
    Movies: { 'clip.mp4': 300 },
    Download: { 'small.pdf': 1, 'setup.zip': 60 },
    Pictures: { Screenshots: {} },
    Music: {},
    Android: {
      data: { 'com.maps': { files: { 'region.map': 700, deep: { deeper: { 'tile.bin': 80 } } } } },
      media: { 'com.whatsapp': { WhatsApp: { Media: { 'WhatsApp Video': { 'v.mp4': 75 } } } } },
      obb: { 'com.game': { 'main.obb': 2000 } }
    },
    Notes: { 'archive.zip': 55 },
    constructor: { 'odd.bin': 51 },
    '.hidden': { 'secret.bin': 90 }
  };
}

function fakePhone(tree) {
  let nextId = 100;
  let folders = 1;
  const children = new Map();
  const ids = new Map();
  function add(node, parentId, path) {
    const objects = [];
    for (const [name, value] of Object.entries(node)) {
      const id = nextId++;
      const childPath = [...path, name];
      ids.set(childPath.join('/'), id);
      const folder = typeof value === 'object';
      objects.push({
        id,
        parentId,
        storageId: STORAGE.id,
        name,
        kind: folder ? 'folder' : 'file',
        size: folder ? 0 : value * MB,
        modified: 1_700_000_000,
        filetype: ''
      });
      if (folder) {
        folders += 1;
        add(value, id, childPath);
      }
    }
    children.set(parentId, objects);
  }
  add(tree, ROOT, []);
  const pathsById = new Map([[ROOT, '/']]);
  for (const [path, id] of ids) {
    pathsById.set(id, path);
  }
  const listed = [];
  return {
    ids,
    listed,
    folders,
    list: async (storageId, folderId) => {
      assert.equal(storageId, STORAGE.id);
      listed.push(pathsById.get(folderId));
      return children.get(folderId) ?? [];
    }
  };
}

async function scan(phone, depth, known = [], extra = {}) {
  return largeFiles.scanForLargeFiles({
    storages: [STORAGE],
    depth,
    known,
    list: phone.list,
    shouldStop: () => false,
    now: () => 42,
    ...extra
  });
}

const names = (result) => result.entries.map((entry) => entry.name);

const usualPhone = fakePhone(phoneTree());
const usual = await scan(usualPhone, 'usual');
assert.equal(usual.complete, true);
assert.deepEqual(names(usual), ['main.obb', 'VID_1.mp4', 'clip.mp4', 'v.mp4', 'setup.zip']);
assert.equal(usualPhone.listed[0], '/', 'The storage root is listed first.');
assert.ok(
  usualPhone.listed.indexOf('DCIM/Camera') < usualPhone.listed.indexOf('Pictures'),
  'Camera, Movies and Downloads are checked before less likely places.'
);
for (const skipped of ['Android/data', 'Notes', '.hidden', 'DCIM/.thumbnails', 'constructor']) {
  assert.ok(!usualPhone.listed.includes(skipped), `Usual places must not list ${skipped}.`);
}
const video = usual.entries.find((entry) => entry.name === 'VID_1.mp4');
assert.deepEqual(video.folderPath, ['Internal storage', 'DCIM', 'Camera']);
assert.equal(video.seenAt, 42);
assert.equal(video.live.storageId, STORAGE.id);
assert.equal(video.live.object.id, usualPhone.ids.get('DCIM/Camera/VID_1.mp4'));
assert.deepEqual(video.live.crumbs, [
  { label: 'Internal storage', folderId: ROOT },
  { label: 'DCIM', folderId: usualPhone.ids.get('DCIM') },
  { label: 'Camera', folderId: usualPhone.ids.get('DCIM/Camera') }
]);

const deeperPhone = fakePhone(phoneTree());
const deeper = await scan(deeperPhone, 'deeper');
assert.deepEqual(names(deeper).sort(), [
  'VID_1.mp4', 'archive.zip', 'cache.bin', 'clip.mp4', 'main.obb', 'odd.bin', 'region.map', 'secret.bin', 'setup.zip', 'v.mp4'
]);
assert.ok(deeperPhone.listed.includes('Android/data/com.maps/files'), 'Deeper reaches four levels below the storage.');
assert.ok(!deeperPhone.listed.includes('Android/data/com.maps/files/deep'), 'Deeper stops after four levels outside usual places.');

const everythingPhone = fakePhone(phoneTree());
const everything = await scan(everythingPhone, 'everything');
assert.ok(names(everything).includes('tile.bin'));
assert.equal(everything.foldersChecked, everythingPhone.folders, 'Whole phone lists every folder once.');
assert.equal(new Set(everythingPhone.listed).size, everythingPhone.listed.length);

// Memory comes back from storage without live object IDs, as it would on the next connection.
const remembered = largeFiles.parseRememberedLargeFiles(largeFiles.serializeRememberedLargeFiles(deeper.entries));
assert.equal(remembered.length, deeper.entries.length);
assert.ok(remembered.every((entry) => entry.live === undefined), 'Object IDs are never remembered.');

const changedTree = phoneTree();
delete changedTree.Notes['archive.zip'];
delete changedTree['.hidden'];
const memoryPhone = fakePhone(changedTree);
const updates = [];
const guided = await scan(memoryPhone, 'usual', remembered, { onUpdate: (update) => updates.push(update) });
assert.ok(
  memoryPhone.listed.indexOf('Android/data/com.maps/files') < memoryPhone.listed.indexOf('Pictures'),
  'Folders where large files were found before are checked first, even outside usual places.'
);
assert.ok(memoryPhone.listed.includes('DCIM/.thumbnails'), 'A remembered hidden folder is rechecked.');
assert.ok(!names(guided).includes('archive.zip'), 'A file missing from its listed folder is forgotten.');
assert.ok(!names(guided).includes('secret.bin'), 'A file whose folder disappeared is forgotten.');
assert.ok(guided.entries.every((entry) => entry.live), 'Every remaining file was confirmed in this connection.');
assert.ok(updates.some((update) => update.entries), 'Changed results are reported while scanning.');

let listsAllowed = 2;
const stoppedPhone = fakePhone(phoneTree());
const stopped = await scan(stoppedPhone, 'usual', remembered, { shouldStop: () => listsAllowed-- <= 0 });
assert.equal(stopped.complete, false);
const unconfirmed = stopped.entries.find((entry) => entry.name === 'region.map');
assert.ok(unconfirmed && !unconfirmed.live, 'Files in folders not reached yet stay remembered without object IDs.');

const failingPhone = fakePhone(phoneTree());
const failed = await scan(failingPhone, 'usual', [], {
  list: async (storageId, folderId) => {
    if (folderId === failingPhone.ids.get('Pictures')) {
      throw new Error('Phone unplugged');
    }
    return failingPhone.list(storageId, folderId);
  }
});
assert.equal(failed.complete, false);
assert.equal(failed.error, 'Phone unplugged');
assert.deepEqual(names(failed), ['VID_1.mp4', 'clip.mp4', 'setup.zip'], 'Files found before a failed listing are kept.');

assert.deepEqual(largeFiles.parseRememberedLargeFiles(null), []);
assert.deepEqual(largeFiles.parseRememberedLargeFiles('{broken'), []);
assert.deepEqual(largeFiles.parseRememberedLargeFiles(JSON.stringify({ version: 2, files: [] })), []);
const parsed = largeFiles.parseRememberedLargeFiles(
  JSON.stringify({
    version: 1,
    files: [
      { folderPath: ['Internal storage'], name: 'a.mp4', size: 60 * MB, modified: 1, seenAt: 2 },
      { folderPath: ['Internal storage'], name: 'b.mp4', size: 90 * MB, modified: 1, seenAt: 2, extra: true },
      { folderPath: [], name: 'no-folder.mp4', size: 90 * MB, modified: 1, seenAt: 2 },
      { folderPath: ['Internal storage'], name: 'small.jpg', size: MB, modified: 1, seenAt: 2 },
      { folderPath: ['Internal storage'], name: 'bad.mp4', size: '90', modified: 1, seenAt: 2 },
      null
    ]
  })
);
assert.deepEqual(parsed, [
  { folderPath: ['Internal storage'], name: 'b.mp4', size: 90 * MB, modified: 1, seenAt: 2 },
  { folderPath: ['Internal storage'], name: 'a.mp4', size: 60 * MB, modified: 1, seenAt: 2 }
]);

// Remembered files are found by folder names before a scan reaches them, listing each folder once.
const lookupPhone = fakePhone(phoneTree());
const lookup = await largeFiles.findRememberedLargeFiles(
  [
    { folderPath: ['Internal storage', 'DCIM', 'Camera'], name: 'VID_1.mp4', size: 1, modified: 1, seenAt: 1 },
    { folderPath: ['Internal storage', 'Movies'], name: 'clip.mp4', size: 1, modified: 1, seenAt: 1 },
    { folderPath: ['Internal storage', 'DCIM', 'Camera'], name: 'gone.mp4', size: 1, modified: 1, seenAt: 1 },
    { folderPath: ['Internal storage', 'Nowhere'], name: 'x.bin', size: 1, modified: 1, seenAt: 1 }
  ],
  [STORAGE],
  lookupPhone.list,
  () => 7
);
assert.deepEqual(lookup.found.map((entry) => entry.name), ['VID_1.mp4', 'clip.mp4']);
assert.deepEqual(lookup.missing.map((entry) => entry.name), ['gone.mp4', 'x.bin']);
assert.equal(lookup.found[0].live.object.id, lookupPhone.ids.get('DCIM/Camera/VID_1.mp4'));
assert.equal(lookup.found[0].size, 900 * MB, 'The size on the phone now replaces the remembered size.');
assert.equal(lookup.found[0].seenAt, 7);
assert.deepEqual(lookup.found[0].live.crumbs.map((crumb) => crumb.label), ['Internal storage', 'DCIM', 'Camera']);
assert.deepEqual(lookupPhone.listed, ['/', 'DCIM', 'DCIM/Camera', 'Movies'], 'Each folder is listed once.');

const app = await readFile(resolve(root, 'src/renderer/src/App.tsx'), 'utf8');
assert.match(
  app,
  /async function copyRowsToMac[\s\S]*?const rememberedRows = fileRows\.filter\(\(row\) => row\.largeFile && !row\.object\);[\s\S]*?findRememberedRows\(rememberedRows\)/,
  'Copy and Move must look up remembered Large files rows instead of silently dropping them.'
);
assert.match(
  app,
  /const canRunPhoneTransfer =\s*selectedDownloadRows\.length > 0/,
  'The phone-to-Mac button must count remembered Large files rows as transferable.'
);
const lookupBody = app.slice(app.indexOf('async function findRememberedRows'), app.indexOf('return foundRows;'));
assert.ok(lookupBody.length > 0, 'findRememberedRows must exist.');
assert.ok(
  !lookupBody.includes('cancelFolderListing'),
  'The lookup must wait for a running listing: cancelling one mid-listing leaves the phone unresponsive.'
);

console.log('Large-file scan checks passed.');
