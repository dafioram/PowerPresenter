// Workspace backup and restore (spec §9.7): one ZIP containing a .pres file per
// presentation, templates, the theme library and a backup.json index. Backups
// larger than 4 GB are split into parts, so no part needs ZIP64.
import { writeZip, readCentralDirectory, extractEntry } from './zip.js';
import { exportPres, safeFilename } from './pres.js';
import { LIMITS } from '../core/limits.js';
import { APP_VERSION } from '../version.js';
import { EXT_BY_TYPE } from './sniff.js';
import { nowIso } from '../core/model.js';
import { validateTheme } from '../core/validate.js';

// items: [{ meta, doc, getAsset }]; library: [{ id, name, theme, fonts, ... }]
export async function buildBackup(items, library, { fontIds, onProgress, partBytes = LIMITS.backupPartBytes } = {}) {
  const files = []; // { name, blob, entryIndex }
  const index = [];
  let n = 0;
  for (const it of items) {
    const { blob } = await exportPres(it.doc, it.getAsset, { fontIds });
    const folder = it.meta.template ? 'templates' : 'presentations';
    const name = `${folder}/${safeFilename(`${it.doc.metadata.title}-${it.doc.id.slice(0, 8)}`, 'pres')}`;
    files.push({ name, blob });
    index.push({ id: it.doc.id, title: it.doc.metadata.title, file: name, template: !!it.meta.template, trashed: !!it.meta.trashed_at, updated_at: it.doc.metadata.updated_at });
    onProgress?.(++n / (items.length + 1));
  }
  const libFiles = [];
  const libJson = library.map((entry) => ({
    id: entry.id,
    name: entry.name,
    theme: entry.theme,
    source_height: entry.source_height || null,
    created_at: entry.created_at,
    fonts: (entry.fonts || []).map((fam) => ({
      ...fam,
      faces: fam.faces.map((f) => {
        const path = `library/fonts/${f.asset_id}.${EXT_BY_TYPE[f.media_type] || 'bin'}`;
        libFiles.push({ name: path, blob: f.blob });
        const { blob, ...rest } = f;
        return { ...rest, path };
      }),
    })),
  }));
  // split into parts under the ZIP32 limit
  const parts = [];
  let current = [];
  let size = 0;
  const all = [...files, ...libFiles];
  for (const f of all) {
    if (current.length && size + f.blob.size > partBytes) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(f);
    size += f.blob.size;
  }
  parts.push(current);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const partFiles = parts[i];
    const names = new Set(partFiles.map((f) => f.name));
    const manifest = {
      format: 'pres-backup',
      version: 1,
      app_version: APP_VERSION,
      created_at: nowIso(),
      part: i + 1,
      parts: parts.length,
      presentations: index.filter((p) => names.has(p.file)),
      library: i === 0 ? libJson : [],
    };
    const entries = [{ name: 'backup.json', data: JSON.stringify(manifest, null, 1), compress: true }, ...partFiles.map((f) => ({ name: f.name, data: f.blob, compress: false }))];
    out.push(await writeZip(entries));
  }
  return out;
}

export async function readBackupIndex(file) {
  const entries = await readCentralDirectory(file, { maxEntries: LIMITS.zipEntries });
  const idx = entries.find((e) => e.name === 'backup.json');
  if (!idx) throw new Error('This ZIP isn’t a workspace backup.');
  const json = JSON.parse(new TextDecoder().decode(await extractEntry(file, idx, { maxBytes: LIMITS.manifestBytes })));
  if (json.format !== 'pres-backup') throw new Error('This ZIP isn’t a workspace backup.');
  return { json, entries };
}

export async function extractBackupFile(file, entries, name, type = 'application/octet-stream') {
  const e = entries.find((x) => x.name === name);
  if (!e) throw new Error(`The backup is missing ${name}.`);
  return extractEntry(file, e, { maxBytes: LIMITS.packageBytes, asBlob: true, type });
}

// Library entries with their font blobs restored.
export async function readBackupLibrary(file, entries, json) {
  const out = [];
  for (const entry of json.library || []) {
    if (!validateTheme(entry.theme).ok) continue;
    const fonts = [];
    for (const fam of entry.fonts || []) {
      const faces = [];
      for (const f of fam.faces || []) {
        try {
          const blob = await extractBackupFile(file, entries, f.path, f.media_type);
          const { path, ...rest } = f;
          faces.push({ ...rest, blob });
        } catch {
          /* skip missing font */
        }
      }
      fonts.push({ ...fam, faces });
    }
    out.push({ ...entry, fonts });
  }
  return out;
}
