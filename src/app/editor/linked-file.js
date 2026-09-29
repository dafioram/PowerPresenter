// Linked .pres files (spec §9.8, Chromium): Cmd/Ctrl+S writes the whole
// package to the file the presentation is linked to.
import { exportPres, ExportBlocked } from '../../io/pres.js';
import { getFileHandle, setFileHandle, patchMeta, getMeta } from '../../storage/repo.js';
import { broadcast } from '../../storage/session.js';
import { registryFontIds } from '../../render/fonts.js';
import { nowIso } from '../../core/model.js';
import { toast, confirmDialog } from '../ui/components.jsx';
import { MOD } from '../settings.js';

export const canLinkFiles = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

async function ensurePermission(handle) {
  if (!handle.queryPermission) return true;
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function writeTo(ctl, handle) {
  const { blob, warnings } = await exportPres(ctl.doc, (id) => ctl.assets.blobAsync(id), { fontIds: registryFontIds() });
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
  let mtime = null;
  try {
    mtime = (await handle.getFile()).lastModified;
  } catch {
    /* ignore */
  }
  await patchMeta(ctl.id, { linked_file: handle.name, linked_mtime: mtime, last_backup_at: nowIso() });
  ctl.set({ linkedFile: handle.name }, 'status');
  broadcast({ type: 'workspace-changed' });
  for (const m of warnings) toast(m, { kind: 'info', duration: 8000 });
}

export async function saveAsLinkedFile(ctl) {
  if (!canLinkFiles) return false;
  let handle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: `${(ctl.doc.metadata.title || 'presentation').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'presentation'}.pres`,
      types: [{ description: 'Presentation', accept: { 'application/x-presentation-editor': ['.pres'] } }],
    });
  } catch {
    return false; // cancelled
  }
  try {
    await ctl.session?.flush();
    await writeTo(ctl, handle);
    await setFileHandle(ctl.id, handle);
    toast(`Saved to ${handle.name}. ${MOD}+S saves to this file from now on.`, { kind: 'success' });
    return true;
  } catch (e) {
    toast(e instanceof ExportBlocked ? 'This presentation has errors that block saving to a file. Open Export to see them.' : `Couldn’t save the file: ${e.message}`, { kind: 'error', duration: 8000 });
    return false;
  }
}

// Cmd/Ctrl+S: flush the local save, then write the linked file if there is one.
export async function saveNow(ctl) {
  await ctl.session?.flush();
  const handle = canLinkFiles ? await getFileHandle(ctl.id).catch(() => null) : null;
  if (!handle || typeof handle.createWritable !== 'function') {
    toast(canLinkFiles ? 'Saved in this browser. Use “Save to file…” to also keep a .pres file on disk.' : 'Saved in this browser. Use Export or a workspace backup to keep a copy on disk.', { kind: 'success', id: 'save-now' });
    return;
  }
  try {
    if (!(await ensurePermission(handle))) {
      toast('Permission to write the linked file was denied. Saved in this browser only.', { kind: 'info' });
      return;
    }
    const meta = await getMeta(ctl.id);
    let changed = false;
    try {
      const f = await handle.getFile();
      changed = meta?.linked_mtime && f.lastModified !== meta.linked_mtime;
    } catch {
      /* file removed: write a fresh copy */
    }
    if (changed) {
      const choice = await confirmDialog({
        title: 'The file changed on disk',
        message: `“${handle.name}” was changed outside this app since you last saved it here.`,
        confirmLabel: 'Overwrite',
        extra: { label: 'Save as copy…', value: 'copy' },
      });
      if (choice === 'copy') {
        await saveAsLinkedFile(ctl);
        return;
      }
      if (choice !== true) return;
    }
    await writeTo(ctl, handle);
    toast(`Saved to ${handle.name}.`, { kind: 'success', id: 'save-now' });
  } catch (e) {
    toast(e instanceof ExportBlocked ? 'This presentation has errors that block saving to a file. Open Export to see them.' : `Couldn’t write the linked file: ${e.message}`, { kind: 'error', duration: 8000 });
  }
}
