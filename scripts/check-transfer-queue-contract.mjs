import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [app, main, styles, readme, checklist, architecture] = await Promise.all([
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('src/main/index.ts'),
  readProjectFile('src/renderer/src/styles.css'),
  readProjectFile('README.md'),
  readProjectFile('docs/manual-test-checklist.md'),
  readProjectFile('docs/architecture.md')
]);

assert.match(app, /const queueSummary = useMemo/, 'Renderer must compute aggregate transfer queue state.');
assert.match(app, /const visibleQueueJobs = jobs;/, 'Every real transfer job must be visible in the queue.');
assert.match(app, /function mergeTransferJobs/, 'Renderer must merge transfer jobs by id before showing queue totals.');
assert.match(app, /seenJobIds\.has\(job\.id\)/, 'Transfer queue merge must de-duplicate repeated queued/event jobs.');
assert.doesNotMatch(
  app,
  /\[\.\.\.queued,\s*\.\.\.currentJobs\]/,
  'Queued IPC responses must not be blindly prepended because transfer events can report the same jobs.'
);
assert.match(app, /visibleQueueJobs\.map/, 'Visible queue rendering must use the filtered job list.');
assert.match(app, /activeTransfers/, 'Queue summary must track active copy jobs.');
assert.match(app, /const connectionStateClass =/, 'Top connection pill must derive its state from queue activity.');
assert.match(app, /queueSummary\.activeTransfers[\s\S]*'transfer-active'/, 'Top connection pill must show active transfers.');
assert.match(app, /role="status"[\s\S]*aria-live="polite"/, 'Top connection pill must announce transfer-active state changes.');
assert.match(app, /'Completed'/, 'Completed-only queues must be labeled as completed, not transferring.');
assert.match(app, /<span>Finished<\/span>/, 'Completed queue items must stop showing stale speed and ETA metadata.');
assert.doesNotMatch(app, /activePreparations|queuedPreparations|preparationOnly/, 'Removed drag-cache preparation must not remain in queue state.');
assert.match(app, /transferredBytes/, 'Queue summary must track transferred bytes.');
assert.match(app, /speedBytesPerSecond/, 'Queue summary must track aggregate transfer speed.');
assert.match(app, /remainingBytes/, 'Queue summary must track remaining bytes for ETA.');
assert.match(app, /etaSeconds/, 'Queue summary must compute aggregate ETA.');
assert.match(app, /copied of/, 'Queue summary must explain copied bytes in plain language.');
assert.match(app, /ETA \{formatDuration\(queueSummary\.etaSeconds\)\}/, 'Queue summary must show aggregate ETA.');
assert.match(app, /function clearFinishedTransfers/, 'Queue must expose a clear-finished action.');
assert.match(app, /async function cancelAllTransfers/, 'Queue must expose a cancel-all action.');
assert.match(app, /window\.mtp\.cancelTransfer\(job\.id\)/, 'Cancel-all must use the existing transfer cancel IPC.');
assert.match(app, /Promise\.allSettled/, 'Cancel-all must tolerate individual cancel IPC failures.');
assert.match(app, /aria-label="Overall transfer progress"/, 'Aggregate queue progress must be exposed as a progressbar.');
assert.match(app, /Clear Finished/, 'Queue summary must show a clear-finished control.');
assert.match(app, /Cancel All/, 'Queue summary must show a cancel-all control.');
assert.match(
  app,
  /event\.type === 'completed'[\s\S]*event\.job\.direction === 'download'[\s\S]*event\.job\.destinationDirectory === localPath[\s\S]*loadLocalDirectory\(localPath\)/,
  'A completed download must refresh the open Mac destination folder.'
);

assert.match(main, /const knownTotal = job\.size > 0 \? job\.size : job\.totalBytes/, 'Transfer progress must prefer known file sizes.');
assert.match(main, /Math\.min\(Math\.max\(reportedTransferred, 0\), job\.totalBytes\)/, 'Transfer progress must clamp callback bytes to the known total.');
assert.match(main, /job\.totalBytes = job\.size > 0 \? job\.size : job\.totalBytes/, 'Completed transfers must keep the known file size as the final total.');
assert.match(main, /const TRANSFER_COMMAND_IDLE_TIMEOUT_MS = 30 \* 60_000;/, 'Large transfers must use a named idle timeout, not an implicit wall-clock literal.');
assert.match(main, /function armCommandTimer\(command: SessionCommand, onTimeout: \(\) => void\): void/, 'Session command timers must be reusable so transfer progress can refresh them.');
assert.match(
  main,
  /payload\.event === 'progress'[\s\S]*armCommandTimer\(command,[\s\S]*destroyMtpSession\(`MTP session command timed out after \$\{command\.timeoutMs\}ms\.`, true\)/,
  'Normal transfer progress must refresh the session command timeout.'
);
assert.match(main, /TRANSFER_COMMAND_IDLE_TIMEOUT_MS/, 'Transfer jobs must use the transfer idle timeout constant.');

assert.match(styles, /\.queue-summary/, 'Queue summary must have dedicated styling.');
assert.match(styles, /\.queue-total-progress/, 'Aggregate queue progress must have stable progress styling.');
assert.match(styles, /\.state-transfer-active/, 'Transfer-active connection state must have dedicated styling.');
assert.match(styles, /\.state-preparing/, 'Preparing connection state must have dedicated styling.');
assert.match(styles, /flex-wrap:\s*wrap/, 'Queue summary actions must wrap in the narrow sidebar.');
assert.match(styles, /\.danger-button/, 'Cancel-all action must have distinct danger styling.');

assert.match(readme, /copied-of-total bytes, active speed, ETA/, 'README must document queue ETA.');
assert.match(readme, /4GB\+ copies are allowed to keep running while progress events arrive/, 'README must document large transfer timeout behavior.');
assert.match(checklist, /copied-of-total bytes, active speed, ETA/, 'Manual checklist must cover queue ETA.');
assert.match(checklist, /4GB\+ video/, 'Manual checklist must cover a 4GB+ transfer when available.');
assert.match(architecture, /aggregate ETA from remaining bytes/, 'Architecture note must explain aggregate queue ETA.');
assert.match(architecture, /top connection pill switches to Transferring/, 'Architecture note must document transfer-active state.');
assert.match(architecture, /idle timeout is refreshed on native progress events/, 'Architecture note must document progress-aware transfer timeout behavior.');

console.log('Transfer queue contract check passed.');
