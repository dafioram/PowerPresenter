// The .pres format: export and the import pipeline (spec §10).
import { readCentralDirectory, extractEntry, checkPath, writeZip, ZipError } from './zip.js';
import { validateDocument, validateEnvelope, formatErrors } from '../core/validate.js';
import { canonicalize, normalizeDocument } from '../core/canonical.js';
import { migrateDocument, CURRENT_FORMAT_VERSION, NewerVersionError } from '../core/migrate.js';
import { referencedAssetIds } from '../core/model.js';
import { LIMITS } from '../core/limits.js';
import { APP_VERSION } from '../version.js';
import { sha256 } from './hash.js';
import { sniffBlob, COMPRESSED_TYPES, imageSizeFromBytes, EXT_BY_TYPE } from './sniff.js';
import { sanitizeSvg } from './svg-sanitize.js';
import { normalizeVtt } from './webvtt.js';
import { inspectFont } from './font-inspect.js';
import { nowIso } from '../core/model.js';

export class ImportError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ImportError';
    this.details = details;
  }
}

export class ExportBlocked extends Error {
  constructor(errors) {
    super('The presentation has problems that block export:\n' + formatErrors(errors));
    this.errors = errors;
  }
}

export function safeFilename(title, ext) {
  let base = String(title || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 100)
    .trim();
  if (!base) base = 'Untitled';
  return `${base}.${ext}`;
}

// Prepares the document that goes into a package: canonical form, only
// referenced assets, restricted fonts left out (spec §7.2, §10.3).
export function packageDocument(doc) {
  const warnings = [];
  const out = canonicalize(doc);
  for (const fam of out.fonts || []) {
    if (fam.restricted && fam.faces.length) {
      warnings.push(`The font “${fam.family_name}” restricts embedding, so it isn’t included. Recipients will see ${fam.fallback || 'the fallback font'}.`);
      fam.faces = [];
    }
  }
  const refs = referencedAssetIds(out);
  out.assets = (out.assets || []).filter((a) => refs.has(a.id));
  return { doc: out, warnings };
}

// Returns { blob, filename, warnings }.
export async function exportPres(doc, getAssetBlob, { fontIds = null, onProgress } = {}) {
  const v = validateDocument(doc, { fontIds });
  if (!v.ok) throw new ExportBlocked(v.errors);
  const { doc: out, warnings } = packageDocument(doc);
  const envelope = { format: 'pres', format_version: CURRENT_FORMAT_VERSION, created_with: APP_VERSION, exported_at: nowIso(), document: out };
  const entries = [{ name: 'manifest.json', data: JSON.stringify(envelope), compress: true }];
  for (const a of out.assets) {
    const blob = await getAssetBlob(a.id);
    if (!blob) throw new ExportBlocked([{ path: `assets.${a.id}`, message: 'the file for this asset is missing from local storage' }]);
    entries.push({ name: a.path, data: blob, compress: !COMPRESSED_TYPES.has(a.media_type) });
  }
  const blob = await writeZip(entries, { onProgress });
  if (blob.size > LIMITS.packageBytes) throw new ExportBlocked([{ path: '', message: 'the package would be larger than 2 GB' }]);
  return { blob: new Blob([blob], { type: 'application/x-presentation-editor' }), filename: safeFilename(doc.metadata.title, 'pres'), warnings };
}

