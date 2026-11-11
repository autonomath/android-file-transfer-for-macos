import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [types, preload, main, policySource, native, app, patch, depsBuild, sourceBundle, nativeBuild, entitlements] =
  await Promise.all([
    readProjectFile('src/shared/types.ts'),
    readProjectFile('src/preload/index.ts'),
    readProjectFile('src/main/index.ts'),
    readProjectFile('src/main/mtpConnectionPolicy.ts'),
    readProjectFile('src/native/mtp-json.c'),
    readProjectFile('src/renderer/src/App.tsx'),
    readProjectFile('patches/libmtp-1.1.23-no-usb-reset.patch'),
    readProjectFile('scripts/build-native-deps.sh'),
    readProjectFile('scripts/package-third-party-sources.sh'),
    readProjectFile('scripts/build-native.mjs'),
    readProjectFile('build/entitlements.mtp-helper.plist')
  ]);

const requiredPhases = [
  'no-phone',
  'file-transfer-off',
  'opening',
  'listing-storage',
  'ready',
  'needs-mode-reset',
  'needs-replug',
  'usb-busy',
  'cancelled'
];
requiredPhases.forEach((phase) => {
  assert.match(types, new RegExp(`'${phase}'`), `Missing structured MTP phase ${phase}.`);
});

assert.match(preload, /cancelConnectionAttempt: \(\) => ipcRenderer\.invoke\('mtp:cancelConnectionAttempt'\)/);
assert.doesNotMatch(preload, /recoverWithAdmin|administrator|osascript/i, 'Preload must expose no privileged connection route.');
assert.doesNotMatch(main, /recoverWithAdmin|startAdminMtpSession|runAdminSessionCommand|administrator|osascript/i);
assert.doesNotMatch(native, /MAC_ANDROID_TRANSFER_ADMIN|MAC_ANDROID_TRANSFER_REQUIRE_PRIVILEGE_DROP|setuid\(/);

assert.match(policySource, /LIBMTP_OPEN_SESSION_TIMEOUT_MS = 5_000/);
assert.match(policySource, /MTP_CONNECTION_WATCHDOG_MS = 10_000/);
assert.match(main, /setTimeout\([\s\S]*MTP_CONNECTION_WATCHDOG_MS/);
assert.match(main, /MAC_ANDROID_TRANSFER_DISABLE_USB_RESET: '1'/);
assert.match(patch, /automatic USB reset disabled by application/);
assert.match(patch, /ret = ptp_opensession\(params, 1\)/);
assert.doesNotMatch(patch, /while \(ret == PTP_ERROR_IO/, 'A failed USB handle must be released between automatic attempts.');
assert.match(main, /armSessionOpenWatchdog\(child\)/);
assert.match(patch, /forced reset on close suppressed by application/);
assert.match(depsBuild, /patch -d "\$WORK_DIR\/libmtp-\$LIBMTP_VERSION" -p1 < "\$LIBMTP_PATCH"/);
assert.match(sourceBundle, /patches\/libmtp-1\.1\.23-no-usb-reset\.patch/);

const sessionSpawnCount = (main.match(/spawn\(helperPath, \['session'/g) ?? []).length;
assert.equal(sessionSpawnCount, 1, 'There must be one native session creation path.');
assert.match(main, /if \(sessionProcess\) \{\s*await destroyMtpSession/);
assert.match(main, /await waitForMtpSessionTeardown\(\)/);
assert.match(main, /if \(openSessionServesConnection\(connectionId, deviceIdentityKey\)\) \{/);
assert.match(
  main,
  /function openSessionServesConnection[\s\S]*sessionConnectionId === connectionId[\s\S]*!connectionIdIsUsbSessionScoped\(sessionConnectionId\)/,
  'A helper opened on one USB enumeration must not be reused for a different enumeration of the same phone.'
);
assert.match(main, /phone re-enumerated on USB[\s\S]*destroyMtpSession\('The phone re-established its USB connection\.', true\)/);
assert.match(main, /sessionProcess && !sessionConnectionId && pendingSessionConnectionId/);
assert.match(main, /File Transfer disappeared while MTP was opening/);
assert.match(main, /File Transfer was turned off while opening phone files/);
assert.match(main, /runSessionCommand<InventoryResult/);
assert.match(main, /runSessionCommand<FolderListResult/);
assert.match(main, /connectionPhase: 'ready'/);
assert.match(main, /USB_CONNECTION_SETTLE_MS = 100/);
assert.match(main, /waitForUsbConnectionToSettle\(connectionId\)/);
assert.match(
  native,
  /blocked_normal_access_message[\s\S]*The app will try again automatically\./,
  'The initial connection failure must not instruct the user to press Retry.'
);
assert.match(
  native,
  /empty_storage_root_message[\s\S]*the app will keep checking automatically\./,
  'Storage enumeration must describe its automatic retry behavior.'
);
assert.match(main, /phone file access validation failed[\s\S]*keeping the persistent session open for an explicit storage retry/);
assert.match(main, /session root listing failed[\s\S]*keeping the persistent session open for an explicit storage retry/);
assert.doesNotMatch(main, /closing the unusable session/);

assert.match(app, /blockedAutoDeviceKeys = useRef<Set<string>>\(new Set\(\)\)/);
assert.match(app, /lastVisibleConnectionKey\.current !== nextConnectionKey/);
assert.match(app, /lastVisibleMode\.current !== nextMode/);
assert.match(app, /connectionPhase: 'opening'[\s\S]*will keep trying automatically/);
assert.doesNotMatch(app, /connectionAttemptCounts/);
assert.match(app, /window\.mtp\.cancelConnectionAttempt\(\)/);
assert.match(app, /inventory\?\.connectionPhase === 'ready'[\s\S]*status\?\.sessionOpen === true/);
assert.match(app, /!hasDevice \? \([\s\S]*className=.{0,2}connection-gate/);
assert.match(app, /keeps checking on its own for as long as the cable is in/);
assert.doesNotMatch(app, /recoverWithAdmin|Mac login password|osascript|protected access/i);

assert.match(nativeBuild, /entitlements\.mtp-helper\.plist/);
assert.match(nativeBuild, /codesign/);
assert.match(entitlements, /com\.apple\.security\.device\.usb/);

const transpiledPolicy = ts.transpileModule(policySource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText;
const policyUrl = `data:text/javascript;base64,${Buffer.from(transpiledPolicy).toString('base64')}`;
const policy = await import(policyUrl);

assert.equal(policy.MTP_CONNECTION_WATCHDOG_MS, 10_000);
assert.equal(policy.LIBMTP_OPEN_SESSION_TIMEOUT_MS, 5_000);
assert.equal(
  policy.classifyMtpConnectionIssue(new policy.MtpUsbBusyError('User-facing explanation'), 'PTP_ERROR_IO: canceled'),
  'other-app-owns-usb',
  'Observed ownership must stay USB-busy regardless of wording or stale helper errors, so automatic retries continue.'
);
assert.match(main, /throw new MtpUsbBusyError\(blockedMtpAccessMessage\(\)\)/);
assert.equal(
  policy.classifyMtpConnectionIssue(new Error('PTP_ERROR_IO: failed to open session'), ''),
  'phone-not-responding',
  'PTP OpenSession failures must never be classified as protected USB access.'
);
assert.equal(
  policy.classifyMtpConnectionIssue(
    new Error('PTP_ERROR_IO: failed to open session'),
    'libusb: warning [darwin_detach_kernel_driver] failed to capture USB device'
  ),
  'phone-not-responding',
  'A harmless debug capture warning must not override the actual OpenSession timeout.'
);
assert.equal(
  policy.classifyMtpConnectionIssue(
    new Error('Unable to initialize device'),
    'error returned by libusb_claim_interface() = -3'
  ),
  'other-app-owns-usb',
  'A USB interface claim failure must take precedence over libmtp generic initialization text.'
);
assert.equal(policy.connectionPhaseForIssue('phone-not-responding'), 'needs-mode-reset');
assert.equal(policy.connectionPhaseForIssue('other-app-owns-usb'), 'usb-busy');
assert.equal(policy.connectionPhaseForIssue('cancelled'), 'cancelled');

console.log('Reliable single-session MTP contract check passed.');
