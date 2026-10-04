import type { QuitUsbAppRequest, QuitUsbAppResult, UsbConflict } from '../shared/types';

export interface MacMtpCameraOwner {
  pid: number;
  processName: string;
  locationId?: number;
}

export interface MacMtpDeviceIdentity {
  vendorId: number;
  productId: number;
  serial?: string | null;
}

function numberProperty(block: string, name: string): number | null {
  const match = block.match(new RegExp(`"${name}"\\s*=\\s*(\\d+)`));
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function stringProperty(block: string, name: string): string | null {
  const match = block.match(new RegExp(`"${name}"\\s*=\\s*"([^"]*)"`));
  return match?.[1]?.trim() || null;
}

export function findMacMtpCameraOwner(
  ioregOutput: string,
  device: MacMtpDeviceIdentity
): MacMtpCameraOwner | null {
  const expectedSerial = device.serial?.trim().toLowerCase() || null;
  const interfaceBlocks = ioregOutput.split(/\n(?=\+-o )/);

  for (const block of interfaceBlocks) {
    if (
      numberProperty(block, 'bInterfaceClass') !== 6 ||
      numberProperty(block, 'bInterfaceSubClass') !== 1 ||
      numberProperty(block, 'idVendor') !== device.vendorId ||
      numberProperty(block, 'idProduct') !== device.productId
    ) {
      continue;
    }

    const interfaceSerial = stringProperty(block, 'USB Serial Number')?.toLowerCase() || null;
    if (expectedSerial && interfaceSerial !== expectedSerial) {
      continue;
    }

    const owner = block.match(/"UsbExclusiveOwner"\s*=\s*"pid\s+(\d+),\s*([^"]+)"/);
    if (!owner || owner[2].trim() !== 'ptpcamerad') {
      continue;
    }

    const pid = Number.parseInt(owner[1], 10);
    if (Number.isFinite(pid) && pid > 0) {
      const locationId = numberProperty(block, 'locationID');
      return { pid, processName: owner[2].trim(), ...(locationId !== null ? { locationId } : {}) };
    }
  }

  return null;
}

export interface MacCameraClient {
  pid: number;
  bundleId: string;
  appName: string;
  bundlePath: string;
}

const cameraClientNames: Record<string, string> = {
  'com.apple.Preview': 'Preview',
  'com.apple.Photos': 'Photos',
  'com.apple.Image_Capture': 'Image Capture',
  'com.apple.PhotoBooth': 'Photo Booth',
  'com.google.drivefs': 'Google Drive'
};

export function cameraProcessAgeSeconds(elapsed: string): number | null {
  const match = elapsed.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!match) return null;
  return Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3]) * 60 + Number(match[4]);
}

// Attribution is conservative: only the currently owning daemon, a single
// matching USB location, and a still-running client with a matching executable.
// A requestStart line on its own says nothing about exclusive USB ownership.
export function findMacCameraClients(
  log: string,
  owner: MacMtpCameraOwner,
  processes: Map<number, string>
): MacCameraClient[] {
  if (owner.locationId === undefined) return [];
  const lines = log.split('\n').filter((line) => line.includes(`ptpcamerad[${owner.pid}:`));
  const locations = new Set(lines.flatMap((line) => {
    const match = line.match(/New Device: LOC:(\d+)/);
    return match ? [Number(match[1])] : [];
  }));
  if (locations.size !== 1 || !locations.has(owner.locationId)) return [];
  const clients = new Map<number, MacCameraClient>();
  for (const line of lines) {
    const match = line.match(/PTPCameraDevice\s*\|\s*([+-])\s*(\d+)-([\w.-]+):/);
    if (!match) continue;
    const pid = Number(match[2]);
    if (match[1] === '-') { clients.delete(pid); continue; }
    const bundleId = match[3];
    const appName = cameraClientNames[bundleId];
    const executable = processes.get(pid);
    if (!appName || !executable?.includes(`/${appName}.app/Contents/MacOS/`)) continue;
    if (!lines.some((entry) => entry.includes(`requestStart | Process: ${bundleId},`))) continue;
    const bundlePath = executable.slice(0, executable.indexOf('.app/Contents/MacOS/') + 4);
    clients.set(pid, { pid, bundleId, appName, bundlePath });
  }
  return [...clients.values()];
}

