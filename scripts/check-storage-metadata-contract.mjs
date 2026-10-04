import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const app = await readProjectFile('src/renderer/src/App.tsx');

assert.match(
  app,
  /function storageCapacityKnown\(storage: MtpStorage \| undefined\): boolean \{[\s\S]*maxCapacity > 0 \|\| storage\.freeSpace > 0/,
  'Storage capacity must be considered known only when MTP reports a real capacity value.'
);
assert.match(
  app,
  /function formatStorageTotal\(storage: MtpStorage \| undefined\): string \{[\s\S]*Size unavailable[\s\S]*formatBytes\(storage\.maxCapacity\)/,
  'Storage total rendering must avoid showing 0 B when capacity metadata is missing.'
);
assert.match(
  app,
  /function formatStorageFree\(storage: MtpStorage \| undefined\): string \{[\s\S]*Capacity unavailable[\s\S]*formatBytes\(storage\.freeSpace\)/,
  'Storage free-space rendering must explain when capacity metadata is missing.'
);
assert.match(
  app,
  /function storageUsagePercent\(storage: MtpStorage \| undefined\): number \| null \{[\s\S]*storage\.maxCapacity <= 0[\s\S]*Math\.round/,
  'Storage sidebar must compute a bounded used-capacity percentage when total capacity is available.'
);
assert.match(
  app,
  /function formatStorageUsage\(storage: MtpStorage \| undefined\): string \{[\s\S]*used of[\s\S]*formatBytes\(storage\.maxCapacity\)/,
  'Storage sidebar must explain used capacity as well as free space.'
);
assert.match(
  app,
  /className="storage-usage">\{formatStorageUsage\(storage\)\}<\/small>/,
  'Storage sidebar must show used-of-total capacity text.'
);
assert.match(
  app,
  /className="storage-free">\{formatStorageFree\(storage\)\}<\/small>/,
  'Storage sidebar must use the metadata-aware free-space formatter.'
);
assert.match(
  app,
  /className="storage-meter"[\s\S]*role="meter"[\s\S]*aria-valuenow=\{usagePercent\}/,
  'Storage sidebar must render an accessible capacity meter when total capacity is known.'
);
assert.match(
  app,
  /row\.kind === 'storage'[\s\S]*formatStorageTotal\(row\.storage\)/,
  'Phone grid storage rows must use the metadata-aware total formatter.'
);
assert.match(
  app,
  /<td>\{formatBrowserRowSize\(row\)\}<\/td>/,
  'Phone list size column must use the metadata-aware row size formatter.'
);
assert.doesNotMatch(
  app,
  /<small>\{formatBytes\(storage\.freeSpace\)\} free<\/small>/,
  'Storage sidebar must not directly render missing free space as 0 B free.'
);
assert.doesNotMatch(
  app,
  /formatBytes\(row\.size\)\} total/,
  'Storage rows must not render missing total capacity as 0 B total.'
);

console.log('Storage metadata contract check passed.');
