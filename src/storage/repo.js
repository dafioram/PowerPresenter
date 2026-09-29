// High-level local storage for presentations, assets, snapshots, trash,
// the theme library and settings (spec §9).
import { tx, reqP, get, put, del, getAll, getAllByIndex } from './db.js';
import { CURRENT_FORMAT_VERSION } from '../core/migrate.js';
import { newId } from '../core/ids.js';
import { nowIso } from '../core/model.js';
import { APP_VERSION } from '../version.js';

export const TRASH_DAYS = 30;

export function metaFromDoc(doc, extra = {}) {
  return {
    id: doc.id,
    title: doc.metadata.title,
    created_at: doc.metadata.created_at,
    updated_at: doc.metadata.updated_at,
    format_version: CURRENT_FORMAT_VERSION,
    template: false,
    trashed_at: null,
    last_backup_at: null,
    last_snapshot_at: null,
    linked_file: null,
    thumbnail_slide: null,
    ...extra,
  };
}

export async function listPresentations() {
  return getAll('presentations');
}

export async function getMeta(id) {
  return get('presentations', id);
}

export async function patchMeta(id, patch) {
  return tx(['presentations'], 'readwrite', async (t) => {
    const store = t.objectStore('presentations');
    const m = await reqP(store.get(id));
    if (!m) return null;
    const next = { ...m, ...patch };
    await reqP(store.put(next));
    return next;
  });
}

export async function loadDocument(id) {
  const rec = await get('documents', id);
  if (!rec) return null;
  return { doc: rec.doc, format_version: rec.format_version || 1 };
}

// Saves the complete post-command document atomically together with its
// metadata record (spec §9.2).
export async function saveDocument(doc, metaPatch = {}) {
  return tx(['documents', 'presentations'], 'readwrite', async (t) => {
    const ps = t.objectStore('presentations');
    const m = (await reqP(ps.get(doc.id))) || metaFromDoc(doc);
    await reqP(t.objectStore('documents').put({ id: doc.id, doc, format_version: CURRENT_FORMAT_VERSION, saved_at: nowIso() }));
    await reqP(ps.put({ ...m, title: doc.metadata.title, updated_at: doc.metadata.updated_at, format_version: CURRENT_FORMAT_VERSION, ...metaPatch }));
  });
}

export async function putAsset(presentationId, assetId, blob) {
  return put('assets', { presentation_id: presentationId, asset_id: assetId, blob, pending: false });
}

export async function getAsset(presentationId, assetId) {
  const rec = await get('assets', [presentationId, assetId]);
  return rec ? rec.blob : null;
}

export async function listAssetRecords(presentationId) {
  return getAllByIndex('assets', 'by_presentation', presentationId);
}

export async function deleteAssets(presentationId, assetIds) {
  if (!assetIds.length) return;
  return tx(['assets'], 'readwrite', async (t) => {
    const s = t.objectStore('assets');
    for (const id of assetIds) s.delete([presentationId, id]);
  });
}

// Creates a presentation with its assets. Assets are written first as pending,
// then one final transaction stores the document and makes it visible, so a
// partial presentation never appears (spec §10.4 step 10).
export async function createPresentation(doc, assets = new Map(), metaExtra = {}) {
  const importId = newId();
  for (const [assetId, blob] of assets) {
    await put('assets', { presentation_id: doc.id, asset_id: assetId, blob, pending: importId });
  }
  try {
    await tx(['documents', 'presentations', 'assets'], 'readwrite', async (t) => {
      const as = t.objectStore('assets');
      for (const assetId of assets.keys()) {
        const rec = await reqP(as.get([doc.id, assetId]));
        if (rec) as.put({ ...rec, pending: false });
      }
      t.objectStore('documents').put({ id: doc.id, doc, format_version: CURRENT_FORMAT_VERSION, saved_at: nowIso() });
      t.objectStore('presentations').put(metaFromDoc(doc, metaExtra));
    });
  } catch (e) {
    await deleteAssets(doc.id, [...assets.keys()]).catch(() => undefined);
    throw e;
  }
}

// Replaces an existing presentation's content in place (import "Replace existing").
export async function replacePresentation(doc, assets, metaPatch = {}) {
  await createPresentation(doc, assets, {});
  await patchMeta(doc.id, { trashed_at: null, ...metaPatch });
}

// Removes pending assets left over from interrupted imports.
export async function cleanupPendingAssets() {
  return tx(['assets'], 'readwrite', async (t) => {
    const s = t.objectStore('assets');
    const all = await reqP(s.getAll());
    for (const rec of all) if (rec.pending) s.delete([rec.presentation_id, rec.asset_id]);
  });
}

export async function trashPresentation(id) {
  return patchMeta(id, { trashed_at: nowIso() });
}

export async function restorePresentation(id) {
  return patchMeta(id, { trashed_at: null });
}

export async function deleteForever(id) {
  const assets = await listAssetRecords(id);
  const snaps = await getAllByIndex('snapshots', 'by_presentation', id);
  await tx(['presentations', 'documents', 'assets', 'snapshots', 'file_handles', 'editor_state'], 'readwrite', async (t) => {
    t.objectStore('presentations').delete(id);
    t.objectStore('documents').delete(id);
    for (const a of assets) t.objectStore('assets').delete([id, a.asset_id]);
    for (const s of snaps) t.objectStore('snapshots').delete(s.id);
    t.objectStore('file_handles').delete(id);
    t.objectStore('editor_state').delete(id);
  });
}

