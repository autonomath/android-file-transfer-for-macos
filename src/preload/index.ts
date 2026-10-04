import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AppMenuCommand,
  AppUpdateCheckResult,
  CreateLocalFolderRequest,
  CreateFolderRequest,
  DeletePhoneItemsRequest,
  FolderListProgress,
  MtpConnectionPhaseEvent,
  MtpApi,
  PhoneFilePromiseDragEvent,
  PhoneFilePromiseDragRequest,
  RenamePhoneItemRequest,
  RenameLocalItemRequest,
  TrashLocalItemsRequest,
  TransferEvent,
  TransferRequest,
  UploadRequest
} from '../shared/types';

const api: MtpApi = {
  getStatus: () => ipcRenderer.invoke('mtp:getStatus'),
  requestQuitUsbApp: (request) => ipcRenderer.invoke('mtp:requestQuitUsbApp', request),
  scanInventory: () => ipcRenderer.invoke('mtp:scanInventory'),
  listFolder: (deviceIndex: number, deviceConnectionId: string, storageId: number, parentId: number) =>
    ipcRenderer.invoke('mtp:listFolder', deviceIndex, deviceConnectionId, storageId, parentId),
  cancelConnectionAttempt: () => ipcRenderer.invoke('mtp:cancelConnectionAttempt'),
  cancelFolderListing: () => ipcRenderer.invoke('mtp:cancelFolderListing'),
  onConnectionPhase: (callback: (event: MtpConnectionPhaseEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MtpConnectionPhaseEvent) => callback(payload);
    ipcRenderer.on('mtp:connection-phase', listener);
    return () => ipcRenderer.off('mtp:connection-phase', listener);
  },
  onFolderListProgress: (callback: (progress: FolderListProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: FolderListProgress) =>
      callback(progress);
    ipcRenderer.on('folder-list:progress', listener);
    return () => ipcRenderer.off('folder-list:progress', listener);
  },
  listLocalDirectory: (directoryPath?: string, showHiddenFiles?: boolean) =>
    ipcRenderer.invoke('local:listDirectory', directoryPath, showHiddenFiles),
  inspectLocalPath: (path: string) => ipcRenderer.invoke('local:inspectPath', path),
  ensureLocalDirectory: (directoryPath: string) => ipcRenderer.invoke('local:ensureDirectory', directoryPath),
  createLocalFolder: (request: CreateLocalFolderRequest) => ipcRenderer.invoke('local:createFolder', request),
  renameLocalItem: (request: RenameLocalItemRequest) => ipcRenderer.invoke('local:renameItem', request),
  trashLocalItems: (request: TrashLocalItemsRequest) => ipcRenderer.invoke('local:trashItems', request),
  setLocalModifiedTime: (path: string, modified: number) =>
    ipcRenderer.invoke('local:setModifiedTime', path, modified),
  getCommonMacFolders: () => ipcRenderer.invoke('local:getCommonFolders'),
  chooseDestination: () => ipcRenderer.invoke('mtp:chooseDestination'),
  getDesktopDestination: () => ipcRenderer.invoke('mtp:getDesktopDestination'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  startDownloads: (requests: TransferRequest[]) => ipcRenderer.invoke('mtp:startDownloads', requests),
  startUploads: (requests: UploadRequest[]) => ipcRenderer.invoke('mtp:startUploads', requests),
  startMoveDownloads: (requests: TransferRequest[]) => ipcRenderer.invoke('mtp:startMoveDownloads', requests),
  startMoveUploads: (requests: UploadRequest[]) => ipcRenderer.invoke('mtp:startMoveUploads', requests),
  createFolder: (request: CreateFolderRequest) => ipcRenderer.invoke('mtp:createFolder', request),
  renamePhoneItem: (request: RenamePhoneItemRequest) => ipcRenderer.invoke('mtp:renamePhoneItem', request),
  deletePhoneItems: (request: DeletePhoneItemsRequest) => ipcRenderer.invoke('mtp:deletePhoneItems', request),
  startPhoneFilePromiseDrag: (request: PhoneFilePromiseDragRequest) =>
    ipcRenderer.send('mtp:startPhoneFilePromiseDrag', request),
  startLocalFileDrag: (filePaths: string[]) => ipcRenderer.send('mtp:startLocalFileDrag', filePaths),
  cancelTransfer: (jobId: string) => ipcRenderer.invoke('mtp:cancelTransfer', jobId),
  retryTransfer: (jobId: string) => ipcRenderer.invoke('mtp:retryTransfer', jobId),
  revealInFinder: (path: string) => ipcRenderer.invoke('mtp:revealInFinder', path),
  openLog: () => ipcRenderer.invoke('mtp:openLog'),
  copyDiagnostics: () => ipcRenderer.invoke('mtp:copyDiagnostics'),
  getUpdateStatus: () => ipcRenderer.invoke('app:getUpdateStatus'),
  checkForUpdates: (interactive?: boolean) => ipcRenderer.invoke('app:checkForUpdates', interactive === true),
  downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
  openUpdateRelease: (releaseTag: string) => ipcRenderer.invoke('app:openUpdateRelease', releaseTag),
  onAppUpdateStatus: (callback: (status: AppUpdateCheckResult) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: AppUpdateCheckResult) => callback(status);
    ipcRenderer.on('app:update-status', listener);
    return () => ipcRenderer.off('app:update-status', listener);
  },
  onTransferEvent: (callback: (event: TransferEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TransferEvent) => callback(payload);
    ipcRenderer.on('transfer:event', listener);
    return () => ipcRenderer.off('transfer:event', listener);
  },
  onPhoneFilePromiseDragEvent: (callback: (event: PhoneFilePromiseDragEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: PhoneFilePromiseDragEvent) => callback(payload);
    ipcRenderer.on('phone-file-promise:event', listener);
    return () => ipcRenderer.off('phone-file-promise:event', listener);
  },
  onAppMenuCommand: (callback: (command: AppMenuCommand) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: AppMenuCommand) => callback(command);
    ipcRenderer.on('app-menu:command', listener);
    return () => ipcRenderer.off('app-menu:command', listener);
  }
};

contextBridge.exposeInMainWorld('mtp', api);
