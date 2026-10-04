import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [types, preload, main, app, styles, nativeHelper, checklist, architecture] = await Promise.all([
  readProjectFile('src/shared/types.ts'),
  readProjectFile('src/preload/index.ts'),
  readProjectFile('src/main/index.ts'),
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('src/renderer/src/styles.css'),
  readProjectFile('src/native/mtp-json.c'),
  readProjectFile('docs/manual-test-checklist.md'),
  readProjectFile('docs/architecture.md')
]);

assert.match(
  types,
  /cancelFolderListing: \(\) => Promise<boolean>;/,
  'MtpApi must expose cancellation for long folder listings.'
);
assert.match(types, /export interface FolderListProgress/, 'Shared types must expose measurable listing progress.');
assert.match(types, /onFolderListProgress:/, 'Renderer API must expose listing progress events.');
assert.match(preload, /folder-list:progress/, 'Preload must forward listing progress without exposing Electron.');
assert.match(main, /reportProgress[\s\S]*folder-list:progress/, 'Main must forward native list progress with folder identity.');
assert.match(app, /currentFolderProgressPercent/, 'The active folder banner must render an exact percent when available.');
assert.match(styles, /folder-progress-fill\.determinate/, 'Determinate listing progress must not use the indeterminate animation.');
assert.match(nativeHelper, /session_list_progress_callback/, 'The Samsung fallback must emit listing progress.');
assert.match(
  nativeHelper,
  /if \(\*fallback_files == NULL\) \{\s*\*fallback_attempted = 0;/,
  'A failed Samsung full-index scan must remain retryable in the same session.'
);
assert.match(
  nativeHelper,
  /Retry will try again without reconnecting\./,
  'A failed Samsung index scan must explain that Retry does not require reconnecting.'
);
assert.doesNotMatch(
  nativeHelper,
  /Reconnect the phone before trying again\./,
  'Folder-list failure must not instruct users to reconnect when the app can retry.'
);

assert.match(
  preload,
  /cancelFolderListing: \(\) => ipcRenderer\.invoke\('mtp:cancelFolderListing'\)/,
  'Preload must expose folder-list cancellation.'
);

assert.match(
  main,
  /function cancelFolderListing\(\): boolean/,
  'Main process must own cancellation of active native folder listing commands.'
);

assert.match(
  main,
  /command\?\.name === 'list' \|\| command\?\.name === 'inventory'/,
  'Folder-list cancellation must be limited to browser list or inventory commands.'
);

assert.match(
  main,
  /rejectQueuedCommands\(sessionQueue\)/,
  'Folder-list cancellation must remove queued normal list commands before they run later.'
);

assert.match(
  main,
  /ipcMain\.handle\('mtp:cancelFolderListing', \(\) => cancelFolderListing\(\)\)/,
  'Main process must register folder-list cancellation IPC.'
);

assert.match(
  app,
  /folderLoadTokens/,
  'Renderer must ignore stale folder-list results after Stop or navigation.'
);

assert.match(
  app,
  /function stopFolderListing\(\)/,
  'Renderer must provide a Stop action for long folder listings.'
);

assert.match(
  app,
  /Folder listing stopped\. Open another folder, press Retry, or check the phone again\./,
  'Stopped folder listings must show a plain-language recovery message.'
);

assert.match(app, />Stop</, 'Folder loading banner must expose a Stop button.');
assert.match(app, />Retry</, 'Stopped or failed folder listing must expose a Retry button.');
assert.match(styles, /\.folder-stop-button/, 'Stop listing control must have dedicated styling.');
assert.match(styles, /\.folder-error-banner/, 'Stopped folder listing error must have dedicated styling.');
assert.match(nativeHelper, /empty_storage_root_message/, 'Native helper must not report an empty Internal storage root as a successful folder list.');
assert.match(nativeHelper, /LIBMTP_Get_Errorstack/, 'Native helper must inspect libmtp folder-list errors.');
assert.match(
  nativeHelper,
  /files == NULL && \(list_error != NULL \|\| parent_id == ROOT_PARENT_ID\)/,
  'Native helper must turn root-list NULL results into retryable folder errors.'
);
assert.match(checklist, /Stop/, 'Manual checklist must cover stopping a long folder listing.');
assert.match(architecture, /Stop listing/, 'Architecture docs must describe the long-folder escape hatch.');
assert.match(architecture, /NULL storage-root result is not treated as an empty folder/, 'Architecture docs must document the false-empty root guard.');

console.log('Folder listing contract check passed.');
