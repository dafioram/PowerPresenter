// Identifiers (spec §5.2). Opaque strings; generated ones are 22-character
// base64url encodings of 128 random bits.
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function newId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET[(value >> bits) & 63];
    }
  }
  if (bits > 0) out += ALPHABET[(value << (6 - bits)) & 63];
  return out; // 22 characters
}

export function isId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}
