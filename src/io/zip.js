// Minimal, safe ZIP reader and writer (spec §10.1, §18.2).
// The reader parses the central directory with random access (Blob.slice),
// enforces path rules and limits, and counts bytes actually decompressed.
// The writer builds a Blob from parts, so large media never needs copying.
import { Inflate, deflateSync } from 'fflate';
import { crc32, crc32Update, crc32Blob } from './hash.js';

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
  }
}

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function decodeName(bytes, utf8) {
  if (utf8) return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  let s = '';
  for (const c of bytes) s += String.fromCharCode(c);
  return s;
}

export function checkPath(name) {
  if (!name || name.length > 512) return 'has an invalid name';
  if (name.includes('\\')) return 'uses a backslash';
  if (/^[A-Za-z]:/.test(name) || name.startsWith('/')) return 'is an absolute path';
  if (name.split('/').some((seg) => seg === '..' || seg === '.')) return 'contains ".." or "." segments';
  if (/[\u0000-\u001f]/.test(name)) return 'contains control characters';
  return null;
}

// Reads the central directory. Returns entries [{ name, method, crc, compSize, size, offset, isDir, isSymlink }].
export async function readCentralDirectory(blob, { maxEntries = 10000 } = {}) {
  if (blob.size < 22) throw new ZipError('The file isn’t a readable ZIP package.');
  const tailLen = Math.min(blob.size, 65557);
  const tail = new Uint8Array(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('The file isn’t a readable ZIP package.');
  const count = u16(tail, eocd + 10);
  const cdSize = u32(tail, eocd + 12);
  const cdOffset = u32(tail, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError('ZIP64 packages aren’t supported.');
  if (count > maxEntries) throw new ZipError(`The package has ${count} entries; the limit is ${maxEntries}.`);
  if (cdOffset + cdSize > blob.size) throw new ZipError('The ZIP directory is damaged.');
  const cd = new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const entries = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || u32(cd, p) !== 0x02014b50) throw new ZipError('The ZIP directory is damaged.');
    const madeBy = u16(cd, p + 4);
    const flags = u16(cd, p + 8);
    const method = u16(cd, p + 10);
    const crc = u32(cd, p + 16);
    const compSize = u32(cd, p + 20);
    const size = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    const extAttr = u32(cd, p + 38);
    const offset = u32(cd, p + 42);
    const name = decodeName(cd.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
    const unixMode = (madeBy >> 8) === 3 ? extAttr >>> 16 : 0;
    entries.push({
      name,
      method,
      crc,
      compSize,
      size,
      offset,
      encrypted: (flags & 1) !== 0,
      isDir: name.endsWith('/'),
      isSymlink: (unixMode & 0o170000) === 0o120000,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Extracts one entry. Counts the bytes actually produced and stops when they
// exceed `maxBytes` or the declared size (zip bomb protection).
export async function extractEntry(blob, entry, { maxBytes = Infinity, asBlob = false, type = '' } = {}) {
  if (entry.encrypted) throw new ZipError(`"${entry.name}" is encrypted.`);
  const lh = new Uint8Array(await blob.slice(entry.offset, entry.offset + 30).arrayBuffer());
  if (u32(lh, 0) !== 0x04034b50) throw new ZipError(`"${entry.name}" is damaged.`);
  const start = entry.offset + 30 + u16(lh, 26) + u16(lh, 28);
  const end = start + entry.compSize;
  if (end > blob.size) throw new ZipError(`"${entry.name}" is truncated.`);
  const limit = Math.min(maxBytes, entry.size);
  if (entry.method === 0) {
    if (entry.compSize !== entry.size) throw new ZipError(`"${entry.name}" has inconsistent sizes.`);
    if (entry.size > maxBytes) throw new ZipError(`"${entry.name}" is larger than allowed.`);
    const data = blob.slice(start, end, type);
    const crc = await crc32Blob(data);
    if (crc !== entry.crc) throw new ZipError(`"${entry.name}" failed its checksum.`);
    return asBlob ? data : new Uint8Array(await data.arrayBuffer());
  }
  if (entry.method !== 8) throw new ZipError(`"${entry.name}" uses an unsupported compression method.`);
  const parts = [];
  let produced = 0;
  let crc = 0;
  let overflow = false;
  const inflater = new Inflate((chunk) => {
    produced += chunk.length;
    if (produced > limit) {
      overflow = true;
      return;
    }
    crc = crc32Update(crc, chunk);
    parts.push(chunk);
  });
  // Read 4 MB at a time but feed the inflater 64 KB at a time, so a single
  // push can never expand into more than ~66 MB before the byte count is checked.
  const CH = 4 * 1024 * 1024;
  const SUB = 64 * 1024;
  for (let off = start; off < end; off += CH) {
    const piece = new Uint8Array(await blob.slice(off, Math.min(end, off + CH)).arrayBuffer());
    for (let so = 0; so < piece.length; so += SUB) {
      const last = off + CH >= end && so + SUB >= piece.length;
      try {
        inflater.push(piece.subarray(so, so + SUB), last);
      } catch {
        throw new ZipError(`"${entry.name}" couldn’t be decompressed.`);
      }
      if (overflow) throw new ZipError(`"${entry.name}" expands to more data than it declares or than is allowed.`);
    }
  }
  if (produced !== entry.size) throw new ZipError(`"${entry.name}" doesn’t match its declared size.`);
  if (crc !== entry.crc) throw new ZipError(`"${entry.name}" failed its checksum.`);
  if (asBlob) return new Blob(parts, { type });
  const out = new Uint8Array(produced);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function dosTime(date) {
  const d = date || new Date(2026, 0, 1);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, day };
}

function header(sig, fields) {
  const len = fields.reduce((n, [size]) => n + size, 4);
  const b = new Uint8Array(len);
  const v = new DataView(b.buffer);
  v.setUint32(0, sig, true);
  let o = 4;
  for (const [size, val] of fields) {
    if (size === 2) v.setUint16(o, val, true);
    else if (size === 4) v.setUint32(o, val >>> 0, true);
    else b.set(val, o);
    o += size;
  }
  return b;
}

// entries: [{ name, data: Uint8Array | Blob | string, compress: bool }]
// Returns a Blob. Throws if the archive would need ZIP64.
export async function writeZip(entries, { onProgress, date = new Date() } = {}) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, day } = dosTime(date);
  let doneBytes = 0;
  const total = entries.reduce((n, e) => n + (typeof e.data === 'string' ? e.data.length : e.data.size ?? e.data.length), 0);
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    let data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    let crc;
    let size;
    let body;
    let method = 0;
    if (data instanceof Blob) {
      size = data.size;
      if (e.compress && size < 64 * 1024 * 1024) {
        data = new Uint8Array(await data.arrayBuffer());
      } else {
        crc = await crc32Blob(data, (n) => onProgress?.((doneBytes + n) / total));
        body = data;
      }
    }
    if (!body) {
      size = data.length;
      crc = crc32(data);
      if (e.compress) {
        const deflated = deflateSync(data, { level: 6 });
        if (deflated.length < data.length) {
          body = deflated;
          method = 8;
        } else body = data;
      } else body = data;
    }
    const compSize = body instanceof Blob ? body.size : body.length;
    if (offset + compSize > 0xfffffff0 || size > 0xfffffff0) throw new Error('The package would be larger than 4 GB, which needs ZIP64.');
    const local = header(0x04034b50, [
      [2, 20], [2, 0x800], [2, method], [2, time], [2, day], [4, crc], [4, compSize], [4, size], [2, nameBytes.length], [2, 0], [nameBytes.length, nameBytes],
    ]);
    central.push(header(0x02014b50, [
      [2, 20], [2, 20], [2, 0x800], [2, method], [2, time], [2, day], [4, crc], [4, compSize], [4, size],
      [2, nameBytes.length], [2, 0], [2, 0], [2, 0], [2, 0], [4, 0], [4, offset], [nameBytes.length, nameBytes],
    ]));
    parts.push(local, body);
    offset += local.length + compSize;
    doneBytes += size;
    onProgress?.(doneBytes / Math.max(1, total));
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  if (entries.length > 0xfffe) throw new Error('Too many files for a ZIP package.');
  const eocd = header(0x06054b50, [[2, 0], [2, 0], [2, entries.length], [2, entries.length], [4, cdSize], [4, offset], [2, 0]]);
  return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
}
