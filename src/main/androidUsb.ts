import type { RawDevice } from '../shared/types';

const androidUsbVendors = new Map<number, string>([
  [0x04e8, 'Samsung'],
  [0x18d1, 'Google'],
  [0x22b8, 'Motorola'],
  [0x12d1, 'Huawei'],
  [0x2717, 'Xiaomi'],
  [0x2a70, 'OnePlus'],
  [0x0bb4, 'HTC'],
  [0x0fce, 'Sony'],
  [0x1004, 'LG']
]);

function numberProperty(block: string, name: string): number | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`"${escaped}" = (\\d+)`));
  return match ? Number(match[1]) : null;
}

function numericStringProperty(block: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`"${escaped}" = (\\d+)`));
  return match?.[1] ?? null;
}

function stringProperty(block: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = block.match(new RegExp(`"${escaped}" = "([^"]*)"`));
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function booleanProperty(block: string, name: string): boolean | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`"${escaped}" = (Yes|No|true|false)`));
  if (!match) {
    return null;
  }
  return match[1] === 'Yes' || match[1] === 'true';
}

function isKnownMtpUsbMode(
  vendorId: number,
  productId: number,
  product: string,
  currentConfiguration: number | null,
  preferredConfiguration: number | null
): boolean {
  if (
    currentConfiguration !== null &&
    preferredConfiguration !== null &&
    preferredConfiguration > 0 &&
    currentConfiguration !== preferredConfiguration
  ) {
    return false;
  }

  if (/\bmtp\b/i.test(product)) {
    return true;
  }

  // Samsung Galaxy phones expose File Transfer / MTP as 04e8:6860 even when
  // libmtp cannot see the raw device through its normal user-owned path.
  return vendorId === 0x04e8 && productId === 0x6860;
}

export function androidUsbFallbackKey(devices: RawDevice[]): string {
  return devices
    .map((device) => `${device.vendorId.toString(16)}:${device.productId.toString(16)}@${device.bus}:${device.device}`)
    .join(',');
}

export function parseAndroidUsbDevicesFromIoreg(output: string): RawDevice[] {
  const chunks: string[] = [];
  let currentChunk: string[] = [];

  for (const line of output.split('\n')) {
    if (/\+-o /.test(line)) {
      if (currentChunk.length) {
        chunks.push(currentChunk.join('\n'));
      }
      currentChunk = [line];
    } else if (currentChunk.length) {
      currentChunk.push(line);
    }
  }

  if (currentChunk.length) {
    chunks.push(currentChunk.join('\n'));
  }

  const devices: RawDevice[] = [];

  for (const chunk of chunks) {
    const vendorId = numberProperty(chunk, 'idVendor');
    const productId = numberProperty(chunk, 'idProduct');
    if (!vendorId || !productId || !androidUsbVendors.has(vendorId)) {
      continue;
    }

    const locationId = numberProperty(chunk, 'locationID') ?? 0;
    const deviceAddress =
      numberProperty(chunk, 'USB Address') ?? numberProperty(chunk, 'kUSBAddress') ?? devices.length + 1;
    const vendor =
      stringProperty(chunk, ['USB Vendor Name', 'kUSBVendorString']) ??
      androidUsbVendors.get(vendorId) ??
      'Android';
    const product =
      stringProperty(chunk, ['USB Product Name', 'kUSBProductString']) ?? 'Android USB device';
    const serial = stringProperty(chunk, ['USB Serial Number', 'kUSBSerialNumberString']);
    const usbSessionId = numericStringProperty(chunk, 'sessionID');
    const currentConfiguration = numberProperty(chunk, 'kUSBCurrentConfiguration');
    const preferredConfiguration = numberProperty(chunk, 'kUSBPreferredConfiguration');
    const needsDeviceAccessEntitlement = booleanProperty(chunk, 'NeedsDeviceAccessEntitlement');
    const connectionMode = isKnownMtpUsbMode(
      vendorId,
      productId,
      product,
      currentConfiguration,
      preferredConfiguration
    )
      ? 'mtp'
      : 'usb-only';

    const device: RawDevice = {
      index: devices.length,
      vendorId,
      productId,
      bus: locationId ? Math.floor(locationId / 0x1000000) : 0,
      device: deviceAddress,
      vendor,
      product,
      connectionMode
    };

    if (serial) {
      device.serial = serial;
    }
    if (usbSessionId) {
      device.usbSessionId = usbSessionId;
    }
    if (currentConfiguration !== null) {
      device.usbCurrentConfiguration = currentConfiguration;
    }
    if (preferredConfiguration !== null) {
      device.usbPreferredConfiguration = preferredConfiguration;
    }
    if (needsDeviceAccessEntitlement !== null) {
      device.needsDeviceAccessEntitlement = needsDeviceAccessEntitlement;
    }

    devices.push(device);
  }

  return devices;
}
