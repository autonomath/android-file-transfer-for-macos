import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  type MessageBoxOptions,
  type MenuItemConstructorOptions,
  type OpenDialogOptions
} from 'electron';
import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronUpdater from 'electron-updater';
import { androidUsbFallbackKey, parseAndroidUsbDevicesFromIoreg } from './androidUsb';
import { findMacMtpCameraOwner, findMacCameraClients, cameraProcessAgeSeconds, MacCameraConflicts, type MacMtpCameraOwner, type MacCameraConflictSnapshot } from './macMtpCamera';
import {
  classifyMtpConnectionIssue,
  connectionPhaseForIssue,
  MtpUsbBusyError,
  MTP_CONNECTION_WATCHDOG_MS
} from './mtpConnectionPolicy';
import {
  fileIdentitySnapshot,
  publishTemporaryFile,
  replaceTemporaryFile
} from './atomicDownload';
import { removeVerifiedLocalMoveSource } from './localMoveSource';
import { publishStagedPhoneReplacement } from './phoneReplacement';
import {
  deviceConnectionId as buildDeviceConnectionId,
  stableDeviceIdentity
} from '../shared/deviceIdentity';
import { encodePhoneCommandName, validatePhoneItemName } from '../shared/phoneMutation';
import { validateLocalItemName } from '../shared/localMutation';
import { classifyUpdateInstallLocation, normalizeSemanticVersion } from '../shared/appUpdate';
import { keepBothPhoneName, temporaryPhoneTransferName } from '../shared/transferCollision';
import type {
  AppMenuCommand,
  QuitUsbAppRequest,
  AppUpdateCheckResult,
  CommonMacFolder,
  CreateLocalFolderRequest,
  CreateFolderRequest,
  CreateFolderResult,
  DeletePhoneItemFailure,
  DeletePhoneItemsRequest,
  DeletePhoneItemsResult,
  DiagnosticsCopyResult,
  DestinationResult,
  DeviceStatus,
  FolderListProgress,
  FolderListResult,
  InventoryResult,
  LocalDirectoryResult,
  LocalEntry,
  LocalModifiedTimeResult,
  LocalMutationResult,
  LocalMutationTarget,
  LocalSourceIdentity,
  MtpDeviceInventory,
  MtpConnectionIssue,
  MtpConnectionPhaseEvent,
  MtpConnectionPhase,
  MoveQueueResult,
  OpenUpdateReleaseResult,
  PhoneFilePromiseDragEvent,
  PhoneFilePromiseDragItem,
  PhoneFilePromiseDragRequest,
  PhoneMutationTarget,
  RawDevice,
  RenamePhoneItemRequest,
  RenamePhoneItemResult,
  RenameLocalItemRequest,
  TrashLocalItemFailure,
  TrashLocalItemsRequest,
  TrashLocalItemsResult,
  TransferEvent,
  TransferCollisionAction,
  TransferJob,
  TransferOperation,
  TransferQueueResult,
  TransferRequest,
  UploadRequest
} from '../shared/types';

const { autoUpdater } = electronUpdater;
const currentDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const APP_NAME = 'Android File Transfer for macOS';
const IS_DEVELOPMENT_RUNTIME =
  process.env.NODE_ENV_ELECTRON_VITE === 'development' || Boolean(process.env.ELECTRON_RENDERER_URL);
const MTP_DIAGNOSTIC_DEBUG = process.env.MAC_ANDROID_TRANSFER_MTP_DEBUG === '1';
const MAC_CAMERA_SERVICE_NAMES = ['icdd', 'ptpcamerad', 'mscamerad-xpc'];
const RAW_DEVICE_MISSING_SESSION_GRACE_MS = 12_000;
const OPENING_DEVICE_MISSING_GRACE_MS = 500;
const USB_CONNECTION_SETTLE_MS = 100;
const MTP_ROOT_PARENT_ID = 0xffffffff;
const PHONE_FILES_UNAVAILABLE_MESSAGE =
  'The phone connection is open, but its folders are not available yet. Keep the phone unlocked, tap Allow if asked, then try again.';
const MTP_SESSION_EXIT_KILL_AFTER_MS = 4_000;
const TRANSFER_COMMAND_IDLE_TIMEOUT_MS = 30 * 60_000;
const MAX_PROMISED_PHONE_FILES = 20_000;
const MAX_PHONE_MUTATION_ITEMS = 1_000;
const MAX_PROMISED_PHONE_FOLDERS = 5_000;
const GITHUB_RELEASES_WEB =
  'https://github.com/autonomath/android-file-transfer-for-macos/releases/tag/';
let mainWindow: BrowserWindow | null = null;
const transferJobs = new Map<string, TransferJob>();
let activeJobId: string | null = null;
let activeWasCanceled = false;
let pendingPromisePlanningCount = 0;
let phoneMutationInProgress = false;
let localMutationInProgress = false;
let updateCheckInFlight: Promise<AppUpdateCheckResult> | null = null;
let updateDownloadInFlight: Promise<AppUpdateCheckResult> | null = null;
let appUpdateStatus: AppUpdateCheckResult = {
  ok: true,
  status: 'idle',
  currentVersion: app.getVersion(),
  checkedAt: '',
  message: 'Updates have not been checked yet.'
};

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.logger = null;

app.setName(APP_NAME);

interface NativePromiseDragEvent {
  type: 'write' | 'drag-ended' | 'internal-hover';
  promiseId?: string;
  path?: string;
  active?: boolean;
  operation?: number;
}

interface FilePromiseDragAddon {
  requestApplicationQuit: (bundleId: string, bundlePath: string) => 'requested' | 'not-running' | 'refused';
  startDrag: (
    options: {
      viewHandle: Buffer;
      items: Array<{ promiseId: string; name: string; kind: 'file' | 'folder' }>;
      internalDestination?: PhoneFilePromiseDragRequest['internalDestination'];
    },
    callback: (event: NativePromiseDragEvent) => void
  ) => boolean;
  completePromise: (promiseId: string, error?: string) => boolean;
  failAll: (error?: string) => void;
}

interface PromisedDirectory {
  path: string;
  modified: number;
}

interface PromisedDownloadFile {
  request: TransferRequest;
  destinationPath: string;
}

interface PromiseSourceRecord {
  id: string;
  item: PhoneFilePromiseDragItem;
}

interface PromiseFulfillment {
  id: string;
  rootPath: string;
  rootKind: 'file' | 'folder';
  directories: PromisedDirectory[];
  remainingJobIds: Set<string>;
  settled: boolean;
}

let filePromiseDragAddon: FilePromiseDragAddon | null | undefined;
const promiseSources = new Map<string, PromiseSourceRecord>();
const promiseFulfillments = new Map<string, PromiseFulfillment>();

interface SessionPayload {
  type?: string;
  requestId?: string;
  ok?: boolean;
  state?: string;
  message?: string;
  event?: 'started' | 'progress' | 'complete' | 'failed';
  sent?: number;
  total?: number;
  objectId?: number;
  actualName?: string;
  verified?: boolean;
  destination?: string;
  bus?: number;
  device?: number;
  vendorId?: number;
  productId?: number;
  serial?: string;
  usbSessionId?: string;
  [key: string]: unknown;
}

interface SessionCommand {
  id: string;
  name: string;
  line: string;
  timeoutMs: number;
  resolve: (payload: SessionPayload) => void;
  reject: (error: Error) => void;
  onEvent?: (payload: SessionPayload) => void;
  timer?: ReturnType<typeof setTimeout>;
}

let sessionProcess: ChildProcessWithoutNullStreams | null = null;
let sessionDeviceIndex: number | null = null;
let sessionRawKey: string | null = null;
let pendingSessionRawKey: string | null = null;
let sessionConnectionId: string | null = null;
let pendingSessionConnectionId: string | null = null;
let sessionDeviceIdentityKey: string | null = null;
let pendingSessionDeviceIdentityKey: string | null = null;
let lastRawDevices: RawDevice[] = [];
let sessionReady: Promise<void> | null = null;
let sessionReadyResolve: (() => void) | null = null;
let sessionReadyReject: ((error: Error) => void) | null = null;
let sessionReadyTimer: ReturnType<typeof setTimeout> | null = null;
let sessionStdoutBuffer = '';
let sessionStderrBuffer = '';
let lastSessionStderr = '';
let activeSessionCommand: SessionCommand | null = null;
const sessionQueue: SessionCommand[] = [];
let lastAndroidUsbFallbackKey: string | null = null;
let rawDevicesMissingSince: number | null = null;
let openingDeviceMissingSince: number | null = null;
const rawDeviceConnectionFirstSeenAt = new Map<string, number>();

interface LegacyPrivilegedSessionManifest {
  stageRoot: string;
  pidPath: string;
  stopPath: string;
  processPid: number | null;
}

let mtpSessionTeardown: Promise<void> | null = null;
let connectionAttemptGeneration = 0;

function getLogPath(): string {
  const logsDir = join(app.getPath('userData'), 'logs');
  mkdirSync(logsDir, { recursive: true });
  return join(logsDir, 'mtp.log');
}

function appendLog(message: string): void {
  const timestamp = new Date().toISOString();
  appendFileSync(getLogPath(), `[${timestamp}] ${message}\n`, 'utf8');
}

// A phone that keeps answering the storage question the same way produces the
// same log line on every retry. Write it once, then summarize repeats, so a
// long wait does not grow the log by megabytes and the next real change is
// easy to find. A different message for the same key still logs immediately.
const throttledLogState = new Map<string, { lastAt: number; suppressed: number }>();
const THROTTLED_LOG_INTERVAL_MS = 30_000;

function appendThrottledLog(message: string): void {
  const now = Date.now();
  const state = throttledLogState.get(message);
  if (state && now - state.lastAt < THROTTLED_LOG_INTERVAL_MS) {
    state.suppressed += 1;
    return;
  }
  if (throttledLogState.size > 200) {
    throttledLogState.clear();
  }
  const suppressed = state?.suppressed ?? 0;
  throttledLogState.set(message, { lastAt: now, suppressed: 0 });
  appendLog(
    suppressed
      ? `${message} (same answer repeated ${suppressed} more time${suppressed === 1 ? '' : 's'} since the previous line)`
      : message
  );
}

function removeLegacyPrecopyDirectory(): void {
  const legacyDirectory = join(app.getPath('userData'), ['drag', 'cache'].join('-'));
  if (!existsSync(legacyDirectory)) {
    return;
  }

  try {
    rmSync(legacyDirectory, { recursive: true, force: true });
    appendLog('removed obsolete phone drag pre-copy data');
  } catch (error) {
    appendLog(`warning: unable to remove obsolete phone drag pre-copy data: ${String(error)}`);
  }
}

function getBridgePath(): string {
  if (app.isPackaged && !IS_DEVELOPMENT_RUNTIME) {
    return join(process.resourcesPath, 'bin', 'mtp-json');
  }

  return resolve(process.cwd(), 'resources/bin/mtp-json');
}

function getFilePromiseDragAddonPath(): string {
  if (app.isPackaged && !IS_DEVELOPMENT_RUNTIME) {
    return join(process.resourcesPath, 'bin', 'file-promise-drag.node');
  }
  return resolve(process.cwd(), 'resources/bin/file-promise-drag.node');
}

function loadFilePromiseDragAddon(): FilePromiseDragAddon | null {
  if (filePromiseDragAddon !== undefined) {
    return filePromiseDragAddon;
  }
  try {
    filePromiseDragAddon = require(getFilePromiseDragAddonPath()) as FilePromiseDragAddon;
    appendLog('native file-promise drag bridge loaded');
  } catch (error) {
    filePromiseDragAddon = null;
    appendLog(`native file-promise drag bridge unavailable: ${String(error)}`);
  }
  return filePromiseDragAddon;
}

function sendPhoneFilePromiseDragEvent(event: PhoneFilePromiseDragEvent): void {
  mainWindow?.webContents.send('phone-file-promise:event', event);
}

function getPreloadPath(): string {
  const candidates = [
    join(currentDir, '../preload/index.mjs'),
    join(currentDir, '../preload/index.js')
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    appendLog(`preload script missing; tried ${candidates.join(', ')}`);
  }
  return found ?? candidates[0];
}

async function ensureBridge(): Promise<string> {
  const bridgePath = getBridgePath();
  await access(bridgePath, constants.X_OK);
  return bridgePath;
}

function missingBridgeStatus(error: unknown): DeviceStatus {
  const helperPath = getBridgePath();
  const message =
    error instanceof Error ? error.message : 'Native MTP helper could not be executed.';

  appendLog(`bridge missing: ${message}`);

  return {
    ok: false,
    state: 'bridge-missing',
    message: `Native MTP helper is missing or not executable at ${helperPath}. Run npm run native:build.`,
    deviceCount: 0,
    rawDevices: [],
    helperPath,
    logPath: getLogPath(),
    stderr: message
  };
}

function parseJson<T>(stdout: string, fallback: T): T {
  const payload = stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('{'));

  if (!payload) {
    return fallback;
  }

  return JSON.parse(payload) as T;
}

