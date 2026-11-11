import type {
  DeletePhoneItemsRequest,
  DeletePhoneItemsResult,
  PhoneMutationTarget,
  RemoveEmptyLocalFoldersResult
} from './types';

// Source folders of a confirmed Move, deepest first.
export type MoveFolderCleanup =
  | { side: 'phone'; deviceIndex: number; deviceConnectionId: string; folders: PhoneMutationTarget[] }
  | { side: 'mac'; folders: string[] };

export interface MoveFolderCleanupResult {
  removedPaths: string[];
  deletedTargets: PhoneMutationTarget[];
  kept: string[];
  // Folders not tried because the call was refused or failed; a later drain runs them.
  retry: MoveFolderCleanup | null;
}

// Runs after the queue drains, deepest folder first. Main and the phone keep any folder that is not empty,
// so a file whose move failed keeps its folder (and every folder above it).
export async function runMoveFolderCleanup(
  cleanup: MoveFolderCleanup,
  removeEmptyLocalFolders: (paths: string[]) => Promise<RemoveEmptyLocalFoldersResult>,
  deletePhoneItems: (request: DeletePhoneItemsRequest) => Promise<DeletePhoneItemsResult>
): Promise<MoveFolderCleanupResult> {
  const result: MoveFolderCleanupResult = { removedPaths: [], deletedTargets: [], kept: [], retry: null };
  if (cleanup.side === 'mac') {
    const removed = await removeEmptyLocalFolders(cleanup.folders).catch(() => null);
    if (!removed) {
      return { ...result, retry: cleanup };
    }
    result.removedPaths = removed.removedPaths;
    result.kept = removed.kept.map((folder) => `${folder.path.slice(folder.path.lastIndexOf('/') + 1)}: ${folder.message}`);
    return result;
  }
  for (let start = 0; start < cleanup.folders.length; start += 1000) {
    const batch = cleanup.folders.slice(start, start + 1000);
    const deleted = await deletePhoneItems({
      deviceIndex: cleanup.deviceIndex,
      deviceConnectionId: cleanup.deviceConnectionId,
      targets: batch,
      emptyFoldersOnly: true
    }).catch(() => null);
    // No failures means main refused before trying a folder (phone or queue busy). Later batches hold the
    // parents of this one, so they wait too.
    if (!deleted || (!deleted.ok && !deleted.failures.length)) {
      result.retry = { ...cleanup, folders: cleanup.folders.slice(start) };
      break;
    }
    result.deletedTargets.push(...batch.filter((target) => deleted.deletedObjectIds.includes(target.objectId)));
    deleted.failures.forEach((failure) => result.kept.push(`${failure.target.name}: ${failure.message}`));
  }
  return result;
}
