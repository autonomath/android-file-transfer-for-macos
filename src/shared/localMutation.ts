export const MAX_LOCAL_ITEM_NAME_BYTES = 255;

export function validateLocalItemName(name: string): string | null {
  if (!name) {
    return 'Enter a name.';
  }
  if (name === '.' || name === '..') {
    return 'That name is reserved.';
  }
  if (/[\u0000/]/u.test(name)) {
    return 'Mac file names cannot contain / or a null character.';
  }
  const encoded = new TextEncoder().encode(name);
  if (new TextDecoder().decode(encoded) !== name) {
    return 'The name contains invalid Unicode.';
  }
  if (encoded.byteLength > MAX_LOCAL_ITEM_NAME_BYTES) {
    return `Names must be ${MAX_LOCAL_ITEM_NAME_BYTES} UTF-8 bytes or fewer.`;
  }
  return null;
}
