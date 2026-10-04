export type DeviceState =
  | 'checking'
  | 'bridge-missing'
  | 'no-device'
  | 'connect-error'
  | 'memory-error'
  | 'connected'
  | 'error';

export type MtpConnectionPhase =
  | 'no-phone'
  | 'file-transfer-off'
  | 'opening'
  | 'listing-storage'
  | 'ready'
  | 'needs-mode-reset'
  | 'needs-replug'
  | 'usb-busy'
  | 'cancelled';

export type MtpConnectionIssue =
  | 'phone-not-responding'
  | 'storage-unavailable'
  | 'other-app-owns-usb'
  | 'helper-unavailable'
  | 'disconnected'
  | 'cancelled'
  | 'unknown';

export interface MtpConnectionPhaseEvent {
  phase: Extract<MtpConnectionPhase, 'opening' | 'listing-storage'>;
  connectionId?: string;
}

export interface RawDevice {
  index: number;
  vendorId: number;
  productId: number;
  bus: number;
  device: number;
  serial?: string;
  usbSessionId?: string;
  vendor: string;
  product: string;
  connectionMode?: 'mtp' | 'usb-only';
  usbCurrentConfiguration?: number;
  usbPreferredConfiguration?: number;
  needsDeviceAccessEntitlement?: boolean;
  connectionId?: string;
}

export interface DeviceStatus {
  ok: boolean;
  state: DeviceState;
  message: string;
  deviceCount: number;
  rawDevices: RawDevice[];
  helperPath: string;
  logPath: string;
  connectionPhase?: MtpConnectionPhase;
  connectionIssue?: MtpConnectionIssue;
  sessionOpen?: boolean;
  sessionConnectionId?: string;
  sessionConnectionIds?: string[];
  stderr?: string;
  // Name of the Mac app holding a macOS Image Capture session on the phone
  // (for example Preview). Present only while that app keeps the phone busy.
  usbOwnerApp?: string;
  usbConflict?: UsbConflict;
}

export interface UsbConflictApp {
  id: string;
  name: string;
  quitImpact: string;
}

export interface UsbConflict {
  connectionId: string;
  apps: UsbConflictApp[];
}

export interface QuitUsbAppRequest {
  connectionId: string;
  appId: string;
}

export interface QuitUsbAppResult {
  ok: boolean;
  message: string;
}

export interface MtpStorage {
  id: number;
  description: string;
  volumeIdentifier: string;
  maxCapacity: number;
  freeSpace: number;
  inferred?: boolean;
}

export type MtpObjectKind = 'folder' | 'file';

export interface MtpObject {
  id: number;
  parentId: number;
  storageId: number;
  name: string;
  kind: MtpObjectKind;
  size: number;
  modified: number;
  filetype: string;
}

export interface MtpDeviceInventory {
  index: number;
  name: string;
  serial: string;
  vendorId: number;
  productId: number;
  vendor: string;
  product: string;
  connectionId: string;
  storages: MtpStorage[];
  objects: MtpObject[];
}

export interface InventoryResult {
  ok: boolean;
  state: DeviceState;
  message: string;
  devices: MtpDeviceInventory[];
  helperPath: string;
  logPath: string;
  connectionPhase?: MtpConnectionPhase;
  connectionIssue?: MtpConnectionIssue;
  fileAccessUnavailable?: boolean;
  stderr?: string;
  usbOwnerApp?: string;
}

export interface FolderListResult {
  ok: boolean;
  state: DeviceState;
  message: string;
  deviceIndex: number;
  storageId: number;
  parentId: number;
  objects: MtpObject[];
  connectionPhase?: MtpConnectionPhase;
  connectionIssue?: MtpConnectionIssue;
  fileAccessUnavailable?: boolean;
  helperPath: string;
  logPath: string;
  stderr?: string;
}

export interface FolderListProgress {
  deviceConnectionId: string;
  storageId: number;
  parentId: number;
  sent: number;
  total: number;
}

