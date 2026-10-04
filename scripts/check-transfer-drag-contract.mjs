import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [types, preload, main, app, native, build] = await Promise.all([
  readProjectFile('src/shared/types.ts'),
  readProjectFile('src/preload/index.ts'),
  readProjectFile('src/main/index.ts'),
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('src/native/file-promise-drag/file_promise_drag.mm'),
  readProjectFile('scripts/build-native.mjs')
]);

assert.doesNotMatch(
  app,
  /dataTransfer\.setData\(['"]text\/plain['"]/,
  'Phone file row drag must not publish text/plain, because Finder creates .textClipping files from it.'
);

assert.match(
  types,
  /startPhoneFilePromiseDrag: \(request: PhoneFilePromiseDragRequest\) => void;/,
  'MtpApi must expose destination-aware phone drag.'
);
assert.match(
  types,
  /startLocalFileDrag: \(filePaths: string\[\]\) => void;/,
  'MtpApi must retain immediate native drag for existing Mac files.'
);
assert.match(
  preload,
  /ipcRenderer\.send\('mtp:startPhoneFilePromiseDrag', request\)/,
  'Preload must start phone promises without waiting for a pre-copy.'
);
assert.match(
  preload,
  /ipcRenderer\.send\('mtp:startLocalFileDrag', filePaths\)/,
  'Preload must expose local native drag separately.'
);
assert.match(
  native,
  /NSFilePromiseProvider/,
  'The native bridge must advertise real macOS file promises.'
);
assert.match(
  native,
  /coordinateWritingItemAtURL/,
  'Promise fulfillment must use NSFileCoordinator.'
);
assert.match(
  native,
  /beginDraggingSessionWithItems/,
  'The bridge must start a native AppKit drag session.'
);
assert.match(
  native,
  /NSFilePromiseReceiver[\s\S]*receivePromisedFilesAtDestination/,
  'The native Mac-pane overlay must receive the same promises into the visible folder.'
);
assert.match(
  native,
  /gPromiseCoordinators\.count == 0[\s\S]*gCoordinator = nil/,
  'The native coordinator must be released after its final promise settles.'
);
assert.match(
  main,
  /async function fulfillPhoneFilePromise[\s\S]*planPromisedPhoneItem[\s\S]*enqueuePromisedDownloads/,
  'Main must wait for an accepted destination before planning and downloading.'
);
assert.match(
  main,
  /destinationPath: job\.destinationPath[\s\S]*expectedSize: job\.size/,
  'Promised downloads must atomically publish to the exact destination URL.'
);
assert.match(
  main,
  /pathIsInside\(resolvedDestination, directory\.path\)/,
  'Promised folder paths must stay under the receiver-provided root.'
);
assert.match(
  main,
  /completePromiseFulfillment[\s\S]*completePromise\(promiseId\)/,
  'AppKit promises must complete only after transfer fulfillment.'
);
assert.match(
  main,
  /const jobs = enqueuePromisedDownloads[\s\S]*remainingJobIds\.add\(job\.id\)[\s\S]*processTransferQueue\(\)/,
  'Promised transfer jobs must be registered with their promise before the queue can start them.'
);
assert.match(
  main,
  /failPromiseFulfillment[\s\S]*rmSync\(fulfillment\.rootPath[\s\S]*completePromise\(promiseId, message\)/,
  'Failed promises must clean their partial output and reject the receiver.'
);
assert.match(
  app,
  /window\.mtp\.startPhoneFilePromiseDrag\(/,
  'Phone rows must begin a promise drag immediately.'
);
assert.match(
  app,
  /Drag phone files directly to Finder, Desktop, another app, or this Mac folder\./,
  'The UI must explain direct dragging without a Ready step.'
);
assert.doesNotMatch(
  `${types}\n${preload}\n${main}\n${app}`,
  /drag-cache|prepareDragFiles|getDragCacheDirectory|Ready badge|dragReadyFiles/,
  'The removed pre-copy cache and Ready workflow must not remain in runtime code.'
);
assert.match(
  main,
  /function removeLegacyPrecopyDirectory[\s\S]*rmSync\(legacyDirectory, \{ recursive: true, force: true \}\)[\s\S]*removeLegacyPrecopyDirectory\(\)/,
  'Startup must remove data left by the obsolete phone drag pre-copy cache.'
);
assert.match(
  app,
  /summarizePhoneObjects/,
  'Renderer must summarize listed phone folders after a slow folder listing completes.'
);

assert.match(
  app,
  /Click to select\. Double-click folders or storage to open them\./,
  'Phone browser must explain ordinary click and drag behavior in regular-user language.'
);

assert.match(
  main,
  /async function planPromisedPhoneItem/,
  'Promised folder planning must live in the main process.'
);
assert.match(
  build,
  /file-promise-drag\.node[\s\S]*adHocSign\(filePromiseOutput\)/,
  'The native promise addon must be built, copied, and signed.'
);

assert.match(
  app,
  /draggable=\{row\.kind === 'file' \|\| row\.kind === 'folder'\}/,
  'Phone folders must be draggable transfer items.'
);

assert.match(
  types,
  /getDesktopDestination: \(\) => Promise<string>;/,
  'MtpApi must expose a Desktop destination helper.'
);

assert.match(
  preload,
  /getDesktopDestination: \(\) => ipcRenderer\.invoke\('mtp:getDesktopDestination'\)/,
  'Preload must expose the Desktop destination helper.'
);

assert.match(
  main,
  /ipcMain\.handle\('mtp:getDesktopDestination', getDesktopDestination\)/,
  'Main process must register the Desktop destination helper.'
);

console.log('Transfer drag contract check passed.');
