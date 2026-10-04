import { existsSync, linkSync, lstatSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { LocalSourceIdentity } from '../shared/types';

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