// The import pipeline (spec §10.4). Nothing is stored here; the caller commits
// the result atomically. Returns { doc, assets: Map<id, Blob>, warnings, formatVersion }.
export async function importPres(file, { fontIds = null, onProgress = () => {}, limits = LIMITS, signal } = {}) {
  const warnings = [];
  const check = () => {
    if (signal?.aborted) throw new ImportError('Import cancelled.');
  };
  if (file.size > limits.packageBytes) throw new ImportError('The package is larger than 2 GB.');
  // 1. readable ZIP, entry count, declared sizes, path rules
  let entries;
  try {
    entries = await readCentralDirectory(file, { maxEntries: limits.zipEntries });
  } catch (e) {
    throw new ImportError(e instanceof ZipError ? e.message : 'The file isn’t a readable .pres package.');
  }
  let declaredTotal = 0;
  const names = new Set();
  for (const e of entries) {
    const bad = checkPath(e.name);
    if (bad) throw new ImportError(`The package entry "${e.name.slice(0, 80)}" ${bad}.`);
    if (e.isSymlink) throw new ImportError(`The package contains a symbolic link ("${e.name}").`);
    if (names.has(e.name)) throw new ImportError(`The package contains "${e.name}" twice.`);
    names.add(e.name);
    if (e.isDir) {
      if (e.name !== 'assets/') throw new ImportError(`The package contains an unexpected folder "${e.name}".`);
      continue;
    }
    if (e.name !== 'manifest.json' && !/^assets\/[^/]+$/.test(e.name)) throw new ImportError(`The package contains an unexpected file "${e.name}".`);
    declaredTotal += e.size;
    if (e.size > limits.compressionRatioMinBytes && e.compSize > 0 && e.size / e.compSize > limits.compressionRatio) {
      throw new ImportError(`"${e.name}" is compressed suspiciously well (possible zip bomb).`);
    }
  }
  if (declaredTotal > limits.packageBytes) throw new ImportError('The package expands to more than 2 GB.');
  onProgress(0.05);
  check();
  // 2. manifest
  const manEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manEntry) throw new ImportError('The package has no manifest.json.');
  if (manEntry.size > limits.manifestBytes) throw new ImportError('manifest.json is larger than 50 MB.');
  let envelope;
  try {
    const bytes = await extractEntry(file, manEntry, { maxBytes: limits.manifestBytes });
    envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) {
    throw new ImportError(e instanceof ZipError ? e.message : 'manifest.json isn’t valid JSON.');
  }
  // 3. format and version
  if (!envelope || envelope.format !== 'pres') throw new ImportError('This isn’t a .pres presentation.');
  if (!Number.isInteger(envelope.format_version) || envelope.format_version < 1) throw new ImportError('The package has an invalid format version.');
  if (envelope.format_version > CURRENT_FORMAT_VERSION) throw new ImportError(new NewerVersionError(envelope.format_version).message, { newer: true });
  const envCheck = validateEnvelope(envelope);
  if (!envCheck.ok) throw new ImportError('The package envelope is invalid:\n' + formatErrors(envCheck.errors), envCheck.errors);
  const rawDoc = envelope.document;
  if (!rawDoc || typeof rawDoc !== 'object' || !Array.isArray(rawDoc.assets ?? [])) throw new ImportError('The package document is missing or malformed.');
  onProgress(0.1);
  // 4. package paths and asset references
  const records = rawDoc.assets || [];
  const byPath = new Map(entries.filter((e) => !e.isDir).map((e) => [e.name, e]));
  const recordPaths = new Set();
  for (const a of records) {
    if (!a || typeof a.path !== 'string' || typeof a.id !== 'string') throw new ImportError('An asset record is malformed.');
    if (a.path !== `assets/${a.id}.${EXT_BY_TYPE[a.media_type] || ''}`) throw new ImportError(`Asset "${a.id}" has an unexpected path.`);
    if (!byPath.has(a.path)) throw new ImportError(`The package is missing the file for asset "${a.id}".`);
    recordPaths.add(a.path);
  }
  for (const name of byPath.keys()) {
    if (name !== 'manifest.json' && !recordPaths.has(name)) warnings.push(`Ignored an extra file in the package: ${name}`);
  }
  // 5. decompress assets, counting actual bytes; verify hashes
  const assets = new Map();
  let doneBytes = 0;
  let videoTotal = 0;
  const kindLimit = { image: limits.imageBytes, svg: limits.svgBytes, video: limits.videoBytes, captions: limits.captionsBytes, font: limits.fontBytes };
  for (const a of records) {
    check();
    const e = byPath.get(a.path);
    const max = kindLimit[a.kind] ?? limits.imageBytes;
    if (e.size > max) throw new ImportError(`Asset "${a.original_filename || a.id}" is larger than allowed for its kind.`);
    let blob;
    try {
      blob = await extractEntry(file, e, { maxBytes: max, asBlob: true, type: a.media_type });
    } catch (err) {
      throw new ImportError(err.message);
    }
    if (a.kind === 'video') {
      videoTotal += blob.size;
      if (videoTotal > limits.videoTotalBytes) throw new ImportError('The presentation contains more than 2 GB of video.');
    }
    const hash = await sha256(blob);
    if (hash !== a.sha256) throw new ImportError(`Asset "${a.original_filename || a.id}" doesn’t match its recorded checksum.`);
    if (blob.size !== a.byte_size) throw new ImportError(`Asset "${a.original_filename || a.id}" doesn’t match its recorded size.`);
    assets.set(a.id, blob);
    doneBytes += blob.size;
    onProgress(0.1 + 0.6 * (doneBytes / Math.max(1, declaredTotal)));
  }
  // 6. migrate
  let doc;
  try {
    doc = migrateDocument(rawDoc, envelope.format_version);
  } catch (e) {
    throw new ImportError(e.message);
  }
  doc = normalizeDocument(doc);
  onProgress(0.75);
  // 7. validate (schema + semantic rules)
  const v = validateDocument(doc, { fontIds });
  if (!v.ok) throw new ImportError('The presentation data is invalid:\n' + formatErrors(v.errors), v.errors);
  // 8. clean and check content
  for (const a of doc.assets) {
    check();
    let blob = assets.get(a.id);
    const sn = await sniffBlob(blob);
    if (!sn || sn.rejected || sn.type !== a.media_type) throw new ImportError(`Asset "${a.original_filename || a.id}" isn’t the file type it claims to be.`);
    if (a.kind === 'image') {
      const size = imageSizeFromBytes(new Uint8Array(await blob.slice(0, 512 * 1024).arrayBuffer()), a.media_type);
      if (size && size.width * size.height > limits.imagePixels) throw new ImportError(`Image "${a.original_filename || a.id}" has more than 100 megapixels.`);
    }
    if (a.kind === 'svg' || a.kind === 'captions') {
      let text;
      try {
        text = a.kind === 'svg' ? sanitizeSvg(await blob.text()).svg : normalizeVtt(await blob.text());
      } catch (e) {
        throw new ImportError(`Asset "${a.original_filename || a.id}": ${e.message}`);
      }
      const nb = new Blob([text], { type: a.media_type });
      if (nb.size !== blob.size || (await sha256(nb)) !== a.sha256) {
        blob = nb;
        a.byte_size = nb.size;
        a.sha256 = await sha256(nb);
        warnings.push(`Cleaned up ${a.kind === 'svg' ? 'SVG' : 'caption'} file ${a.original_filename || a.id}.`);
      }
      assets.set(a.id, blob);
    }
    if (a.kind === 'font') {
      const info = inspectFont(new Uint8Array(await blob.arrayBuffer()), a.media_type);
      if (!info.packageable) {
        for (const fam of doc.fonts) {
          if (fam.faces.some((f) => f.asset_id === a.id)) {
            fam.faces = fam.faces.filter((f) => f.asset_id !== a.id);
            fam.restricted = true;
          }
        }
        assets.delete(a.id);
        warnings.push(`Left out a font whose license restricts embedding (${a.original_filename || a.id}).`);
      }
    }
  }
  doc.assets = doc.assets.filter((a) => assets.has(a.id));
  const v2 = validateDocument(doc, { fontIds });
  if (!v2.ok) throw new ImportError('The presentation data is invalid:\n' + formatErrors(v2.errors), v2.errors);
  onProgress(1);
  return { doc, assets, warnings, formatVersion: envelope.format_version };
}

export async function isBackupZip(file) {
  try {
    const entries = await readCentralDirectory(file, { maxEntries: LIMITS.zipEntries });
    return entries.some((e) => e.name === 'backup.json');
  } catch {
    return false;
  }
}