export type LocalEntryKind = 'folder' | 'file';

export interface LocalEntry {
  path: string;
  name: string;
  kind: LocalEntryKind;
  size: number;
  modified: number;
  type: string;
  identity: LocalSourceIdentity;
}

export interface LocalDirectoryResult {
  ok: boolean;
  path: string;
  parentPath: string;
  message: string;
  entries: LocalEntry[];
}

export interface LocalModifiedTimeResult {
  ok: boolean;
  path: string;
  message: string;
  modified?: number;
}

export interface LocalMutationTarget {
  path: string;
  name: string;
  kind: LocalEntryKind;
  identity: LocalSourceIdentity;
}

export interface CreateLocalFolderRequest {
  directoryPath: string;
  name: string;
}

export interface RenameLocalItemRequest {
  directoryPath: string;
  target: LocalMutationTarget;
  newName: string;
}

export interface LocalMutationResult {
  ok: boolean;
  message: string;
  entry?: LocalEntry;
}

export interface TrashLocalItemsRequest {
  directoryPath: string;
  targets: LocalMutationTarget[];
}

export interface TrashLocalItemFailure {
  target: LocalMutationTarget;
  message: string;
}

export interface TrashLocalItemsResult {
  ok: boolean;
  message: string;
  trashedPaths: string[];
  failures: TrashLocalItemFailure[];
}

export interface TransferRequest {
  deviceIndex: number;
  deviceConnectionId: string;
  storageId?: number;
  parentId?: number;
  objectId: number;
  name: string;
  size: number;
  modified?: number;
  destinationDirectory: string;
  operation?: TransferOperation;
}

export type TransferCollisionAction = 'none' | 'keep-both' | 'replace' | 'skip' | 'cancel';

export interface UploadRequest {
  deviceIndex: number;
  deviceConnectionId: string;
  storageId: number;
  parentId: number;
  sourcePath: string;
  name: string;
  size: number;
  sourceIdentity: LocalSourceIdentity;
  operation?: TransferOperation;
  existingDestination?: PhoneMutationTarget;
  keepBothName?: string;
}

export interface CreateFolderRequest {
  deviceIndex: number;
  deviceConnectionId: string;
  storageId: number;
  parentId: number;
  name: string;
}

export interface CreateFolderResult {
  ok: boolean;
  state: DeviceState;
  message: string;
  deviceIndex: number;
  storageId: number;
  parentId: number;
  folderId: number;
  name: string;
  helperPath: string;
  logPath: string;
  stderr?: string;
}

export interface PhoneMutationTarget {
  objectId: number;
  storageId: number;
  parentId: number;
  name: string;
  kind: MtpObjectKind;
  // File-only listing snapshot. Folder size/time metadata is not stable across MTP devices.
  size?: number;
  modified?: number;
}

export interface RenamePhoneItemRequest {
  deviceIndex: number;
  deviceConnectionId: string;
  target: PhoneMutationTarget;
  newName: string;
}

export interface RenamePhoneItemResult {
  ok: boolean;
  state: DeviceState;
  message: string;
  objectId: number;
  actualName?: string;
  verified?: boolean;
  helperPath: string;
  logPath: string;
  stderr?: string;
}

export interface DeletePhoneItemsRequest {
  deviceIndex: number;
  deviceConnectionId: string;
  targets: PhoneMutationTarget[];
}

export interface DeletePhoneItemFailure {
  target: PhoneMutationTarget;
  message: string;
}

export interface DeletePhoneItemsResult {
  confirmed: boolean;
  ok: boolean;
  state: DeviceState;
  message: string;
  deletedObjectIds: number[];
  failures: DeletePhoneItemFailure[];
  helperPath: string;
  logPath: string;
  stderr?: string;
}

export type TransferDirection = 'download' | 'upload';

export type TransferOperation = 'copy' | 'move';

export type SourceRemovalStatus = 'pending' | 'removed' | 'kept';

