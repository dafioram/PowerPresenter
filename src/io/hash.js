// CRC-32 and SHA-256 helpers for ZIP packaging and asset records.
let table = null;
function crcTable() {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

export function crc32Update(crc, bytes) {
  const t = crcTable();
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function crc32(bytes) {
  return crc32Update(0, bytes);
}

const CHUNK = 8 * 1024 * 1024;

// Streams a Blob in chunks, yielding to the event loop between chunks.
export async function crc32Blob(blob, onProgress) {
  let crc = 0;
  for (let off = 0; off < blob.size; off += CHUNK) {
    const part = new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer());
    crc = crc32Update(crc, part);
    onProgress?.(Math.min(blob.size, off + CHUNK));
    await new Promise((r) => setTimeout(r, 0));
  }
  return crc;
}

export function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(data) {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  return toHex(await crypto.subtle.digest('SHA-256', buf));
}
