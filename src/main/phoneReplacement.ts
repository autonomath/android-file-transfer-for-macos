import type { PhoneMutationTarget } from '../shared/types';

export interface PhoneReplacementResponse {
  ok?: boolean;
  event?: 'started' | 'progress' | 'complete' | 'failed';
  message?: string;
  actualName?: string;
  verified?: boolean;
}

export type PhoneReplacementMutation = (
  command: 'rename-item' | 'delete-item',
  target: PhoneMutationTarget,
  newName?: string
) => Promise<PhoneReplacementResponse>;

export interface PhoneReplacementOptions {
  existing: PhoneMutationTarget;
  staged: PhoneMutationTarget;
  finalName: string;
  backupName: string;
  mutate: PhoneReplacementMutation;
  onCleanupWarning?: (message: string) => void;
}

function verifiedRename(result: PhoneReplacementResponse, expectedName: string): boolean {
  return result.ok === true &&
    result.event === 'complete' &&
    result.verified === true &&
    result.actualName === expectedName;
}

async function bestEffortDelete(
  target: PhoneMutationTarget,
  mutate: PhoneReplacementMutation,
  onWarning?: (message: string) => void
): Promise<void> {
  try {
    const result = await mutate('delete-item', target);
    if (!result.ok) {
      onWarning?.(result.message || `Unable to remove staged phone upload ${target.name}.`);
    }
  } catch (error) {
    onWarning?.(error instanceof Error ? error.message : String(error));
  }
}

export async function publishStagedPhoneReplacement(
  options: PhoneReplacementOptions
): Promise<{ message: string }> {
  const { existing, staged, finalName, backupName, mutate, onCleanupWarning } = options;

  let oldRename: PhoneReplacementResponse;
  try {
    oldRename = await mutate('rename-item', existing, backupName);
  } catch (error) {
    await bestEffortDelete(staged, mutate, onCleanupWarning);
    throw new Error(`The new copy was staged, but the existing phone file could not be prepared for replacement. It was kept. ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!oldRename.ok) {
    await bestEffortDelete(staged, mutate, onCleanupWarning);
    throw new Error(oldRename.message || 'The existing phone file could not be prepared for replacement. It was kept.');
  }
  if (!verifiedRename(oldRename, backupName)) {
    throw new Error(`The phone accepted a rename but did not verify it. The old file was kept as ${backupName}; refresh the folder before trying again.`);
  }

  const backup = { ...existing, name: backupName };
  let newRename: PhoneReplacementResponse;
  try {
    newRename = await mutate('rename-item', staged, finalName);
  } catch (error) {
    throw new Error(`The phone session stopped while publishing the replacement. The old file remains as ${backupName}; refresh the folder before trying again. ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!newRename.ok) {
    const rollback = await mutate('rename-item', backup, finalName).catch(() => null);
    await bestEffortDelete(staged, mutate, onCleanupWarning);
    if (!rollback || !verifiedRename(rollback, finalName)) {
      throw new Error(`The replacement could not be published, and the phone did not verify restoration of the old filename. The old file remains as ${backupName}. Refresh the folder.`);
    }
    throw new Error(newRename.message || 'The replacement could not be published. The existing phone file was restored.');
  }
  if (!verifiedRename(newRename, finalName)) {
    throw new Error(`The phone accepted the replacement name but did not verify it. The old file remains as ${backupName}; refresh the folder before trying again.`);
  }

  try {
    const removedBackup = await mutate('delete-item', backup);
    if (!removedBackup.ok) {
      return {
        message: `Replaced ${finalName}, but the old copy remains as ${backupName}. Delete that backup after refreshing the folder.`
      };
    }
  } catch (error) {
    return {
      message: `Replaced ${finalName}, but the old copy remains as ${backupName}. ${error instanceof Error ? error.message : String(error)}`
    };
  }

  return { message: `Replaced the existing ${finalName} after verifying the new copy.` };
}
