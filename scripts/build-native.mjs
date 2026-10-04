import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const source = resolve(root, 'src/native/mtp-json.c');
const filePromiseSourceDir = resolve(root, 'src/native/file-promise-drag');
const resourcesDir = resolve(root, 'resources');
const output = resolve(resourcesDir, 'bin/mtp-json');
const filePromiseOutput = resolve(resourcesDir, 'bin/file-promise-drag.node');
const bundledLibDir = resolve(resourcesDir, 'lib');
const requestedArch = process.env.TARGET_ARCH || process.env.npm_config_arch || process.arch;
const targetArch = requestedArch === 'x86_64' ? 'x64' : requestedArch;
if (targetArch !== 'arm64' && targetArch !== 'x64') {
  throw new Error(`Unsupported native architecture: ${requestedArch}`);
}
const clangArch = targetArch === 'x64' ? 'x86_64' : targetArch;
const declaredPackageMinimumMacOS = require(resolve(root, 'package.json')).build?.mac?.minimumSystemVersion;
if (!declaredPackageMinimumMacOS) {
  throw new Error('package.json must declare build.mac.minimumSystemVersion.');
}
const deploymentTarget = process.env.MACOSX_DEPLOYMENT_TARGET || declaredPackageMinimumMacOS;
const packageBuild = process.env.NATIVE_BUILD_FOR_PACKAGE === '1';
const preparedNativeDepsPrefix = resolve(root, '.native-deps', targetArch);
const requestedNativeDepsPrefix = process.env.NATIVE_DEPS_PREFIX
  ? resolve(process.env.NATIVE_DEPS_PREFIX)
  : null;
if (
  packageBuild &&
  requestedNativeDepsPrefix &&
  requestedNativeDepsPrefix !== preparedNativeDepsPrefix
) {
  throw new Error(
    `Packaging must use the repository native dependencies at ${preparedNativeDepsPrefix}, not ${requestedNativeDepsPrefix}`
  );
}
const nativeDepsPrefix = requestedNativeDepsPrefix ?? preparedNativeDepsPrefix;

if (nativeDepsPrefix && !existsSync(nativeDepsPrefix)) {
  const preparation = ` Run \`npm run native:deps -- ${targetArch}\` first.`;
  throw new Error(`Native dependency prefix does not exist: ${nativeDepsPrefix}.${preparation}`);
}

if (packageBuild) {
  if (deploymentTarget !== declaredPackageMinimumMacOS) {
    throw new Error(
      `Packaging must target macOS ${declaredPackageMinimumMacOS}, not ${deploymentTarget}.`
    );
  }
  const requiredPreparedFiles = [
    'lib/pkgconfig/libmtp.pc',
    'lib/pkgconfig/libusb-1.0.pc',
    'lib/libmtp.9.dylib',
    'lib/libusb-1.0.0.dylib'
  ];
  for (const relativePath of requiredPreparedFiles) {
    const requiredPath = resolve(nativeDepsPrefix, relativePath);
    if (!existsSync(requiredPath)) {
      throw new Error(
        `Prepared native dependency is missing: ${requiredPath}. Run \`npm run native:deps -- ${targetArch}\` before packaging.`
      );
    }
  }
}

const nativePkgConfigDir = nativeDepsPrefix
  ? resolve(nativeDepsPrefix, 'lib/pkgconfig')
  : null;
const nativeEnv = {
  ...process.env,
  MACOSX_DEPLOYMENT_TARGET: deploymentTarget,
  ...(nativeDepsPrefix
    ? packageBuild
      ? {
          PKG_CONFIG_PATH: nativePkgConfigDir,
          PKG_CONFIG_LIBDIR: nativePkgConfigDir
        }
      : {
        PKG_CONFIG_PATH: [
          nativePkgConfigDir,
          process.env.PKG_CONFIG_PATH
        ]
          .filter(Boolean)
          .join(':')
      }
    : {})
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: options.env || nativeEnv
  });

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${details ? `\n${details}` : ''}`);
  }

  return result.stdout?.trim() ?? '';
}

if (packageBuild) {
  run(process.execPath, [
    resolve(root, 'scripts/check-macho.mjs'),
    '--root',
    resolve(nativeDepsPrefix, 'lib'),
    '--arch',
    targetArch,
    '--max-macos',
    declaredPackageMinimumMacOS,
    '--allow-build-paths'
  ]);
}

function nodeGypToolchainEnvironment() {
  const xcodeVersion = spawnSync('xcodebuild', ['-version'], {
    encoding: 'utf8',
    env: nativeEnv
  });
  if (xcodeVersion.status === 0) {
    return { env: nativeEnv, cleanup() {} };
  }

  // Some CLT-only installations lose their pkgutil receipt after a macOS
  // upgrade. node-gyp then refuses to generate a Makefile even though clang,
  // the SDK, and xcrun are all usable. Supply only the version probe that gyp
  // requires; every actual compiler and SDK lookup still uses the selected CLT.
  const sdkVersion = run('xcrun', ['--sdk', 'macosx', '--show-sdk-version'], { capture: true });
  if (!/^\d+(?:\.\d+){1,2}$/.test(sdkVersion)) {
    throw new Error(`Unable to determine an Xcode/CLT version for node-gyp: ${sdkVersion}`);
  }

  const shimDir = mkdtempSync(join(tmpdir(), 'android-file-transfer-xcodebuild-'));
  const shimPath = join(shimDir, 'xcodebuild');
  writeFileSync(
    shimPath,
    `#!/bin/sh\nif [ "$1" = "-version" ]; then\n  printf 'Xcode ${sdkVersion}\\nBuild version CLT\\n'\n  exit 0\nfi\nexec /usr/bin/xcodebuild "$@"\n`,
    { mode: 0o755 }
  );

  return {
    env: {
      ...nativeEnv,
      PATH: `${shimDir}:${nativeEnv.PATH}`
    },
    cleanup() {
      rmSync(shimDir, { recursive: true, force: true });
    }
  };
}

