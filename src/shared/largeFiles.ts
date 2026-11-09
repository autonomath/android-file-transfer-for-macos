import type { MtpObject } from './types';

export type LargeFileScanDepth = 'usual' | 'deeper' | 'everything';

// Phone photos stay under this size; videos, downloads and game data usually do not.
export const LARGE_FILE_MIN_BYTES = 50 * 1024 * 1024;
export const MAX_REMEMBERED_LARGE_FILES = 2000;
const MAX_SCANNED_FOLDERS = 50_000;
const DEEPER_SCAN_LEVELS = 4;
const STORAGE_ROOT_ID = 0xffffffff;
const REMEMBERED_TIER = 3;

// Top-level folders where Android and common apps keep big files. Tier 2 is checked before tier 1.
const LIKELY_FOLDERS = new Map<string, number>([
  ['dcim', 2],
  ['movies', 2],
  ['video', 2],
  ['videos', 2],
  ['download', 2],
  ['downloads', 2],
  ['android', 1],
  ['audiobooks', 1],
  ['backup', 1],
  ['backups', 1],
  ['documents', 1],
  ['miui', 1],
  ['music', 1],
  ['pictures', 1],
  ['podcasts', 1],
  ['recordings', 1],
  ['telegram', 1],
  ['whatsapp', 1]
]);

// Inside Android/, shared app media and game data hold big files; Android/data is mostly app caches.
const LIKELY_ANDROID_FOLDERS = new Map<string, number>([
  ['media', 2],
  ['obb', 2]
]);

export interface LargeFileCrumb {
  label: string;
  folderId: number;
}

export interface LargeFileEntry {
  // Storage name, then folder names. MTP object IDs change between connections, so memory keeps paths.
  folderPath: string[];
  name: string;
  size: number;
  modified: number;
  seenAt: number;
  // Set only when the file was listed during the current connection.
  live?: {
    storageId: number;
    crumbs: LargeFileCrumb[];
    object: MtpObject;
  };
}

export interface LargeFileScanUpdate {
  foldersChecked: number;
  currentFolder: string[];
  // Present when the list of large files changed.
  entries?: LargeFileEntry[];
}

export interface LargeFileScanResult {
  entries: LargeFileEntry[];
  foldersChecked: number;
  complete: boolean;
  error?: string;
}

export interface LargeFileScanOptions {
  storages: Array<{ id: number; name: string }>;
  depth: LargeFileScanDepth;
  // Files from earlier scans. Their folders are checked first at every depth.
  known: LargeFileEntry[];
  // Must throw when the phone cannot list the folder.
  list: (storageId: number, folderId: number) => Promise<MtpObject[]>;
  shouldStop: () => boolean;
  onUpdate?: (update: LargeFileScanUpdate) => void;
  now?: () => number;
}

interface PendingFolder {
  storageId: number;
  folderId: number;
  path: string[];
  crumbs: LargeFileCrumb[];
}

function pathKey(path: string[]): string {
  return path.join('\u0000');
}

function placeTier(path: string[]): number {
  const top = path[1]?.toLowerCase() ?? '';
  if (top !== 'android' || path.length === 2) {
    return LIKELY_FOLDERS.get(top) ?? 0;
  }
  return LIKELY_ANDROID_FOLDERS.get(path[2].toLowerCase()) ?? 0;
}

function shouldList(path: string[], tier: number, depth: LargeFileScanDepth): boolean {
  if (depth === 'everything' || tier === REMEMBERED_TIER) {
    return true;
  }
  if (depth === 'deeper') {
    return tier > 0 || path.length - 1 <= DEEPER_SCAN_LEVELS;
  }
  return tier > 0 && !path[path.length - 1].startsWith('.');
}

