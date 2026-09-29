// Removes photo metadata — EXIF, XMP and IPTC, including GPS location — by
// stripping metadata segments without re-encoding (spec §8.4). JPEGs whose EXIF
// orientation isn't the default are re-encoded upright, because the orientation
// lives in the metadata being removed.

function jpegOrientation(b) {
  let p = 2;
  while (p + 4 <= b.length && b[p] === 0xff) {
    const marker = b[p + 1];
    const len = (b[p + 2] << 8) | b[p + 3];
    if (marker === 0xda) break;
    if (marker === 0xe1 && String.fromCharCode(...b.subarray(p + 4, p + 10)) === 'Exif\0\0') {
      const t = p + 10;
      const le = b[t] === 0x49;
      const r16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const r32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
      const ifd = t + r32(t + 4);
      const n = r16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > b.length) break;
        if (r16(e) === 0x0112) return r16(e + 8);
      }
    }
    p += 2 + len;
  }
  return 1;
}

function stripJpeg(b) {
  const out = [b.subarray(0, 2)];
  let p = 2;
  let changed = false;
  while (p + 4 <= b.length && b[p] === 0xff) {
    const marker = b[p + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const len = (b[p + 2] << 8) | b[p + 3];
    const seg = b.subarray(p, p + 2 + len);
    let drop = false;
    if (marker === 0xe1 || marker === 0xed || marker === 0xfe) drop = true; // EXIF/XMP, IPTC, comments
    if (marker >= 0xe3 && marker <= 0xef && marker !== 0xee) drop = true; // other APPn (keep APP0 JFIF, APP2 ICC, APP14 Adobe)
    if (drop) changed = true;
    else out.push(seg);
    p += 2 + len;
  }
  out.push(b.subarray(p));
  return { parts: out, changed };
}

function stripPng(b) {
  const out = [b.subarray(0, 8)];
  let p = 8;
  let changed = false;
  const DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  while (p + 12 <= b.length) {
    const len = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const end = p + 12 + len;
    if (DROP.has(type)) changed = true;
    else out.push(b.subarray(p, end));
    p = end;
    if (type === 'IEND') break;
  }
  return { parts: out, changed };
}

function stripWebp(b) {
  const chunks = [];
  let p = 12;
  let changed = false;
  while (p + 8 <= b.length) {
    const fourcc = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    const size = b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24);
    const total = 8 + size + (size & 1);
    if (fourcc === 'EXIF' || fourcc === 'XMP ') changed = true;
    else chunks.push({ fourcc, bytes: b.slice(p, p + total) });
    p += total;
  }
  if (!changed) return { parts: [b], changed: false };
  for (const c of chunks) if (c.fourcc === 'VP8X') c.bytes[8] &= ~(0x08 | 0x04);
  const bodyLen = chunks.reduce((n, c) => n + c.bytes.length, 0);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 4), 0);
  const riff = 4 + bodyLen;
  head[4] = riff & 0xff;
  head[5] = (riff >> 8) & 0xff;
  head[6] = (riff >> 16) & 0xff;
  head[7] = (riff >> 24) & 0xff;
  head.set(b.subarray(8, 12), 8);
  return { parts: [head, ...chunks.map((c) => c.bytes)], changed: true };
}

async function reencodeUpright(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
}

// Returns { blob, changed, reencoded }.
export async function stripPhotoMetadata(blob, type) {
  const b = new Uint8Array(await blob.arrayBuffer());
  if (type === 'image/jpeg') {
    const orientation = jpegOrientation(b);
    if (orientation !== 1 && typeof createImageBitmap !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      try {
        const out = await reencodeUpright(blob);
        return { blob: new Blob([out], { type }), changed: true, reencoded: true };
      } catch {
        /* fall back to stripping */
      }
    }
    const { parts, changed } = stripJpeg(b);
    return { blob: changed ? new Blob(parts, { type }) : blob, changed, reencoded: false };
  }
  if (type === 'image/png') {
    const { parts, changed } = stripPng(b);
    return { blob: changed ? new Blob(parts, { type }) : blob, changed, reencoded: false };
  }
  if (type === 'image/webp') {
    const { parts, changed } = stripWebp(b);
    return { blob: changed ? new Blob(parts, { type }) : blob, changed, reencoded: false };
  }
  return { blob, changed: false, reencoded: false };
}

export const _internal = { stripJpeg, stripPng, stripWebp, jpegOrientation };
