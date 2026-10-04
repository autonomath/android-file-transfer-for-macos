import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [app, styles] = await Promise.all([
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('src/renderer/src/styles.css')
]);

assert.match(app, /type FileViewMode = 'list' \| 'grid'/, 'Renderer must model list and grid file view modes.');
assert.match(app, /PHONE_VIEW_MODE_STORAGE_KEY/, 'Phone view mode must have a stable storage key.');
assert.match(app, /MAC_VIEW_MODE_STORAGE_KEY/, 'Mac view mode must have a separate stable storage key.');
assert.match(app, /readStoredViewMode/, 'Renderer must read saved pane view modes.');
assert.match(app, /return stored === 'grid' \|\| stored === 'list' \? stored : 'list'/, 'List view must remain the default.');
assert.match(app, /setItem\(PHONE_VIEW_MODE_STORAGE_KEY,\s*phoneViewMode\)/, 'Renderer must persist the selected phone view mode.');
assert.match(app, /setItem\(MAC_VIEW_MODE_STORAGE_KEY,\s*macViewMode\)/, 'Renderer must persist the selected Mac view mode independently.');
assert.match(app, /aria-label="Phone file view"/, 'Phone toolbar must expose a compact list/grid switch.');
assert.match(app, /aria-label="Mac file view"/, 'Mac toolbar must expose its own compact list/grid switch.');
assert.match(app, /setPhoneViewMode\('list'\)/, 'Phone view switch must include list view.');
assert.match(app, /setPhoneViewMode\('grid'\)/, 'Phone view switch must include grid view.');
assert.match(app, /setMacViewMode\('list'\)/, 'Mac view switch must include list view.');
assert.match(app, /setMacViewMode\('grid'\)/, 'Mac view switch must include grid view.');
assert.match(app, /phoneViewMode === 'grid' && rows\.length > 0/, 'Renderer must render a grid for phone rows.');
assert.match(app, /onDragStart=\{\(event\) => startFileDrag\(row, event\)\}/, 'Phone grid must retain direct drag.');
assert.match(app, /onDoubleClick=\{\(\) => openRow\(row\)\}/, 'Phone grid must open storage and folders.');
assert.match(app, /macViewMode === 'grid' \? 'local-grid' : 'local-list'/, 'Mac browser must render its selected view mode.');
assert.match(app, /className=\{`file-tile local-file-tile/, 'Mac grid must render selectable local file tiles.');
assert.match(app, /onDragStart=\{\(event\) => startLocalEntryDrag\(entry, event\)\}/, 'Mac grid must retain native local-file drag.');
assert.match(app, /onDoubleClick=\{\(\) => openLocalEntry\(entry\)\}/, 'Mac grid must open files and folders on double click.');
assert.match(app, /function getPhoneGridColumnCount\(\)/, 'Phone grid must derive a keyboard column count.');
assert.match(app, /function getMacGridColumnCount\(\)/, 'Mac grid must derive a keyboard column count.');
assert.match(app, /phoneViewMode === 'grid'[\s\S]*movePhoneSelection\(columnCount,\s*event\.shiftKey\)/, 'Phone Grid Down Arrow must move by one grid row.');
assert.match(app, /phoneViewMode === 'grid'[\s\S]*movePhoneSelection\(-columnCount,\s*event\.shiftKey\)/, 'Phone Grid Up Arrow must move by one grid row.');
assert.match(app, /phoneViewMode === 'grid'[\s\S]*movePhoneSelection\(-1,\s*event\.shiftKey\)/, 'Phone Grid Left Arrow must move selection.');
assert.match(app, /phoneViewMode === 'grid'[\s\S]*movePhoneSelection\(1,\s*event\.shiftKey\)/, 'Phone Grid Right Arrow must move selection.');
assert.match(app, /macViewMode === 'grid'[\s\S]*moveLocalSelection\(columnCount,\s*event\.shiftKey\)/, 'Mac Grid Down Arrow must move by one grid row.');
assert.match(app, /macViewMode === 'grid'[\s\S]*moveLocalSelection\(-columnCount,\s*event\.shiftKey\)/, 'Mac Grid Up Arrow must move by one grid row.');
assert.match(app, /macViewMode === 'grid'[\s\S]*moveLocalSelection\(-1,\s*event\.shiftKey\)/, 'Mac Grid Left Arrow must move selection.');
assert.match(app, /macViewMode === 'grid'[\s\S]*moveLocalSelection\(1,\s*event\.shiftKey\)/, 'Mac Grid Right Arrow must move selection.');

assert.match(styles, /\.view-switch/, 'View switch must have dedicated styling.');
assert.match(styles, /\.file-grid/, 'Phone grid view must have a stable grid layout.');
assert.match(styles, /\.file-tile/, 'Grid views must have stable tile styling.');
assert.match(styles, /\.file-tile-name[\s\S]*-webkit-line-clamp:\s*2/, 'Grid names must reserve two readable lines instead of clipping immediately.');
assert.match(styles, /\.local-grid/, 'Mac grid view must have a stable responsive layout.');
assert.match(styles, /\.local-file-tile/, 'Mac grid view must have dedicated tile styling.');
assert.match(styles, /\.app-shell\[data-theme='dark'\] \.file-tile/, 'Grid views must be covered by dark mode.');

console.log('View mode contract check passed.');
