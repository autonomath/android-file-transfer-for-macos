import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [app, styles, readme, checklist, architecture] = await Promise.all([
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('src/renderer/src/styles.css'),
  readProjectFile('README.md'),
  readProjectFile('docs/manual-test-checklist.md'),
  readProjectFile('docs/architecture.md')
]);

assert.match(app, /interface ContextMenuState/, 'Renderer must track context-menu state.');
assert.match(app, /function openPhoneContextMenu/, 'Renderer must expose phone row context menus.');
assert.match(app, /function openMacContextMenu/, 'Renderer must expose Mac row context menus.');
assert.match(app, /function renderContextMenu/, 'Renderer must render context menus.');
assert.match(app, /role="menu"/, 'Context menu container must use menu role.');
assert.match(app, /role="menuitem"/, 'Context menu actions must use menuitem role.');

assert.match(
  app,
  /onContextMenu=\{\(event\) => openPhoneContextMenu\(event, row\)\}/,
  'Phone file rows and tiles must open a row-aware context menu.'
);
assert.match(
  app,
  /onContextMenu=\{\(event\) => openMacContextMenu\(event, entry\)\}/,
  'Mac rows must open a row-aware context menu.'
);
assert.match(
  app,
  /onContextMenu=\{\(event\) => openPhoneContextMenu\(event\)\}/,
  'Phone pane background must open a context menu for pane-level actions.'
);
assert.match(
  app,
  /onContextMenu=\{\(event\) => openMacContextMenu\(event\)\}/,
  'Mac pane background must open a context menu for pane-level actions.'
);

for (const label of [
  'Open Storage',
  'Open Folder',
  'Copy to Mac',
  'Stop Listing',
  'Parent Folder',
  'New Phone Folder',
  'Rename',
  'Delete Permanently...',
  'Check Phone Now',
  'Copy to Phone',
  'Move to',
  'Reveal in Finder',
  'Move to Trash',
  'New Mac Folder',
  'Refresh Mac Folder',
  'Choose Mac Folder',
  'Use Desktop'
]) {
  assert.match(app, new RegExp(label.replaceAll(' ', '\\s*')), `Context menu must include ${label}.`);
}

assert.match(app, /copyRowsToMac\(phoneActionRows\)/, 'Phone context menu must reuse the normal Copy to Mac path.');
assert.doesNotMatch(app, /Get Ready to Drag|prepareRowsForNativeDrag/, 'Context menus must not expose the removed pre-copy step.');
assert.match(
  app,
  /copyLocalFilesToPhone\(localActionEntries\)/,
  'Mac context menu must reuse the normal Copy to Phone path.'
);
assert.match(app, /copyRowsToMac\([\s\S]*phoneActionRows[\s\S]*'move'/, 'Phone context menu must reuse the verified Move path.');
assert.match(app, /copyLocalFilesToPhone\(localActionEntries, 'move'\)/, 'Mac context menu must reuse the verified Move path.');
assert.match(app, /phoneActionFilesOnly/, 'Phone folder selections must not enable Move.');
assert.match(app, /localActionFilesOnly/, 'Mac folder selections must not enable Move.');
assert.match(app, /window\.mtp\.revealInFinder\(localContextEntry\.path\)/, 'Mac context menu must reveal rows in Finder.');
assert.match(app, /openRenamePhoneItemDialog\(phoneActionRows\[0\]\)/, 'Phone rename must use the guarded dialog.');
assert.match(app, /deletePhoneRows\(phoneActionRows\)/, 'Phone delete must use the guarded main-process path.');

assert.match(styles, /\.context-menu\s*\{/, 'Context menu must have dedicated styling.');
assert.match(styles, /\.context-menu button\s*\{/, 'Context menu buttons must have compact row styling.');
assert.match(styles, /\.context-menu button\.separated/, 'Context menu must support separated action groups.');
assert.match(styles, /\.app-shell\[data-theme='dark'\] \.context-menu/, 'Context menu must inherit dark theme styling.');

assert.match(readme, /Right-click context menus/, 'README must document context menus.');
assert.match(checklist, /Right-click/, 'Manual checklist must cover context menus.');
assert.match(architecture, /context menu/, 'Architecture note must explain context menu action reuse.');

console.log('Context menu contract check passed.');
