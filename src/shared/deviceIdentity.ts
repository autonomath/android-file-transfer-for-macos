import type { RawDevice } from './types';

function normalizedSerial(device: Pick<RawDevice, 'serial'>): string {
  return device.serial?.trim().toLowerCase() ?? '';
}

export function stableDeviceIdentity(device: Pick<RawDevice, 'vendorId' | 'productId' | 'serial'>): string {
  const serial = normalizedSerial(device);
  return serial
    ? `${device.vendorId}:${device.productId}:serial:${serial}`
    : `${device.vendorId}:${device.productId}:serial:unknown`;
}

export function deviceConnectionId(
  device: Pick<RawDevice, 'vendorId' | 'productId' | 'serial' | 'usbSessionId' | 'bus' | 'device'>
): string {
  const attachment = device.usbSessionId?.trim()
    ? `usb:${device.usbSessionId.trim()}`
    : `raw:${device.bus}:${device.device}`;
  return `${stableDeviceIdentity(device)}@${attachment}`;
}
