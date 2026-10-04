import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [app, main, native, phoneReplacement, types] = await Promise.all([
  readFile(resolve(root, 'src/renderer/src/App.tsx'), 'utf8'),
  readFile(resolve(root, 'src/main/index.ts'), 'utf8'),
  readFile(resolve(root, 'src/native/mtp-json.c'), 'utf8'),
  readFile(resolve(root, 'src/main/phoneReplacement.ts'), 'utf8'),
  readFile(resolve(root, 'src/shared/types.ts'), 'utf8')
]);

assert.match(app, /planLocalEntriesForUpload/, 'Folder upload planning must remain present.');
assert.match(app, /if \(!result\.ok\)[\s\S]*Could not check the destination phone folder/, 'A failed destination listing must stop upload planning.');
assert.match(app, /existingDestination:[\s\S]*objectId: existing\.id/, 'File conflicts must retain the exact phone object identity for the main process.');
assert.match(app, /existingDestination:[\s\S]*size: existing\.size[\s\S]*modified: existing\.modified/, 'Replacement identity must retain the listed phone file size and available modification time.');
assert.match(app, /sourcePath: entry\.path,[\s\S]*sourceIdentity: entry\.identity/, 'Upload requests must retain the exact Mac listing identity.');
assert.match(app, /nextKeepBothPhoneName\(entry\.name, occupiedNames\)/, 'Keep Both must select a visible numbered phone filename.');
assert.doesNotMatch(app, /existing\.size[\s\S]{0,120}skippedDuplicate/, 'Name and size must not be treated as content identity.');
assert.match(app, /MAX_PLANNED_MAC_FOLDERS/, 'Recursive upload planning must cap folder count.');
assert.match(app, /MAX_PLANNED_MAC_DEPTH/, 'Recursive upload planning must cap depth.');

