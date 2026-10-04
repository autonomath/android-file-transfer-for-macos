import { existsSync, linkSync, lstatSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

interface AtomicExchangeAddon {
  atomicExchangePaths: (leftPath: string, rightPath: string) => void;
}

const requireNativeAddon = createRequire(import.meta.url);
let atomicExchangeAddon: AtomicExchangeAddon | undefined;

export interface FileIdentitySnapshot {
  device: number;
  inode: number;
  size: number;
  modifiedMs: number;
  changedMs: number;
}

export interface PublishTemporaryFileOptions {
  temporaryPath: string;
  destinationPath: string;
  expectedSize: number;
  allowExistingEquivalent?: boolean;
  onCollision?: (currentPath: string) => string;
}

export interface PublishedTemporaryFile {
  destinationPath: string;
  size: number;
  usedExisting: boolean;
}

export interface ReplaceTemporaryFileOptions {
  temporaryPath: string;
  destinationPath: string;
  expectedSize: number;
  expectedExisting: FileIdentitySnapshot;
  beforeExchange?: () => void;
  exchangePaths?: (leftPath: string, rightPath: string) => void;
}

function checkedTemporaryFile(temporaryPath: string, expectedSize: number) {
  const temporaryStat = lstatSync(temporaryPath);
  if (!temporaryStat.isFile() || temporaryStat.isSymbolicLink()) {
    throw new Error('The downloaded temporary item is not a regular file.');
  }
  if (expectedSize > 0 && temporaryStat.size !== expectedSize) {
    throw new Error(
      `The phone sent ${temporaryStat.size} bytes, but ${expectedSize} bytes were expected.`
    );
  }
  return temporaryStat;
}

export function fileIdentitySnapshot(path: string): FileIdentitySnapshot {
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Only a regular file can be replaced at ${path}.`);
  }
  return {
    device: stats.dev,
    inode: stats.ino,
    size: stats.size,
    modifiedMs: stats.mtimeMs,
    changedMs: stats.ctimeMs
  };
}

function identitiesMatch(left: FileIdentitySnapshot, right: FileIdentitySnapshot): boolean {
  return left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedMs === right.modifiedMs &&
    left.changedMs === right.changedMs;
}

function identitiesMatchAfterExchange(
  left: FileIdentitySnapshot,
  right: FileIdentitySnapshot
): boolean {
  // RENAME_SWAP updates ctime on both inodes; the full ctime check runs immediately before it.
  return left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedMs === right.modifiedMs;
}

function loadAtomicExchangeAddon(): AtomicExchangeAddon {
  if (atomicExchangeAddon) {
    return atomicExchangeAddon;
  }
  if (process.platform !== 'darwin') {
    throw new Error('Atomic replacement requires macOS rename exchange support.');
  }

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    resourcesPath ? join(resourcesPath, 'bin', 'file-promise-drag.node') : '',
    resolve(process.cwd(), 'resources/bin/file-promise-drag.node')
  ].filter((candidate, index, paths) => candidate && paths.indexOf(candidate) === index);
  const failures: string[] = [];
  for (const candidatePath of candidates) {
    try {
      const candidate = requireNativeAddon(candidatePath) as Partial<AtomicExchangeAddon>;
      if (typeof candidate.atomicExchangePaths !== 'function') {
        failures.push(`${candidatePath}: atomic exchange export is missing`);
        continue;
      }
      atomicExchangeAddon = candidate as AtomicExchangeAddon;
      return atomicExchangeAddon;
    } catch (error) {
      failures.push(`${candidatePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Native atomic rename support is unavailable. ${failures.join(' ')}`);
}

function atomicExchangePaths(leftPath: string, rightPath: string): void {
  loadAtomicExchangeAddon().atomicExchangePaths(leftPath, rightPath);
}

function destinationChangedError(destinationPath: string): Error {
  return new Error(
    `The existing item changed while ${destinationPath} was being copied. ` +
    'It was not replaced.'
  );
}

export function replaceTemporaryFile(
  options: ReplaceTemporaryFileOptions
): PublishedTemporaryFile {
  const temporaryStat = checkedTemporaryFile(options.temporaryPath, options.expectedSize);
  const expectedTemporary = fileIdentitySnapshot(options.temporaryPath);
  const currentExisting = fileIdentitySnapshot(options.destinationPath);
  if (!identitiesMatch(currentExisting, options.expectedExisting)) {
    throw destinationChangedError(options.destinationPath);
  }
  if (temporaryStat.dev !== currentExisting.device) {
    throw new Error('The completed temporary file is not on the destination volume.');
  }

  const exchangePaths = options.exchangePaths ?? atomicExchangePaths;
  options.beforeExchange?.();
  try {
    exchangePaths(options.temporaryPath, options.destinationPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not atomically replace ${options.destinationPath}. ` +
      `No destination was overwritten. ${detail}`
    );
  }

  let publicationMatches = false;
  try {
    const swappedExisting = fileIdentitySnapshot(options.temporaryPath);
    const publishedTemporary = fileIdentitySnapshot(options.destinationPath);
    publicationMatches =
      identitiesMatchAfterExchange(swappedExisting, options.expectedExisting) &&
      identitiesMatchAfterExchange(publishedTemporary, expectedTemporary);
  } catch {
    publicationMatches = false;
  }

  if (!publicationMatches) {
    try {
      exchangePaths(options.temporaryPath, options.destinationPath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `The destination changed during atomic publication of ${options.destinationPath}, ` +
        `and automatic rollback failed. The destination state requires manual inspection. ${detail}`
      );
    }
    throw destinationChangedError(options.destinationPath);
  }

  try {
    unlinkSync(options.temporaryPath);
  } catch (error) {
    try {
      exchangePaths(options.temporaryPath, options.destinationPath);
    } catch (rollbackError) {
      const cleanupDetail = error instanceof Error ? error.message : String(error);
      const rollbackDetail = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      throw new Error(
        `The replacement reached ${options.destinationPath}, but the old destination could not be ` +
        `removed or restored automatically. The destination state requires manual inspection. ` +
        `${cleanupDetail} ${rollbackDetail}`
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The replacement of ${options.destinationPath} was rolled back because the old destination ` +
      `could not be removed. The original destination was restored. ${detail}`
    );
  }

  return { destinationPath: options.destinationPath, size: temporaryStat.size, usedExisting: false };
}

export function publishTemporaryFile(
  options: PublishTemporaryFileOptions
): PublishedTemporaryFile {
  const temporaryStat = checkedTemporaryFile(options.temporaryPath, options.expectedSize);

  let destinationPath = options.destinationPath;
  while (true) {
    if (existsSync(destinationPath)) {
      if (options.allowExistingEquivalent) {
        const existingStat = lstatSync(destinationPath);
        if (
          existingStat.isFile() &&
          !existingStat.isSymbolicLink() &&
          existingStat.size === temporaryStat.size
        ) {
          unlinkSync(options.temporaryPath);
          return { destinationPath, size: temporaryStat.size, usedExisting: true };
        }
      }
      if (!options.onCollision) {
        throw new Error(`A different item already exists at ${destinationPath}.`);
      }
      destinationPath = options.onCollision(destinationPath);
      continue;
    }

    try {
      linkSync(options.temporaryPath, destinationPath);
      try {
        unlinkSync(options.temporaryPath);
      } catch (error) {
        unlinkSync(destinationPath);
        throw error;
      }
      return { destinationPath, size: temporaryStat.size, usedExisting: false };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'EEXIST' || !options.onCollision) {
        throw error;
      }
      destinationPath = options.onCollision(destinationPath);
    }
  }
}
