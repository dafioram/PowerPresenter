// Importing .pres files and workspace backups (spec §10.4–10.6, §9.7).
import { importPres, isBackupZip, ImportError } from '../io/pres.js';
import { readBackupIndex, extractBackupFile, readBackupLibrary } from '../io/backup.js';
import { createPresentation, getMeta, loadDocument, addSnapshot, replacePresentation, putLibraryTheme, patchMeta } from '../storage/repo.js';
import { withPresentationLock, broadcast } from '../storage/session.js';
import { registryFontIds } from '../render/fonts.js';
import { newId } from '../core/ids.js';
import { nowIso } from '../core/model.js';
import { toast, dismissToast, openDialog } from './ui/components.jsx';
import { ConflictDialog, BackupRestoreDialog } from './dialogs/ImportDialogs.jsx';

async function commit(result, { choice, template = false, trashed = false }) {
  const { doc, assets } = result;
  const existing = await getMeta(doc.id);
  if (existing && choice === 'copy') {
    doc.id = newId();
    doc.metadata.title = `${doc.metadata.title} (imported)`.slice(0, 200);
    doc.metadata.updated_at = nowIso();
    await createPresentation(doc, assets, { template, trashed_at: trashed ? nowIso() : null });
    return doc.id;
  }
  if (existing && choice === 'replace') {
    await withPresentationLock(doc.id, async () => {
      const old = await loadDocument(doc.id);
      if (old) await addSnapshot(doc.id, old.doc, { reason: 'Before replacing with an imported file', automatic: true });
      await replacePresentation(doc, assets, { template: existing.template });
    });
    return doc.id;
  }
  await createPresentation(doc, assets, { template, trashed_at: trashed ? nowIso() : null });
  return doc.id;
}

async function importOne(file, state) {
  const tid = toast(`Importing ${file.name}…`, { duration: 0 });
  try {
    const result = await importPres(file, { fontIds: registryFontIds() });
    dismissToast(tid);
    const existing = await getMeta(result.doc.id);
    let choice = 'new';
    if (existing) {
      if (state.applyAll) choice = state.applyAll;
      else {
        const r = await openDialog(ConflictDialog, { title: result.doc.metadata.title, existing, multiple: state.total > 1 });
        if (!r) return null;
        choice = r.choice;
        if (r.applyAll) state.applyAll = r.choice;
      }
    }
    const id = await commit(result, { choice });
    for (const w of result.warnings) toast(w, { kind: 'info', duration: 8000 });
    return id;
  } catch (e) {
    dismissToast(tid);
    const msg = e instanceof ImportError ? e.message : `Import failed: ${e.message}`;
    toast(`${file.name}: ${msg}`, { kind: 'error', duration: 12000 });
    return null;
  }
}

async function restoreBackup(file, state) {
  let index;
  try {
    index = await readBackupIndex(file);
  } catch (e) {
    toast(`${file.name}: ${e.message}`, { kind: 'error' });
    return [];
  }
  const selection = await openDialog(BackupRestoreDialog, { json: index.json, filename: file.name });
  if (!selection) return [];
  const ids = [];
  for (const p of index.json.presentations.filter((x) => selection.presentations.includes(x.file))) {
    try {
      const blob = await extractBackupFile(file, index.entries, p.file, 'application/zip');
      const result = await importPres(blob, { fontIds: registryFontIds() });
      const existing = await getMeta(result.doc.id);
      let choice = 'new';
      if (existing) {
        if (state.applyAll) choice = state.applyAll;
        else {
          const r = await openDialog(ConflictDialog, { title: result.doc.metadata.title, existing, multiple: true });
          if (!r) continue;
          choice = r.choice;
          if (r.applyAll) state.applyAll = r.choice;
        }
      }
      const id = await commit(result, { choice, template: p.template, trashed: p.trashed });
      if (p.template) await patchMeta(id, { template: true });
      ids.push(id);
    } catch (e) {
      toast(`${p.title}: ${e.message}`, { kind: 'error', duration: 10000 });
    }
  }
  if (selection.library) {
    const lib = await readBackupLibrary(file, index.entries, index.json);
    for (const entry of lib) await putLibraryTheme(entry);
    if (lib.length) toast(`Restored ${lib.length} library theme${lib.length === 1 ? '' : 's'}.`, { kind: 'success' });
  }
  if (ids.length) toast(`Restored ${ids.length} presentation${ids.length === 1 ? '' : 's'}.`, { kind: 'success' });
  return ids;
}

// Imports any mix of .pres files and backup ZIPs. Returns imported ids.
export async function importFiles(files, { openSingle } = {}) {
  const state = { applyAll: null, total: files.length };
  const ids = [];
  let backups = 0;
  for (const file of files) {
    if (await isBackupZip(file)) {
      backups++;
      ids.push(...(await restoreBackup(file, state)));
    } else {
      const id = await importOne(file, state);
      if (id) ids.push(id);
    }
  }
  broadcast({ type: 'workspace-changed' });
  if (ids.length === 1 && files.length === 1 && !backups && openSingle) openSingle(ids[0]);
  return ids;
}