assert.match(main, /local symbolic link skipped during phone upload planning/, 'Local upload traversal must skip symlinks.');
assert.match(main, /const sourceStat = lstatSync\(request\.sourcePath\)/, 'Upload enqueue must revalidate sources without following symlinks.');
assert.match(types, /interface UploadRequest[\s\S]*sourceIdentity: LocalSourceIdentity/, 'Upload requests must carry their Mac listing identity.');
assert.match(types, /interface PhoneMutationTarget[\s\S]*size\?: number[\s\S]*modified\?: number/, 'Phone replacement targets must carry file listing metadata.');
assert.match(main, /sameLocalSourceIdentity\(currentSourceIdentity, request\.sourceIdentity\)/, 'Upload enqueue must reject a source changed since the Mac listing.');
assert.match(main, /uploadSourceIdentityError[\s\S]*fileIdentitySnapshot\(job\.sourcePath\)[\s\S]*sameLocalSourceIdentity/, 'A queued upload must re-read its source identity.');
assert.match(
  main,
  /encodePhoneCommandName\(destinationName\),[\s\S]*String\(job\.sourceIdentity\.device\),[\s\S]*String\(job\.sourceIdentity\.inode\),[\s\S]*String\(job\.sourceIdentity\.size\),[\s\S]*String\(job\.sourceIdentity\.modifiedMs\),[\s\S]*String\(job\.sourceIdentity\.changedMs\),[\s\S]*job\.sourcePath/,
  'The native upload command must receive every queued source identity field before the source path.'
);
const processTransferQueueBlock = main.match(
  /function processTransferQueue\(\): void \{[\s\S]*?(?=\nfunction enqueueDownloads)/
)?.[0];
assert.ok(processTransferQueueBlock, 'Transfer queue implementation must remain present.');
assert.ok(
  processTransferQueueBlock.indexOf('uploadSourceIdentityError(job)') <
    processTransferQueueBlock.indexOf("job.status = 'active'"),
  'Upload identity must be revalidated before a queued job becomes active.'
);
assert.match(main, /deviceConnectionId: request\.deviceConnectionId/, 'Upload jobs must remain bound to the selected phone attachment.');
assert.match(main, /chooseTransferCollisionAction\([\s\S]*'upload'/, 'Phone conflicts must require one explicit batch decision.');
assert.match(main, /finalizePhoneReplacement/, 'Phone replacement must use a staged transaction.');
assert.match(main, /uploadResult\.verified !== true[\s\S]*existing file was kept/, 'The existing phone file must stay untouched until the staging upload is verified.');
assert.match(phoneReplacement, /mutate\('rename-item', existing, backupName\)[\s\S]*mutate\('rename-item', staged, finalName\)/, 'Phone replacement must keep a backup until the staged item is published.');
assert.match(phoneReplacement, /mutate\('delete-item', backup\)/, 'The old phone backup may be deleted only after publication.');

const nativeSendBlock = native.match(
  /static int send_file_to_device\([\s\S]*?(?=\nstatic uint32_t verified_uploaded_file_id)/
)?.[0];
assert.ok(nativeSendBlock, 'Native upload implementation must remain present.');
assert.match(nativeSendBlock, /open\(source, O_RDONLY \| O_CLOEXEC \| O_NOFOLLOW\)/, 'The native upload helper must open the source without following symlinks.');
assert.match(nativeSendBlock, /fstat\(source_fd, &source_stat\)/, 'The opened source descriptor must be inspected.');
assert.match(nativeSendBlock, /source_stat_matches_identity\(&source_stat, expected_source_identity\)/, 'The descriptor metadata must match the queued identity.');
assert.match(nativeSendBlock, /LIBMTP_Send_File_From_File_Descriptor/, 'libmtp must read from the same verified descriptor.');
assert.doesNotMatch(nativeSendBlock, /LIBMTP_Send_File_From_File\(/, 'A verified upload must not reopen the source path inside libmtp.');
assert.ok(
  nativeSendBlock.lastIndexOf('source_stat_matches_identity(&source_stat, expected_source_identity)') <
    nativeSendBlock.indexOf('LIBMTP_Send_File_From_File_Descriptor'),
  'The queued identity must be checked immediately before libmtp reads the descriptor.'
);
assert.match(native, /strcmp\(current->filename, filename\) == 0[\s\S]*status = 2/, 'Any same-name phone item must block an upload.');
assert.match(native, /decode_phone_item_name\(destination_name_token, 1, &destination_name\)/, 'The native upload destination name must use the encoded command protocol.');
assert.match(native, /parse_u64\(source_device_token, &source_identity\.device\)[\s\S]*parse_u64\(source_inode_token, &source_identity\.inode\)[\s\S]*parse_u64\(source_size_token, &source_identity\.size\)[\s\S]*parse_finite_double\(source_modified_token, &source_identity\.modified_ms\)[\s\S]*parse_finite_double\(source_changed_token, &source_identity\.changed_ms\)/, 'The native session protocol must parse every queued source identity field.');
assert.match(native, /send_file_to_device\([\s\S]*destination_name/, 'The native upload must use the explicit destination name without copying locally first.');
assert.match(native, /result == -6[\s\S]*changed after it was queued/, 'A native identity mismatch must fail without uploading.');
assert.doesNotMatch(native, /skippedDuplicate/, 'The native helper must not claim same-size files are duplicates.');
assert.match(native, /Nothing was overwritten/, 'Name conflicts must be reported as non-destructive failures.');

const matcherSource = main.match(
  /function sameLocalSourceIdentity\([\s\S]*?\n\}/
)?.[0];
assert.ok(matcherSource, 'Local source identity comparator must remain present.');
const cancellationSource = main.match(
  /function shouldReportTransferCanceled\([\s\S]*?\n\}/
)?.[0];
assert.ok(cancellationSource, 'Late-cancellation outcome helper must remain present.');
const matcherModule = ts.transpileModule(
  `${matcherSource}\n${cancellationSource}\nexport { sameLocalSourceIdentity, shouldReportTransferCanceled };`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }
).outputText;
const { sameLocalSourceIdentity, shouldReportTransferCanceled } = await import(
  `data:text/javascript;base64,${Buffer.from(matcherModule).toString('base64')}`
);
const queuedIdentity = {
  device: 11,
  inode: 22,
  size: 33,
  modifiedMs: 44,
  changedMs: 55
};
assert.equal(sameLocalSourceIdentity({ ...queuedIdentity }, queuedIdentity), true);
for (const field of ['device', 'inode', 'size', 'modifiedMs', 'changedMs']) {
  assert.equal(
    sameLocalSourceIdentity(
      { ...queuedIdentity, [field]: queuedIdentity[field] + 1 },
      queuedIdentity
    ),
    false,
    `A changed ${field} must reject the queued upload source.`
  );
}
assert.equal(shouldReportTransferCanceled(true, false), true);
assert.equal(
  shouldReportTransferCanceled(true, true),
  false,
  'Cancellation must not hide a replacement transaction outcome or its backup recovery details.'
);
assert.equal(shouldReportTransferCanceled(false, true), false);
const runTransferJobBlock = main.match(
  /async function runTransferJob\(job: TransferJob\): Promise<void> \{[\s\S]*?(?=\nfunction processTransferQueue)/
)?.[0];
assert.ok(runTransferJobBlock, 'Transfer execution implementation must remain present.');
assert.match(
  runTransferJobBlock,
  /phoneReplacementStarted = true;[\s\S]*finalizePhoneReplacement/
);
assert.equal(
  (runTransferJobBlock.match(/shouldReportTransferCanceled\(activeWasCanceled, phoneReplacementStarted\)/g) ?? []).length,
  2,
  'Both normal and exceptional transfer outcomes must preserve late replacement recovery details.'
);
assert.match(
  runTransferJobBlock,
  /job\.error = phoneReplacementStarted[\s\S]*Transfer failed\. \$\{rawFailure\}[\s\S]*sessionErrorMessage/,
  'Replacement recovery errors must bypass generic connection-error masking.'
);

console.log('Upload safety contract check passed.');