function runningMacCameraServices(): string[] {
  if (process.platform !== 'darwin') {
    return [];
  }

  try {
    const output = execFileSync('/bin/ps', ['-axo', 'comm='], {
      encoding: 'utf8',
      timeout: 1000,
      maxBuffer: 1024 * 1024
    });
    const processNames = new Set(
      output
        .split('\n')
        .map((line) => basename(line.trim()))
        .filter(Boolean)
    );
    return MAC_CAMERA_SERVICE_NAMES.filter((serviceName) => processNames.has(serviceName));
  } catch (error) {
    appendLog(`macOS camera service check failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function macCameraServiceHint(): string | null {
  const services = runningMacCameraServices();
  if (!services.length) {
    return null;
  }

  return `macOS camera/import services are running: ${services.join(', ')}. Close Photos or Image Capture if either app is trying to use the phone.`;
}

function readMacMtpInterfaces(): Promise<string> {
  if (process.platform !== 'darwin') {
    return Promise.resolve('');
  }

  return new Promise((resolvePromise) => {
    execFile(
      'ioreg',
      ['-p', 'IOService', '-r', '-l', '-c', 'IOUSBHostInterface'],
      { maxBuffer: 1024 * 1024 * 10, timeout: 2500 },
      (error, stdout) => {
        if (error) {
          appendLog(`MTP interface ownership check failed: ${error.message}`);
          resolvePromise('');
          return;
        }
        resolvePromise(stdout);
      }
    );
  });
}

const cameraConflicts = new MacCameraConflicts(randomUUID);

function currentUsbConflict() {
  return lastRawDevices.map((device) => cameraConflicts.get(rawDeviceConnectionId(device))).find(Boolean);
}

function currentMacCameraClientApp(): string | undefined {
  return currentUsbConflict()?.apps.map((entry) => entry.name).join(', ') || undefined;
}

async function readMacCameraClients(owner: MacMtpCameraOwner) {
  // Clients register once, often long before this app is opened. Limit history
  // to this daemon's lifetime so an old registration stays usable without
  // attributing records from an earlier process that happened to share its PID.
  const age = cameraProcessAgeSeconds(execFileSync('/bin/ps', ['-p', String(owner.pid), '-o', 'etime='], {
    encoding: 'utf8', timeout: 1000, maxBuffer: 1024
  }));
  if (age === null) return [];
  const log = await new Promise<string>((resolvePromise) => {
    execFile('/usr/bin/log', [
      'show', '--last', `${age + 1}s`, '--style', 'compact',
      '--predicate', `processID == ${owner.pid} AND process == "ptpcamerad" AND (eventMessage CONTAINS "PTPCameraDevice" OR eventMessage CONTAINS "requestStart" OR eventMessage CONTAINS "requestStop")`
    ], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolvePromise(error ? '' : stdout);
    });
  });
  const processes = new Map<number, string>();
  const output = execFileSync('/bin/ps', ['-axo', 'pid=', '-o', 'uid=', '-o', 'comm='], {
    encoding: 'utf8', timeout: 1000, maxBuffer: 1024 * 1024
  });
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (match && Number(match[2]) === process.getuid?.()) {
      processes.set(Number(match[1]), match[3]);
    }
  }
  return findMacCameraClients(log, owner, processes);
}

async function inspectMacCameraConflict(rawDevice: RawDevice): Promise<MacCameraConflictSnapshot | null> {
  const output = await readMacMtpInterfaces();
  if (!output.trim()) throw new Error('Unable to check the phone USB interface owner.');
  const owner = findMacMtpCameraOwner(output, rawDevice);
  if (!owner) return null;
  const clients = await readMacCameraClients(owner);
  // Logs can be slow. An ownership change invalidates the old client list.
  const current = findMacMtpCameraOwner(await readMacMtpInterfaces(), rawDevice);
  if (!current) return null;
  return { owner: current, clients: current.pid === owner.pid && current.locationId === owner.locationId ? clients : [] };
}

async function checkMacMtpCameraAccess(rawDevice: RawDevice, generation: number): Promise<boolean> {
  const connectionId = rawDeviceConnectionId(rawDevice);
  const conflict = await inspectMacCameraConflict(rawDevice);
  if (generation !== connectionAttemptGeneration) throw new Error('Opening phone files was canceled.');
  cameraConflicts.observe(connectionId, conflict);
  if (conflict) {
    appendThrottledLog(`USB interface busy for ${connectionId}; waiting for the camera-import service to release it. No process was terminated.`);
  }
  return !conflict;
}

async function requestQuitUsbApp(request: QuitUsbAppRequest) {
  return cameraConflicts.requestQuit(request, {
    inspect: async (connectionId) => {
      await refreshRawDevices();
      if (sessionConnectionId === connectionId) return null;
      const rawDevice = lastRawDevices.find((entry) => rawDeviceConnectionId(entry) === connectionId);
      if (!rawDevice) return null;
      return inspectMacCameraConflict(rawDevice);
    },
    quitNormally: (client) => {
      const addon = loadFilePromiseDragAddon();
      if (!addon?.requestApplicationQuit) return 'refused';
      appendLog(`user requested normal Quit for ${client.appName} to release the phone`);
      return addon.requestApplicationQuit(client.bundleId, client.bundlePath);
    }
  });
}

function bridgeFailureHint(stderr: string, timedOut: boolean): string | null {
  const normalized = stderr.toLowerCase();
  const phoneDidNotAnswer =
    normalized.includes('ptp_error_io') ||
    normalized.includes('failed to open session');
  const usbBusy =
    normalized.includes('libusb_claim_interface') ||
    normalized.includes('libusb_error_access') ||
    normalized.includes('libusb_error_busy') ||
    normalized.includes('another process has device opened for exclusive access');

  if (usbBusy) {
    const serviceHint = macCameraServiceHint();
    return [
      'Another Mac app is using the phone USB connection.',
      serviceHint,
      'Close other photo or Android transfer apps, then try again.'
    ]
      .filter(Boolean)
      .join(' ');
  }

  if (phoneDidNotAnswer) {
    return 'The phone did not answer the file request. Keep it unlocked and in File transfer while the app tries again.';
  }

  if (timedOut) {
    return 'Keep the phone unlocked and confirm it is still in File Transfer / Android Auto mode before retrying.';
  }

  return null;
}

function helperMetadata<T extends object>(payload: T, stderr?: string): T & {
  helperPath: string;
  logPath: string;
  stderr?: string;
} {
  const stderrText = stderr?.trim() || undefined;
  return {
    ...payload,
    helperPath: getBridgePath(),
    logPath: getLogPath(),
    stderr: stderrText
  };
}

function rawDeviceKey(device: Pick<RawDevice, 'bus' | 'device' | 'vendorId' | 'productId'>): string {
  return `${device.bus}:${device.device}:${device.vendorId}:${device.productId}`;
}

function rawDeviceIdentityKey(device: RawDevice): string {
  return `${stableDeviceIdentity(device)}:${device.connectionMode ?? 'unknown'}`;
}

function rawDeviceConnectionId(device: RawDevice): string {
  return device.connectionId || buildDeviceConnectionId(device);
}

function rememberRawDeviceConnections(devices: RawDevice[]): void {
  const now = Date.now();
  const visibleConnectionIds = new Set(devices.map(rawDeviceConnectionId));
  for (const connectionId of visibleConnectionIds) {
    if (!rawDeviceConnectionFirstSeenAt.has(connectionId)) {
      rawDeviceConnectionFirstSeenAt.set(connectionId, now);
    }
  }
  for (const connectionId of rawDeviceConnectionFirstSeenAt.keys()) {
    if (!visibleConnectionIds.has(connectionId)) {
      rawDeviceConnectionFirstSeenAt.delete(connectionId);
    }
  }
}

async function waitForUsbConnectionToSettle(connectionId: string): Promise<void> {
  if (!connectionIdIsUsbSessionScoped(connectionId)) {
    return;
  }
  const firstSeenAt = rawDeviceConnectionFirstSeenAt.get(connectionId);
  if (firstSeenAt === undefined) {
    return;
  }
  const remainingMs = firstSeenAt + USB_CONNECTION_SETTLE_MS - Date.now();
  if (remainingMs <= 0) {
    return;
  }
  appendLog(`waiting ${remainingMs}ms for new USB connection ${connectionId} to settle before opening MTP`);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, remainingMs));
}

// A connection ID that carries a macOS USB session ID identifies one specific
// enumeration of the phone. When that ID changes, macOS re-enumerated the
// device (USB mode switch, unlock, or a phone-side reset) and any helper that
// opened the previous enumeration now holds a handle to hardware that no
// longer exists. Its answers are stale, so the session must be reopened.
function connectionIdIsUsbSessionScoped(connectionId: string | null | undefined): boolean {
  return typeof connectionId === 'string' && connectionId.includes('@usb:');
}

function openSessionServesConnection(connectionId: string, deviceIdentityKey: string): boolean {
  if (!sessionProcess || !sessionReady) {
    return false;
  }
  if (sessionConnectionId === connectionId) {
    return true;
  }
  return (
    sessionDeviceIdentityKey === deviceIdentityKey &&
    !connectionIdIsUsbSessionScoped(sessionConnectionId) &&
    !connectionIdIsUsbSessionScoped(connectionId)
  );
}

function readyPayloadMatchesConnection(
  payload: SessionPayload,
  expectedConnectionId: string | null,
  expectedRawKey: string | null
): boolean {
  if (
    !expectedConnectionId ||
    typeof payload.bus !== 'number' ||
    typeof payload.device !== 'number' ||
    typeof payload.vendorId !== 'number' ||
    typeof payload.productId !== 'number'
  ) {
    return false;
  }

  const expectedUsbMarker = '@usb:';
  const usbMarkerIndex = expectedConnectionId.indexOf(expectedUsbMarker);
  if (usbMarkerIndex >= 0) {
    const expectedUsbSessionId = expectedConnectionId.slice(
      usbMarkerIndex + expectedUsbMarker.length
    );
    return (
      payload.usbSessionId === expectedUsbSessionId &&
      expectedConnectionId.startsWith(`${payload.vendorId}:${payload.productId}:`)
    );
  }

  return (
    rawDeviceKey({
      bus: payload.bus,
      device: payload.device,
      vendorId: payload.vendorId,
      productId: payload.productId
    }) === expectedRawKey
  );
}

function withRawDeviceConnectionIds(rawDevices: RawDevice[]): RawDevice[] {
  return rawDevices.map((device) => ({
    ...device,
    connectionId: rawDeviceConnectionId(device)
  }));
}

function rawDeviceForConnection(deviceIndex: number, connectionId?: string): RawDevice | null {
  if (connectionId) {
    return (
      lastRawDevices.find((device) => rawDeviceConnectionId(device) === connectionId) ?? null
    );
  }
  return lastRawDevices.find((device) => device.index === deviceIndex) ?? null;
}

function rawDeviceUsbSessionId(device: Pick<RawDevice, 'usbSessionId'> | null | undefined): string | null {
  return typeof device?.usbSessionId === 'string' && device.usbSessionId.length > 0
    ? device.usbSessionId
    : null;
}

function detectAndroidUsbDevices(): Promise<RawDevice[]> {
  return new Promise((resolvePromise) => {
    execFile(
      'ioreg',
      ['-p', 'IOUSB', '-l', '-w0'],
      { maxBuffer: 1024 * 1024 * 10, timeout: 2500 },
      (error, stdout) => {
        if (error) {
          appendLog(`ioreg USB fallback failed: ${error.message}`);
          resolvePromise([]);
          return;
        }
        resolvePromise(parseAndroidUsbDevicesFromIoreg(stdout));
      }
    );
  });
}

async function androidUsbFallbackStatus(baseStatus: DeviceStatus): Promise<DeviceStatus | null> {
  const usbDevices = await detectAndroidUsbDevices();
  if (!usbDevices.length) {
    lastAndroidUsbFallbackKey = null;
    return null;
  }

  const fallbackKey = androidUsbFallbackKey(usbDevices);
  if (fallbackKey !== lastAndroidUsbFallbackKey) {
    const mode = usbDevices.some((device) => device.connectionMode === 'mtp')
      ? 'with MTP USB mode visible'
      : 'without MTP file-transfer mode';
    appendLog(`Android USB device present ${mode}: ${fallbackKey}`);
    lastAndroidUsbFallbackKey = fallbackKey;
  }
  const hasMtpUsbDevice = usbDevices.some((device) => device.connectionMode === 'mtp');

  return {
    ...baseStatus,
    ok: hasMtpUsbDevice,
    state: hasMtpUsbDevice ? 'connected' : 'connect-error',
    message: hasMtpUsbDevice
      ? 'Phone is visible in File Transfer mode. Opening its files automatically.'
      : 'Phone is connected by USB, but File transfer is not active. Unlock the phone, open the USB notification, and choose File transfer or Transferring files.',
    connectionPhase: hasMtpUsbDevice ? 'opening' : 'file-transfer-off',
    deviceCount: usbDevices.length,
    rawDevices: usbDevices
  };
}

async function enrichRawDevicesWithAndroidUsbMetadata(rawDevices: RawDevice[]): Promise<RawDevice[]> {
  if (!rawDevices.length) {
    return rawDevices;
  }

  const usbDevices = await detectAndroidUsbDevices();
  if (!usbDevices.length) {
    return rawDevices;
  }

  return rawDevices.map((rawDevice) => {
    const candidates = usbDevices.filter(
      (usbDevice) =>
        usbDevice.vendorId === rawDevice.vendorId &&
        usbDevice.productId === rawDevice.productId
    );
    const metadata =
      candidates.find(
        (usbDevice) => usbDevice.bus === rawDevice.bus && usbDevice.device === rawDevice.device
      ) ??
      candidates.find(
        (usbDevice) => !!rawDevice.serial && usbDevice.serial === rawDevice.serial
      ) ??
      (candidates.length === 1 ? candidates[0] : null);

    if (!metadata) {
      return rawDevice;
    }

    return {
      ...rawDevice,
      serial: rawDevice.serial ?? metadata.serial,
      usbSessionId: rawDevice.usbSessionId ?? metadata.usbSessionId,
      usbCurrentConfiguration: rawDevice.usbCurrentConfiguration ?? metadata.usbCurrentConfiguration,
      usbPreferredConfiguration: rawDevice.usbPreferredConfiguration ?? metadata.usbPreferredConfiguration,
      needsDeviceAccessEntitlement:
        rawDevice.needsDeviceAccessEntitlement ?? metadata.needsDeviceAccessEntitlement
    };
  });
}

function readPidFile(pidPath: string): number | null {
  try {
    const raw = readFileSync(pidPath, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function trackMtpSessionTeardown(teardown: Promise<void>): Promise<void> {
  const previousTeardown = mtpSessionTeardown;
  const combinedTeardown = previousTeardown
    ? Promise.all([previousTeardown, teardown]).then(() => undefined)
    : teardown;
  mtpSessionTeardown = combinedTeardown;

  void combinedTeardown.then(() => {
    if (mtpSessionTeardown !== combinedTeardown) {
      return;
    }
    mtpSessionTeardown = null;
    processTransferQueue();
  });

  return combinedTeardown;
}

async function waitForMtpSessionTeardown(): Promise<void> {
  while (mtpSessionTeardown) {
    await mtpSessionTeardown;
  }
}

function cleanupLegacyPrivilegedSession(): void {
  const manifestPath = join(app.getPath('userData'), 'sessions', 'protected-mtp-session.json');
  let manifest: LegacyPrivilegedSessionManifest | null = null;

  try {
    const value = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const stageRoot = typeof value.stageRoot === 'string' ? resolve(value.stageRoot) : '';
    const pidPath = typeof value.pidPath === 'string' ? resolve(value.pidPath) : '';
    const stopPath = typeof value.stopPath === 'string' ? resolve(value.stopPath) : '';
    const processPid =
      typeof value.processPid === 'number' && Number.isInteger(value.processPid) && value.processPid > 0
        ? value.processPid
        : null;
    const expectedPrefix = '/private/var/tmp/androidFileTransferForMacOS-protected-';

    if (
      stageRoot.startsWith(expectedPrefix) &&
      pidPath.startsWith(`${stageRoot}/`) &&
      stopPath.startsWith(`${stageRoot}/`)
    ) {
      manifest = { stageRoot, pidPath, stopPath, processPid };
    }
  } catch {
    // No legacy session is present.
  }

  try {
    rmSync(manifestPath, { force: true });
  } catch {
    // The app may be quitting before Electron has a usable userData path.
  }

  if (!manifest) {
    return;
  }

  try {
    writeFileSync(
      manifest.stopPath,
      `${new Date().toISOString()} This connection method is no longer used.\n`,
      'utf8'
    );
  } catch (error) {
    appendLog(`unable to stop a legacy privileged MTP helper: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }

  const pid = manifest.processPid ?? readPidFile(manifest.pidPath);
  if (!pid) {
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'EPERM' && nodeError.code !== 'ESRCH') {
      appendLog(`unable to signal a legacy privileged MTP helper: ${nodeError.message || String(error)}`);
    }
  }
}

async function refreshRawDevices(): Promise<RawDevice[]> {
  let status = await runBridgeJson<DeviceStatus>(
    'status',
    [],
    {
      ok: false,
      state: 'error',
      message: 'Unable to check MTP device status.',
      deviceCount: 0,
      rawDevices: [],
      helperPath: getBridgePath(),
      logPath: getLogPath()
    },
    10_000
  );

  if (status.state === 'no-device' && status.rawDevices.length === 0) {
    status = (await androidUsbFallbackStatus(status)) ?? status;
  }

  if (status.rawDevices.length > 0) {
    status = {
      ...status,
      rawDevices: withRawDeviceConnectionIds(
        await enrichRawDevicesWithAndroidUsbMetadata(status.rawDevices)
      )
    };
  }

  lastRawDevices = status.rawDevices;
  rememberRawDeviceConnections(lastRawDevices);
  return lastRawDevices;
}

function getRawKeyForDeviceIndex(deviceIndex: number): string | null {
  const rawDevice = lastRawDevices.find((device) => device.index === deviceIndex);
  return rawDevice ? rawDeviceKey(rawDevice) : null;
}

function blockedMtpAccessMessage(): string {
  return 'Another Mac app is using the phone USB connection. Waiting for it to become available; see the connection panel for options. Nothing will be closed automatically.';
}

function sessionErrorMessage(base: string, error: unknown, stderr: string): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const issue = classifyMtpConnectionIssue(error, stderr);
  if (issue === 'phone-not-responding') {
    return 'The phone did not answer the file request yet. Keep it unlocked and in File transfer while the app tries again.';
  }
  if (issue === 'other-app-owns-usb') {
    return blockedMtpAccessMessage();
  }
  if (issue === 'cancelled') {
    return 'Opening phone files was canceled.';
  }

  const hint = bridgeFailureHint(stderr, rawMessage.toLowerCase().includes('timed out'));
  return `${base} ${rawMessage}${hint ? ` ${hint}` : ''}`;
}

function normalMtpAccessBlocked(error: unknown, stderr: string): boolean {
  if (!lastRawDevices.some((device) => device.connectionMode === 'mtp')) {
    return false;
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  const combined = `${rawMessage}\n${stderr}`.toLowerCase();
  return (
    combined.includes('libusb_claim_interface') ||
    combined.includes('libusb_error_access') ||
    combined.includes('access denied') ||
    combined.includes('libusb_error_busy') ||
    combined.includes('another process has device opened for exclusive access')
  );
}

async function normalMtpAccessBlockedAfterRefresh(error: unknown, stderr: string): Promise<boolean> {
  if (normalMtpAccessBlocked(error, stderr)) {
    return true;
  }

  await refreshRawDevices();
  return normalMtpAccessBlocked(error, stderr);
}

function cancelFolderListing(): boolean {
  let stopped = false;
  const cancelError = new Error('Folder listing stopped by user.');
  const canCancelCommand = (command: SessionCommand | null): boolean =>
    command?.name === 'list' || command?.name === 'inventory';
  const rejectQueuedCommands = (queue: SessionCommand[]): number => {
    let rejected = 0;
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (!canCancelCommand(queue[index])) {
        continue;
      }
      const [command] = queue.splice(index, 1);
      if (command.timer) {
        clearTimeout(command.timer);
      }
      command.reject(cancelError);
      rejected += 1;
    }
    return rejected;
  };

  const queuedNormal = rejectQueuedCommands(sessionQueue);
  if (queuedNormal > 0) {
    appendLog(`user stopped ${queuedNormal} queued MTP folder listing command(s)`);
    stopped = true;
  }

  if (canCancelCommand(activeSessionCommand)) {
    appendLog(`user stopped active MTP ${activeSessionCommand?.name} command`);
    destroyMtpSession(cancelError.message, true);
    stopped = true;
  }

  return stopped;
}

function cancelConnectionAttempt(): boolean {
  connectionAttemptGeneration += 1;
  if (!sessionProcess || sessionConnectionId) {
    return cancelFolderListing();
  }
  appendLog('user canceled the active MTP connection attempt');
  void destroyMtpSession('Opening phone files was canceled.', true);
  return true;
}

function rejectSessionCommands(error: Error): void {
  if (activeSessionCommand) {
    if (activeSessionCommand.timer) {
      clearTimeout(activeSessionCommand.timer);
    }
    activeSessionCommand.reject(error);
    activeSessionCommand = null;
  }

  while (sessionQueue.length > 0) {
    const command = sessionQueue.shift();
    command?.reject(error);
  }
}

function clearSessionReady(error?: Error): void {
  if (sessionReadyTimer) {
    clearTimeout(sessionReadyTimer);
    sessionReadyTimer = null;
  }

  if (error && sessionReadyReject) {
    sessionReadyReject(error);
  }

  sessionReady = null;
  sessionReadyResolve = null;
  sessionReadyReject = null;
}

function armSessionOpenWatchdog(child: ChildProcessWithoutNullStreams): void {
  if (sessionReadyTimer) {
    clearTimeout(sessionReadyTimer);
  }
  sessionReadyTimer = setTimeout(() => {
    if (sessionProcess === child && !sessionConnectionId) {
      void destroyMtpSession(
        `MTP session stopped responding for ${MTP_CONNECTION_WATCHDOG_MS}ms while opening.`,
        true
      );
    }
  }, MTP_CONNECTION_WATCHDOG_MS);
}

function clearCommandTimer(command: SessionCommand): void {
  if (command.timer) {
    clearTimeout(command.timer);
    command.timer = undefined;
  }
}

function armCommandTimer(command: SessionCommand, onTimeout: () => void): void {
  clearCommandTimer(command);
  command.timer = setTimeout(onTimeout, command.timeoutMs);
}

function waitForChildProcessExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolvePromise) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      child.off('close', finish);
      child.off('exit', finish);
      child.off('error', handleError);
      resolvePromise();
    };
    const handleError = (): void => {
      if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
        finish();
      }
    };
    timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        appendLog(
          `MTP helper PID ${child.pid ?? 'unknown'} did not report its exit within ${timeoutMs}ms; released the connection-attempt barrier.`
        );
      }
      finish();
    }, timeoutMs);
    child.once('close', finish);
    child.once('exit', finish);
    child.once('error', handleError);

    if (child.exitCode !== null || child.signalCode !== null) {
      finish();
    }
  });
}

function destroyMtpSession(
  reason: string,
  forceProcessStop = false,
  requestGracefulQuit = true
): Promise<void> {
  appendLog(`mtp session closing: ${reason}`);
  const processToClose = sessionProcess;
  const teardown = processToClose
    ? trackMtpSessionTeardown(
        waitForChildProcessExit(processToClose, MTP_SESSION_EXIT_KILL_AFTER_MS)
      )
    : Promise.resolve();
  const error = new Error(reason);

  lastSessionStderr = sessionStderrBuffer.trim() || lastSessionStderr;
  clearSessionReady(error);
  rejectSessionCommands(error);

  sessionProcess = null;
  sessionDeviceIndex = null;
  sessionRawKey = null;
  pendingSessionRawKey = null;
  sessionConnectionId = null;
  pendingSessionConnectionId = null;
  sessionDeviceIdentityKey = null;
  pendingSessionDeviceIdentityKey = null;
  rawDevicesMissingSince = null;
  openingDeviceMissingSince = null;
  sessionStdoutBuffer = '';
  sessionStderrBuffer = '';

  if (processToClose && processToClose.exitCode === null && processToClose.signalCode === null) {
    try {
      if (
        requestGracefulQuit &&
        !processToClose.stdin.destroyed &&
        processToClose.stdin.writable
      ) {
        processToClose.stdin.end('quit\n');
        appendLog(`sent graceful quit to MTP session: ${reason}`);
      }
    } catch (closeError) {
      appendLog(`unable to send graceful quit to MTP session: ${closeError instanceof Error ? closeError.message : String(closeError)}`);
    }

    if (forceProcessStop) {
      setTimeout(() => {
        if (processToClose.exitCode === null && processToClose.signalCode === null) {
          processToClose.kill('SIGTERM');
          appendLog(`sent SIGTERM to MTP session: ${reason}`);
        }
        setTimeout(() => {
          if (processToClose.exitCode === null && processToClose.signalCode === null) {
            processToClose.kill('SIGKILL');
            appendLog(`sent SIGKILL to MTP session: ${reason}`);
          }
        }, 1500);
      }, 1500);
    }
  }

  return teardown;
}

function finishActiveSessionCommand(payload: SessionPayload): void {
  const command = activeSessionCommand;
  if (!command) {
    appendLog(`session response without active command: ${JSON.stringify(payload)}`);
    return;
  }

  if (payload.requestId !== command.id) {
    appendLog(`session response id mismatch: ${JSON.stringify(payload)}`);
    return;
  }

  clearCommandTimer(command);
  activeSessionCommand = null;
  command.resolve(payload);
  pumpSessionQueue();
  processTransferQueue();
}

