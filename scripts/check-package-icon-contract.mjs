import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const iconPath = resolve(root, 'build/icon.icns');
const iconSourcePath = resolve(root, 'build/app-icon.svg');
const runDevPath = resolve(root, 'scripts/run-dev.sh');
const mainSourcePath = resolve(root, 'src/main/index.ts');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

assert.equal(
  packageJson.build?.mac?.icon,
  'build/icon.icns',
  'macOS package must use the first-party app icon, not Electron defaults.'
);
assert.ok(existsSync(iconPath), 'build/icon.icns must exist for macOS packaging.');
assert.ok(existsSync(iconSourcePath), 'build/app-icon.svg must keep the editable icon source.');
assert.ok(existsSync(runDevPath), 'The development launcher must exist.');
assert.ok(statSync(iconPath).size > 20_000, 'App icon must be a real multi-size .icns asset.');

const iconSource = readFileSync(iconSourcePath, 'utf8');
assert.match(iconSource, /Android File Transfer for macOS|phone|#245d7a|#52634a/s, 'Icon source should be project-owned artwork.');
assert.doesNotMatch(iconSource, /openmtp|ganeshrvel/i, 'Icon source must not reuse OpenMTP branding.');

const runDev = readFileSync(runDevPath, 'utf8');
const mainSource = readFileSync(mainSourcePath, 'utf8');
assert.match(packageJson.scripts?.dev ?? '', /scripts\/run-dev\.sh/, 'npm run dev must use the branded launcher.');
assert.match(runDev, /CFBundleDisplayName Android File Transfer for macOS/, 'The development app bundle must use the product name.');
assert.match(runDev, /CFBundleExecutable Android File Transfer for macOS/, 'The development executable must use the product name.');
assert.match(runDev, /CFBundleIconFile app-icon\.icns/, 'The development app bundle must use the product icon.');
assert.match(runDev, /ELECTRON_EXEC_PATH/, 'electron-vite must launch the branded development bundle.');
assert.match(
  mainSource,
  /app\.setName\(APP_NAME\)/,
  'The Electron runtime name must use the product name in the macOS app menu.'
);
assert.match(
  mainSource,
  /app\.isPackaged && !IS_DEVELOPMENT_RUNTIME/,
  'The branded development executable must not switch native resource lookup to packaged paths.'
);

console.log('Package icon contract check passed.');