mkdirSync(dirname(output), { recursive: true });
mkdirSync(bundledLibDir, { recursive: true });

const nativePackages = ['libmtp', 'libusb-1.0'];
const cflags = run('pkg-config', ['--cflags', ...nativePackages], { capture: true })
  .split(/\s+/)
  .filter(Boolean);
const libs = run('pkg-config', ['--libs', ...nativePackages], { capture: true })
  .split(/\s+/)
  .filter(Boolean);
const libmtpDir = run('pkg-config', ['--variable=libdir', 'libmtp'], { capture: true });
const libusbDir = run('pkg-config', ['--variable=libdir', 'libusb-1.0'], { capture: true });

function assertPathInsidePreparedPrefix(path, description) {
  const prefixPath = realpathSync(nativeDepsPrefix);
  const candidatePath = realpathSync(path);
  const relativePath = relative(prefixPath, candidatePath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`${description} resolved outside ${nativeDepsPrefix}: ${candidatePath}`);
  }
}

function installName(binaryPath) {
  return run('otool', ['-D', binaryPath], { capture: true })
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && line !== `${binaryPath}:`);
}

function bundleDylib(sourcePath) {
  const targetPath = resolve(bundledLibDir, basename(sourcePath));
  copyFileSync(sourcePath, targetPath);
  chmodSync(targetPath, 0o755);
  return targetPath;
}

function relink(binaryPath, changes) {
  const args = [];
  for (const [oldName, newName] of changes) {
    if (oldName && newName) {
      args.push('-change', oldName, newName);
    }
  }
  args.push(binaryPath);
  run('install_name_tool', args);
}

function adHocSign(binaryPath, entitlementsPath) {
  const args = ['--force', '--sign', '-', '--timestamp=none'];
  if (entitlementsPath) {
    args.push('--entitlements', entitlementsPath);
  }
  args.push(binaryPath);
  run('codesign', args);
}

run('clang', [
  '-Wall',
  '-Wextra',
  '-O2',
  '-arch',
  clangArch,
  `-mmacosx-version-min=${deploymentTarget}`,
  '-Wl,-headerpad_max_install_names',
  source,
  '-o',
  output,
  ...cflags,
  ...libs,
  '-framework',
  'CoreFoundation'
]);

const electronVersion = require('electron/package.json').version;
const nodeGypScript = require.resolve('node-gyp/bin/node-gyp.js');
const nodeGypToolchain = nodeGypToolchainEnvironment();
try {
  run(process.execPath, [
    nodeGypScript,
    'rebuild',
    `--directory=${filePromiseSourceDir}`,
    `--target=${electronVersion}`,
    `--arch=${targetArch}`,
    '--dist-url=https://electronjs.org/headers'
  ], {
    env: {
      ...nodeGypToolchain.env,
      npm_config_arch: targetArch,
      CFLAGS: [nativeEnv.CFLAGS, `-arch ${clangArch}`, `-mmacosx-version-min=${deploymentTarget}`]
        .filter(Boolean)
        .join(' '),
      CXXFLAGS: [nativeEnv.CXXFLAGS, `-arch ${clangArch}`, `-mmacosx-version-min=${deploymentTarget}`]
        .filter(Boolean)
        .join(' '),
      LDFLAGS: [nativeEnv.LDFLAGS, `-arch ${clangArch}`, `-mmacosx-version-min=${deploymentTarget}`]
        .filter(Boolean)
        .join(' ')
    }
  });
} finally {
  nodeGypToolchain.cleanup();
}
copyFileSync(resolve(filePromiseSourceDir, 'build/Release/file_promise_drag.node'), filePromiseOutput);
chmodSync(filePromiseOutput, 0o755);

const sourceLibmtp = resolve(libmtpDir, 'libmtp.9.dylib');
const sourceLibusb = resolve(libusbDir, 'libusb-1.0.0.dylib');
if (packageBuild) {
  assertPathInsidePreparedPrefix(sourceLibmtp, 'libmtp');
  assertPathInsidePreparedPrefix(sourceLibusb, 'libusb');
}
const bundledLibmtp = bundleDylib(sourceLibmtp);
const bundledLibusb = bundleDylib(sourceLibusb);
const libmtpInstallName = installName(sourceLibmtp);
const libusbInstallName = installName(sourceLibusb);
const bundledLibmtpName = `@loader_path/${basename(bundledLibmtp)}`;
const bundledLibusbName = `@loader_path/${basename(bundledLibusb)}`;

run('install_name_tool', ['-id', bundledLibusbName, bundledLibusb]);
run('install_name_tool', [
  '-id',
  bundledLibmtpName,
  '-change',
  libusbInstallName,
  bundledLibusbName,
  bundledLibmtp
]);

relink(output, [
  [libmtpInstallName, `@loader_path/../lib/${basename(bundledLibmtp)}`],
  [libusbInstallName, `@loader_path/../lib/${basename(bundledLibusb)}`]
]);

adHocSign(bundledLibusb);
adHocSign(bundledLibmtp);
adHocSign(output, resolve(root, 'build/entitlements.mtp-helper.plist'));
adHocSign(filePromiseOutput);

console.log(`Built ${output}`);
console.log(`Built ${filePromiseOutput}`);
console.log(`Bundled native libraries in ${bundledLibDir}`);
console.log(`Native architecture: ${targetArch}; minimum macOS: ${deploymentTarget}`);
if (nativeDepsPrefix) {
  console.log(`Native dependency prefix: ${nativeDepsPrefix}${packageBuild ? ' (packaging)' : ''}`);
}