function handleSessionPayload(payload: SessionPayload): void {
  if (payload.type === 'ready') {
    if (payload.ok) {
      if (!readyPayloadMatchesConnection(payload, pendingSessionConnectionId, pendingSessionRawKey)) {
        destroyMtpSession('The MTP helper opened a different phone connection than the one requested.', true);
        return;
      }
      if (
        typeof payload.bus === 'number' &&
        typeof payload.device === 'number' &&
        typeof payload.vendorId === 'number' &&
        typeof payload.productId === 'number'
      ) {
        sessionRawKey = rawDeviceKey({
          bus: payload.bus,
          device: payload.device,
          vendorId: payload.vendorId,
          productId: payload.productId
        });
        sessionConnectionId = pendingSessionConnectionId;
        sessionDeviceIdentityKey = pendingSessionDeviceIdentityKey;
        pendingSessionRawKey = null;
        pendingSessionConnectionId = null;
        pendingSessionDeviceIdentityKey = null;
      }
      if (sessionReadyTimer) {
        clearTimeout(sessionReadyTimer);
        sessionReadyTimer = null;
      }
      sessionReadyResolve?.();
      sessionReadyResolve = null;
      sessionReadyReject = null;
      if (sessionConnectionId) cameraConflicts.observe(sessionConnectionId, null);
      mainWindow?.webContents.send('mtp:connection-phase', {
        phase: 'listing-storage',
        connectionId: sessionConnectionId ?? undefined
      } satisfies MtpConnectionPhaseEvent);
      appendLog(payload.message || 'mtp session opened');
    } else {
      const message = payload.message || 'Unable to open the MTP session.';
      void destroyMtpSession(message, true, false);
    }
    return;
  }

  if (
    (payload.type === 'download' || payload.type === 'upload' || payload.type === 'list') &&
    activeSessionCommand
  ) {
    const command = activeSessionCommand;
    if (payload.requestId === command.id) {
      command.onEvent?.(payload);
      if (payload.event === 'progress') {
        armCommandTimer(command, () => {
          destroyMtpSession(`MTP session command timed out after ${command.timeoutMs}ms.`, true);
        });
      }
      return;
    }
  }

  if (payload.type === 'response') {
    finishActiveSessionCommand(payload);
    return;
  }

  if (payload.type !== 'bye') {
    appendLog(`session payload ignored: ${JSON.stringify(payload)}`);
  }
}

function handleSessionStdout(chunk: Buffer): void {
  sessionStdoutBuffer += chunk.toString('utf8');
  const lines = sessionStdoutBuffer.split('\n');
  sessionStdoutBuffer = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (!trimmed.startsWith('{')) {
      appendLog(`session stdout: ${trimmed}`);
      continue;
    }

    try {
      handleSessionPayload(JSON.parse(trimmed) as SessionPayload);
    } catch (error) {
      appendLog(`session JSON parse failed: ${String(error)} line=${trimmed}`);
    }
  }
}

function pumpSessionQueue(): void {
  if (activeSessionCommand || !sessionProcess || sessionProcess.stdin.destroyed) {
    return;
  }

  const command = sessionQueue.shift();
  if (!command) {
    return;
  }

  activeSessionCommand = command;
  armCommandTimer(command, () => {
    destroyMtpSession(`MTP session command timed out after ${command.timeoutMs}ms.`, true);
  });
  sessionProcess.stdin.write(command.line);
}

async function ensureMtpSession(deviceIndex: number, expectedConnectionId?: string): Promise<void> {
  const generation = connectionAttemptGeneration;
  await waitForMtpSessionTeardown();
  const helperPath = await ensureBridge();

  if (lastRawDevices.length === 0) {
    await refreshRawDevices();
  }
  let rawDevice = rawDeviceForConnection(deviceIndex, expectedConnectionId);
  if (!rawDevice) {
    await refreshRawDevices();
    rawDevice = rawDeviceForConnection(deviceIndex, expectedConnectionId);
  }
  if (!rawDevice) {
    throw new Error('The selected phone connection changed or is no longer available.');
  }
  const connectionId = rawDeviceConnectionId(rawDevice);
  let deviceIdentityKey = rawDeviceIdentityKey(rawDevice);
  let rawKey = rawDeviceKey(rawDevice);
  deviceIndex = rawDevice.index;

  if (openSessionServesConnection(connectionId, deviceIdentityKey)) {
    sessionDeviceIndex = deviceIndex;
    await sessionReady;
    return;
  }

  await waitForUsbConnectionToSettle(connectionId);
  await refreshRawDevices();
  rawDevice = rawDeviceForConnection(deviceIndex, connectionId);
  if (!rawDevice) {
    throw new Error('The phone re-established its USB connection while MTP was preparing to open.');
  }
  deviceIndex = rawDevice.index;
  deviceIdentityKey = rawDeviceIdentityKey(rawDevice);
  rawKey = rawDeviceKey(rawDevice);

  if (sessionProcess) {
    await destroyMtpSession('Restarting MTP session for a different phone connection.', true);
  }

  if (!(await checkMacMtpCameraAccess(rawDevice, generation))) {
    appendLog(
      `macOS camera import still owns the MTP interface for ${connectionId}; the bounded connection attempt stopped without resetting the phone USB session`
    );
    throw new MtpUsbBusyError(blockedMtpAccessMessage());
  }

  if (generation !== connectionAttemptGeneration) throw new Error('Opening phone files was canceled.');
  await refreshRawDevices();
  rawDevice = rawDeviceForConnection(deviceIndex, connectionId);
  if (!rawDevice) throw new Error('The phone re-established its USB connection while checking USB ownership.');
  if (generation !== connectionAttemptGeneration) throw new Error('Opening phone files was canceled.');
  deviceIndex = rawDevice.index;
  deviceIdentityKey = rawDeviceIdentityKey(rawDevice);
  rawKey = rawDeviceKey(rawDevice);

  sessionStdoutBuffer = '';
  sessionStderrBuffer = '';
  lastSessionStderr = '';
  const child = spawn(helperPath, ['session', String(deviceIndex)], {
    env: {
      ...process.env,
      MAC_ANDROID_TRANSFER_DISABLE_USB_RESET: '1',
      ...(MTP_DIAGNOSTIC_DEBUG ? { LIBMTP_DEBUG: '13' } : {})
    }
  });
  sessionProcess = child;
  sessionDeviceIndex = deviceIndex;
  sessionRawKey = null;
  pendingSessionRawKey = rawKey;
  sessionConnectionId = null;
  pendingSessionConnectionId = connectionId;
  sessionDeviceIdentityKey = null;
  pendingSessionDeviceIdentityKey = deviceIdentityKey;
  mainWindow?.webContents.send('mtp:connection-phase', {
    phase: 'opening',
    connectionId
  } satisfies MtpConnectionPhaseEvent);
  appendLog(`mtp session starting for device index ${deviceIndex}`);

  sessionReady = new Promise<void>((resolve, reject) => {
    sessionReadyResolve = resolve;
    sessionReadyReject = reject;
  });
  armSessionOpenWatchdog(child);

  child.stdout.on('data', handleSessionStdout);
  child.stderr.on('data', (chunk: Buffer) => {
    const stderrChunk = chunk.toString('utf8');
    sessionStderrBuffer += stderrChunk;
    if (sessionStderrBuffer.length > 20_000) {
      sessionStderrBuffer = sessionStderrBuffer.slice(-20_000);
    }
    lastSessionStderr = sessionStderrBuffer.trim();
  });
  child.on('error', (error) => {
    if (sessionProcess === child) {
      destroyMtpSession(`MTP session process error: ${error.message}`);
    }
  });
  child.on('close', (code, signal) => {
    const message = `MTP session exited with code ${code ?? 'null'} signal ${signal ?? 'null'}.`;
    appendLog(message);
    if (sessionProcess === child) {
      if (MTP_DIAGNOSTIC_DEBUG && sessionStderrBuffer.trim()) {
        appendLog(`MTP session debug output:\n${sessionStderrBuffer.trim()}`);
      }
      lastSessionStderr = sessionStderrBuffer.trim() || lastSessionStderr;
      clearSessionReady(new Error(message));
      rejectSessionCommands(new Error(message));
      sessionProcess = null;
      sessionDeviceIndex = null;
      sessionRawKey = null;
      pendingSessionRawKey = null;
      sessionConnectionId = null;
      pendingSessionConnectionId = null;
      sessionDeviceIdentityKey = null;
      pendingSessionDeviceIdentityKey = null;
      sessionStdoutBuffer = '';
      sessionStderrBuffer = '';
    }
  });

  await sessionReady;
}

async function runSessionCommand<T extends SessionPayload>(
  deviceIndex: number,
  deviceConnectionId: string,
  commandName: string,
  args: string[],
  timeoutMs: number,
  onEvent?: (payload: SessionPayload) => void
): Promise<T> {
  await ensureMtpSession(deviceIndex, deviceConnectionId);

  if (args.some((arg) => /[\r\n]/.test(arg))) {
    throw new Error('MTP command arguments cannot contain newlines.');
  }

  return new Promise<T>((resolve, reject) => {
    const id = randomUUID();
    const line = [commandName, id, ...args].join(' ') + '\n';
    sessionQueue.push({
      id,
      name: commandName,
      line,
      timeoutMs,
      resolve: (payload) => resolve(payload as T),
      reject,
      onEvent
    });
    pumpSessionQueue();
  });
}

async function runBridgeJson<T>(
  command: string,
  args: string[],
  fallback: T,
  timeoutMs: number
): Promise<T & { helperPath: string; logPath: string; stderr?: string }> {
  try {
    const helperPath = await ensureBridge();

    return await new Promise((resolvePromise) => {
      let settled = false;
      let timedOut = false;
      const child = execFile(
        helperPath,
        [command, ...args],
        {
          maxBuffer: 1024 * 1024 * 100,
          env: {
            ...process.env,
            MAC_ANDROID_TRANSFER_DISABLE_USB_RESET: '1'
          }
        },
        (error, stdout, stderr) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);

          const fallbackWithError = { ...fallback };
          const stderrText = stderr.trim();
          if (error || timedOut) {
            const errorMessage = timedOut
              ? `The MTP helper timed out after ${timeoutMs}ms.`
              : error?.message || 'The MTP helper failed.';
            const hint = bridgeFailureHint(stderrText, timedOut);
            appendLog(`${command} failed: ${errorMessage}`);
            const target = fallbackWithError as { message?: string };
            if (target.message) {
              const reason = timedOut
                ? 'The MTP helper timed out while opening the phone session.'
                : errorMessage;
              target.message = `${target.message} ${reason}${hint ? ` ${hint}` : ''}`;
            }
          }
          if (stderrText) {
            appendLog(`${command} stderr: ${stderrText}`);
          }

          try {
            const parsed = parseJson<T>(stdout, fallback);
            resolvePromise({
              ...parsed,
              helperPath,
              logPath: getLogPath(),
              stderr: stderr.trim() || undefined
            });
          } catch (parseError) {
            const message =
              parseError instanceof Error ? parseError.message : 'Unknown JSON parse error';
            appendLog(`${command} parse failed: ${message}`);
            resolvePromise({
              ...fallbackWithError,
              helperPath,
              logPath: getLogPath(),
              stderr: `${stderr.trim()}\n${message}`.trim()
            });
          }
        }
      );

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!settled) {
            child.kill('SIGKILL');
          }
        }, 1500);
      }, timeoutMs);
    });
  } catch (error) {
    return {
      ...fallback,
      ...missingBridgeStatus(error),
      helperPath: getBridgePath(),
      logPath: getLogPath()
    };
  }
}

async function getStatus(): Promise<DeviceStatus> {
  let status = await runBridgeJson<DeviceStatus>(
    'status',
    [],
    {
      ok: false,
      state: 'error',
      message: 'Unable to check MTP device status.',
      deviceCount: 0,
      rawDevices: [],
      helperPath: getBridgePath(),
      logPath: getLogPath()
    },
    10_000
  );

  if (status.state === 'no-device' && status.rawDevices.length === 0) {
    status = (await androidUsbFallbackStatus(status)) ?? status;
  }

  if (status.rawDevices.length > 0) {
    status = {
      ...status,
      rawDevices: withRawDeviceConnectionIds(
        await enrichRawDevicesWithAndroidUsbMetadata(status.rawDevices)
      )
    };
  }

  lastRawDevices = status.rawDevices;
  rememberRawDeviceConnections(lastRawDevices);

  const currentKeys = new Set(lastRawDevices.map((device) => rawDeviceKey(device)));
  const currentConnectionIds = new Set(lastRawDevices.map(rawDeviceConnectionId));
  cameraConflicts.retainConnections(currentConnectionIds);
  const currentDeviceIdentityKeys = new Set(lastRawDevices.map(rawDeviceIdentityKey));
  if (currentKeys.size > 0) {
    rawDevicesMissingSince = null;
  }

  if (
    sessionProcess &&
    sessionConnectionId &&
    currentConnectionIds.size > 0 &&
    !currentConnectionIds.has(sessionConnectionId)
  ) {
    const samePhoneStillVisible =
      !!sessionDeviceIdentityKey && currentDeviceIdentityKeys.has(sessionDeviceIdentityKey);
    if (!samePhoneStillVisible) {
      destroyMtpSession('The open MTP session belongs to a different phone connection.', true);
    } else if (connectionIdIsUsbSessionScoped(sessionConnectionId)) {
      appendLog(
        `phone re-enumerated on USB (${sessionConnectionId} -> ${Array.from(currentConnectionIds).join(',')}); reopening the MTP session on the new connection`
      );
      destroyMtpSession('The phone re-established its USB connection.', true);
    }
  }

  if (sessionProcess && !sessionConnectionId && pendingSessionConnectionId) {
    const pendingConnectionStillVisible = lastRawDevices.some(
      (device) =>
        rawDeviceConnectionId(device) === pendingSessionConnectionId &&
        device.connectionMode === 'mtp'
    );
    const sameMtpIdentityMoved =
      !!pendingSessionDeviceIdentityKey &&
      currentDeviceIdentityKeys.has(pendingSessionDeviceIdentityKey) &&
      !currentConnectionIds.has(pendingSessionConnectionId);

    if (pendingConnectionStillVisible) {
      openingDeviceMissingSince = null;
    } else if (sameMtpIdentityMoved) {
      appendLog(
        `phone changed USB connection while MTP was opening (${pendingSessionConnectionId} -> ${Array.from(currentConnectionIds).join(',')}); abandoning the stale attempt`
      );
      destroyMtpSession('The phone re-established its USB connection while opening files.', true);
    } else {
      const now = Date.now();
      if (openingDeviceMissingSince === null) {
        openingDeviceMissingSince = now;
        appendLog('File Transfer disappeared while MTP was opening; waiting for one confirming status check');
      } else if (now - openingDeviceMissingSince >= OPENING_DEVICE_MISSING_GRACE_MS) {
        destroyMtpSession('File Transfer was turned off while opening phone files.', true);
      }
    }
  } else {
    openingDeviceMissingSince = null;
  }

  if (sessionProcess) {
    if (currentKeys.size === 0) {
      const now = Date.now();
      if (rawDevicesMissingSince === null) {
        rawDevicesMissingSince = now;
        appendLog('raw MTP device temporarily missing while the persistent session is open; keeping the session alive');
      }

      if (now - rawDevicesMissingSince >= RAW_DEVICE_MISSING_SESSION_GRACE_MS) {
        destroyMtpSession('MTP raw device disappeared.', true);
      }
    } else {
      if (sessionProcess && sessionRawKey && !currentKeys.has(sessionRawKey)) {
        appendLog(`preserving open MTP session for the same USB attachment across raw address change: ${sessionRawKey} -> ${Array.from(currentKeys).join(',')}`);
      }
    }
  }

  const normalSessionOpen = !!sessionProcess && !!sessionConnectionId && !!sessionDeviceIdentityKey;
  const hasMtpDevice = lastRawDevices.some((device) => device.connectionMode === 'mtp');
  const connectionPhase: MtpConnectionPhase = !lastRawDevices.length
    ? 'no-phone'
    : !hasMtpDevice
      ? 'file-transfer-off'
      : normalSessionOpen
        ? 'listing-storage'
        : 'opening';

  return {
    ...status,
    connectionPhase,
    sessionOpen: normalSessionOpen,
    sessionConnectionId: sessionConnectionId ?? undefined,
    sessionConnectionIds: sessionConnectionId ? [sessionConnectionId] : [],
    usbOwnerApp: normalSessionOpen ? undefined : currentMacCameraClientApp(),
    usbConflict: normalSessionOpen ? undefined : currentUsbConflict()
  };
}