export async function purgeTrash(days = TRASH_DAYS) {
  const all = await listPresentations();
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const purged = [];
  for (const m of all) {
    if (m.trashed_at && Date.parse(m.trashed_at) < cutoff) {
      await deleteForever(m.id);
      purged.push(m.id);
    }
  }
  return purged;
}

// ---------- snapshots (spec §9.5) ----------

async function compress(str) {
  if (typeof CompressionStream === 'undefined') return { encoding: 'json', data: str };
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  return { encoding: 'gzip', data: await new Response(stream).blob() };
}

async function decompress(rec) {
  if (rec.encoding === 'gzip') {
    const stream = rec.data.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return rec.data;
}

export async function addSnapshot(presentationId, doc, { reason = 'auto', name = null, automatic = true } = {}) {
  const payload = await compress(JSON.stringify(doc));
  const rec = {
    id: newId(),
    presentation_id: presentationId,
    created_at: nowIso(),
    reason,
    name,
    automatic,
    app_version: APP_VERSION,
    format_version: CURRENT_FORMAT_VERSION,
    title: doc.metadata?.title || '',
    ...payload,
  };
  await put('snapshots', rec);
  await patchMeta(presentationId, { last_snapshot_at: rec.created_at });
  await pruneSnapshots(presentationId);
  return rec.id;
}

export async function listSnapshots(presentationId) {
  const list = await getAllByIndex('snapshots', 'by_presentation', presentationId);
  return list
    .map(({ data, ...rest }) => ({ ...rest, size: data?.size ?? data?.length ?? 0 }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function loadSnapshot(id) {
  const rec = await get('snapshots', id);
  if (!rec) return null;
  const text = await decompress(rec);
  return { doc: JSON.parse(text), format_version: rec.format_version, meta: rec };
}

export async function deleteSnapshot(id) {
  return del('snapshots', id);
}

export async function renameSnapshot(id, name) {
  const rec = await get('snapshots', id);
  if (!rec) return;
  await put('snapshots', { ...rec, name: name || null, automatic: name ? false : rec.automatic });
}

// Retention: named snapshots kept; automatic kept if among the 20 most recent,
// or the newest from each of the previous 14 days.
export function retainedSnapshotIds(list, now = Date.now()) {
  const keep = new Set();
  const autos = list.filter((s) => s.automatic).sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const s of list) if (!s.automatic) keep.add(s.id);
  autos.slice(0, 20).forEach((s) => keep.add(s.id));
  const byDay = new Map();
  for (const s of autos) {
    const t = Date.parse(s.created_at);
    if (now - t > 14 * 24 * 3600 * 1000) continue;
    const day = s.created_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, s.id);
  }
  for (const id of byDay.values()) keep.add(id);
  return keep;
}

export async function pruneSnapshots(presentationId) {
  const list = await listSnapshots(presentationId);
  const keep = retainedSnapshotIds(list);
  for (const s of list) if (!keep.has(s.id)) await del('snapshots', s.id);
}

// Documents stored in snapshots (for asset liveness, spec §8.5).
export async function snapshotDocs(presentationId) {
  const list = await getAllByIndex('snapshots', 'by_presentation', presentationId);
  const out = [];
  for (const rec of list) {
    try {
      out.push(JSON.parse(await decompress(rec)));
    } catch {
      /* skip unreadable snapshot */
    }
  }
  return out;
}

// ---------- theme library (spec §6.4) ----------

export async function listLibrary() {
  return (await getAll('library')).sort((a, b) => a.name.localeCompare(b.name));
}

export async function putLibraryTheme(entry) {
  return put('library', entry);
}

export async function deleteLibraryTheme(id) {
  return del('library', id);
}

// ---------- misc ----------

export async function getFileHandle(id) {
  return (await get('file_handles', id))?.handle || null;
}

export async function setFileHandle(id, handle) {
  if (!handle) return del('file_handles', id);
  return put('file_handles', { id, handle });
}

export async function getEditorState(id) {
  return (await get('editor_state', id)) || { id };
}

export async function setEditorState(id, state) {
  return put('editor_state', { ...state, id });
}

export async function getSetting(key, fallback = null) {
  const r = await get('meta', `setting:${key}`);
  return r ? r.value : fallback;
}

export async function setSetting(key, value) {
  return put('meta', { key: `setting:${key}`, value });
}

export async function presentationSizes() {
  const assets = await getAll('assets');
  const docs = await getAll('documents');
  const snaps = await getAll('snapshots');
  const sizes = new Map();
  const add = (id, n) => sizes.set(id, (sizes.get(id) || 0) + n);
  for (const a of assets) add(a.presentation_id, a.blob?.size || 0);
  for (const d of docs) add(d.id, JSON.stringify(d.doc).length);
  const snapSizes = new Map();
  for (const s of snaps) snapSizes.set(s.presentation_id, (snapSizes.get(s.presentation_id) || 0) + (s.data?.size ?? s.data?.length ?? 0));
  return { sizes, snapSizes };
}
