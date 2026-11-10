import { existsSync, linkSync, lstatSync, readdirSync, renameSync, rmdirSync, rmSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import type { LocalSourceIdentity, RemoveEmptyLocalFoldersResult } from '../shared/types';

function matchesQueuedIdentity(sourcePath: string, identity: LocalSourceIdentity): boolean {
  const current = lstatSync(sourcePath);
  return (
    current.isFile() &&
    !current.isSymbolicLink() &&
    current.dev === identity.device &&
    current.ino === identity.inode &&
    current.size === identity.size &&
    current.mtimeMs === identity.modifiedMs &&
    current.ctimeMs === identity.changedMs
  );
}

function matchesStableIdentity(sourcePath: string, identity: LocalSourceIdentity): boolean {
  const current = lstatSync(sourcePath);
  return (
    current.isFile() &&
    !current.isSymbolicLink() &&
    current.dev === identity.device &&
    current.ino === identity.inode &&
    current.size === identity.size &&
    current.mtimeMs === identity.modifiedMs
  );
}

export function removeVerifiedLocalMoveSource(
  sourcePath: string,
  identity: LocalSourceIdentity
): void {
  if (!matchesQueuedIdentity(sourcePath, identity)) {
    throw new Error('The Mac source changed while it was copying.');
  }

  const quarantinePath = join(
    dirname(sourcePath),
    `.android-file-transfer-for-macos-move-${randomUUID()}.source`
  );
  renameSync(sourcePath, quarantinePath);

  try {
    if (!matchesStableIdentity(quarantinePath, identity)) {
      throw new Error('The Mac source changed before it could be removed.');
    }
    unlinkSync(quarantinePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!existsSync(quarantinePath)) {
      throw error;
    }
    let restored = false;
    try {
      linkSync(quarantinePath, sourcePath);
      restored = true;
      unlinkSync(quarantinePath);
    } catch (restoreError) {
      const restoreReason = restoreError instanceof Error ? restoreError.message : String(restoreError);
      if (restored) {
        throw new Error(
          `${reason} The source was restored to its original Mac folder; an additional recovery link remains at ${quarantinePath}: ${restoreReason}`
        );
      }
      throw new Error(
        `${reason} The source was kept at ${quarantinePath} because its original name could not be restored: ${restoreReason}`
      );
    }
    throw new Error(`${reason} The source was restored to its original Mac folder.`);
  }
}

// Folders a Move emptied, deepest first. Each goes only when nothing but Finder's .DS_Store is left in it.
export function removeEmptyLocalFolders(paths: unknown): RemoveEmptyLocalFoldersResult {
  const result: RemoveEmptyLocalFoldersResult = { removedPaths: [], kept: [] };
  for (const folderPath of Array.isArray(paths) ? paths : []) {
    try {
      if (typeof folderPath !== 'string' || resolve(folderPath) !== folderPath || !lstatSync(folderPath).isDirectory()) {
        throw new Error('This is not a Mac folder.');
      }
      const leftovers = readdirSync(folderPath).filter((name) => name !== '.DS_Store');
      if (leftovers.length) {
        throw new Error(`It still has ${leftovers.length} ${leftovers.length === 1 ? 'item' : 'items'}, so it was kept.`);
      }
      rmSync(join(folderPath, '.DS_Store'), { force: true });
      rmdirSync(folderPath);
      result.removedPaths.push(folderPath);
    } catch (error) {
      result.kept.push({ path: String(folderPath), message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
