export const MAX_PHONE_ITEM_NAME_BYTES = 255;

export function validatePhoneItemName(name: string): string | null {
  if (!name) {
    return 'Enter a name.';
  }
  if (name === '.' || name === '..') {
    return 'That name is reserved.';
  }
  if (/[\u0000-\u001f\u007f/\\:*?"<>|]/u.test(name)) {
    return 'Names cannot contain control characters or / \\ : * ? " < > |.';
  }
  const encoded = new TextEncoder().encode(name);
  if (new TextDecoder().decode(encoded) !== name) {
    return 'The name contains invalid Unicode.';
  }
  if (encoded.byteLength > MAX_PHONE_ITEM_NAME_BYTES) {
    return `Names must be ${MAX_PHONE_ITEM_NAME_BYTES} UTF-8 bytes or fewer.`;
  }
  return null;
}

export function encodePhoneCommandName(name: string): string {
  return Array.from(new TextEncoder().encode(name), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
