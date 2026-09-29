// Reads basic font facts (spec §7.2): family name, weight, italic, and embedding
// permissions from OS/2 fsType. Supports TTF, OTF and WOFF; WOFF2 permissions
// can't be read without a Brotli decoder, so they're reported as unknown.
import { unzlibSync } from 'fflate';

const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function tablesSfnt(b) {
  const n = u16(b, 4);
  const tables = new Map();
  for (let i = 0; i < n; i++) {
    const e = 12 + i * 16;
    const tag = String.fromCharCode(b[e], b[e + 1], b[e + 2], b[e + 3]);
    const off = u32(b, e + 8);
    const len = u32(b, e + 12);
    tables.set(tag, b.subarray(off, off + len));
  }
  return tables;
}

function tablesWoff(b) {
  const n = u16(b, 12);
  const tables = new Map();
  for (let i = 0; i < n; i++) {
    const e = 44 + i * 20;
    const tag = String.fromCharCode(b[e], b[e + 1], b[e + 2], b[e + 3]);
    const off = u32(b, e + 4);
    const compLen = u32(b, e + 8);
    const origLen = u32(b, e + 12);
    const data = b.subarray(off, off + compLen);
    if (!['OS/2', 'name', 'head'].includes(tag)) continue;
    tables.set(tag, compLen < origLen ? unzlibSync(data) : data);
  }
  return tables;
}

function readName(t) {
  if (!t) return null;
  const count = u16(t, 2);
  const strOff = u16(t, 4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const platform = u16(t, r);
    const nameId = u16(t, r + 6);
    const len = u16(t, r + 8);
    const off = u16(t, r + 10);
    if (nameId !== 1 && nameId !== 16) continue;
    const bytes = t.subarray(strOff + off, strOff + off + len);
    let s;
    if (platform === 3 || platform === 0) {
      s = '';
      for (let k = 0; k + 1 < bytes.length; k += 2) s += String.fromCharCode((bytes[k] << 8) | bytes[k + 1]);
    } else s = String.fromCharCode(...bytes);
    if (nameId === 16 || !best) best = s;
  }
  return best;
}

// Returns { family, weight, italic, embedding: 'installable'|'editable'|'preview'|'restricted'|'unknown', packageable }.
export function inspectFont(bytes, type) {
  try {
    if (type === 'font/woff2') return { family: null, weight: 400, italic: false, embedding: 'unknown', packageable: true };
    const tables = type === 'font/woff' ? tablesWoff(bytes) : tablesSfnt(bytes);
    const os2 = tables.get('OS/2');
    let weight = 400;
    let italic = false;
    let embedding = 'installable';
    if (os2 && os2.length >= 64) {
      weight = u16(os2, 4) || 400;
      const fsType = u16(os2, 8);
      const fsSelection = u16(os2, 62);
      italic = (fsSelection & 1) !== 0;
      if (fsType & 0x0002) embedding = 'restricted';
      else if (fsType & 0x0004) embedding = 'preview';
      else if (fsType & 0x0008) embedding = 'editable';
    }
    const family = readName(tables.get('name'));
    return { family, weight: Math.min(900, Math.max(100, Math.round(weight / 100) * 100)), italic, embedding, packageable: embedding !== 'restricted' };
  } catch {
    return { family: null, weight: 400, italic: false, embedding: 'unknown', packageable: true };
  }
}
