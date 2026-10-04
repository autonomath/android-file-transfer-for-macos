import { MAX_PHONE_ITEM_NAME_BYTES, validatePhoneItemName } from './phoneMutation';

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let result = '';
  for (const character of value) {
    if (utf8Length(result + character) > maximumBytes) {
      break;
    }
    result += character;
  }
  return result;
}

function splitFileName(name: string): { base: string; extension: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return { base: name, extension: '' };
  }
  const extension = name.slice(dot);
  return utf8Length(extension) <= 32
    ? { base: name.slice(0, dot), extension }
    : { base: name, extension: '' };
}

function boundedPhoneName(base: string, suffix: string, extension: string): string {
  const fixedBytes = utf8Length(suffix + extension);
  const availableBaseBytes = Math.max(MAX_PHONE_ITEM_NAME_BYTES - fixedBytes, 1);
  const candidate = `${truncateUtf8(base, availableBaseBytes)}${suffix}${extension}`;
  if (validatePhoneItemName(candidate)) {
    throw new Error('Unable to create a valid phone filename for this transfer.');
  }
  return candidate;
}

export function keepBothPhoneName(name: string, copyNumber = 2): string {
  if (!Number.isInteger(copyNumber) || copyNumber < 2) {
    throw new Error('Copy numbers must be integers starting at 2.');
  }
  const { base, extension } = splitFileName(name);
  return boundedPhoneName(base, ` ${copyNumber}`, extension);
}

export function nextKeepBothPhoneName(name: string, occupiedNames: ReadonlySet<string>): string {
  let copyNumber = 2;
  while (copyNumber < 10_000) {
    const candidate = keepBothPhoneName(name, copyNumber);
    if (!occupiedNames.has(candidate)) {
      return candidate;
    }
    copyNumber += 1;
  }
  throw new Error('Too many copies with this name already exist on the phone.');
}

export function temporaryPhoneTransferName(
  originalName: string,
  purpose: 'stage' | 'backup',
  identifier: string
): string {
  const safeIdentifier = identifier.toLowerCase().replace(/[^a-f0-9]/g, '').slice(0, 12);
  if (!safeIdentifier) {
    throw new Error('A temporary phone filename requires an identifier.');
  }
  const { extension } = splitFileName(originalName);
  return boundedPhoneName('.aft', `-${purpose}-${safeIdentifier}`, extension);
}