function limitDiagnosticText(value: string | undefined, maxLength = 4000): string {
  const normalized = (value ?? '').replace(/\0/g, '').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}\n... truncated ...`;
}

function hexDeviceId(value: number): string {
  return value.toString(16).padStart(4, '0');
}

function rawDeviceLine(device: RawDevice): string {
  const usbProtection =
    device.needsDeviceAccessEntitlement === undefined
      ? 'not reported'
      : device.needsDeviceAccessEntitlement
        ? 'required'
        : 'not reported';
  const configuration =
    device.usbCurrentConfiguration === undefined
      ? 'unknown'
      : String(device.usbCurrentConfiguration);

  return [
    `- ${device.vendor || 'Unknown vendor'} ${device.product || 'Unknown product'}`,
    `vid:pid ${hexDeviceId(device.vendorId)}:${hexDeviceId(device.productId)}`,
    `bus/device ${device.bus}/${device.device}`,
    `usb session ${device.usbSessionId || 'unknown'}`,
    `mode ${device.connectionMode ?? 'unknown'}`,
    `serial ${device.serial || 'unknown'}`,
    `usb configuration ${configuration}`,
    `macOS USB protection ${usbProtection}`
  ].join(' | ');
}

function countJobsByStatus(): string {
  const counts = {
    queued: 0,
    active: 0,
    completed: 0,
    failed: 0,
    canceled: 0
  };

  for (const job of transferJobs.values()) {
    counts[job.status] += 1;
  }

  return Object.entries(counts)
    .map(([status, count]) => `${status}=${count}`)
    .join(', ');
}

function connectionDiagnosis(status: DeviceStatus): string {
  const rawMtpVisible = status.rawDevices.some((device) => device.connectionMode === 'mtp');
  const rawUsbVisible = status.rawDevices.length > 0;

  if (status.sessionOpen || status.state === 'connected') {
    return 'MTP file session is open.';
  }
  if (rawMtpVisible && status.state === 'connect-error') {
    return 'USB and File Transfer mode are visible, but the MTP file session is not open.';
  }
  if (rawUsbVisible) {
    return 'USB device is visible, but File Transfer mode or file access is not open.';
  }
  return 'No Android file-transfer USB device is visible.';
}

function buildDiagnosticsReport(status: DeviceStatus, generatedAt: string): string {
  const cameraServices = runningMacCameraServices();
  const rawDevices = status.rawDevices.length
    ? status.rawDevices.map(rawDeviceLine)
    : ['- none reported'];
  const stderr = limitDiagnosticText(status.stderr || lastSessionStderr);

  return [
    'Android File Transfer for macOS Diagnostics',
    `Generated: ${generatedAt}`,
    '',
    'App',
    `Version: ${app.getVersion()}`,
    `Packaged: ${app.isPackaged && !IS_DEVELOPMENT_RUNTIME ? 'yes' : 'no'}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Electron: ${process.versions.electron ?? 'unknown'}`,
    `Node: ${process.versions.node}`,
    '',
    'Paths',
    `Helper: ${getBridgePath()}`,
    `Log: ${getLogPath()}`,
    '',
    'Connection',
    `Diagnosis: ${connectionDiagnosis(status)}`,
    `State: ${status.state}`,
    `OK: ${status.ok ? 'yes' : 'no'}`,
    `Message: ${status.message}`,
    `Device count: ${status.deviceCount}`,
    `Session open: ${status.sessionOpen ? 'yes' : 'no'}`,
    `Connection phase: ${status.connectionPhase ?? 'unknown'}`,
    `Camera/import services: ${cameraServices.length ? cameraServices.join(', ') : 'none detected'}`,
    '',
    'Raw USB devices',
    ...rawDevices,
    '',
    'Transfer queue',
    countJobsByStatus(),
    '',
    'Recent native error',
    stderr || 'none',
    '',
    'Privacy note',
    'This report includes connection state, USB metadata, helper paths, and recent native error text. It does not include a phone file listing.'
  ].join('\n');
}

async function copyDiagnostics(): Promise<DiagnosticsCopyResult> {
  const generatedAt = new Date().toISOString();

  try {
    const status = await getStatus();
    const text = buildDiagnosticsReport(status, generatedAt);
    clipboard.writeText(text);
    appendLog('diagnostics report copied to clipboard');
    return {
      ok: true,
      copied: true,
      generatedAt,
      text,
      message: 'Copied connection report. It includes USB/session state, not phone file names.'
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const text = [
      'Android File Transfer for macOS Diagnostics',
      `Generated: ${generatedAt}`,
      '',
      'Status check failed while building the report.',
      limitDiagnosticText(detail) || 'Unknown error.',
      '',
      `Helper: ${getBridgePath()}`,
      `Log: ${getLogPath()}`
    ].join('\n');

    clipboard.writeText(text);
    appendLog(`limited diagnostics report copied after status failure: ${detail}`);
    return {
      ok: false,
      copied: true,
      generatedAt,
      text,
      message: 'Copied a limited report. The phone status check failed while building it.'
    };
  }
}

function publishAppUpdateStatus(status: AppUpdateCheckResult): AppUpdateCheckResult {
  appUpdateStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:update-status', status);
  }
  return status;
}

async function updateInstallBlockReason(): Promise<string | null> {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    return 'In-app updates are available in the installed macOS app.';
  }
  const location = classifyUpdateInstallLocation(process.execPath, app.getPath('downloads'));
  if (location.reason || !location.appBundlePath) {
    return location.reason;
  }
  try {
    await access(location.appBundlePath, constants.W_OK);
    await access(dirname(location.appBundlePath), constants.W_OK);
    return null;
  } catch {
    return 'This app location is not writable. Move the app to Applications, or download the new version from GitHub.';
  }
}

autoUpdater.on('error', (error) => {
  appendLog(`update service error: ${error.message}`);
  publishAppUpdateStatus({
    ...appUpdateStatus,
    ok: false,
    status: 'error',
    message: 'The update could not be completed. Try again or download the release from GitHub.'
  });
});

autoUpdater.on('download-progress', (progress) => {
  if (appUpdateStatus.status !== 'downloading') {
    return;
  }
  publishAppUpdateStatus({
    ...appUpdateStatus,
    downloadPercent: Math.max(0, Math.min(100, progress.percent)),
    message: `Downloading version ${appUpdateStatus.latestVersion ?? ''}...`
  });
});

autoUpdater.on('update-downloaded', (event) => {
  appendLog(`update downloaded: ${event.version}`);
  publishAppUpdateStatus({
    ...appUpdateStatus,
    ok: true,
    status: 'ready-to-install',
    latestVersion: event.version,
    releaseTag: `v${event.version}`,
    downloadPercent: 100,
    message: `Version ${event.version} is ready. Restart to install it.`
  });
});

async function fetchAppUpdateResult(): Promise<AppUpdateCheckResult> {
  const checkedAt = new Date().toISOString();
  const currentVersion = app.getVersion();
  publishAppUpdateStatus({
    ok: true,
    status: 'checking',
    currentVersion,
    checkedAt,
    message: 'Checking for updates...'
  });
  if (!app.isPackaged) {
    return publishAppUpdateStatus({
      ok: false,
      status: 'error',
      currentVersion,
      checkedAt,
      message: 'Update checks are available in the installed app.'
    });
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result) {
      throw new Error('The update service did not return a result.');
    }
    if (!result.isUpdateAvailable) {
      appendLog(`update check complete: ${currentVersion} is current`);
      return publishAppUpdateStatus({
        ok: true,
        status: 'up-to-date',
        currentVersion,
        checkedAt,
        message: `Version ${currentVersion} is up to date.`
      });
    }
    const latestVersion = result.updateInfo.version;
    const blockReason = await updateInstallBlockReason();
    appendLog(`update available: ${currentVersion} -> ${latestVersion}`);
    return publishAppUpdateStatus({
      ok: true,
      status: 'update-available',
      currentVersion,
      latestVersion,
      releaseTag: `v${latestVersion}`,
      checkedAt,
      canInstallInPlace: blockReason === null,
      message: blockReason ?? `Version ${latestVersion} is available to download.`
    });
  } catch (error) {
    appendLog(`update check failed: ${error instanceof Error ? error.message : String(error)}`);
    return publishAppUpdateStatus({
      ok: false,
      status: 'error',
      currentVersion,
      checkedAt,
      message: 'Could not reach the GitHub update service. Try again later.'
    });
  }
}

function getAppUpdateResult(): Promise<AppUpdateCheckResult> {
  if (updateCheckInFlight) {
    return updateCheckInFlight;
  }
  if (appUpdateStatus.status === 'downloading' || appUpdateStatus.status === 'ready-to-install') {
    return Promise.resolve(appUpdateStatus);
  }
  updateCheckInFlight = fetchAppUpdateResult().finally(() => {
    updateCheckInFlight = null;
  });
  return updateCheckInFlight;
}

async function downloadAppUpdate(): Promise<AppUpdateCheckResult> {
  if (updateDownloadInFlight) {
    return updateDownloadInFlight;
  }
  if (appUpdateStatus.status !== 'update-available' || !appUpdateStatus.latestVersion) {
    return appUpdateStatus;
  }
  const blockReason = await updateInstallBlockReason();
  if (blockReason) {
    return publishAppUpdateStatus({
      ...appUpdateStatus,
      canInstallInPlace: false,
      message: blockReason
    });
  }
  publishAppUpdateStatus({
    ...appUpdateStatus,
    status: 'downloading',
    downloadPercent: 0,
    message: `Downloading version ${appUpdateStatus.latestVersion}...`
  });
  updateDownloadInFlight = autoUpdater.downloadUpdate()
    .then(() => appUpdateStatus)
    .catch((error: unknown) => {
      appendLog(`update download failed: ${error instanceof Error ? error.message : String(error)}`);
      return publishAppUpdateStatus({
        ...appUpdateStatus,
        ok: false,
        status: 'error',
        message: 'The update download failed. Check your connection and try again, or use the GitHub release.'
      });
    })
    .finally(() => {
      updateDownloadInFlight = null;
    });
  return updateDownloadInFlight;
}

function hasUnfinishedFileWork(): boolean {
  return Boolean(
    activeJobId ||
    [...transferJobs.values()].some((job) => job.status === 'active' || job.status === 'queued') ||
    phoneMutationInProgress ||
    localMutationInProgress ||
    pendingPromisePlanningCount > 0 ||
    promiseFulfillments.size > 0
  );
}

async function installAppUpdate(): Promise<OpenUpdateReleaseResult> {
  if (appUpdateStatus.status !== 'ready-to-install') {
    return { ok: false, message: 'Download the update before restarting to install it.' };
  }
  const blockReason = await updateInstallBlockReason();
  if (blockReason) {
    return { ok: false, message: blockReason };
  }
  if (hasUnfinishedFileWork()) {
    return { ok: false, message: 'Finish current file transfers before restarting to install the update.' };
  }
  appendLog(`user requested install of version ${appUpdateStatus.latestVersion}`);
  setTimeout(() => {
    if (hasUnfinishedFileWork()) {
      appendLog('update restart canceled because a file operation started');
      publishAppUpdateStatus({
        ...appUpdateStatus,
        message: 'Finish current file transfers before restarting to install the update.'
      });
      return;
    }
    try {
      autoUpdater.quitAndInstall();
    } catch (error) {
      appendLog(`update restart failed: ${error instanceof Error ? error.message : String(error)}`);
      publishAppUpdateStatus({
        ...appUpdateStatus,
        ok: false,
        status: 'error',
        message: 'Could not restart to install the update. Try again or use the GitHub release.'
      });
    }
  }, 50);
  return { ok: true, message: 'Restarting to install the update.' };
}

async function showUpdateCheckDialog(result: AppUpdateCheckResult): Promise<void> {
  let options: MessageBoxOptions;
  if (result.status === 'update-available' && result.latestVersion && result.releaseTag) {
    options = {
      type: 'info',
      title: 'Update Available',
      message: `Version ${result.latestVersion} is available.`,
      detail: result.message,
      buttons: result.canInstallInPlace ? ['Download Update', 'View Release', 'Later'] : ['View Release', 'Later'],
      defaultId: 0,
      cancelId: result.canInstallInPlace ? 2 : 1,
      noLink: true
    };
  } else if (result.status === 'ready-to-install') {
    options = {
      type: 'info',
      title: 'Update Ready',
      message: result.message,
      buttons: ['Restart and Install', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    };
  } else if (result.status === 'up-to-date') {
    options = {
      type: 'info',
      title: 'No Updates',
      message: 'Android File Transfer for macOS is up to date.',
      detail: `You are using version ${result.currentVersion}.`,
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    };
  } else {
    options = {
      type: result.status === 'error' ? 'warning' : 'info',
      title: result.status === 'error' ? 'Update Check Failed' : 'Update in Progress',
      message: result.message,
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    };
  }
  const response = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (response.response !== 0) {
    if (response.response === 1 && result.status === 'update-available' && result.canInstallInPlace && result.releaseTag) {
      await openUpdateRelease(result.releaseTag);
    }
    return;
  }
  if (result.status === 'update-available' && result.releaseTag) {
    if (result.canInstallInPlace) {
      void downloadAppUpdate();
    } else {
      await openUpdateRelease(result.releaseTag);
    }
  } else if (result.status === 'ready-to-install') {
    const install = await installAppUpdate();
    if (!install.ok) {
      await dialog.showMessageBox({ type: 'warning', message: install.message, buttons: ['OK'] });
    }
  }
}

async function checkForAppUpdates(interactive: boolean): Promise<AppUpdateCheckResult> {
  const result = await getAppUpdateResult();
  if (interactive) {
    await showUpdateCheckDialog(result);
  }
  return result;
}

async function openUpdateRelease(releaseTag: string): Promise<OpenUpdateReleaseResult> {
  const normalized = typeof releaseTag === 'string' ? normalizeSemanticVersion(releaseTag) : null;
  if (!normalized) {
    appendLog('blocked invalid update release tag');
    return { ok: false, message: 'That update link is not valid.' };
  }
  try {
    await shell.openExternal(`${GITHUB_RELEASES_WEB}${encodeURIComponent(releaseTag.trim())}`);
    return { ok: true, message: `Opened the version ${normalized} release.` };
  } catch (error) {
    appendLog(`unable to open update release: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, message: 'Could not open the update page.' };
  }
}