export interface LocalSourceIdentity {
  device: number;
  inode: number;
  size: number;
  modifiedMs: number;
  changedMs: number;
}

export type TransferStatus = 'queued' | 'active' | 'completed' | 'failed' | 'canceled';

export interface TransferJob {
  id: string;
  direction: TransferDirection;
  operation: TransferOperation;
  deviceIndex: number;
  deviceConnectionId: string;
  objectId?: number;
  storageId?: number;
  parentId?: number;
  promiseId?: string;
  sourcePath?: string;
  sourceIdentity?: LocalSourceIdentity;
  sourceRemovalStatus?: SourceRemovalStatus;
  sourceRemovalError?: string;
  collisionAction?: Exclude<TransferCollisionAction, 'none' | 'cancel'>;
  destinationIdentity?: LocalSourceIdentity;
  originalName?: string;
  uploadName?: string;
  uploadStagingName?: string;
  uploadBackupName?: string;
  replacementTarget?: PhoneMutationTarget;
  name: string;
  size: number;
  modified?: number;
  destinationDirectory: string;
  destinationPath: string;
  temporaryPath?: string;
  originalDestinationPath?: string;
  renamedDestination?: boolean;
  status: TransferStatus;
  bytesTransferred: number;
  totalBytes: number;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  error?: string;
  resultMessage?: string;
  startedAt?: number;
  finishedAt?: number;
}

export type TransferEventType = 'queued' | 'started' | 'progress' | 'completed' | 'failed' | 'canceled';

export interface TransferEvent {
  type: TransferEventType;
  job: TransferJob;
}

export interface PhoneFilePromiseDragItem {
  deviceIndex: number;
  deviceConnectionId: string;
  storageId: number;
  objectId: number;
  parentId: number;
  name: string;
  kind: 'file' | 'folder';
  size: number;
  modified: number;
}

export interface PhoneFilePromiseDragRequest {
  items: PhoneFilePromiseDragItem[];
  internalDestination?: {
    path: string;
    rect: { x: number; y: number; width: number; height: number };
  };
}

export type PhoneFilePromiseDragEvent =
  | { type: 'started' | 'canceled' | 'accepted'; message: string }
  | { type: 'internal-hover'; active: boolean }
  | { type: 'planning'; promiseId: string; files: number; folders: number; currentName: string }
  | { type: 'failed'; message: string; promiseId?: string };

export interface MoveQueueResult {
  confirmed: boolean;
  collisionAction: TransferCollisionAction;
  conflictCount: number;
  skippedCount: number;
  jobs: TransferJob[];
}

export interface TransferQueueResult {
  collisionAction: TransferCollisionAction;
  conflictCount: number;
  skippedCount: number;
  jobs: TransferJob[];
}

export interface DestinationResult {
  canceled: boolean;
  path?: string;
}

export type CommonMacFolderId = 'home' | 'downloads' | 'documents' | 'pictures' | 'movies' | 'desktop';

export interface CommonMacFolder {
  id: CommonMacFolderId;
  label: string;
  path: string;
}

export interface DiagnosticsCopyResult {
  ok: boolean;
  copied: boolean;
  message: string;
  generatedAt: string;
  text: string;
}

export type AppUpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'update-available'
  | 'downloading'
  | 'ready-to-install'
  | 'up-to-date'
  | 'error';

export interface AppUpdateCheckResult {
  ok: boolean;
  status: AppUpdateCheckStatus;
  currentVersion: string;
  latestVersion?: string;
  releaseTag?: string;
  checkedAt: string;
  message: string;
  canInstallInPlace?: boolean;
  downloadPercent?: number;
}

export interface OpenUpdateReleaseResult {
  ok: boolean;
  message: string;
}

export type AppMenuCommand =
  | 'new-folder'
  | 'rename-selected-item'
  | 'delete-selected-items'
  | 'copy-to-queue'
  | 'copy-selection'
  | 'paste-selection'
  | 'folder-up'
  | 'refresh'
  | 'select-all'
  | 'open-files'
  | 'open-log'
  | 'check-for-updates'
  | 'focus-phone'
  | 'focus-mac'
  | 'view-list'
  | 'view-grid'
  | 'toggle-hidden-files'
  | 'theme-system'
  | 'theme-light'
  | 'theme-dark';

