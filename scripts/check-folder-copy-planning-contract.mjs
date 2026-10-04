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

assert.match(app, /interface PhoneDownloadPlanningProgress[\s\S]*files: number;[\s\S]*folders: number;[\s\S]*currentName: string;/, 'Renderer must define folder-copy planning progress.');
assert.match(app, /interface PhoneDownloadPlanOptions[\s\S]*onProgress\?: \(progress: PhoneDownloadPlanningProgress\) => void;/, 'Recursive download planning must accept a progress callback.');
assert.match(app, /shouldCancel\?: \(\) => boolean;/, 'Recursive download planning must accept a cancellation callback.');
assert.match(app, /const \[phoneDownloadPlanning, setPhoneDownloadPlanning\] = useState<PhoneDownloadPlanningProgress \| null>\(null\)/, 'Renderer must keep visible folder-copy planning state.');
assert.match(app, /phoneDownloadPlanningCancelRequested = useRef\(false\)/, 'Renderer must track stop requests for folder-copy planning.');
assert.match(app, /phoneDownloadPlanning[\s\S]*\? 'preparing'/, 'Top connection status must switch to preparing during recursive folder-copy planning.');
assert.match(app, /Listing phone folders before the copy starts/, 'Top connection title must explain folder-copy preparation.');
assert.match(app, /function folderCopyPlanningStoppedMessage\(\): string[\s\S]*Folder copy preparation stopped\. Nothing was copied\./, 'Stopped planning must use one plain-language message.');
assert.match(app, /async function stopPhoneDownloadPlanning\(\): Promise<void>/, 'Renderer must expose a Stop handler for folder-copy planning.');
assert.match(app, /phoneDownloadPlanningCancelRequested\.current = true;[\s\S]*window\.mtp\.cancelFolderListing\(\)/, 'Stop must cancel the active native folder-list command.');
assert.match(app, /setPhoneDownloadPlanning\(\{[\s\S]*files: 0,[\s\S]*folders: 0,[\s\S]*currentName: 'selected folders'/, 'Copy to Mac must show immediate planning feedback before recursion starts.');
assert.match(app, /onProgress: includesFolder[\s\S]*setPhoneDownloadPlanning\(progress\)/, 'Copy to Mac must wire recursive planning progress to state.');
assert.match(app, /shouldCancel: \(\) => phoneDownloadPlanningCancelRequested\.current/, 'Copy to Mac must pass cancellation state into the recursive planner.');
assert.match(app, /let plannedFiles = 0;[\s\S]*let plannedFolders = 0;/, 'Recursive planner must count found files and folders.');
assert.match(app, /function reportProgress\(currentName: string\): void[\s\S]*options\.onProgress\?\.\(/, 'Recursive planner must report progress while listing.');
assert.match(app, /function throwIfCanceled\(\): void[\s\S]*options\.shouldCancel\?\.\(\)[\s\S]*folderCopyPlanningStoppedMessage\(\)/, 'Recursive planner must stop before queuing downloads when cancellation is requested.');
assert.match(app, /plannedFiles \+= 1;[\s\S]*reportProgress\(object\.name\)/, 'Planner must update file count as files are found.');
assert.match(app, /plannedFolders \+= 1;[\s\S]*reportProgress\(object\.name\)/, 'Planner must update folder count before listing child folders.');
assert.match(app, /setPhoneDownloadPlanning\(null\)/, 'Planning state must be cleared after completion, errors, or browser reset.');
assert.match(app, /className="transfer-planning-notice"[\s\S]*Preparing folder copy/, 'Queue pane must show a compact preparing-folder-copy card.');
assert.match(app, /className="transfer-planning-stop-button"[\s\S]*Stop/, 'Planning card must expose a Stop button.');
assert.match(app, /aria-label="Preparing folder copy"/, 'Planning progress must be exposed as a progressbar.');
assert.match(styles, /\.transfer-planning-notice/, 'Planning card must have dedicated styling.');
assert.match(styles, /\.transfer-planning-fill[\s\S]*animation: folder-progress/, 'Planning card must use an indeterminate progress bar.');
assert.match(styles, /\.transfer-planning-stop-button/, 'Planning Stop button must have compact styling.');

assert.match(readme, /Preparing folder copy/, 'README must document recursive folder-copy preparation feedback.');
assert.match(readme, /Stop/, 'README must document stopping folder-copy preparation.');
assert.match(checklist, /Preparing folder copy/, 'Manual checklist must cover recursive folder-copy preparation feedback.');
assert.match(checklist, /Stop[\s\S]*Nothing was copied/, 'Manual checklist must cover stopping folder-copy preparation.');
assert.match(architecture, /phoneDownloadPlanning/, 'Architecture docs must describe renderer planning state.');
assert.match(architecture, /before transfer jobs exist/, 'Architecture docs must explain why planning feedback is needed.');
assert.match(architecture, /cancelFolderListing/, 'Architecture docs must explain how Stop cancels active folder listing.');

console.log('Folder copy planning contract check passed.');
