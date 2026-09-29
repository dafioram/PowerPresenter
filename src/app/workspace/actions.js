// Workspace actions on stored presentations (spec §9, §11).
import { createPresentation, loadDocument, listAssetRecords, getMeta, patchMeta, listPresentations, listLibrary, getSetting, setSetting } from '../../storage/repo.js';
import { broadcast } from '../../storage/session.js';
import { newPresentation } from '../../core/factory.js';
import { newId } from '../../core/ids.js';
import { nowIso } from '../../core/model.js';
import { normalizeDocument } from '../../core/canonical.js';
import { exportPres } from '../../io/pres.js';
import { buildBackup } from '../../io/backup.js';
import { registryFontIds } from '../../render/fonts.js';
import { downloadBlob } from '../download.js';
import { toast } from '../ui/components.jsx';
import { BUILTIN_TEMPLATES } from '../../samples/templates.js';

export async function requestPersistence({ force = false } = {}) {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    const asked = await getSetting('persistRequested', false);
    if (asked && !force) return false;
    await setSetting('persistRequested', true);
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

// Never awaited on the create path: Firefox answers persist() only after the
// user responds to a permission prompt, which would otherwise keep the new
// presentation from opening.
function requestPersistenceInBackground() {
  requestPersistence().catch(() => false);
}

export async function createBlank({ title = 'Untitled presentation', size, themeId = 'harbor' } = {}) {
  const doc = newPresentation({ title, themeId, ...(size || {}) });
  await createPresentation(doc, new Map());
  requestPersistenceInBackground();
  broadcast({ type: 'workspace-changed' });
  return doc.id;
}

export async function createFromBuiltinTemplate(templateId) {
  const t = BUILTIN_TEMPLATES.find((x) => x.id === templateId);
  const { doc, assets } = await t.make();
  await createPresentation(doc, assets);
  requestPersistenceInBackground();
  broadcast({ type: 'workspace-changed' });
  return doc.id;
}

async function assetsOf(id) {
  const recs = await listAssetRecords(id);
  return new Map(recs.filter((r) => !r.pending).map((r) => [r.asset_id, r.blob]));
}

// Copies a presentation with a new ID, keeping internal IDs (spec §5.2).
export async function duplicatePresentation(id, { asTemplate = false, title } = {}) {
  const rec = await loadDocument(id);
  if (!rec) throw new Error('Presentation not found.');
  const doc = normalizeDocument(rec.doc);
  doc.id = newId();
  doc.metadata.title = (title || `${doc.metadata.title} (copy)`).slice(0, 200);
  doc.metadata.created_at = nowIso();
  doc.metadata.updated_at = nowIso();
  await createPresentation(doc, await assetsOf(id), { template: asTemplate });
  broadcast({ type: 'workspace-changed' });
  return doc.id;
}

// New presentation from a user template: an independent copy with a new ID.
export async function createFromUserTemplate(id) {
  const m = await getMeta(id);
  return duplicatePresentation(id, { title: m?.title?.replace(/ \(template\)$/, '') || 'Untitled presentation' });
}

export async function exportPresentationFile(id) {
  const rec = await loadDocument(id);
  const assets = await assetsOf(id);
  const { blob, filename, warnings } = await exportPres(normalizeDocument(rec.doc), async (aid) => assets.get(aid), { fontIds: registryFontIds() });
  downloadBlob(blob, filename);
  await patchMeta(id, { last_backup_at: nowIso() });
  for (const w of warnings) toast(w, { kind: 'info', duration: 8000 });
  broadcast({ type: 'workspace-changed' });
}

export async function backupEverything({ includeTrashed = false } = {}) {
  const metas = (await listPresentations()).filter((m) => includeTrashed || !m.trashed_at);
  const items = [];
  for (const m of metas) {
    const rec = await loadDocument(m.id);
    if (!rec) continue;
    const assets = await assetsOf(m.id);
    items.push({ meta: m, doc: normalizeDocument(rec.doc), getAsset: async (aid) => assets.get(aid) });
  }
  const library = await listLibrary();
  const parts = await buildBackup(items, library, { fontIds: registryFontIds() });
  const stamp = new Date().toISOString().slice(0, 10);
  parts.forEach((blob, i) => downloadBlob(blob, parts.length > 1 ? `presentations-backup-${stamp}-part-${i + 1}.zip` : `presentations-backup-${stamp}.zip`));
  const now = nowIso();
  for (const m of metas) await patchMeta(m.id, { last_backup_at: now });
  await setSetting('lastWorkspaceBackup', now);
  broadcast({ type: 'workspace-changed' });
  return { count: items.length, parts: parts.length };
}

export { BUILTIN_TEMPLATES };
