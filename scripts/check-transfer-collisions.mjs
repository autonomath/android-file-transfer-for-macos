import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporaryDirectory = resolve(root, '.tmp');
await mkdir(temporaryDirectory, { recursive: true });

async function compile(sourceName, outputName, transform = (value) => value) {
  const source = await readFile(resolve(root, 'src/shared', sourceName), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  await writeFile(resolve(temporaryDirectory, outputName), transform(compiled), 'utf8');
}

await compile('phoneMutation.ts', 'phoneMutation-collision-check.mjs');
await compile(
  'transferCollision.ts',
  'transferCollision-check.mjs',
  (value) => value.replace("'./phoneMutation'", "'./phoneMutation-collision-check.mjs'")
);
const phoneReplacementSource = await readFile(resolve(root, 'src/main/phoneReplacement.ts'), 'utf8');
const phoneReplacementCompiled = ts.transpileModule(phoneReplacementSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
await writeFile(
  resolve(temporaryDirectory, 'phoneReplacement-check.mjs'),
  phoneReplacementCompiled,
  'utf8'
);

const collision = await import(
  `${pathToFileURL(resolve(temporaryDirectory, 'transferCollision-check.mjs')).href}?t=${Date.now()}`
);
const phoneMutation = await import(
  `${pathToFileURL(resolve(temporaryDirectory, 'phoneMutation-collision-check.mjs')).href}?t=${Date.now()}`
);
const { publishStagedPhoneReplacement } = await import(
  `${pathToFileURL(resolve(temporaryDirectory, 'phoneReplacement-check.mjs')).href}?t=${Date.now()}`
);

assert.equal(collision.keepBothPhoneName('video.mp4'), 'video 2.mp4');
assert.equal(
  collision.nextKeepBothPhoneName('video.mp4', new Set(['video.mp4', 'video 2.mp4'])),
  'video 3.mp4'
);
assert.throws(() => collision.keepBothPhoneName('video.mp4', 1), /starting at 2/);

const longName = `${'é'.repeat(180)}.jpg`;
const bounded = collision.keepBothPhoneName(longName, 12);
assert.equal(phoneMutation.validatePhoneItemName(bounded), null);
assert.ok(new TextEncoder().encode(bounded).byteLength <= phoneMutation.MAX_PHONE_ITEM_NAME_BYTES);
assert.ok(bounded.endsWith(' 12.jpg'));

const stage = collision.temporaryPhoneTransferName('holiday.mov', 'stage', 'A1B2-C3D4-E5F6-7788');
const backup = collision.temporaryPhoneTransferName('holiday.mov', 'backup', 'A1B2-C3D4-E5F6-7788');
assert.equal(stage, '.aft-stage-a1b2c3d4e5f6.mov');
assert.equal(backup, '.aft-backup-a1b2c3d4e5f6.mov');
assert.equal(phoneMutation.validatePhoneItemName(stage), null);
assert.equal(phoneMutation.validatePhoneItemName(backup), null);

const existing = { objectId: 10, storageId: 1, parentId: 20, name: 'holiday.mov', kind: 'file' };
const staged = { objectId: 11, storageId: 1, parentId: 20, name: stage, kind: 'file' };

{
  const calls = [];
  const result = await publishStagedPhoneReplacement({
    existing,
    staged,
    finalName: 'holiday.mov',
    backupName: backup,
    mutate: async (command, target, newName) => {
      calls.push([command, target.name, newName]);
      if (command === 'rename-item') {
        return { ok: true, event: 'complete', verified: true, actualName: newName };
      }
      return { ok: true, event: 'complete' };
    }
  });
  assert.match(result.message, /after verifying/);
  assert.deepEqual(calls, [
    ['rename-item', 'holiday.mov', backup],
    ['rename-item', stage, 'holiday.mov'],
    ['delete-item', backup, undefined]
  ]);
}

{
  const calls = [];
  await assert.rejects(
    publishStagedPhoneReplacement({
      existing,
      staged,
      finalName: 'holiday.mov',
      backupName: backup,
      mutate: async (command, target, newName) => {
        calls.push([command, target.name, newName]);
        if (command === 'rename-item' && target.name === stage) {
          return { ok: false, event: 'failed', message: 'publish rejected' };
        }
        if (command === 'rename-item') {
          return { ok: true, event: 'complete', verified: true, actualName: newName };
        }
        return { ok: true, event: 'complete' };
      }
    }),
    /publish rejected/
  );
  assert.deepEqual(calls, [
    ['rename-item', 'holiday.mov', backup],
    ['rename-item', stage, 'holiday.mov'],
    ['rename-item', backup, 'holiday.mov'],
    ['delete-item', stage, undefined]
  ]);
}

{
  const result = await publishStagedPhoneReplacement({
    existing,
    staged,
    finalName: 'holiday.mov',
    backupName: backup,
    mutate: async (command, _target, newName) => {
      if (command === 'delete-item') {
        return { ok: false, event: 'failed', message: 'delete rejected' };
      }
      return { ok: true, event: 'complete', verified: true, actualName: newName };
    }
  });
  assert.match(result.message, /old copy remains/);
}

{
  const calls = [];
  await assert.rejects(
    publishStagedPhoneReplacement({
      existing,
      staged,
      finalName: 'holiday.mov',
      backupName: backup,
      mutate: async (command, target, newName) => {
        calls.push([command, target.name, newName]);
        if (command === 'rename-item') {
          throw new Error('connection lost');
        }
        return { ok: true, event: 'complete' };
      }
    }),
    /existing phone file could not be prepared/
  );
  assert.deepEqual(calls, [
    ['rename-item', 'holiday.mov', backup],
    ['delete-item', stage, undefined]
  ]);
}

console.log('Transfer collision behavior check passed.');