// Lists one folder at a time, most likely places first, so the shared MTP session stays free between folders.
export async function scanForLargeFiles(options: LargeFileScanOptions): Promise<LargeFileScanResult> {
  const now = options.now ?? Date.now;
  const rememberedFolders = new Set<string>();
  for (const entry of options.known) {
    for (let length = 1; length <= entry.folderPath.length; length += 1) {
      rememberedFolders.add(pathKey(entry.folderPath.slice(0, length)));
    }
  }
  // Names listed in remembered folders during this scan; enough to tell which remembered files are gone.
  const listedNames = new Map<string, Set<string>>();
  const found = new Map<string, LargeFileEntry>();
  const visited = new Set<string>();
  const queues: PendingFolder[][] = [[], [], [], []];
  const heads = [0, 0, 0, 0];
  for (const storage of options.storages) {
    queues[REMEMBERED_TIER].push({
      storageId: storage.id,
      folderId: STORAGE_ROOT_ID,
      path: [storage.name],
      crumbs: [{ label: storage.name, folderId: STORAGE_ROOT_ID }]
    });
  }

  function takeNext(): PendingFolder | undefined {
    for (let tier = REMEMBERED_TIER; tier >= 0; tier -= 1) {
      if (heads[tier] < queues[tier].length) {
        return queues[tier][heads[tier]++];
      }
    }
    return undefined;
  }

  function isGone(entry: LargeFileEntry): boolean {
    // Called only for files not found in this scan, so a listed folder means the file left it or shrank.
    if (listedNames.has(pathKey(entry.folderPath))) {
      return true;
    }
    for (let length = 1; length < entry.folderPath.length; length += 1) {
      const names = listedNames.get(pathKey(entry.folderPath.slice(0, length)));
      if (!names) {
        return false;
      }
      if (!names.has(entry.folderPath[length])) {
        return true;
      }
    }
    return false;
  }

  function currentEntries(): LargeFileEntry[] {
    const entries = [...found.values()];
    for (const entry of options.known) {
      if (!found.has(pathKey([...entry.folderPath, entry.name])) && !isGone(entry)) {
        entries.push(entry);
      }
    }
    return entries.sort((a, b) => b.size - a.size).slice(0, MAX_REMEMBERED_LARGE_FILES);
  }

  let foldersChecked = 0;
  let complete = true;
  let error: string | undefined;
  for (let folder = takeNext(); folder; folder = takeNext()) {
    if (options.shouldStop() || foldersChecked >= MAX_SCANNED_FOLDERS) {
      complete = false;
      break;
    }
    const visitKey = `${folder.storageId}:${folder.folderId}`;
    if (visited.has(visitKey)) {
      continue;
    }
    visited.add(visitKey);
    options.onUpdate?.({ foldersChecked, currentFolder: folder.path });

    let objects: MtpObject[];
    try {
      objects = await options.list(folder.storageId, folder.folderId);
    } catch (listError) {
      error = listError instanceof Error ? listError.message : String(listError);
      complete = false;
      break;
    }
    foldersChecked += 1;

    const folderKey = pathKey(folder.path);
    let changed = rememberedFolders.has(folderKey);
    if (changed) {
      listedNames.set(folderKey, new Set(objects.map((object) => object.name)));
    }
    for (const object of objects) {
      const path = [...folder.path, object.name];
      if (object.kind === 'folder') {
        const tier = rememberedFolders.has(pathKey(path)) ? REMEMBERED_TIER : placeTier(path);
        if (shouldList(path, tier, options.depth)) {
          queues[tier].push({
            storageId: folder.storageId,
            folderId: object.id,
            path,
            crumbs: [...folder.crumbs, { label: object.name, folderId: object.id }]
          });
        }
      } else if (object.size >= LARGE_FILE_MIN_BYTES) {
        found.set(pathKey(path), {
          folderPath: folder.path,
          name: object.name,
          size: object.size,
          modified: object.modified,
          seenAt: now(),
          live: { storageId: folder.storageId, crumbs: folder.crumbs, object }
        });
        changed = true;
      }
    }
    if (changed) {
      options.onUpdate?.({ foldersChecked, currentFolder: folder.path, entries: currentEntries() });
    }
  }

  return { entries: currentEntries(), foldersChecked, complete, error };
}

export function serializeRememberedLargeFiles(entries: LargeFileEntry[]): string {
  return JSON.stringify({
    version: 1,
    files: entries
      .slice(0, MAX_REMEMBERED_LARGE_FILES)
      .map(({ folderPath, name, size, modified, seenAt }) => ({ folderPath, name, size, modified, seenAt }))
  });
}

export function parseRememberedLargeFiles(raw: string | null): LargeFileEntry[] {
  let stored: { version?: unknown; files?: unknown } | null = null;
  try {
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    return [];
  }
  if (!stored || stored.version !== 1 || !Array.isArray(stored.files)) {
    return [];
  }
  return (stored.files as Array<Partial<LargeFileEntry> | null>)
    .filter(
      (entry): entry is LargeFileEntry =>
        !!entry &&
        Array.isArray(entry.folderPath) &&
        entry.folderPath.length > 0 &&
        entry.folderPath.every((part) => typeof part === 'string' && part.length > 0) &&
        typeof entry.name === 'string' &&
        entry.name.length > 0 &&
        Number.isFinite(entry.size) &&
        (entry.size as number) >= LARGE_FILE_MIN_BYTES &&
        Number.isFinite(entry.modified) &&
        Number.isFinite(entry.seenAt)
    )
    .map(({ folderPath, name, size, modified, seenAt }) => ({ folderPath, name, size, modified, seenAt }))
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_REMEMBERED_LARGE_FILES);
}
