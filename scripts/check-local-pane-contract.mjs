import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [types, preload, main, app, styles] = await Promise.all([
  readProjectFile('src/shared/types.ts'),
  readProjectFile('src/preload/index.ts'),
  readProjectFile('src/main/index.ts'),
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('src/renderer/src/styles.css')
]);

assert.match(types, /interface LocalDirectoryResult/, 'Shared types must define local directory listing results.');
assert.match(types, /interface CommonMacFolder/, 'Shared types must define common Mac folder shortcuts.');
assert.match(types, /listLocalDirectory: \(directoryPath\?: string, showHiddenFiles\?: boolean\) => Promise<LocalDirectoryResult>/, 'MtpApi must expose local directory listing.');
assert.match(types, /getCommonMacFolders: \(\) => Promise<CommonMacFolder\[\]>/, 'MtpApi must expose common Mac folders.');
assert.match(types, /ensureLocalDirectory: \(directoryPath: string\) => Promise<LocalDirectoryResult>/, 'MtpApi must expose local directory creation.');

assert.match(preload, /ipcRenderer\.invoke\('local:listDirectory', directoryPath, showHiddenFiles\)/, 'Preload must expose local:listDirectory.');
assert.match(preload, /ipcRenderer\.invoke\('local:getCommonFolders'\)/, 'Preload must expose local:getCommonFolders.');
assert.match(preload, /ipcRenderer\.invoke\('local:ensureDirectory', directoryPath\)/, 'Preload must expose local:ensureDirectory.');

