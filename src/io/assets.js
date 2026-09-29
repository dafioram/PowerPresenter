// Preparing files that the user adds (spec §8.3, §8.4): signature checks,
// limits, sanitizing, metadata stripping, dimensions and hashing.
import { sniffBlob, EXT_BY_TYPE, KIND_BY_TYPE, imageSizeFromBytes } from './sniff.js';
import { sanitizeSvg } from './svg-sanitize.js';
import { stripPhotoMetadata } from './photo-metadata.js';
import { normalizeVtt } from './webvtt.js';
import { inspectFont } from './font-inspect.js';
import { sha256 } from './hash.js';
import { LIMITS } from '../core/limits.js';
import { newId } from '../core/ids.js';

export class AssetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssetError';
  }
}

const MB = 1024 * 1024;
const fmtMb = (n) => `${Math.round(n / MB)} MB`;

export function assetPath(id, type) {
  return `assets/${id}.${EXT_BY_TYPE[type] || 'bin'}`;
}

function cleanFilename(name) {
  return String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || undefined;
}

export async function probeVideo(blob) {
  if (typeof document === 'undefined') return { duration_ms: 0, width: 0, height: 0, playable: false };
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      const done = (ok) => {
        resolve({
          duration_ms: ok && isFinite(v.duration) ? Math.round(v.duration * 1000) : 0,
          width: ok ? v.videoWidth : 0,
          height: ok ? v.videoHeight : 0,
          playable: ok && v.videoWidth > 0,
        });
      };
      v.onloadedmetadata = () => done(true);
      v.onerror = () => done(false);
      setTimeout(() => done(false), 15000);
      v.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Captures a poster frame at `atMs` (spec §13.8). Returns a PNG Blob or null.
export async function capturePoster(blobOrUrl, atMs = 0) {
  if (typeof document === 'undefined') return null;
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  try {
    return await new Promise((resolve) => {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.playsInline = true;
      let settled = false;
      const finish = (val) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };
      v.onloadeddata = () => {
        v.currentTime = Math.max(0.001, atMs / 1000);
      };
      v.onseeked = () => {
        try {
          const c = document.createElement('canvas');
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          c.getContext('2d').drawImage(v, 0, 0);
          c.toBlob((b) => finish(b), 'image/jpeg', 0.9);
        } catch {
          finish(null);
        }
      };
      v.onerror = () => finish(null);
      setTimeout(() => finish(null), 15000);
      v.src = url;
    });
  } finally {
    if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Prepares one file. Returns { record, blob, warnings, extra }.
export async function prepareAsset(file, { stripMetadata = true, filename } = {}) {
  const warnings = [];
  const sniff = await sniffBlob(file);
  if (!sniff) throw new AssetError('This file type isn’t supported.');
  if (sniff.rejected) throw new AssetError(sniff.rejected);
  let type = sniff.type;
  const kind = KIND_BY_TYPE[type];
  let blob = file;
  const extra = {};
  const record = { id: newId(), kind, media_type: type, original_filename: cleanFilename(filename || file.name) };
  if (kind === 'image') {
    if (file.size > LIMITS.imageBytes) throw new AssetError(`Images can be at most ${fmtMb(LIMITS.imageBytes)}.`);
    if (stripMetadata) {
      const r = await stripPhotoMetadata(file, type);
      blob = r.blob;
      if (r.reencoded) extra.reencoded = true;
      if (r.changed) extra.metadataRemoved = true;
    }
    const head = new Uint8Array(await blob.slice(0, 512 * 1024).arrayBuffer());
    let size = imageSizeFromBytes(head, type);
    if (!size && typeof createImageBitmap !== 'undefined') {
      try {
        const bmp = await createImageBitmap(blob);
        size = { width: bmp.width, height: bmp.height };
        bmp.close?.();
      } catch {
        throw new AssetError('The image couldn’t be decoded.');
      }
    }
    if (!size || !size.width || !size.height) throw new AssetError('The image couldn’t be decoded.');
    if (size.width * size.height > LIMITS.imagePixels) throw new AssetError('The image has more than 100 megapixels.');
    record.width = size.width;
    record.height = size.height;
  } else if (kind === 'svg') {
    if (file.size > LIMITS.svgBytes) throw new AssetError('SVG files can be at most 5 MB.');
    const { svg, width, height } = sanitizeSvg(await file.text());
    blob = new Blob([svg], { type });
    record.width = width;
    record.height = height;
  } else if (kind === 'video') {
    if (file.size > LIMITS.videoBytes) throw new AssetError(`Videos can be at most ${fmtMb(LIMITS.videoBytes)}.`);
    const meta = await probeVideo(file);
    record.duration_ms = meta.duration_ms;
    record.width = meta.width;
    record.height = meta.height;
    if (!meta.playable) warnings.push('This browser can’t play the video. It may still play elsewhere.');
    if (type === 'video/webm') warnings.push('WebM video may not play everywhere and can’t be embedded in PowerPoint files. MP4 (H.264 + AAC) is the portable choice.');
    if (typeof File !== 'undefined' && !(blob instanceof File)) blob = new Blob([blob], { type });
    else blob = file.slice(0, file.size, type);
  } else if (kind === 'captions') {
    if (file.size > LIMITS.captionsBytes) throw new AssetError('Caption files can be at most 2 MB.');
    blob = new Blob([normalizeVtt(await file.text())], { type });
  } else if (kind === 'font') {
    if (file.size > LIMITS.fontBytes) throw new AssetError('Font files can be at most 30 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = inspectFont(bytes, type);
    extra.font = info;
    blob = new Blob([bytes], { type });
    if (!info.packageable) warnings.push('This font’s license restricts embedding. You can use it here, but it won’t be included in exported files.');
  }
  if (blob.type !== type) blob = new Blob([blob], { type });
  record.byte_size = blob.size;
  record.sha256 = await sha256(blob);
  record.path = assetPath(record.id, type);
  return { record, blob, warnings, extra };
}
