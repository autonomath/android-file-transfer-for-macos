import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [app, readme, checklist, architecture] = await Promise.all([
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('README.md'),
  readProjectFile('docs/manual-test-checklist.md'),
  readProjectFile('docs/architecture.md')
]);

assert.match(app, /phoneSelectionAnchorKey\s*=\s*useRef<string \| null>\(null\)/, 'Phone selection must keep a range anchor.');
assert.match(app, /localSelectionAnchorPath\s*=\s*useRef<string \| null>\(null\)/, 'Mac selection must keep a range anchor.');
assert.match(app, /function toggleRowSelection\(row: BrowserRow,\s*additive: boolean,\s*range: boolean\)/, 'Phone selection helper must accept range mode.');
assert.match(app, /function toggleLocalSelection\(entry: LocalEntry,\s*additive: boolean,\s*range: boolean\)/, 'Mac selection helper must accept range mode.');
assert.match(app, /function summarizePhoneSelection\(rows: BrowserRow\[\]\): string/, 'Phone pane must summarize selected items.');
assert.match(app, /function summarizeLocalSelection\(entries: LocalEntry\[\]\): string/, 'Mac pane must summarize selected items.');
assert.match(app, /const phoneSelectionSummary = summarizePhoneSelection\(selectedRows\)/, 'Renderer must derive a phone selection summary.');
assert.match(app, /const localSelectionSummary = summarizeLocalSelection\(selectedLocalEntries\)/, 'Renderer must derive a Mac selection summary.');
assert.match(app, /phoneSelectionSummary \? `\$\{phoneSelectionSummary\}\. \$\{phoneSelectionGuidance\}` : phoneSelectionGuidance/, 'Phone summary bar must switch from folder guidance to selected-item feedback.');
assert.match(
  app,
  /className="transfer-bar-status" title=\{localSelectionStatus\}[\s\S]*localSelectionSummary/,
  'Mac action strip must show selected-item feedback.'
);
assert.match(app, /Use Copy to Mac, Cmd\+C then Cmd\+V, or drag selected files directly to a destination\./, 'Phone selected feedback must name direct dragging.');
assert.match(app, /Use Copy to Phone, Cmd\+C then Cmd\+V, right-click, or drag from the Mac pane\./, 'Mac selected feedback must name the next safe actions.');
assert.match(app, /rows\.slice\(start,\s*end \+ 1\)\.map\(\(candidate\) => candidate\.key\)/, 'Phone range selection must use visible row order.');
assert.match(app, /sortedLocalEntries\.slice\(start,\s*end \+ 1\)\.map\(\(candidate\) => candidate\.path\)/, 'Mac range selection must use visible local row order.');
assert.match(app, /toggleRowSelection\(row,\s*event\.metaKey \|\| event\.ctrlKey,\s*event\.shiftKey\)/, 'Phone list/grid clicks must pass shiftKey.');
assert.match(app, /toggleLocalSelection\(entry,\s*event\.metaKey \|\| event\.ctrlKey,\s*event\.shiftKey\)/, 'Mac row clicks must pass shiftKey.');
assert.match(readme, /Shift-click/, 'README must document Shift-click selection.');
assert.match(readme, /selection summaries/, 'README must document selected-item summaries.');
assert.match(checklist, /Shift-click/, 'Manual checklist must cover Shift-click selection.');
assert.match(checklist, /selected-item summary/, 'Manual checklist must cover selected-item summaries.');
assert.match(architecture, /Shift-click/, 'Architecture docs must mention Shift-click selection behavior.');
assert.match(architecture, /selection summary/, 'Architecture docs must mention selected-item summaries.');

console.log('Selection contract check passed.');