assert.match(main, /function listLocalDirectory\(directoryPath\?: string, showHiddenFiles = false\): LocalDirectoryResult/, 'Main process must list local Mac folders.');
assert.match(main, /directoryPath \|\| app\.getPath\('home'\)/, 'Mac pane must default to the user Home folder, not Desktop.');
assert.doesNotMatch(main, /directoryPath \|\| app\.getPath\('desktop'\)/, 'Mac pane startup must not expose Desktop by default.');
assert.match(main, /function getCommonMacFolders\(\): CommonMacFolder\[\]/, 'Main process must provide common Mac folders.');
assert.match(main, /label: 'Downloads'[\s\S]*app\.getPath\('downloads'\)/, 'Common Mac folders must include Downloads.');
assert.match(main, /label: 'Documents'[\s\S]*app\.getPath\('documents'\)/, 'Common Mac folders must include Documents.');
assert.match(main, /label: 'Pictures'[\s\S]*app\.getPath\('pictures'\)/, 'Common Mac folders must include Pictures.');
assert.match(main, /label: 'Movies'[\s\S]*app\.getPath\('videos'\)/, 'Common Mac folders must include Movies.');
assert.match(main, /label: 'Desktop'[\s\S]*app\.getPath\('desktop'\)/, 'Desktop must remain available as an explicit shortcut.');
assert.match(main, /entry\.name\.startsWith\('\.'\)[\s\S]*return \[\];/, 'Mac pane should hide dotfiles and dotfolders by default like Finder.');
assert.match(main, /function ensureLocalDirectory\(directoryPath: string\): LocalDirectoryResult/, 'Main process must create local Mac folders.');
assert.match(main, /ipcMain\.handle\('local:listDirectory'/, 'Main process must register local:listDirectory.');
assert.match(main, /ipcMain\.handle\('local:getCommonFolders', getCommonMacFolders\)/, 'Main process must register local:getCommonFolders.');
assert.match(main, /ipcMain\.handle\('local:ensureDirectory'/, 'Main process must register local:ensureDirectory.');

assert.match(app, /const \[localEntries, setLocalEntries\]/, 'Renderer must keep local Mac entries in state.');
assert.match(app, /const \[commonMacFolders, setCommonMacFolders\]/, 'Renderer must keep common Mac folder shortcuts in state.');
assert.match(app, /Copy to Phone/, 'Renderer must expose a Copy to Phone action for local files.');
assert.match(app, /window\.mtp\.listLocalDirectory\(\s*directoryPath,\s*options\.showHidden \?\? macShowHiddenFiles\s*\)/, 'Renderer must load local directories with the Mac visibility preference.');
assert.match(app, /window\.mtp\.getCommonMacFolders\(\)\.then\(setCommonMacFolders\)/, 'Renderer must load common Mac folders on startup.');
assert.match(app, /window\.mtp\.ensureLocalDirectory\(directory\.path\)/, 'Renderer must preserve empty phone folders on Mac.');
assert.match(app, /function startLocalEntryDrag/, 'Renderer must let Mac pane rows start native drags.');
assert.match(app, /window\.mtp\.startLocalFileDrag\(dragPaths\)/, 'Renderer must drag local Mac rows as real filesystem paths.');
assert.match(app, /draggable\s+className=\{`local-row/, 'Local rows must be draggable.');
assert.match(app, /className="local-column-header"/, 'Local pane must expose Finder-style column headers.');
assert.match(app, /className="local-modified"/, 'Local rows must show modified dates.');
assert.match(app, /className="local-kind"/, 'Local rows must show item kind.');
assert.match(app, /const \[localSortKey, setLocalSortKey\]/, 'Renderer must keep Mac pane sort state.');
assert.match(app, /const sortedLocalEntries = useMemo/, 'Renderer must derive visible Mac rows from the current sort.');
assert.match(app, /function compareLocalEntries/, 'Renderer must sort Mac rows by column values.');
assert.match(app, /return 'Home';/, 'Mac pane title should label the user home directory as Home.');
assert.match(app, /function toggleLocalSort/, 'Mac column headers must be able to toggle sorting.');
assert.match(app, /sortedLocalEntries\.map/, 'Mac pane rendering must use the sorted visible row order.');
assert.match(app, /const \[localBackStack, setLocalBackStack\]/, 'Mac pane must keep back navigation history.');
assert.match(app, /const \[localForwardStack, setLocalForwardStack\]/, 'Mac pane must keep forward navigation history.');
assert.match(app, /const localCrumbs = useMemo/, 'Mac pane must derive breadcrumbs from the current path.');
assert.match(app, /function goBackLocalDirectory/, 'Mac pane must support Back navigation.');
assert.match(app, /function goForwardLocalDirectory/, 'Mac pane must support Forward navigation.');
assert.match(app, /className="local-breadcrumbs"/, 'Mac pane must render clickable path breadcrumbs.');
assert.match(app, /className="common-folder-shortcuts"/, 'Mac pane must render common user-folder shortcuts.');
assert.match(app, /navigateLocalDirectory\(folder\.path\)/, 'Common folder shortcuts must use normal Mac folder navigation.');
assert.match(app, /MAC_PANE_WIDTH_STORAGE_KEY/, 'Renderer must persist the Mac pane width preference.');
assert.match(app, /const \[macPaneWidth, setMacPaneWidth\]/, 'Renderer must store a resizable Mac pane width.');
assert.match(app, /ref=\{workspaceRef\}/, 'Workspace must be measurable for pane-width clamping.');
assert.match(app, /className=\{`pane-resizer/, 'Renderer must expose a draggable pane divider.');
assert.match(app, /onPointerDown=\{startPaneResize\}/, 'Pane divider must support pointer resizing.');
assert.match(app, /onKeyDown=\{handlePaneResizeKeyDown\}/, 'Pane divider must support keyboard resizing.');
assert.match(main, /fileStat\.isFile\(\) \|\| fileStat\.isDirectory\(\)/, 'Native drag must support local folders as well as files.');

assert.match(styles, /\.local-list/, 'Local pane must have dedicated list styling.');
assert.match(styles, /\.common-folder-shortcuts/, 'Common Mac folder shortcuts must have dedicated styling.');
assert.doesNotMatch(styles, /max-height:\s*210px/, 'Local Mac pane must not be capped to the old tiny list height.');
assert.match(styles, /--mac-pane-width/, 'Workspace must use a persisted CSS variable for Mac pane width.');
assert.match(styles, /grid-template-columns:\s*246px minmax\(420px, 1fr\) 8px minmax\(400px, var\(--mac-pane-width, 460px\)\)/, 'Workspace must reserve resizable desktop-width phone and Mac panes.');
assert.match(styles, /\.pane-resizer\s*\{[\s\S]*cursor:\s*col-resize/, 'Pane divider must look and behave like a resize handle.');
assert.match(styles, /grid-template-columns: 20px minmax\(120px, 1fr\) 84px 62px 56px/, 'Local rows must use stable Finder-style columns without horizontal scrolling.');
assert.match(styles, /\.local-browser\s*\{[\s\S]*overflow-x:\s*hidden/, 'Local Mac pane should not show a horizontal scrollbar in normal use.');
assert.match(styles, /\.local-column-header button/, 'Local column headers must be styled as compact sortable controls.');
assert.match(styles, /\.local-column-header button\.active/, 'Active Mac sort column must be visually distinguishable.');
assert.match(styles, /\.local-nav-buttons/, 'Mac navigation controls must have compact styling.');
assert.match(styles, /\.local-breadcrumbs/, 'Mac breadcrumbs must have dedicated compact styling.');
assert.match(styles, /\.local-pane\s*\{[\s\S]*grid-template-rows:\s*auto auto auto auto auto auto minmax\(0, 1fr\)/, 'Mac pane grid must reserve rows for title, folder picker, shortcuts, breadcrumbs, browser controls, actions, and the scrollable file view.');
assert.match(styles, /\.queue-pane\s*\{[\s\S]*flex-direction:\s*column/, 'Right pane must stack the Mac browser above the transfer queue.');
assert.match(styles, /\.queue-header\s*\{[\s\S]*flex:\s*1 1 360px/, 'Mac browser must receive the primary height in the right pane.');
assert.match(styles, /\.queue-list\.empty\s*\{[\s\S]*flex:\s*0 0 auto/, 'Empty transfer history must not reserve space from the Mac browser.');

console.log('Local pane contract check passed.');