export interface MacCameraConflictSnapshot {
  owner: MacMtpCameraOwner;
  clients: MacCameraClient[];
}

type QuitOutcome = 'requested' | 'not-running' | 'refused';
type OfferedClient = MacCameraClient & { id: string };

export class MacCameraConflicts {
  private conflicts = new Map<string, { owner: MacMtpCameraOwner; clients: OfferedClient[] }>();
  private pendingQuits = new Set<string>();

  constructor(private makeId: () => string) {}

  observe(connectionId: string, snapshot: MacCameraConflictSnapshot | null): void {
    if (!snapshot) { this.conflicts.delete(connectionId); return; }
    const previous = this.conflicts.get(connectionId);
    this.conflicts.set(connectionId, {
      owner: snapshot.owner,
      clients: snapshot.clients.map((client) => ({
        ...client,
        id: previous?.owner.pid === snapshot.owner.pid && previous.owner.locationId === snapshot.owner.locationId
          ? previous.clients.find((old) => this.sameClient(old, client))?.id ?? this.makeId()
          : this.makeId()
      }))
    });
  }

  retainConnections(connections: Set<string>): void {
    for (const key of this.conflicts.keys()) {
      if (!connections.has(key)) this.conflicts.delete(key);
    }
  }

  get(connectionId: string): UsbConflict | undefined {
    const current = this.conflicts.get(connectionId);
    if (!current) return undefined;
    return {
      connectionId,
      apps: current.clients.map((client) => ({
        id: client.id,
        name: client.appName,
        quitImpact: client.bundleId === 'com.google.drivefs'
          ? 'Quitting pauses Google Drive syncing and may interrupt access to cloud-only files. Wait for any current uploads or saves to finish.'
          : `Quitting ${client.appName} may interrupt imports or other work. It can ask you to save changes or decline the request.`
      }))
    };
  }

  private sameClient(left: MacCameraClient, right: MacCameraClient): boolean {
    return left.pid === right.pid && left.bundleId === right.bundleId && left.bundlePath === right.bundlePath;
  }

  async requestQuit(request: QuitUsbAppRequest, actions: {
    inspect: (connectionId: string) => Promise<MacCameraConflictSnapshot | null>;
    quitNormally: (client: MacCameraClient) => QuitOutcome;
  }): Promise<QuitUsbAppResult> {
    const changed = { ok: false, message: 'The phone connection or app has changed. Nothing was closed; checking again automatically.' };
    if (!request || typeof request.connectionId !== 'string' || typeof request.appId !== 'string') return changed;
    const offered = this.conflicts.get(request.connectionId);
    const client = offered?.clients.find((candidate) => candidate.id === request.appId);
    if (!offered || !client) return changed;
    if (this.pendingQuits.has(request.appId)) return { ok: false, message: 'A Quit request is already in progress.' };
    this.pendingQuits.add(request.appId);
    try {
      const fresh = await actions.inspect(request.connectionId);
      const stillOffered = this.conflicts.get(request.connectionId)?.clients.some((entry) => entry.id === request.appId);
      if (!stillOffered || !fresh || fresh.owner.pid !== offered.owner.pid ||
          fresh.owner.locationId !== offered.owner.locationId ||
          !fresh.clients.some((entry) => this.sameClient(entry, client))) return changed;
      const outcome = actions.quitNormally(client);
      if (outcome === 'requested') return {
        ok: true,
        message: `Quit requested. ${client.appName} may ask you to save changes or cancel quitting. We will keep checking the phone; reopen ${client.appName} when you need it again.`
      };
      return {
        ok: false,
        message: outcome === 'not-running'
          ? `${client.appName} is no longer running. We will keep checking the phone.`
          : `${client.appName} could not be asked to quit. You can quit it from its own menu, or keep waiting. Nothing was force-quit.`
      };
    } catch {
      return { ok: false, message: 'Could not safely request Quit. Nothing was force-quit. You can use the app’s own Quit menu, or keep waiting.' };
    } finally {
      this.pendingQuits.delete(request.appId);
    }
  }
}