async function scanInventory(): Promise<InventoryResult> {
  const fallback: InventoryResult = {
    ok: false,
    state: 'error',
    message: 'Unable to scan the MTP device.',
    devices: [],
    connectionPhase: 'needs-mode-reset',
    connectionIssue: 'unknown',
    helperPath: getBridgePath(),
    logPath: getLogPath()
  };

  await refreshRawDevices();
  const candidates = lastRawDevices.filter((device) => device.connectionMode !== 'usb-only');
  if (!candidates.length) {
    return helperMetadata({
      ...fallback,
      state: lastRawDevices.length ? 'connect-error' : 'no-device',
      connectionPhase: lastRawDevices.length ? 'file-transfer-off' : 'no-phone',
      connectionIssue: lastRawDevices.length ? undefined : 'disconnected',
      message: lastRawDevices.length
        ? 'A phone is connected, but File Transfer mode is not available.'
        : 'No phone file-transfer connection was detected.'
    });
  }

  const devices: MtpDeviceInventory[] = [];
  const failures: string[] = [];
  const stderrParts: string[] = [];
  let fileAccessUnavailable = false;
  let connectionIssue: MtpConnectionIssue = 'unknown';

  for (const rawDevice of candidates) {
    const connectionId = rawDeviceConnectionId(rawDevice);
    try {
      const result = await runSessionCommand<InventoryResult & SessionPayload>(
        rawDevice.index,
        connectionId,
        'inventory',
        [],
        60_000
      );
      const nativeDevice =
        result.devices?.find((candidate) => candidate.index === rawDevice.index) ?? result.devices?.[0];
      appendThrottledLog(
        `inventory answer for ${connectionId}: ok=${String(result.ok)} devices=${result.devices?.length ?? 0} storages=${JSON.stringify(
          nativeDevice?.storages?.map((storage) => ({ id: storage.id, inferred: storage.inferred === true })) ?? []
        )}${result.ok ? '' : ` message=${result.message ?? ''}`}`
      );
      if (!result.ok || !nativeDevice) {
        connectionIssue = 'storage-unavailable';
        failures.push(result.message || `${rawDevice.vendor || rawDevice.product} did not return storage information.`);
        continue;
      }

      const inferredStorages = nativeDevice.storages.filter((storage) => storage.inferred);
      let inferredStorageIsReadable = true;
      for (const storage of inferredStorages) {
        try {
          const reportProgress = (payload: SessionPayload): void => {
            if (
              payload.event !== 'progress' ||
              typeof payload.sent !== 'number' ||
              typeof payload.total !== 'number'
            ) {
              return;
            }
            mainWindow?.webContents.send('folder-list:progress', {
              deviceConnectionId: connectionId,
              storageId: storage.id,
              parentId: MTP_ROOT_PARENT_ID,
              sent: payload.sent,
              total: payload.total
            } satisfies FolderListProgress);
          };
          const rootResult = await runSessionCommand<FolderListResult & SessionPayload>(
            rawDevice.index,
            connectionId,
            'list',
            [String(storage.id), String(MTP_ROOT_PARENT_ID)],
            180_000,
            reportProgress
          );
          inferredStorageIsReadable = rootResult.ok === true;
        } catch (error) {
          inferredStorageIsReadable = false;
          appendLog(
            `inferred storage validation failed for ${connectionId}: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        if (!inferredStorageIsReadable) {
          break;
        }
      }

      if (!inferredStorageIsReadable) {
        fileAccessUnavailable = true;
        connectionIssue = 'storage-unavailable';
        failures.push(PHONE_FILES_UNAVAILABLE_MESSAGE);
        appendThrottledLog(
          `phone file access validation failed for ${connectionId}; keeping the persistent session open for an explicit storage retry (helper stderr: ${limitDiagnosticText(lastSessionStderr, 400) || 'none'})`
        );
        continue;
      }

      devices.push({
        ...nativeDevice,
        index: rawDevice.index,
        connectionId
      });
      const stderr = lastSessionStderr;
      if (stderr?.trim()) {
        stderrParts.push(stderr.trim());
      }
    } catch (error) {
      const stderr = lastSessionStderr;
      connectionIssue = classifyMtpConnectionIssue(error, stderr);
      const message = sessionErrorMessage(
        `Unable to open ${rawDevice.vendor || rawDevice.product || 'the phone'}.`,
        error,
        stderr ?? ''
      );
      appendThrottledLog(`inventory failed for ${connectionId}: ${message}${stderr?.trim() ? ` (${limitDiagnosticText(stderr, 600)})` : ''}`);
      failures.push(message);
      if (stderr?.trim()) {
        stderrParts.push(stderr.trim());
      }
    }
  }

  if (devices.length) {
    return helperMetadata(
      {
        ok: true,
        state: 'connected',
        connectionPhase: 'ready',
        connectionIssue: undefined,
        message: failures.length
          ? `Opened ${devices.length} phone${devices.length === 1 ? '' : 's'}; ${failures.length} other connection${failures.length === 1 ? '' : 's'} could not be opened.`
          : `Opened ${devices.length} phone${devices.length === 1 ? '' : 's'}.`,
        devices,
        helperPath: getBridgePath(),
        logPath: getLogPath()
      },
      stderrParts.join('\n')
    );
  }

  const combinedMessage = failures.join(' ').trim();
  if (fileAccessUnavailable) {
    return helperMetadata(
      {
        ...fallback,
        state: 'connect-error',
        connectionPhase: 'needs-mode-reset',
        connectionIssue: 'storage-unavailable',
        message: PHONE_FILES_UNAVAILABLE_MESSAGE,
        fileAccessUnavailable: true
      },
      stderrParts.join('\n')
    );
  }
  const finalIssue = connectionIssue === 'unknown'
    ? classifyMtpConnectionIssue(combinedMessage, stderrParts.join('\n'))
    : connectionIssue;
  const usbOwnerApp = currentMacCameraClientApp();
  return helperMetadata(
    {
      ...fallback,
      state: 'connect-error',
      connectionPhase: connectionPhaseForIssue(finalIssue),
      connectionIssue: finalIssue,
      message: usbOwnerApp
        ? `${usbOwnerApp} is an active camera-import client. Waiting for the phone connection; see the connection panel for options.`
        : sessionErrorMessage(fallback.message, combinedMessage || fallback.message, stderrParts.join('\n')),
      usbOwnerApp
    },
    stderrParts.join('\n')
  );
}

async function listFolder(
  deviceIndex: number,
  deviceConnectionId: string,
  storageId: number,
  parentId: number
): Promise<FolderListResult> {
  const reportProgress = (payload: SessionPayload): void => {
    if (
      payload.event !== 'progress' ||
      typeof payload.sent !== 'number' ||
      typeof payload.total !== 'number'
    ) {
      return;
    }
    const progress: FolderListProgress = {
      deviceConnectionId,
      storageId,
      parentId,
      sent: payload.sent,
      total: payload.total
    };
    mainWindow?.webContents.send('folder-list:progress', progress);
  };
  const fallback: FolderListResult = {
    ok: false,
    state: 'error',
    message: 'Unable to list the selected MTP folder.',
    deviceIndex,
    storageId,
    parentId,
    objects: [],
    connectionPhase: 'needs-mode-reset',
    connectionIssue: 'unknown',
    helperPath: getBridgePath(),
    logPath: getLogPath()
  };

  try {
    const result = await runSessionCommand<FolderListResult & SessionPayload>(
      deviceIndex,
      deviceConnectionId,
      'list',
      [String(storageId), String(parentId)],
      180_000,
      reportProgress
    );
    if (!result.ok && parentId === MTP_ROOT_PARENT_ID) {
      appendLog(
        `session root listing failed for ${deviceConnectionId}; keeping the persistent session open for an explicit storage retry`
      );
      return helperMetadata(
        {
          ...result,
          state: 'connect-error',
          connectionPhase: 'needs-mode-reset',
          connectionIssue: 'storage-unavailable',
          message: PHONE_FILES_UNAVAILABLE_MESSAGE,
          fileAccessUnavailable: true
        },
        lastSessionStderr
      );
    }
    return helperMetadata(
      {
        ...result,
        connectionPhase: result.ok ? 'ready' : 'needs-mode-reset',
        connectionIssue: result.ok ? undefined : 'unknown'
      },
      lastSessionStderr
    );
  } catch (error) {
    appendLog(`session list failed: ${String(error)}`);
    const issue = classifyMtpConnectionIssue(error, lastSessionStderr);
    return helperMetadata(
      {
        ...fallback,
        state: 'connect-error',
        connectionPhase: connectionPhaseForIssue(issue),
        connectionIssue: issue,
        message: sessionErrorMessage(fallback.message, error, lastSessionStderr)
      },
      lastSessionStderr
    );
  }
}

function isUint32(value: unknown, allowZero: boolean): value is number {
  return Number.isInteger(value) &&
    typeof value === 'number' &&
    value >= (allowZero ? 0 : 1) &&
    value <= 0xffffffff;
}

function phoneMutationTargetError(target: PhoneMutationTarget | null | undefined): string | null {
  if (!target || typeof target !== 'object') {
    return 'No phone item was selected.';
  }
  if (!isUint32(target.objectId, false) ||
      !isUint32(target.storageId, false) ||
      !isUint32(target.parentId, true)) {
    return 'The selected phone item has invalid metadata. Refresh the folder and try again.';
  }
  if (target.kind !== 'file' && target.kind !== 'folder') {
    return 'Only phone files and folders can be changed.';
  }
  if (target.kind === 'file') {
    if (typeof target.size !== 'number' || !Number.isSafeInteger(target.size) || target.size < 0) {
      return 'The selected phone file has invalid size metadata. Refresh the folder and try again.';
    }
    if (
      target.modified !== undefined &&
      (typeof target.modified !== 'number' || !Number.isSafeInteger(target.modified) || target.modified <= 0)
    ) {
      return 'The selected phone file has invalid modification metadata. Refresh the folder and try again.';
    }
  } else if (target.size !== undefined || target.modified !== undefined) {
    return 'The selected phone folder has unexpected file metadata. Refresh the folder and try again.';
  }
  if (!target.name || target.name.includes('\0') || encodePhoneCommandName(target.name).length > 510) {
    return 'The selected phone item has an invalid name. Refresh the folder and try again.';
  }
  return null;
}

function phoneMutationUnavailableMessage(): string | null {
  if (phoneMutationInProgress) {
    return 'Another phone change is still in progress.';
  }
  if (pendingPromisePlanningCount > 0) {
    return 'Wait for the accepted drag to finish listing its phone folder.';
  }
  if ([...transferJobs.values()].some((job) => job.status === 'queued' || job.status === 'active')) {
    return 'Wait for the transfer queue to finish before changing phone items.';
  }
  return null;
}

async function runPhoneMutationCommand(
  deviceIndex: number,
  deviceConnectionId: string,
  command: 'rename-item' | 'delete-item',
  args: string[]
): Promise<{ result: SessionPayload; stderr: string }> {
  const result = await runSessionCommand<SessionPayload>(
    deviceIndex,
    deviceConnectionId,
    command,
    args,
    60_000
  );
  return { result, stderr: lastSessionStderr };
}

function phoneMutationArgs(target: PhoneMutationTarget): string[] {
  return [
    String(target.objectId),
    String(target.storageId),
    String(target.parentId),
    target.kind,
    target.kind === 'file' ? String(target.size) : '-',
    target.kind === 'file' && target.modified !== undefined ? String(target.modified) : '-',
    encodePhoneCommandName(target.name)
  ];
}

async function renamePhoneItem(request: RenamePhoneItemRequest): Promise<RenamePhoneItemResult> {
  const fallback: RenamePhoneItemResult = {
    ok: false,
    state: 'error',
    message: 'Unable to rename the selected phone item.',
    objectId: request?.target?.objectId ?? 0,
    helperPath: getBridgePath(),
    logPath: getLogPath()
  };
  if (!request || !Number.isInteger(request.deviceIndex) || request.deviceIndex < 0 ||
      typeof request.deviceConnectionId !== 'string' || !request.deviceConnectionId) {
    return { ...fallback, message: 'The phone connection changed. Refresh the folder and try again.' };
  }
  const targetError = phoneMutationTargetError(request.target);
  if (targetError) {
    return { ...fallback, message: targetError };
  }
  const nameError = validatePhoneItemName(request.newName);
  if (nameError) {
    return { ...fallback, message: nameError };
  }
  if (request.newName === request.target.name) {
    return helperMetadata({
      ...fallback,
      ok: true,
      state: 'connected',
      message: 'The name is unchanged.',
      actualName: request.target.name,
      verified: true
    });
  }
  const unavailable = phoneMutationUnavailableMessage();
  if (unavailable) {
    return { ...fallback, message: unavailable };
  }

  phoneMutationInProgress = true;
  try {
    const { result, stderr } = await runPhoneMutationCommand(
      request.deviceIndex,
      request.deviceConnectionId,
      'rename-item',
      [...phoneMutationArgs(request.target), encodePhoneCommandName(request.newName)]
    );
    const actualName = typeof result.actualName === 'string' && result.actualName
      ? result.actualName
      : request.newName;
    const ok = result.ok === true;
    appendLog(ok
      ? `phone item renamed: ${request.target.name} -> ${actualName}`
      : `phone item rename failed: ${request.target.name}: ${result.message || fallback.message}`);
    return helperMetadata({
      ...fallback,
      ok,
      state: ok ? 'connected' : 'error',
      message: ok
        ? result.verified === false
          ? `Renamed to ${actualName}, but the phone did not return updated metadata. Refresh the folder to confirm.`
          : `Renamed to ${actualName}.`
        : result.message || fallback.message,
      actualName: ok ? actualName : undefined,
      verified: result.verified === true
    }, stderr);
  } catch (error) {
    const stderr = lastSessionStderr;
    appendLog(`phone item rename failed: ${request.target.name}: ${String(error)}`);
    const accessBlocked = await normalMtpAccessBlockedAfterRefresh(error, stderr);
    return helperMetadata({
      ...fallback,
      state: accessBlocked ? 'connect-error' : 'error',
      message: accessBlocked
        ? blockedMtpAccessMessage()
        : sessionErrorMessage(fallback.message, error, stderr)
    }, stderr);
  } finally {
    phoneMutationInProgress = false;
    processTransferQueue();
  }
}

function mutationDisplayName(name: string): string {
  return name.replace(/[\r\n\t]/g, ' ');
}

async function confirmPhoneDeletion(targets: PhoneMutationTarget[]): Promise<boolean> {
  const shownNames = targets.slice(0, 6).map((target) => `• ${mutationDisplayName(target.name)}`);
  if (targets.length > shownNames.length) {
    shownNames.push(`• and ${targets.length - shownNames.length} more`);
  }
  const folderWarning = targets.some((target) => target.kind === 'folder')
    ? 'Deleting a folder also permanently deletes everything inside it.\n\n'
    : '';
  const options = {
    type: 'warning' as const,
    buttons: ['Delete Permanently', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'Delete from phone?',
    message: `Permanently delete ${targets.length} ${targets.length === 1 ? 'item' : 'items'} from the phone?`,
    detail: `${folderWarning}There is no Trash or Undo for phone files.\n\n${shownNames.join('\n')}`
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}

async function deletePhoneItems(request: DeletePhoneItemsRequest): Promise<DeletePhoneItemsResult> {
  const fallback: DeletePhoneItemsResult = {
    confirmed: false,
    ok: false,
    state: 'error',
    message: 'Unable to delete the selected phone items.',
    deletedObjectIds: [],
    failures: [],
    helperPath: getBridgePath(),
    logPath: getLogPath()
  };
  if (!request || !Number.isInteger(request.deviceIndex) || request.deviceIndex < 0 ||
      typeof request.deviceConnectionId !== 'string' || !request.deviceConnectionId ||
      !Array.isArray(request.targets) || request.targets.length === 0) {
    return { ...fallback, message: 'Select at least one phone file or folder.' };
  }
  if (request.targets.length > MAX_PHONE_MUTATION_ITEMS) {
    return { ...fallback, message: `Delete at most ${MAX_PHONE_MUTATION_ITEMS} items at once.` };
  }

  const targets: PhoneMutationTarget[] = [];
  const seenObjectIds = new Set<number>();
  for (const target of request.targets) {
    const targetError = phoneMutationTargetError(target);
    if (targetError) {
      return { ...fallback, message: targetError };
    }
    if (!seenObjectIds.has(target.objectId)) {
      seenObjectIds.add(target.objectId);
      targets.push(target);
    }
  }
  const unavailable = phoneMutationUnavailableMessage();
  if (unavailable) {
    return { ...fallback, message: unavailable };
  }
  if (!(await confirmPhoneDeletion(targets))) {
    return helperMetadata({
      ...fallback,
      confirmed: false,
      ok: true,
      state: 'connected',
      message: 'Deletion canceled.'
    });
  }
  const unavailableAfterConfirmation = phoneMutationUnavailableMessage();
  if (unavailableAfterConfirmation) {
    return { ...fallback, confirmed: true, message: unavailableAfterConfirmation };
  }

  phoneMutationInProgress = true;
  const deletedObjectIds: number[] = [];
  const failures: DeletePhoneItemFailure[] = [];
  let stderr = '';
  try {
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index];
      try {
        const response = await runPhoneMutationCommand(
          request.deviceIndex,
          request.deviceConnectionId,
          'delete-item',
          phoneMutationArgs(target)
        );
        stderr = response.stderr || stderr;
        if (response.result.ok) {
          deletedObjectIds.push(target.objectId);
          appendLog(`phone item deleted: ${target.name} (${target.objectId})`);
        } else {
          const message = response.result.message || 'The phone could not permanently delete this item.';
          failures.push({ target, message });
          appendLog(`phone item delete failed: ${target.name}: ${message}`);
        }
      } catch (error) {
        stderr = lastSessionStderr || stderr;
        const message = sessionErrorMessage('The phone session stopped before this item was deleted.', error, stderr);
        failures.push({ target, message });
        for (const remaining of targets.slice(index + 1)) {
          failures.push({ target: remaining, message: 'Not attempted because the phone session stopped.' });
        }
        appendLog(`phone item delete session failed: ${target.name}: ${String(error)}`);
        break;
      }
    }
  } finally {
    phoneMutationInProgress = false;
    processTransferQueue();
  }

  const ok = failures.length === 0;
  const deletedCount = deletedObjectIds.length;
  const message = ok
    ? `Permanently deleted ${deletedCount} ${deletedCount === 1 ? 'item' : 'items'} from the phone.`
    : deletedCount > 0
      ? `Deleted ${deletedCount} ${deletedCount === 1 ? 'item' : 'items'}; ${failures.length} could not be deleted.`
      : failures[0]?.message || fallback.message;
  return helperMetadata({
    ...fallback,
    confirmed: true,
    ok,
    state: ok ? 'connected' : 'error',
    message,
    deletedObjectIds,
    failures
  }, stderr);
}

async function createPhoneFolder(request: CreateFolderRequest): Promise<CreateFolderResult> {
  const folderName = request.name.replace(/\0/g, '').trim();
  const fallback: CreateFolderResult = {
    ok: false,
    state: 'error',
    message: 'Unable to create the folder on the phone.',
    deviceIndex: request.deviceIndex,
    storageId: request.storageId,
    parentId: request.parentId,
    folderId: 0,
    name: folderName,
    helperPath: getBridgePath(),
    logPath: getLogPath()
  };

  if (!folderName) {
    return {
      ...fallback,
      message: 'The folder name is empty.'
    };
  }

  const normalizeResult = (result: SessionPayload, stderr?: string): CreateFolderResult => {
    const folderId = typeof result.folderId === 'number' ? result.folderId : 0;
    return helperMetadata(
      {
        ok: Boolean(result.ok && folderId > 0),
        state: result.ok && folderId > 0 ? 'connected' : 'error',
        message:
          result.ok && folderId > 0
            ? `Created ${folderName} on the phone.`
            : result.message || fallback.message,
        deviceIndex: request.deviceIndex,
        storageId: request.storageId,
        parentId: request.parentId,
        folderId,
        name: folderName
      },
      stderr
    );
  };

  try {
    const result = await runSessionCommand<SessionPayload>(
      request.deviceIndex,
      request.deviceConnectionId,
      'mkdir',
      [String(request.storageId), String(request.parentId), folderName],
      60_000
    );
    return normalizeResult(result, lastSessionStderr);
  } catch (error) {
    appendLog(`session mkdir failed: ${String(error)}`);
    const accessBlocked = await normalMtpAccessBlockedAfterRefresh(error, lastSessionStderr);
    return helperMetadata(
      {
        ...fallback,
        state: accessBlocked ? 'connect-error' : fallback.state,
        message: accessBlocked
          ? blockedMtpAccessMessage()
          : sessionErrorMessage(fallback.message, error, lastSessionStderr)
      },
      lastSessionStderr
    );
  }
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[/:]/g, '_').replace(/\0/g, '').trim();
  return cleaned || 'mtp-file';
}

function uniqueDestinationPath(
  directory: string,
  name: string,
  reservedPaths: ReadonlySet<string> = new Set()
): string {
  const safeName = sanitizeFileName(name);
  const dot = safeName.lastIndexOf('.');
  const base = dot > 0 ? safeName.slice(0, dot) : safeName;
  const ext = dot > 0 ? safeName.slice(dot) : '';
  let candidate = join(directory, safeName);
  let counter = 2;

  while (existsSync(candidate) || reservedPaths.has(candidate)) {
    candidate = join(directory, `${base} ${counter}${ext}`);
    counter += 1;
  }

  return candidate;
}

function downloadDestinationPlan(
  directory: string,
  name: string,
  reservedPaths: ReadonlySet<string> = new Set()
): Pick<
  TransferJob,
  'destinationPath' | 'originalDestinationPath' | 'renamedDestination'
> {
  const originalDestinationPath = join(directory, sanitizeFileName(name));
  const destinationPath = uniqueDestinationPath(directory, name, reservedPaths);
  return {
    destinationPath,
    originalDestinationPath,
    renamedDestination: destinationPath !== originalDestinationPath
  };
}

function reservedDownloadDestinationPaths(excludeJobId?: string): Set<string> {
  return new Set(
    Array.from(transferJobs.values())
      .filter(
        (job) =>
          job.id !== excludeJobId &&
          job.direction === 'download' &&
          (job.status === 'queued' || job.status === 'active')
      )
      .map((job) => job.destinationPath)
  );
}

function temporaryDownloadPath(destinationPath: string): string {
  return join(
    dirname(destinationPath),
    `.android-file-transfer-for-macos-${randomUUID()}-${sanitizeFileName(basename(destinationPath))}.partial`
  );
}

function cleanupTemporaryDownload(job: TransferJob): void {
  if (!job.temporaryPath) {
    return;
  }
  try {
    rmSync(job.temporaryPath, { force: true });
  } catch (error) {
    appendLog(`warning: unable to remove partial transfer ${job.temporaryPath}: ${String(error)}`);
  }
  job.temporaryPath = undefined;
}

function finalizeDownloadedFile(job: TransferJob): void {
  const temporaryPath = job.temporaryPath;
  if (!temporaryPath) {
    throw new Error('The transfer completed without a partial Mac file to publish.');
  }

  if (job.direction === 'download' && job.promiseId) {
    publishTemporaryFile({
      temporaryPath,
      destinationPath: job.destinationPath,
      expectedSize: job.size
    });
    job.originalDestinationPath = job.destinationPath;
    job.renamedDestination = false;
  } else if (job.direction === 'download' && job.collisionAction === 'replace' && job.destinationIdentity) {
    replaceTemporaryFile({
      temporaryPath,
      destinationPath: job.destinationPath,
      expectedSize: job.size,
      expectedExisting: job.destinationIdentity
    });
    job.originalDestinationPath = job.destinationPath;
    job.renamedDestination = false;
  } else if (job.direction === 'download') {
    const reservedPaths = reservedDownloadDestinationPaths(job.id);
    if (reservedPaths.has(job.destinationPath)) {
      job.destinationPath = uniqueDestinationPath(job.destinationDirectory, job.name, reservedPaths);
    }
    const published = publishTemporaryFile({
      temporaryPath,
      destinationPath: job.destinationPath,
      expectedSize: job.size,
      onCollision: () => uniqueDestinationPath(job.destinationDirectory, job.name, reservedPaths)
    });
    job.destinationPath = published.destinationPath;
    job.originalDestinationPath ??= join(job.destinationDirectory, sanitizeFileName(job.name));
    job.renamedDestination = job.destinationPath !== job.originalDestinationPath;
  } else {
    publishTemporaryFile({
      temporaryPath,
      destinationPath: job.destinationPath,
      expectedSize: job.size,
      allowExistingEquivalent: true
    });
  }

  job.temporaryPath = undefined;
}

function formatBytesForMessage(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'an unknown amount of space';
  }

  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function availableBytesForDirectory(directory: string): { bytes: number; volumeKey: string } {
  const stats = statfsSync(directory);
  const directoryStats = statSync(directory);
  const availableBlocks = Number(stats.bavail);
  const blockSize = Number(stats.bsize);
  const bytes = availableBlocks * blockSize;

  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new Error(`Unable to read free space for ${directory}.`);
  }

  return {
    bytes,
    volumeKey: String(directoryStats.dev)
  };
}

function downloadSpaceError(
  job: TransferJob,
  reservedBytesByVolume: Map<string, number>
): string | null {
  if (job.direction !== 'download' || job.size <= 0) {
    return null;
  }

  try {
    const available = availableBytesForDirectory(job.destinationDirectory);
    const alreadyReserved = reservedBytesByVolume.get(available.volumeKey) ?? 0;
    const remainingBytes = Math.max(available.bytes - alreadyReserved, 0);

    if (job.size > remainingBytes) {
      const recovery = job.promiseId
        ? 'Free space on the Mac, then drag the item again.'
        : 'Choose another Mac folder or free space, then Retry.';
      return [
        'Not enough free space on the Mac.',
        `${job.name} needs ${formatBytesForMessage(job.size)}, but this Mac volume has about ${formatBytesForMessage(remainingBytes)} free.`,
        recovery
      ].join(' ');
    }

    reservedBytesByVolume.set(available.volumeKey, alreadyReserved + job.size);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(`warning: unable to check Mac free space for ${job.destinationDirectory}: ${message}`);
  }

  return null;
}

function applyDownloadSpacePreflight(
  job: TransferJob,
  reservedBytesByVolume: Map<string, number>
): boolean {
  const error = downloadSpaceError(job, reservedBytesByVolume);
  if (!error) {
    return true;
  }

  job.status = 'failed';
  job.error = error;
  job.finishedAt = Date.now();
  job.bytesTransferred = 0;
  job.totalBytes = job.size;
  appendLog(`${job.direction} preflight failed: ${job.name}: ${error}`);
  return false;
}

function preserveDownloadedModifiedTime(job: TransferJob): void {
  if (
    job.direction !== 'download' ||
    typeof job.modified !== 'number' ||
    !Number.isFinite(job.modified) ||
    job.modified <= 0
  ) {
    return;
  }

  try {
    const fileStat = statSync(job.destinationPath);
    const modifiedAt = new Date(job.modified * 1000);
    utimesSync(job.destinationPath, fileStat.atime, modifiedAt);
    appendLog(`preserved phone modified time for ${job.destinationPath}: ${modifiedAt.toISOString()}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(`warning: unable to preserve phone modified time for ${job.destinationPath}: ${message}`);
  }
}

function pathIsInside(rootPath: string, candidatePath: string): boolean {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function localTypeForName(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return 'File';
  }
  return name.slice(dot + 1).toUpperCase();
}

function localEntryForPath(entryPath: string): LocalEntry | null {
  try {
    const entryStat = lstatSync(entryPath);
    if (entryStat.isSymbolicLink()) {
      appendLog(`local symbolic link skipped during phone upload planning: ${entryPath}`);
      return null;
    }
    const isFolder = entryStat.isDirectory();
    const isFile = entryStat.isFile();
    if (!isFolder && !isFile) {
      return null;
    }

    const name = basename(entryPath);
    return {
      path: entryPath,
      name,
      kind: isFolder ? 'folder' : 'file',
      size: isFile ? entryStat.size : 0,
      modified: Math.floor(entryStat.mtimeMs / 1000),
      type: isFolder ? 'Folder' : localTypeForName(name),
      identity: {
        device: entryStat.dev,
        inode: entryStat.ino,
        size: entryStat.size,
        modifiedMs: entryStat.mtimeMs,
        changedMs: entryStat.ctimeMs
      }
    };
  } catch (error) {
    appendLog(`local path skipped: ${entryPath}: ${String(error)}`);
    return null;
  }
}

function listLocalDirectory(directoryPath?: string, showHiddenFiles = false): LocalDirectoryResult {
  const targetPath = resolve(directoryPath || app.getPath('home'));
  const parentPath = dirname(targetPath);

  try {
    const targetStat = statSync(targetPath);
    if (!targetStat.isDirectory()) {
      return {
        ok: false,
        path: targetPath,
        parentPath,
        message: 'Choose a folder to browse Mac files.',
        entries: []
      };
    }

    const entries: LocalEntry[] = readdirSync(targetPath, { withFileTypes: true }).flatMap((entry) => {
      if (!showHiddenFiles && entry.name.startsWith('.')) {
        return [];
      }
      const entryPath = join(targetPath, entry.name);
      const localEntry = localEntryForPath(entryPath);
      return localEntry ? [localEntry] : [];
    });

    entries.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    return {
      ok: true,
      path: targetPath,
      parentPath,
      message: `Listed ${entries.length} ${entries.length === 1 ? 'item' : 'items'} in ${basename(targetPath) || targetPath}.`,
      entries
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read that Mac folder.';
    appendLog(`local directory list failed: ${targetPath}: ${message}`);
    return {
      ok: false,
      path: targetPath,
      parentPath,
      message,
      entries: []
    };
  }
}

function getCommonMacFolders(): CommonMacFolder[] {
  const candidates: CommonMacFolder[] = [
    { id: 'home', label: 'Home', path: app.getPath('home') },
    { id: 'downloads', label: 'Downloads', path: app.getPath('downloads') },
    { id: 'documents', label: 'Documents', path: app.getPath('documents') },
    { id: 'pictures', label: 'Pictures', path: app.getPath('pictures') },
    { id: 'movies', label: 'Movies', path: app.getPath('videos') },
    { id: 'desktop', label: 'Desktop', path: app.getPath('desktop') }
  ];
  const seenPaths = new Set<string>();
  return candidates.filter((folder) => {
    try {
      const folderPath = resolve(folder.path);
      if (seenPaths.has(folderPath) || !existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
        return false;
      }
      seenPaths.add(folderPath);
      folder.path = folderPath;
      return true;
    } catch (error) {
      appendLog(`common Mac folder skipped: ${folder.label}: ${String(error)}`);
      return false;
    }
  });
}

function ensureLocalDirectory(directoryPath: string): LocalDirectoryResult {
  const targetPath = resolve(directoryPath);
  try {
    mkdirSync(targetPath, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create that Mac folder.';
    appendLog(`local directory create failed: ${targetPath}: ${message}`);
    return {
      ok: false,
      path: targetPath,
      parentPath: dirname(targetPath),
      message,
      entries: []
    };
  }
  return listLocalDirectory(targetPath);
}

function localMutationUnavailableMessage(): string | null {
  if (localMutationInProgress) {
    return 'Another Mac file change is still in progress.';
  }
  if ([...transferJobs.values()].some((job) => job.status === 'queued' || job.status === 'active')) {
    return 'Wait for the transfer queue to finish before changing Mac items.';
  }
  return null;
}

function localIdentityMatches(targetPath: string, target: LocalMutationTarget): boolean {
  const current = lstatSync(targetPath);
  return !current.isSymbolicLink() &&
    (target.kind === 'folder' ? current.isDirectory() : current.isFile()) &&
    current.dev === target.identity.device &&
    current.ino === target.identity.inode &&
    current.size === target.identity.size &&
    current.mtimeMs === target.identity.modifiedMs &&
    current.ctimeMs === target.identity.changedMs;
}

function verifiedLocalMutationPath(
  directoryPath: string,
  target: LocalMutationTarget
): { directory: string; sourcePath: string } {
  const directory = resolve(directoryPath);
  const sourcePath = resolve(target.path);
  const directoryStat = lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('The open Mac folder is no longer available.');
  }
  if (dirname(sourcePath) !== directory || basename(sourcePath) !== target.name) {
    throw new Error('The selected Mac item is outside the open folder.');
  }
  if (!target.identity || !localIdentityMatches(sourcePath, target)) {
    throw new Error('The selected Mac item changed since it was listed. Refresh the folder and try again.');
  }
  return { directory, sourcePath };
}

function createLocalFolder(request: CreateLocalFolderRequest): LocalMutationResult {
  const nameError = validateLocalItemName(request?.name ?? '');
  if (!request || typeof request.directoryPath !== 'string' || !request.directoryPath || nameError) {
    return { ok: false, message: nameError || 'Open a Mac folder first.' };
  }
  const unavailable = localMutationUnavailableMessage();
  if (unavailable) {
    return { ok: false, message: unavailable };
  }
  localMutationInProgress = true;
  try {
    const directory = resolve(request.directoryPath);
    const directoryStat = lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error('The open Mac folder is no longer available.');
    }
    const targetPath = resolve(directory, request.name);
    if (dirname(targetPath) !== directory || existsSync(targetPath)) {
      throw new Error(existsSync(targetPath) ? 'An item with that name is already here.' : 'That folder name is not valid here.');
    }
    mkdirSync(targetPath, { recursive: false });
    const entry = localEntryForPath(targetPath);
    if (!entry) {
      appendLog(`local folder created but not immediately readable: ${targetPath}`);
      return { ok: true, message: 'The folder was created. Refresh to show it.' };
    }
    appendLog(`local folder created: ${targetPath}`);
    return { ok: true, message: `Created ${request.name}.`, entry };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create that Mac folder.';
    appendLog(`local folder create failed: ${String(error)}`);
    return { ok: false, message };
  } finally {
    localMutationInProgress = false;
    processTransferQueue();
  }
}

function renameLocalItem(request: RenameLocalItemRequest): LocalMutationResult {
  const nameError = validateLocalItemName(request?.newName ?? '');
  if (!request || !request.target || nameError) {
    return { ok: false, message: nameError || 'Select one Mac item to rename.' };
  }
  const unavailable = localMutationUnavailableMessage();
  if (unavailable) {
    return { ok: false, message: unavailable };
  }
  localMutationInProgress = true;
  try {
    const { directory, sourcePath } = verifiedLocalMutationPath(request.directoryPath, request.target);
    if (request.newName === request.target.name) {
      return { ok: true, message: 'The name is unchanged.', entry: localEntryForPath(sourcePath) ?? undefined };
    }
    const destinationPath = resolve(directory, request.newName);
    if (dirname(destinationPath) !== directory) {
      throw new Error('That name is not valid here.');
    }
    if (existsSync(destinationPath)) {
      throw new Error('An item with that name is already here.');
    }
    renameSync(sourcePath, destinationPath);
    const entry = localEntryForPath(destinationPath);
    if (!entry) {
      appendLog(`local item renamed but not immediately readable: ${sourcePath} -> ${destinationPath}`);
      return { ok: true, message: 'The item was renamed. Refresh to show it.' };
    }
    appendLog(`local item renamed: ${sourcePath} -> ${destinationPath}`);
    return { ok: true, message: `Renamed to ${request.newName}.`, entry };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to rename that Mac item.';
    appendLog(`local item rename failed: ${String(error)}`);
    return { ok: false, message };
  } finally {
    localMutationInProgress = false;
    processTransferQueue();
  }
}

async function trashLocalItems(request: TrashLocalItemsRequest): Promise<TrashLocalItemsResult> {
  const fallback = { ok: false, message: 'Unable to move the selected items to Trash.', trashedPaths: [], failures: [] };
  if (!request || !Array.isArray(request.targets) || request.targets.length === 0 || request.targets.length > 1_000) {
    return { ...fallback, message: 'Select between 1 and 1,000 Mac items.' };
  }
  const unavailable = localMutationUnavailableMessage();
  if (unavailable) {
    return { ...fallback, message: unavailable };
  }
  localMutationInProgress = true;
  const trashedPaths: string[] = [];
  const failures: TrashLocalItemFailure[] = [];
  try {
    const seenPaths = new Set<string>();
    for (const target of request.targets) {
      if (!target || seenPaths.has(target.path)) {
        continue;
      }
      seenPaths.add(target.path);
      try {
        const { sourcePath } = verifiedLocalMutationPath(request.directoryPath, target);
        await shell.trashItem(sourcePath);
        trashedPaths.push(sourcePath);
        appendLog(`local item moved to Trash: ${sourcePath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to move this item to Trash.';
        failures.push({ target, message });
        appendLog(`local item trash failed: ${target.path}: ${String(error)}`);
      }
    }
  } finally {
    localMutationInProgress = false;
    processTransferQueue();
  }
  const ok = failures.length === 0;
  return {
    ok,
    message: ok
      ? `Moved ${trashedPaths.length} ${trashedPaths.length === 1 ? 'item' : 'items'} to Trash.`
      : trashedPaths.length
        ? `Moved ${trashedPaths.length} to Trash; ${failures.length} could not be moved.`
        : failures[0]?.message || fallback.message,
    trashedPaths,
    failures
  };
}

function setLocalModifiedTime(localPath: string, modified: number): LocalModifiedTimeResult {
  const targetPath = resolve(localPath);
  if (!Number.isFinite(modified) || modified <= 0) {
    return {
      ok: false,
      path: targetPath,
      message: 'The phone did not report a valid modified date.'
    };
  }

  try {
    const fileStat = statSync(targetPath);
    const modifiedAt = new Date(modified * 1000);
    utimesSync(targetPath, fileStat.atime, modifiedAt);
    appendLog(`preserved phone modified time for local path ${targetPath}: ${modifiedAt.toISOString()}`);
    return {
      ok: true,
      path: targetPath,
      modified,
      message: 'Modified date preserved.'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to preserve that modified date.';
    appendLog(`warning: unable to preserve phone folder modified time for ${targetPath}: ${message}`);
    return {
      ok: false,
      path: targetPath,
      message
    };
  }
}

function cloneJob(job: TransferJob): TransferJob {
  return { ...job };
}

function sendTransferEvent(type: TransferEvent['type'], job: TransferJob): void {
  mainWindow?.webContents.send('transfer:event', { type, job: cloneJob(job) });
}

function nextQueuedJob(): TransferJob | undefined {
  return Array.from(transferJobs.values()).find((job) => job.status === 'queued');
}

function sameLocalSourceIdentity(
  current: LocalSourceIdentity,
  queued: LocalSourceIdentity
): boolean {
  return current.device === queued.device &&
    current.inode === queued.inode &&
    current.size === queued.size &&
    current.modifiedMs === queued.modifiedMs &&
    current.changedMs === queued.changedMs;
}

function shouldReportTransferCanceled(
  cancellationRequested: boolean,
  phoneReplacementStarted: boolean
): boolean {
  return cancellationRequested && !phoneReplacementStarted;
}

function uploadSourceIdentityError(job: TransferJob): string | null {
  if (job.direction !== 'upload') {
    return null;
  }
  if (!job.sourcePath || !job.sourceIdentity) {
    return 'The queued Mac source identity is missing. Queue the file again.';
  }

  try {
    const current = fileIdentitySnapshot(job.sourcePath);
    if (sameLocalSourceIdentity(current, job.sourceIdentity)) {
      return null;
    }
  } catch {
    // Missing, unreadable, non-file, and symbolic-link replacements are all stale sources.
  }
  return 'The Mac source changed after it was queued, so it was not uploaded.';
}

async function requireCurrentPhoneConnection(job: TransferJob): Promise<void> {
  let rawDevice = rawDeviceForConnection(job.deviceIndex, job.deviceConnectionId);
  if (!rawDevice) {
    await refreshRawDevices();
    rawDevice = rawDeviceForConnection(job.deviceIndex, job.deviceConnectionId);
  }
  if (!rawDevice) {
    throw new Error('The phone connection changed before this transfer started. Queue the file again for the currently connected phone.');
  }
}

function handleTransferPayload(job: TransferJob, payload: SessionPayload): void {
  if (payload.event === 'started') {
    sendTransferEvent('started', job);
    return;
  }

  if (payload.event === 'progress') {
    const now = Date.now();
    const elapsedSeconds = Math.max((now - (job.startedAt ?? now)) / 1000, 0.1);
    const knownTotal = job.size > 0 ? job.size : job.totalBytes;
    const reportedTransferred = typeof payload.sent === 'number' ? payload.sent : job.bytesTransferred;
    job.totalBytes = knownTotal > 0 ? knownTotal : typeof payload.total === 'number' ? payload.total : job.totalBytes;
    job.bytesTransferred =
      job.totalBytes > 0
        ? Math.min(Math.max(reportedTransferred, 0), job.totalBytes)
        : Math.max(reportedTransferred, 0);
    job.speedBytesPerSecond = job.bytesTransferred / elapsedSeconds;
    const remaining = Math.max(job.totalBytes - job.bytesTransferred, 0);
    job.etaSeconds = job.speedBytesPerSecond > 0 ? remaining / job.speedBytesPerSecond : null;
    sendTransferEvent('progress', job);
    return;
  }

  if (payload.event === 'failed') {
    job.error = payload.message || 'Transfer failed.';
  }
}

function transferCommandForJob(job: TransferJob): { commandName: string; args: string[] } {
  if (job.direction === 'upload') {
    if (
      job.storageId === undefined ||
      job.parentId === undefined ||
      !job.sourcePath ||
      !job.sourceIdentity
    ) {
      throw new Error('Upload job is missing its phone destination or verified Mac source identity.');
    }
    const destinationName = job.uploadStagingName || job.uploadName || job.name;
    const nameError = validatePhoneItemName(destinationName);
    if (nameError) {
      throw new Error(nameError);
    }
    return {
      commandName: 'upload',
      args: [
        String(job.storageId),
        String(job.parentId),
        encodePhoneCommandName(destinationName),
        String(job.sourceIdentity.device),
        String(job.sourceIdentity.inode),
        String(job.sourceIdentity.size),
        String(job.sourceIdentity.modifiedMs),
        String(job.sourceIdentity.changedMs),
        job.sourcePath
      ]
    };
  }

  if (job.objectId === undefined || !job.temporaryPath) {
    throw new Error('Download job is missing its phone object id.');
  }
  return {
    commandName: 'download',
    args: [String(job.objectId), job.temporaryPath]
  };
}

async function runTransferSessionCommand<T extends SessionPayload>(
  job: TransferJob,
  commandName: string,
  args: string[],
  timeoutMs: number,
  onEvent?: (payload: SessionPayload) => void
): Promise<T> {
  return runSessionCommand<T>(
    job.deviceIndex,
    job.deviceConnectionId,
    commandName,
    args,
    timeoutMs,
    onEvent
  );
}

function phoneFileMutationTarget(
  job: TransferJob,
  objectId: number,
  name: string,
  modified?: number
): PhoneMutationTarget {
  if (job.storageId === undefined || job.parentId === undefined) {
    throw new Error('The transfer no longer has its phone item metadata.');
  }
  return {
    objectId,
    storageId: job.storageId,
    parentId: job.parentId,
    name,
    kind: 'file',
    size: job.size,
    modified: Number.isSafeInteger(modified) && (modified ?? 0) > 0 ? modified : undefined
  };
}

function uploadedPhoneTarget(job: TransferJob, objectId: number, name: string): PhoneMutationTarget {
  return phoneFileMutationTarget(job, objectId, name);
}

async function runTransferPhoneMutation(
  job: TransferJob,
  command: 'rename-item' | 'delete-item',
  target: PhoneMutationTarget,
  newName?: string
): Promise<SessionPayload> {
  const args = phoneMutationArgs(target);
  if (command === 'rename-item') {
    if (!newName || validatePhoneItemName(newName)) {
      throw new Error('The replacement transaction produced an invalid phone filename.');
    }
    args.push(encodePhoneCommandName(newName));
  }
  return runTransferSessionCommand<SessionPayload>(
    job,
    command,
    args,
    60_000
  );
}

async function finalizePhoneReplacement(
  job: TransferJob,
  uploadResult: SessionPayload
): Promise<SessionPayload> {
  const existing = job.replacementTarget;
  const stageName = job.uploadStagingName;
  const backupName = job.uploadBackupName;
  const finalName = job.uploadName || job.name;
  if (!existing || !stageName || !backupName) {
    return uploadResult;
  }

  if (!uploadResult.objectId || uploadResult.verified !== true) {
    if (uploadResult.objectId) {
      const unverifiedStage = uploadedPhoneTarget(job, uploadResult.objectId, stageName);
      try {
        const cleanup = await runTransferPhoneMutation(
          job,
          'delete-item',
          unverifiedStage
        );
        if (!cleanup.ok) {
          appendLog(`warning: unable to remove unverified staged phone upload ${stageName}: ${cleanup.message || 'unknown error'}`);
        }
      } catch (error) {
        appendLog(`warning: unable to remove unverified staged phone upload ${stageName}: ${String(error)}`);
      }
    }
    throw new Error('The new phone copy could not be verified, so the existing file was kept.');
  }

  const staged = uploadedPhoneTarget(job, uploadResult.objectId, stageName);
  const published = await publishStagedPhoneReplacement({
    existing,
    staged,
    finalName,
    backupName,
    mutate: (command, target, newName) =>
      runTransferPhoneMutation(job, command, target, newName),
    onCleanupWarning: (message) => appendLog(`warning: unable to remove staged phone upload: ${message}`)
  });
  return { ...uploadResult, message: published.message };
}

async function removeMoveSource(
  job: TransferJob,
  transferResult: SessionPayload
): Promise<void> {
  job.sourceRemovalStatus = 'pending';
  job.sourceRemovalError = undefined;

  try {
    if (job.direction === 'download') {
      if (job.objectId === undefined) {
        throw new Error('The completed copy no longer has a phone source identifier.');
      }
      const sourceTarget = phoneFileMutationTarget(job, job.objectId, job.name, job.modified);
      const deleteResult = await runTransferPhoneMutation(
        job,
        'delete-item',
        sourceTarget
      );
      if (!deleteResult.ok || deleteResult.event !== 'complete') {
        throw new Error(deleteResult.message || 'The phone did not delete the source file.');
      }
    } else if (job.direction === 'upload') {
      if (transferResult.verified !== true || !transferResult.objectId) {
        throw new Error('The phone copy could not be verified after upload.');
      }
      if (!job.sourcePath || !job.sourceIdentity) {
        throw new Error('The Mac source identity was not recorded when this move was queued.');
      }
      removeVerifiedLocalMoveSource(job.sourcePath, job.sourceIdentity);
    } else {
      throw new Error('Drag preparation cannot remove its source.');
    }

    job.sourceRemovalStatus = 'removed';
    job.resultMessage = 'Moved. The source was deleted after the copy was verified.';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    job.sourceRemovalStatus = 'kept';
    job.sourceRemovalError = message;
    job.resultMessage = `Copy finished, but the source was kept. ${message}`;
    appendLog(`move source kept: ${job.name}: ${message}`);
  }
}

async function runTransferJob(job: TransferJob): Promise<void> {
  let phoneReplacementStarted = false;
  const label =
    job.direction === 'upload'
      ? 'upload'
      : 'download';
  try {
    await requireCurrentPhoneConnection(job);
    if (job.direction === 'download') {
      cleanupTemporaryDownload(job);
      job.temporaryPath = temporaryDownloadPath(job.destinationPath);
    }
    const command = transferCommandForJob(job);
    const sourceIdentityError = uploadSourceIdentityError(job);
    if (sourceIdentityError) {
      throw new Error(sourceIdentityError);
    }
    let result = await runTransferSessionCommand<SessionPayload>(
      job,
      command.commandName,
      command.args,
      TRANSFER_COMMAND_IDLE_TIMEOUT_MS,
      (payload) => handleTransferPayload(job, payload)
    );

    if (
      !activeWasCanceled &&
      result.ok &&
      result.event === 'complete' &&
      job.direction === 'upload' &&
      job.collisionAction === 'replace'
    ) {
      phoneReplacementStarted = true;
      result = await finalizePhoneReplacement(job, result);
    }

    if (shouldReportTransferCanceled(activeWasCanceled, phoneReplacementStarted)) {
      job.status = 'canceled';
      job.error = 'Transfer canceled.';
      appendLog(`${label} canceled: ${job.name}`);
    } else if (result.ok && result.event === 'complete') {
      if (job.direction === 'download') {
        finalizeDownloadedFile(job);
      }
      if (job.operation === 'move') {
        await removeMoveSource(job, result);
      }
      job.status = 'completed';
      job.totalBytes = job.size > 0 ? job.size : job.totalBytes;
      job.bytesTransferred = job.totalBytes || job.size;
      job.etaSeconds = 0;
      if (job.operation === 'copy') {
        job.resultMessage = result.message;
      }
      preserveDownloadedModifiedTime(job);
      appendLog(`${label} completed: ${job.destinationPath}`);
    } else {
      job.status = 'failed';
      job.error = result.message || 'Transfer failed.';
      appendLog(`${label} failed: ${job.name}: ${job.error}`);
    }
  } catch (error) {
    if (shouldReportTransferCanceled(activeWasCanceled, phoneReplacementStarted)) {
      job.status = 'canceled';
      job.error = 'Transfer canceled.';
      appendLog(`${label} canceled: ${job.name}`);
    } else {
      const rawFailure = error instanceof Error ? error.message : String(error);
      job.status = 'failed';
      job.error = phoneReplacementStarted
        ? `Transfer failed. ${rawFailure}`
        : sessionErrorMessage('Transfer failed.', error, lastSessionStderr);
      appendLog(`${label} failed: ${job.name}: ${job.error}`);
    }
  } finally {
    await waitForMtpSessionTeardown();
    cleanupTemporaryDownload(job);
    job.finishedAt = Date.now();
    activeJobId = null;

    if (job.status === 'completed') {
      sendTransferEvent('completed', job);
    } else if (job.status === 'canceled') {
      sendTransferEvent('canceled', job);
    } else {
      sendTransferEvent('failed', job);
    }

    handlePromiseTransferTerminal(job);

    processTransferQueue();
  }
}

function processTransferQueue(): void {
  if (
    pendingPromisePlanningCount > 0 ||
    phoneMutationInProgress ||
    localMutationInProgress ||
    mtpSessionTeardown !== null ||
    activeJobId !== null ||
    activeSessionCommand !== null
  ) {
    return;
  }

  let job = nextQueuedJob();
  while (job) {
    const sourceError = uploadSourceIdentityError(job);
    if (!sourceError) {
      break;
    }
    job.status = 'failed';
    job.error = sourceError;
    job.finishedAt = Date.now();
    sendTransferEvent('failed', job);
    appendLog(`upload not started: ${job.name}: ${sourceError}`);
    job = nextQueuedJob();
  }
  if (!job) {
    return;
  }

  activeWasCanceled = false;
  job.status = 'active';
  job.startedAt = Date.now();
  job.finishedAt = undefined;
  job.error = undefined;
  job.resultMessage = undefined;
  job.sourceRemovalStatus = undefined;
  job.sourceRemovalError = undefined;
  job.bytesTransferred = 0;
  job.totalBytes = job.size;
  job.speedBytesPerSecond = 0;
  job.etaSeconds = null;
  activeJobId = job.id;
  sendTransferEvent('started', job);
  appendLog(`${job.direction} started: ${job.name} -> ${job.destinationPath}`);
  void runTransferJob(job);
}

function enqueueDownloads(
  requests: TransferRequest[],
  operation: TransferOperation = 'copy',
  collisionAction: TransferCollisionAction = 'none'
): TransferJob[] {
  const reservedBytesByVolume = new Map<string, number>();
  const reservedPaths = reservedDownloadDestinationPaths();
  const jobs = requests.map((request) => {
    mkdirSync(request.destinationDirectory, { recursive: true });
    const originalDestinationPath = join(request.destinationDirectory, sanitizeFileName(request.name));
    let destination = downloadDestinationPlan(request.destinationDirectory, request.name, reservedPaths);
    let destinationIdentity: LocalSourceIdentity | undefined;
    if (collisionAction === 'replace' && existsSync(originalDestinationPath)) {
      try {
        destinationIdentity = fileIdentitySnapshot(originalDestinationPath);
        destination = {
          destinationPath: originalDestinationPath,
          originalDestinationPath,
          renamedDestination: false
        };
      } catch (error) {
        appendLog(`download replace changed to keep-both for ${originalDestinationPath}: ${String(error)}`);
      }
    }
    reservedPaths.add(destination.destinationPath);
    const job: TransferJob = {
      id: randomUUID(),
      direction: 'download',
      operation,
      deviceIndex: request.deviceIndex,
      deviceConnectionId: request.deviceConnectionId,
      storageId: request.storageId,
      parentId: request.parentId,
      objectId: request.objectId,
      collisionAction:
        destinationIdentity
          ? 'replace'
          : destination.renamedDestination
            ? 'keep-both'
            : undefined,
      destinationIdentity,
      name: request.name,
      size: request.size,
      modified: request.modified,
      destinationDirectory: request.destinationDirectory,
      destinationPath: destination.destinationPath,
      originalDestinationPath: destination.originalDestinationPath,
      renamedDestination: destination.renamedDestination,
      status: 'queued',
      bytesTransferred: 0,
      totalBytes: request.size,
      speedBytesPerSecond: 0,
      etaSeconds: null
    };
    const canQueue = applyDownloadSpacePreflight(job, reservedBytesByVolume);
    transferJobs.set(job.id, job);
    sendTransferEvent(canQueue ? 'queued' : 'failed', job);
    return cloneJob(job);
  });

  processTransferQueue();
  return jobs;
}

function requestedDownloadPath(request: TransferRequest): string {
  return join(request.destinationDirectory, sanitizeFileName(request.name));
}

async function chooseTransferCollisionAction(
  direction: 'download' | 'upload',
  conflictCount: number,
  destinationLabel: string
): Promise<TransferCollisionAction> {
  if (conflictCount <= 0) {
    return 'none';
  }

  const destination = direction === 'download' ? 'the Mac folder' : 'the phone folder';
  const options: MessageBoxOptions = {
    type: 'warning',
    buttons: ['Keep Both', 'Replace', 'Skip Existing', 'Cancel'],
    defaultId: 0,
    cancelId: 3,
    noLink: true,
    title: 'Items with the same name',
    message: `${conflictCount} ${conflictCount === 1 ? 'item already exists' : 'items already exist'} in ${destinationLabel || destination}.`,
    detail: direction === 'download'
      ? 'Keep Both adds a number to the incoming filename. Replace publishes each complete, verified download over the unchanged existing Mac file. Skip Existing copies only new names.'
      : 'Keep Both adds a number to the incoming filename. Replace stages and verifies the new phone copy before changing the old one. Skip Existing copies only new names.'
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return (['keep-both', 'replace', 'skip', 'cancel'] as const)[result.response] ?? 'cancel';
}

async function queueDownloads(
  requests: TransferRequest[],
  operation: TransferOperation = 'copy'
): Promise<TransferQueueResult> {
  const conflicts = requests.filter((request) => existsSync(requestedDownloadPath(request)));
  const collisionAction = await chooseTransferCollisionAction(
    'download',
    conflicts.length,
    requests[0]?.destinationDirectory || 'the selected Mac folder'
  );
  if (collisionAction === 'cancel') {
    return { collisionAction, conflictCount: conflicts.length, skippedCount: requests.length, jobs: [] };
  }

  const queuedRequests = collisionAction === 'skip'
    ? requests.filter((request) => !existsSync(requestedDownloadPath(request)))
    : requests;
  return {
    collisionAction,
    conflictCount: conflicts.length,
    skippedCount: requests.length - queuedRequests.length,
    jobs: enqueueDownloads(queuedRequests, operation, collisionAction)
  };
}

function enqueuePromisedDownloads(
  files: PromisedDownloadFile[],
  promiseId: string
): TransferJob[] {
  const reservedBytesByVolume = new Map<string, number>();
  const jobs = files.map(({ request, destinationPath }) => {
    mkdirSync(dirname(destinationPath), { recursive: true });
    const job: TransferJob = {
      id: randomUUID(),
      direction: 'download',
      operation: 'copy',
      deviceIndex: request.deviceIndex,
      deviceConnectionId: request.deviceConnectionId,
      storageId: request.storageId,
      parentId: request.parentId,
      objectId: request.objectId,
      promiseId,
      name: request.name,
      size: request.size,
      modified: request.modified,
      destinationDirectory: dirname(destinationPath),
      destinationPath,
      originalDestinationPath: destinationPath,
      renamedDestination: false,
      status: 'queued',
      bytesTransferred: 0,
      totalBytes: request.size,
      speedBytesPerSecond: 0,
      etaSeconds: null
    };
    if (existsSync(destinationPath)) {
      job.status = 'failed';
      job.error = `The destination already contains ${basename(destinationPath)}.`;
      job.finishedAt = Date.now();
    } else {
      applyDownloadSpacePreflight(job, reservedBytesByVolume);
    }
    transferJobs.set(job.id, job);
    sendTransferEvent(job.status === 'failed' ? 'failed' : 'queued', job);
    return cloneJob(job);
  });
  return jobs;
}

function enqueueUploads(
  requests: UploadRequest[],
  operation: TransferOperation = 'copy',
  collisionAction: TransferCollisionAction = 'none'
): TransferJob[] {
  const jobs = requests.flatMap((request) => {
    if (!request.sourcePath) {
      return [];
    }

    let fileSize = request.size;
    let sourceIdentity: LocalSourceIdentity;
    try {
      const sourceStat = lstatSync(request.sourcePath);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
        return [];
      }
      const currentSourceIdentity: LocalSourceIdentity = {
        device: sourceStat.dev,
        inode: sourceStat.ino,
        size: sourceStat.size,
        modifiedMs: sourceStat.mtimeMs,
        changedMs: sourceStat.ctimeMs
      };
      if (
        !request.sourceIdentity ||
        !sameLocalSourceIdentity(currentSourceIdentity, request.sourceIdentity)
      ) {
        return [];
      }
      fileSize = currentSourceIdentity.size;
      sourceIdentity = request.sourceIdentity;
    } catch {
      return [];
    }

    const replacementTarget =
      collisionAction === 'replace' ? validUploadReplacementTarget(request) : undefined;
    let uploadName = request.name;
    if (collisionAction === 'keep-both' && validUploadReplacementTarget(request)) {
      const requestedKeepBothName = request.keepBothName?.trim() || keepBothPhoneName(request.name);
      uploadName = validatePhoneItemName(requestedKeepBothName) ? keepBothPhoneName(request.name) : requestedKeepBothName;
    }
    const replacementIdentifier = replacementTarget ? randomUUID() : '';
    const uploadStagingName = replacementTarget
      ? temporaryPhoneTransferName(request.name, 'stage', replacementIdentifier)
      : undefined;
    const uploadBackupName = replacementTarget
      ? temporaryPhoneTransferName(request.name, 'backup', replacementIdentifier)
      : undefined;
    const destinationPath = `mtp://${request.storageId}/${request.parentId}/${uploadName}`;
    const job: TransferJob = {
      id: randomUUID(),
      direction: 'upload',
      operation,
      deviceIndex: request.deviceIndex,
      deviceConnectionId: request.deviceConnectionId,
      storageId: request.storageId,
      parentId: request.parentId,
      sourcePath: request.sourcePath,
      sourceIdentity,
      collisionAction: replacementTarget
        ? 'replace'
        : uploadName !== request.name
          ? 'keep-both'
          : undefined,
      originalName: request.name,
      uploadName,
      uploadStagingName,
      uploadBackupName,
      replacementTarget,
      name: request.name,
      size: fileSize,
      destinationDirectory: 'Phone folder',
      destinationPath,
      status: 'queued',
      bytesTransferred: 0,
      totalBytes: fileSize,
      speedBytesPerSecond: 0,
      etaSeconds: null
    };
    transferJobs.set(job.id, job);
    sendTransferEvent('queued', job);
    return [cloneJob(job)];
  });

  processTransferQueue();
  return jobs;
}

function validUploadReplacementTarget(request: UploadRequest): PhoneMutationTarget | undefined {
  const target = request.existingDestination;
  if (
    phoneMutationTargetError(target) ||
    target?.kind !== 'file' ||
    target.storageId !== request.storageId ||
    target.parentId !== request.parentId ||
    target.name !== request.name
  ) {
    return undefined;
  }
  return target;
}

async function queueUploads(
  requests: UploadRequest[],
  operation: TransferOperation = 'copy'
): Promise<TransferQueueResult> {
  const conflicts = requests.filter((request) => validUploadReplacementTarget(request));
  const collisionAction = await chooseTransferCollisionAction(
    'upload',
    conflicts.length,
    'the open phone folder'
  );
  if (collisionAction === 'cancel') {
    return { collisionAction, conflictCount: conflicts.length, skippedCount: requests.length, jobs: [] };
  }

  const queuedRequests = collisionAction === 'skip'
    ? requests.filter((request) => !validUploadReplacementTarget(request))
    : requests;
  return {
    collisionAction,
    conflictCount: conflicts.length,
    skippedCount: requests.length - queuedRequests.length,
    jobs: enqueueUploads(queuedRequests, operation, collisionAction)
  };
}

async function confirmFileMove(
  direction: 'download' | 'upload',
  fileCount: number,
  destinationLabel: string
): Promise<boolean> {
  if (fileCount <= 0) {
    return false;
  }

  const sourceLabel = direction === 'download' ? 'the phone' : 'this Mac';
  const detail = [
    `Each file will be copied to ${destinationLabel} and checked first.`,
    `Only after a file's destination copy is verified will its source be deleted from ${sourceLabel}.`,
    'If copying, verification, or deletion fails, the source file is kept. Folders are copied, not moved.'
  ].join('\n\n');
  const options = {
    type: 'warning' as const,
    buttons: ['Move Files', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'Confirm file move',
    message: `Move ${fileCount} ${fileCount === 1 ? 'file' : 'files'} to ${destinationLabel}?`,
    detail
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}

async function enqueueMoveDownloads(requests: TransferRequest[]): Promise<MoveQueueResult> {
  const destinationLabel = requests[0]?.destinationDirectory || 'the selected Mac folder';
  const confirmed = await confirmFileMove('download', requests.length, destinationLabel);
  const queued = confirmed
    ? await queueDownloads(requests, 'move')
    : { collisionAction: 'cancel' as const, conflictCount: 0, skippedCount: 0, jobs: [] };
  return {
    confirmed,
    ...queued
  };
}

async function enqueueMoveUploads(requests: UploadRequest[]): Promise<MoveQueueResult> {
  const confirmed = await confirmFileMove('upload', requests.length, 'the open phone folder');
  const queued = confirmed
    ? await queueUploads(requests, 'move')
    : { collisionAction: 'cancel' as const, conflictCount: 0, skippedCount: 0, jobs: [] };
  return {
    confirmed,
    ...queued
  };
}

function retryTransfer(jobId: string): TransferJob | null {
  const job = transferJobs.get(jobId);
  if (
    !job ||
    job.promiseId ||
    (job.direction === 'upload' && job.collisionAction === 'replace') ||
    (job.status !== 'failed' && job.status !== 'canceled')
  ) {
    return null;
  }

  if (job.direction === 'download') {
    const destination = downloadDestinationPlan(
      job.destinationDirectory,
      job.name,
      reservedDownloadDestinationPaths(job.id)
    );
    job.destinationPath = destination.destinationPath;
    job.originalDestinationPath = destination.originalDestinationPath;
    job.renamedDestination = destination.renamedDestination;
    job.collisionAction = destination.renamedDestination ? 'keep-both' : undefined;
    job.destinationIdentity = undefined;
  }
  job.error = undefined;
  job.resultMessage = undefined;
  job.sourceRemovalStatus = undefined;
  job.sourceRemovalError = undefined;
  job.bytesTransferred = 0;
  job.totalBytes = job.size;
  job.speedBytesPerSecond = 0;
  job.etaSeconds = null;
  job.startedAt = undefined;
  job.finishedAt = undefined;

  if (job.direction === 'download' && !applyDownloadSpacePreflight(job, new Map())) {
    sendTransferEvent('failed', job);
    return cloneJob(job);
  }

  job.status = 'queued';
  sendTransferEvent('queued', job);
  processTransferQueue();
  return cloneJob(job);
}

function cancelTransfer(jobId: string): TransferJob | null {
  const job = transferJobs.get(jobId);
  if (!job || (job.status !== 'active' && job.status !== 'queued')) {
    return null;
  }

  if (job.status === 'queued') {
    job.status = 'canceled';
    job.finishedAt = Date.now();
    job.error = 'Transfer canceled.';
    sendTransferEvent('canceled', job);
    handlePromiseTransferTerminal(job);
    return cloneJob(job);
  }

  if (job.id === activeJobId) {
    activeWasCanceled = true;
    destroyMtpSession('Active transfer canceled.', true);
    return cloneJob(job);
  }

  return null;
}

async function chooseDestination(): Promise<DestinationResult> {
  const options: OpenDialogOptions = {
    title: 'Choose Mac destination',
    properties: ['openDirectory', 'createDirectory']
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  return { canceled: false, path: result.filePaths[0] };
}

function getDesktopDestination(): string {
  return app.getPath('desktop');
}

function nativeDragIcon() {
  const namedIcon = nativeImage.createFromNamedImage('NSMultipleDocuments');
  if (!namedIcon.isEmpty()) {
    return namedIcon;
  }

  const fallbackIcon = nativeImage.createFromNamedImage('NSActionTemplate');
  if (!fallbackIcon.isEmpty()) {
    return fallbackIcon;
  }

  const svg = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="24" height="28" x="4" y="2" rx="3" fill="#fdfbf4" stroke="#245d7a" stroke-width="2"/><path d="M10 12h12M10 18h12M10 24h8" stroke="#52634a" stroke-width="2" stroke-linecap="round"/></svg>'
  );
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
}

function startLocalFileDrag(event: Electron.IpcMainEvent, filePaths: string[]): void {
  const validPaths = filePaths.filter((filePath) => {
    try {
      const fileStat = statSync(filePath);
      return fileStat.isFile() || fileStat.isDirectory();
    } catch {
      return false;
    }
  });

  if (!validPaths.length) {
    appendLog('native drag skipped: no valid local files or folders were available');
    return;
  }

  try {
    event.sender.startDrag({
      file: validPaths[0],
      files: validPaths,
      icon: nativeDragIcon()
    });
    appendLog(`native drag started for ${validPaths.length} local path(s)`);
  } catch (error) {
    appendLog(`native drag failed: ${String(error)}`);
  }
}

function preservePromisedDirectories(directories: PromisedDirectory[]): void {
  [...directories]
    .sort((left, right) => right.path.length - left.path.length)
    .forEach((directory) => {
      if (!directory.modified || !existsSync(directory.path)) {
        return;
      }
      try {
        const stats = statSync(directory.path);
        utimesSync(directory.path, stats.atime, new Date(directory.modified * 1000));
      } catch (error) {
        appendLog(`warning: unable to preserve promised folder time ${directory.path}: ${String(error)}`);
      }
    });
}

function completePromiseFulfillment(promiseId: string): void {
  const fulfillment = promiseFulfillments.get(promiseId);
  if (!fulfillment || fulfillment.settled) {
    return;
  }
  fulfillment.settled = true;
  preservePromisedDirectories(fulfillment.directories);
  loadFilePromiseDragAddon()?.completePromise(promiseId);
  promiseFulfillments.delete(promiseId);
  promiseSources.delete(promiseId);
  appendLog(`file promise completed: ${fulfillment.rootPath}`);
}

function failPromiseFulfillment(promiseId: string, message: string): void {
  const fulfillment = promiseFulfillments.get(promiseId);
  if (fulfillment?.settled) {
    return;
  }
  if (fulfillment) {
    fulfillment.settled = true;
    for (const jobId of fulfillment.remainingJobIds) {
      const job = transferJobs.get(jobId);
      if (job?.status === 'queued' || job?.status === 'active') {
        cancelTransfer(jobId);
      }
    }
    try {
      rmSync(fulfillment.rootPath, {
        force: true,
        recursive: fulfillment.rootKind === 'folder'
      });
    } catch (error) {
      appendLog(`warning: unable to remove failed promised output ${fulfillment.rootPath}: ${String(error)}`);
    }
  }
  loadFilePromiseDragAddon()?.completePromise(promiseId, message);
  promiseFulfillments.delete(promiseId);
  promiseSources.delete(promiseId);
  sendPhoneFilePromiseDragEvent({ type: 'failed', promiseId, message: `${message} Drag again.` });
  appendLog(`file promise failed: ${promiseId}: ${message}`);
}

function handlePromiseTransferTerminal(job: TransferJob): void {
  if (!job.promiseId) {
    return;
  }
  const fulfillment = promiseFulfillments.get(job.promiseId);
  if (!fulfillment || fulfillment.settled || !fulfillment.remainingJobIds.has(job.id)) {
    return;
  }
  fulfillment.remainingJobIds.delete(job.id);
  if (job.status === 'failed' || job.status === 'canceled') {
    failPromiseFulfillment(job.promiseId, job.error || 'The promised file could not be copied.');
    return;
  }
  if (job.status === 'completed' && fulfillment.remainingJobIds.size === 0) {
    completePromiseFulfillment(job.promiseId);
  }
}

async function waitForPromisePlanningSlot(): Promise<void> {
  pendingPromisePlanningCount += 1;
  while (activeJobId !== null || activeSessionCommand !== null) {
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 100));
  }
}

function releasePromisePlanningSlot(): void {
  pendingPromisePlanningCount = Math.max(0, pendingPromisePlanningCount - 1);
  processTransferQueue();
}

async function planPromisedPhoneItem(
  source: PhoneFilePromiseDragItem,
  rootPath: string,
  promiseId: string
): Promise<{ files: PromisedDownloadFile[]; directories: PromisedDirectory[] }> {
  if (source.kind === 'file') {
    return {
      files: [
        {
          request: {
            deviceIndex: source.deviceIndex,
            deviceConnectionId: source.deviceConnectionId,
            storageId: source.storageId,
            parentId: source.parentId,
            objectId: source.objectId,
            name: source.name,
            size: source.size,
            modified: source.modified,
            destinationDirectory: dirname(rootPath),
            operation: 'copy'
          },
          destinationPath: rootPath
        }
      ],
      directories: []
    };
  }

  const files: PromisedDownloadFile[] = [];
  const directories: PromisedDirectory[] = [{ path: rootPath, modified: source.modified }];
  let folderCount = 1;

  async function collectFolder(
    storageId: number,
    parentId: number,
    destinationDirectory: string,
    currentName: string
  ): Promise<void> {
    sendPhoneFilePromiseDragEvent({
      type: 'planning',
      promiseId,
      files: files.length,
      folders: folderCount,
      currentName
    });
    const result = await listFolder(
      source.deviceIndex,
      source.deviceConnectionId,
      storageId,
      parentId
    );
    if (!result.ok) {
      throw new Error(result.message || `Unable to list ${currentName}.`);
    }
    for (const object of result.objects) {
      if (files.length >= MAX_PROMISED_PHONE_FILES) {
        throw new Error(`This folder contains more than ${MAX_PROMISED_PHONE_FILES} files. Copy a smaller folder.`);
      }
      const childPath = join(destinationDirectory, sanitizeFileName(object.name));
      if (!pathIsInside(rootPath, childPath)) {
        throw new Error('A phone item produced an invalid destination path.');
      }
      if (object.kind === 'folder') {
        folderCount += 1;
        if (folderCount > MAX_PROMISED_PHONE_FOLDERS) {
          throw new Error(`This selection contains more than ${MAX_PROMISED_PHONE_FOLDERS} folders.`);
        }
        directories.push({ path: childPath, modified: object.modified });
        await collectFolder(object.storageId, object.id, childPath, object.name);
      } else {
        files.push({
          request: {
            deviceIndex: source.deviceIndex,
            deviceConnectionId: source.deviceConnectionId,
            storageId: object.storageId,
            parentId: object.parentId,
            objectId: object.id,
            name: object.name,
            size: object.size,
            modified: object.modified,
            destinationDirectory,
            operation: 'copy'
          },
          destinationPath: childPath
        });
      }
    }
  }

  await waitForPromisePlanningSlot();
  try {
    await collectFolder(source.storageId, source.objectId, rootPath, source.name);
  } finally {
    releasePromisePlanningSlot();
  }
  return { files, directories };
}

async function fulfillPhoneFilePromise(promiseId: string, destinationPath: string): Promise<void> {
  const source = promiseSources.get(promiseId)?.item;
  if (!source) {
    loadFilePromiseDragAddon()?.completePromise(promiseId, 'The dragged phone item is no longer available.');
    sendPhoneFilePromiseDragEvent({
      type: 'failed',
      promiseId,
      message: 'The dragged phone item is no longer available. Drag again.'
    });
    appendLog(`file promise rejected before fulfillment: ${promiseId}: source unavailable`);
    return;
  }
  const resolvedDestination = resolve(destinationPath);
  if (resolvedDestination !== destinationPath || existsSync(resolvedDestination)) {
    const message = existsSync(resolvedDestination)
      ? `The destination already contains ${basename(resolvedDestination)}.`
      : 'The receiving app supplied an invalid destination.';
    loadFilePromiseDragAddon()?.completePromise(promiseId, message);
    promiseSources.delete(promiseId);
    sendPhoneFilePromiseDragEvent({ type: 'failed', promiseId, message: `${message} Drag again.` });
    appendLog(`file promise rejected before fulfillment: ${promiseId}: ${message}`);
    return;
  }

  appendLog(`file promise accepted: ${source.name} -> ${resolvedDestination}`);

  sendPhoneFilePromiseDragEvent({
    type: 'accepted',
    message: `Dropped in ${dirname(resolvedDestination)}. Copying from the phone now.`
  });

  try {
    const plan = await planPromisedPhoneItem(source, resolvedDestination, promiseId);
    for (const directory of plan.directories) {
      if (!pathIsInside(resolvedDestination, directory.path)) {
        throw new Error('A promised folder path escaped its destination.');
      }
      mkdirSync(directory.path, { recursive: true });
    }
    const fulfillment: PromiseFulfillment = {
      id: promiseId,
      rootPath: resolvedDestination,
      rootKind: source.kind,
      directories: plan.directories,
      remainingJobIds: new Set(),
      settled: false
    };
    promiseFulfillments.set(promiseId, fulfillment);
    if (!plan.files.length) {
      completePromiseFulfillment(promiseId);
      return;
    }

    const jobs = enqueuePromisedDownloads(plan.files, promiseId);
    jobs.forEach((job) => fulfillment.remainingJobIds.add(job.id));
    const failed = jobs.find((job) => job.status === 'failed' || job.status === 'canceled');
    if (failed) {
      failPromiseFulfillment(promiseId, failed.error || 'The promised file could not be queued.');
      return;
    }
    if (fulfillment.remainingJobIds.size === 0) {
      completePromiseFulfillment(promiseId);
      return;
    }
    processTransferQueue();
  } catch (error) {
    failPromiseFulfillment(
      promiseId,
      error instanceof Error ? error.message : 'The promised file could not be prepared.'
    );
  }
}

function startPhoneFilePromiseDrag(request: PhoneFilePromiseDragRequest): void {
  const addon = loadFilePromiseDragAddon();
  if (!addon || !mainWindow || mainWindow.isDestroyed()) {
    sendPhoneFilePromiseDragEvent({
      type: 'failed',
      message: 'Dragging phone files is unavailable. Use Copy to Mac.'
    });
    return;
  }
  const items = request.items.filter(
    (item) =>
      Number.isInteger(item.deviceIndex) &&
      item.deviceConnectionId.trim() &&
      Number.isInteger(item.storageId) &&
      Number.isInteger(item.objectId) &&
      (item.kind === 'file' || item.kind === 'folder')
  );
  if (!items.length || items.length > 1_000) {
    sendPhoneFilePromiseDragEvent({
      type: 'failed',
      message: items.length ? 'Drag fewer than 1,000 items at once.' : 'No phone files were available to drag.'
    });
    return;
  }
  const connectionId = items[0].deviceConnectionId;
  if (items.some((item) => item.deviceConnectionId !== connectionId)) {
    sendPhoneFilePromiseDragEvent({ type: 'failed', message: 'Drag files from one phone at a time.' });
    return;
  }

  const nativeItems = items.map((item) => {
    const promiseId = randomUUID();
    promiseSources.set(promiseId, { id: promiseId, item });
    return {
      promiseId,
      name: sanitizeFileName(item.name),
      kind: item.kind
    };
  });

  try {
    const started = addon.startDrag(
      {
        viewHandle: mainWindow.getNativeWindowHandle(),
        items: nativeItems,
        internalDestination: request.internalDestination
      },
      (event) => {
        if (event.type === 'write' && event.promiseId && event.path) {
          void fulfillPhoneFilePromise(event.promiseId, event.path);
        } else if (event.type === 'internal-hover') {
          sendPhoneFilePromiseDragEvent({ type: 'internal-hover', active: event.active === true });
        } else if (event.type === 'drag-ended' && !event.operation) {
          nativeItems.forEach(({ promiseId }) => {
            if (!promiseFulfillments.has(promiseId)) {
              addon.completePromise(promiseId, 'Drag canceled.');
              promiseSources.delete(promiseId);
            }
          });
          appendLog(`file promise drag canceled for ${nativeItems.length} phone item(s)`);
          sendPhoneFilePromiseDragEvent({ type: 'canceled', message: 'Drag canceled. Nothing was copied.' });
        } else if (event.type === 'drag-ended') {
          appendLog(`file promise drag accepted with operation ${event.operation}`);
        }
      }
    );
    if (!started) {
      nativeItems.forEach(({ promiseId }) => {
        addon.completePromise(promiseId, 'The native drag session did not start.');
        promiseSources.delete(promiseId);
      });
      throw new Error('The native drag session did not start.');
    }
    appendLog(`file promise drag started for ${nativeItems.length} phone item(s)`);
    sendPhoneFilePromiseDragEvent({
      type: 'started',
      message: 'Drag to Finder, Desktop, another app, or the Mac pane.'
    });
  } catch (error) {
    nativeItems.forEach(({ promiseId }) => {
      addon.completePromise(promiseId, 'Dragging could not start.');
      promiseSources.delete(promiseId);
    });
    sendPhoneFilePromiseDragEvent({
      type: 'failed',
      message: `${error instanceof Error ? error.message : 'Dragging could not start.'} Use Copy to Mac.`
    });
  }
}

function getPrimaryWindowBounds(): { x: number; y: number; width: number; height: number } {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(1220, Math.max(980, workArea.width - 96));
  const height = Math.min(780, Math.max(620, workArea.height - 96));
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height
  };
}

function logDisplayLayout(): void {
  const displays = screen
    .getAllDisplays()
    .map((display) => {
      const bounds = display.bounds;
      const workArea = display.workArea;
      return `${display.id}:${bounds.x},${bounds.y},${bounds.width}x${bounds.height}:work=${workArea.x},${workArea.y},${workArea.width}x${workArea.height}`;
    })
    .join(' | ');
  appendLog(`display layout: ${displays}`);
}

function centerMainWindowOnPrimaryDisplay(reason: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const bounds = getPrimaryWindowBounds();
  mainWindow.setBounds(bounds, false);
  appendLog(`main window centered on primary display (${reason}): ${bounds.x},${bounds.y},${bounds.width}x${bounds.height}`);
}

function createWindow(): void {
  logDisplayLayout();
  const initialBounds = getPrimaryWindowBounds();
  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: 980,
    minHeight: 620,
    title: 'Android File Transfer for macOS',
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f7f6f1',
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  appendLog('main window created');

  mainWindow.once('ready-to-show', () => {
    appendLog('main window ready to show');
    centerMainWindowOnPrimaryDisplay('ready-to-show');
    mainWindow?.show();
    mainWindow?.focus();
  });
  const createdWindow = mainWindow;
  setTimeout(() => {
    if (mainWindow === createdWindow && !createdWindow.isDestroyed() && !createdWindow.isVisible()) {
      appendLog('main window fallback show');
      centerMainWindowOnPrimaryDisplay('fallback-show');
      createdWindow.show();
      createdWindow.focus();
    }
  }, 2500);

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL).catch((error) => {
      appendLog(`main window loadURL failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  } else {
    mainWindow.loadFile(join(currentDir, '../renderer/index.html')).catch((error) => {
      appendLog(`main window loadFile failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  centerMainWindowOnPrimaryDisplay('activate');
  mainWindow.show();
  mainWindow.focus();
}

function sendAppMenuCommand(command: AppMenuCommand): void {
  const target = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (!target || target.isDestroyed()) {
    showMainWindow();
    return;
  }
  target.webContents.send('app-menu:command', command);
}

function buildApplicationMenu(): void {
  const isMac = process.platform === 'darwin';
  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }
      ]
    : [];

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: 'File',
      submenu: [
        {
          label: 'Retry Phone Connection...',
          click: () => sendAppMenuCommand('open-files')
        },
        {
          label: 'New Folder',
          accelerator: 'CommandOrControl+N',
          click: () => sendAppMenuCommand('new-folder')
        },
        { type: 'separator' },
        {
          label: 'Check Phone Now',
          accelerator: 'CommandOrControl+R',
          click: () => sendAppMenuCommand('refresh')
        },
        {
          label: 'Open Log',
          click: () => sendAppMenuCommand('open-log')
        },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        {
          label: 'Copy File Selection',
          click: () => sendAppMenuCommand('copy-selection')
        },
        {
          label: 'Paste File Selection',
          click: () => sendAppMenuCommand('paste-selection')
        },
        { type: 'separator' },
        {
          label: 'Rename Selected Item',
          accelerator: 'CommandOrControl+D',
          click: () => sendAppMenuCommand('rename-selected-item')
        },
        {
          label: 'Delete Selected Items...',
          click: () => sendAppMenuCommand('delete-selected-items')
        },
        { type: 'separator' },
        {
          label: 'Copy to Queue',
          accelerator: 'CommandOrControl+Shift+C',
          click: () => sendAppMenuCommand('copy-to-queue')
        },
        {
          label: 'Select All Rows',
          accelerator: 'CommandOrControl+A',
          click: () => sendAppMenuCommand('select-all')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Folder Up',
          accelerator: 'CommandOrControl+B',
          click: () => sendAppMenuCommand('folder-up')
        },
        { type: 'separator' },
        {
          label: 'Focus Phone Pane',
          accelerator: 'CommandOrControl+1',
          click: () => sendAppMenuCommand('focus-phone')
        },
        {
          label: 'Focus Mac Pane',
          accelerator: 'CommandOrControl+2',
          click: () => sendAppMenuCommand('focus-mac')
        },
        { type: 'separator' },
        {
          label: 'List View',
          click: () => sendAppMenuCommand('view-list')
        },
        {
          label: 'Grid View',
          click: () => sendAppMenuCommand('view-grid')
        },
        {
          label: 'Show/Hide Hidden Files',
          click: () => sendAppMenuCommand('toggle-hidden-files')
        },
        { type: 'separator' },
        {
          label: 'Use System Appearance',
          click: () => sendAppMenuCommand('theme-system')
        },
        {
          label: 'Light Appearance',
          click: () => sendAppMenuCommand('theme-light')
        },
        {
          label: 'Dark Appearance',
          click: () => sendAppMenuCommand('theme-dark')
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [])]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates...',
          click: () => sendAppMenuCommand('check-for-updates')
        },
        { type: 'separator' },
        {
          label: 'Open Log',
          click: () => sendAppMenuCommand('open-log')
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  removeLegacyPrecopyDirectory();
  cleanupLegacyPrivilegedSession();
  appendLog('app ready');

  if (process.argv.includes('--file-promise-smoke')) {
    if (!loadFilePromiseDragAddon()) {
      console.error('PACKAGED_FILE_PROMISE_DRAG_UNAVAILABLE');
      app.exit(1);
      return;
    }
    appendLog('packaged file-promise drag smoke passed');
    console.log('PACKAGED_FILE_PROMISE_DRAG_OK');
    app.exit(0);
    return;
  }

  buildApplicationMenu();

  ipcMain.handle('mtp:getStatus', getStatus);
  ipcMain.handle('mtp:scanInventory', scanInventory);
  ipcMain.handle(
    'mtp:listFolder',
    (_event, deviceIndex: number, deviceConnectionId: string, storageId: number, parentId: number) =>
      listFolder(deviceIndex, deviceConnectionId, storageId, parentId)
  );
  ipcMain.handle('mtp:cancelConnectionAttempt', () => cancelConnectionAttempt());
  ipcMain.handle('mtp:requestQuitUsbApp', (_event, request: QuitUsbAppRequest) => requestQuitUsbApp(request));
  ipcMain.handle('mtp:cancelFolderListing', () => cancelFolderListing());
  ipcMain.handle('local:listDirectory', (_event, directoryPath?: string, showHiddenFiles?: boolean) =>
    listLocalDirectory(directoryPath, showHiddenFiles === true)
  );
  ipcMain.handle('local:inspectPath', (_event, localPath: string) =>
    localEntryForPath(resolve(localPath))
  );
  ipcMain.handle('local:ensureDirectory', (_event, directoryPath: string) =>
    ensureLocalDirectory(directoryPath)
  );
  ipcMain.handle('local:createFolder', (_event, request: CreateLocalFolderRequest) =>
    createLocalFolder(request)
  );
  ipcMain.handle('local:renameItem', (_event, request: RenameLocalItemRequest) =>
    renameLocalItem(request)
  );
  ipcMain.handle('local:trashItems', (_event, request: TrashLocalItemsRequest) =>
    trashLocalItems(request)
  );
  ipcMain.handle('local:setModifiedTime', (_event, localPath: string, modified: number) =>
    setLocalModifiedTime(localPath, modified)
  );
  ipcMain.handle('local:getCommonFolders', getCommonMacFolders);
  ipcMain.handle('mtp:chooseDestination', chooseDestination);
  ipcMain.handle('mtp:getDesktopDestination', getDesktopDestination);
  ipcMain.handle('mtp:startDownloads', (_event, requests: TransferRequest[]) =>
    queueDownloads(requests)
  );
  ipcMain.handle('mtp:startUploads', (_event, requests: UploadRequest[]) =>
    queueUploads(requests)
  );
  ipcMain.handle('mtp:startMoveDownloads', (_event, requests: TransferRequest[]) =>
    enqueueMoveDownloads(requests)
  );
  ipcMain.handle('mtp:startMoveUploads', (_event, requests: UploadRequest[]) =>
    enqueueMoveUploads(requests)
  );
  ipcMain.handle('mtp:createFolder', (_event, request: CreateFolderRequest) =>
    createPhoneFolder(request)
  );
  ipcMain.handle('mtp:renamePhoneItem', (_event, request: RenamePhoneItemRequest) =>
    renamePhoneItem(request)
  );
  ipcMain.handle('mtp:deletePhoneItems', (_event, request: DeletePhoneItemsRequest) =>
    deletePhoneItems(request)
  );
  ipcMain.on('mtp:startPhoneFilePromiseDrag', (_event, request: PhoneFilePromiseDragRequest) =>
    startPhoneFilePromiseDrag(request)
  );
  ipcMain.on('mtp:startLocalFileDrag', startLocalFileDrag);
  ipcMain.handle('mtp:cancelTransfer', (_event, jobId: string) => cancelTransfer(jobId));
  ipcMain.handle('mtp:retryTransfer', (_event, jobId: string) => retryTransfer(jobId));
  ipcMain.handle('mtp:revealInFinder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });
  ipcMain.handle('mtp:openLog', async () => {
    await shell.openPath(getLogPath());
  });
  ipcMain.handle('mtp:copyDiagnostics', copyDiagnostics);
  ipcMain.handle('app:getUpdateStatus', () => appUpdateStatus);
  ipcMain.handle('app:checkForUpdates', (_event, interactive?: boolean) =>
    checkForAppUpdates(interactive === true)
  );
  ipcMain.handle('app:downloadUpdate', downloadAppUpdate);
  ipcMain.handle('app:installUpdate', installAppUpdate);
  ipcMain.handle('app:openUpdateRelease', (_event, releaseTag: string) =>
    openUpdateRelease(releaseTag)
  );

  showMainWindow();

  app.on('activate', () => {
    showMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  loadFilePromiseDragAddon()?.failAll('The app quit before the promised file finished copying.');
  for (const promiseId of promiseFulfillments.keys()) {
    failPromiseFulfillment(promiseId, 'The app quit before the promised file finished copying.');
  }
  if (sessionProcess) {
    destroyMtpSession('App is quitting.');
  }
});
