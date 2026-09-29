// Format detection from file signatures, not extensions (spec §8.2).
export const EXT_BY_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'text/vtt': 'vtt',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
};

export const KIND_BY_TYPE = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/avif': 'image',
  'image/svg+xml': 'svg',
  'video/mp4': 'video',
  'video/webm': 'video',
  'text/vtt': 'captions',
  'font/ttf': 'font',
  'font/otf': 'font',
  'font/woff': 'font',
  'font/woff2': 'font',
};

export const COMPRESSED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm', 'font/woff', 'font/woff2']);

const ascii = (b, off, len) => String.fromCharCode(...b.subarray(off, off + len));

// Returns { type } or { rejected: message } or null (unknown).
export function sniffBytes(b) {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return { type: 'image/png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg' };
  if (b.length >= 6 && ascii(b, 0, 4) === 'GIF8') return { type: 'image/gif' };
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { type: 'image/webp' };
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') return { type: 'image/avif' };
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return { rejected: 'HEIC images aren’t supported. Convert the image to JPEG or PNG first.' };
    if (brand === 'qt  ') return { rejected: 'QuickTime (.mov) video isn’t supported. Convert it to MP4 (H.264 + AAC).' };
    return { type: 'video/mp4' };
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { type: 'video/webm' };
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a))) return { rejected: 'TIFF images aren’t supported. Convert the image to PNG or JPEG first.' };
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return { rejected: 'BMP images aren’t supported. Convert the image to PNG first.' };
  if (b.length >= 4) {
    const sig = ascii(b, 0, 4);
    if (sig === 'wOFF') return { type: 'font/woff' };
    if (sig === 'wOF2') return { type: 'font/woff2' };
    if (sig === 'OTTO') return { type: 'font/otf' };
    if ((b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || sig === 'true') return { type: 'font/ttf' };
  }
  // text formats
  let start = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) start = 3;
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(start, Math.min(b.length, start + 2048)));
  if (/^WEBVTT(\s|$)/.test(head)) return { type: 'text/vtt' };
  const trimmed = head.replace(/^\s+/, '');
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(trimmed)) return { type: 'image/svg+xml' };
  return null;
}

export async function sniffBlob(blob) {
  const head = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  return sniffBytes(head);
}

// Reads intrinsic image dimensions from headers without decoding pixels.
export function imageSizeFromBytes(b, type) {
  try {
    if (type === 'image/png' && b.length >= 24) {
      const w = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
      const h = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
      return { width: w, height: h };
    }
    if (type === 'image/gif' && b.length >= 10) return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
    if (type === 'image/jpeg') {
      let p = 2;
      while (p + 9 < b.length) {
        if (b[p] !== 0xff) { p++; continue; }
        const m = b[p + 1];
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
        const len = (b[p + 2] << 8) | b[p + 3];
        if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
          return { height: (b[p + 5] << 8) | b[p + 6], width: (b[p + 7] << 8) | b[p + 8] };
        }
        p += 2 + len;
      }
    }
    if (type === 'image/webp' && b.length >= 30) {
      const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (fourcc === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (fourcc === 'VP8 ') return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
      if (fourcc === 'VP8L') {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}