export interface MtpApi {
  getStatus: () => Promise<DeviceStatus>;
  requestQuitUsbApp: (request: QuitUsbAppRequest) => Promise<QuitUsbAppResult>;
  scanInventory: () => Promise<InventoryResult>;
  listFolder: (
    deviceIndex: number,
    deviceConnectionId: string,
    storageId: number,
    parentId: number
  ) => Promise<FolderListResult>;
  cancelConnectionAttempt: () => Promise<boolean>;
  cancelFolderListing: () => Promise<boolean>;
  onConnectionPhase: (listener: (event: MtpConnectionPhaseEvent) => void) => () => void;
  onFolderListProgress: (listener: (progress: FolderListProgress) => void) => () => void;
  listLocalDirectory: (directoryPath?: string, showHiddenFiles?: boolean) => Promise<LocalDirectoryResult>;
  inspectLocalPath: (path: string) => Promise<LocalEntry | null>;
  ensureLocalDirectory: (directoryPath: string) => Promise<LocalDirectoryResult>;
  createLocalFolder: (request: CreateLocalFolderRequest) => Promise<LocalMutationResult>;
  renameLocalItem: (request: RenameLocalItemRequest) => Promise<LocalMutationResult>;
  trashLocalItems: (request: TrashLocalItemsRequest) => Promise<TrashLocalItemsResult>;
  setLocalModifiedTime: (path: string, modified: number) => Promise<LocalModifiedTimeResult>;
  getCommonMacFolders: () => Promise<CommonMacFolder[]>;
  chooseDestination: () => Promise<DestinationResult>;
  getDesktopDestination: () => Promise<string>;
  getPathForFile: (file: File) => string;
  startDownloads: (requests: TransferRequest[]) => Promise<TransferQueueResult>;
  startUploads: (requests: UploadRequest[]) => Promise<TransferQueueResult>;
  startMoveDownloads: (requests: TransferRequest[]) => Promise<MoveQueueResult>;
  startMoveUploads: (requests: UploadRequest[]) => Promise<MoveQueueResult>;
  createFolder: (request: CreateFolderRequest) => Promise<CreateFolderResult>;
  renamePhoneItem: (request: RenamePhoneItemRequest) => Promise<RenamePhoneItemResult>;
  deletePhoneItems: (request: DeletePhoneItemsRequest) => Promise<DeletePhoneItemsResult>;
  startPhoneFilePromiseDrag: (request: PhoneFilePromiseDragRequest) => void;
  startLocalFileDrag: (filePaths: string[]) => void;
  cancelTransfer: (jobId: string) => Promise<TransferJob | null>;
  retryTransfer: (jobId: string) => Promise<TransferJob | null>;
  revealInFinder: (path: string) => Promise<void>;
  openLog: () => Promise<void>;
  copyDiagnostics: () => Promise<DiagnosticsCopyResult>;
  getUpdateStatus: () => Promise<AppUpdateCheckResult>;
  checkForUpdates: (interactive?: boolean) => Promise<AppUpdateCheckResult>;
  downloadUpdate: () => Promise<AppUpdateCheckResult>;
  installUpdate: () => Promise<OpenUpdateReleaseResult>;
  openUpdateRelease: (releaseTag: string) => Promise<OpenUpdateReleaseResult>;
  onAppUpdateStatus: (callback: (status: AppUpdateCheckResult) => void) => () => void;
  onTransferEvent: (callback: (event: TransferEvent) => void) => () => void;
  onPhoneFilePromiseDragEvent: (callback: (event: PhoneFilePromiseDragEvent) => void) => () => void;
  onAppMenuCommand: (callback: (command: AppMenuCommand) => void) => () => void;
}
