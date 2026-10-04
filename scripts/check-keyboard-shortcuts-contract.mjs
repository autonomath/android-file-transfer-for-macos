import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const app = await readFile(resolve(root, 'src/renderer/src/App.tsx'), 'utf8');

assert.match(app, /type ActivePane = 'phone' \| 'mac'/, 'Renderer must track the active keyboard pane.');
assert.match(app, /function handlePhonePaneKeyDown/, 'Phone file table must have keyboard handling.');
assert.match(app, /function handleLocalPaneKeyDown/, 'Mac file pane must have keyboard handling.');
assert.match(app, /onKeyDown=\{handlePhonePaneKeyDown\}/, 'Phone pane must wire keyboard handling.');
assert.match(app, /onKeyDown=\{handleLocalPaneKeyDown\}/, 'Mac pane must wire keyboard handling.');
assert.match(app, /ref=\{searchInputRef\}/, 'Global find shortcut must focus the visible filter input.');
assert.match(app, /key === 'f'[\s\S]*searchInputRef\.current\?\.focus\(\)/, 'Cmd/Ctrl+F must focus the filter.');
assert.match(app, /key === 'r'[\s\S]*handleManualRefresh\(\)/, 'Cmd/Ctrl+R must refresh the phone connection.');
assert.match(app, /key === '1'[\s\S]*focusPhonePane\(\)/, 'Cmd/Ctrl+1 must focus the phone pane.');
assert.match(app, /key === '2'[\s\S]*focusMacPane\(\)/, 'Cmd/Ctrl+2 must focus the Mac pane.');
assert.match(app, /key === 'n'[\s\S]*openNewFolderForActivePane\(\)/, 'Cmd/Ctrl+N must create a folder in the active pane.');
assert.match(app, /key === 'b'[\s\S]*goUpActivePane\(\)/, 'Cmd/Ctrl+B must go up in the active pane.');
assert.match(
  app,
  /key === 'c' && !isEditableElement\(event\.target\)[\s\S]*if \(!activePaneHasTransferSelection\)[\s\S]*event\.preventDefault\(\)[\s\S]*event\.shiftKey[\s\S]*copyActivePaneSelectionToQueue\(\)/,
  'Cmd/Ctrl+Shift+C must copy the active-pane selection to the transfer queue.'
);
assert.match(
  app,
  /key === 'c' && !isEditableElement\(event\.target\)[\s\S]*if \(!activePaneHasTransferSelection\)[\s\S]*event\.preventDefault\(\)[\s\S]*copyActivePaneSelectionToClipboard\(\)/,
  'Cmd/Ctrl+C must copy the active file selection into the internal transfer clipboard.'
);
assert.doesNotMatch(
  app,
  /Select (?:phone|Mac) files or folders before copying/,
  'Copy shortcuts with no app selection must be silent no-ops.'
);
assert.match(
  app,
  /key === 'v' && !isEditableElement\(event\.target\)[\s\S]*pasteTransferClipboard\(\)/,
  'Cmd/Ctrl+V must paste the internal transfer clipboard into the opposite pane.'
);
assert.match(app, /key === 'a'[\s\S]*selectAllLocalEntries\(\)[\s\S]*selectAllPhoneRows\(\)/, 'Cmd/Ctrl+A must select all in the active pane.');
assert.match(
  app,
  /function copyActivePaneSelectionToQueue\(\)[\s\S]*copyLocalFilesToPhone\(\)[\s\S]*copySelectedToMac\(\)/,
  'Active-pane queue copy helper must support both Mac-to-phone and phone-to-Mac.'
);
assert.match(app, /type TransferClipboard/, 'Renderer must keep an internal transfer clipboard for file copy/paste.');
assert.match(app, /function copyActivePaneSelectionToClipboard\(\)/, 'Renderer must expose a transfer clipboard copy helper.');
assert.match(app, /function pasteTransferClipboard\(\)/, 'Renderer must expose a transfer clipboard paste helper.');
assert.match(app, /sourceStillVisible/, 'Pasting copied phone rows must reject stale disconnected phone selections.');
assert.match(app, /key === 'enter'[\s\S]*copyActivePaneSelectionToQueue\(\)/, 'Pane Cmd/Ctrl+Enter must copy the active-pane selection.');
assert.match(app, /event\.key === 'F2'[\s\S]*openRenamePhoneItemDialog\(\)/, 'F2 must rename one selected phone item.');
assert.match(app, /event\.key === 'Backspace'.*event\.key === 'Delete'[\s\S]*deletePhoneRows\(\)/s, 'Delete keys must use guarded phone deletion.');
assert.match(app, /key === 'd'[\s\S]*openRenameSelectedItem\(\)/, 'Cmd/Ctrl+D must rename in the active pane.');
assert.match(app, /function handleLocalPaneKeyDown[\s\S]*event\.key === 'F2'[\s\S]*openRenameLocalItemDialog\(\)/, 'F2 must rename one selected Mac item.');
assert.match(app, /function handleLocalPaneKeyDown[\s\S]*event\.key === 'Backspace'.*event\.key === 'Delete'[\s\S]*trashLocalEntries\(\)/s, 'Delete keys must move selected Mac items to Trash.');
assert.match(app, /isInteractiveElement\(event\.target\)/, 'Pane shortcuts must not hijack buttons or form fields.');

console.log('Keyboard shortcuts contract check passed.');
