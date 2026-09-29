import { useState } from 'preact/hooks';
import { Dialog, Button, Checkbox } from '../ui/components.jsx';

export function ConflictDialog({ close, title, existing, multiple }) {
  const [all, setAll] = useState(false);
  return (
    <Dialog
      title="This presentation is already here"
      onClose={() => close(null)}
      width={500}
      footer={
        <>
          <Button onClick={() => close(null)}>Cancel</Button>
          <Button onClick={() => close({ choice: 'copy', applyAll: all })}>Import as copy</Button>
          <Button variant="primary" onClick={() => close({ choice: 'replace', applyAll: all })}>Replace existing</Button>
        </>
      }
    >
      <div class="stack">
        <p>
          “{title}” has the same ID as “{existing.title}”{existing.trashed_at ? ', which is in Trash' : ''}.
        </p>
        <p class="muted small">
          Replace keeps the ID and saves the current version in version history first{existing.trashed_at ? ', and restores it from Trash' : ''}. Import as copy adds a separate presentation.
        </p>
        {multiple && <Checkbox label="Apply to all" checked={all} onChange={setAll} />}
      </div>
    </Dialog>
  );
}

export function BackupRestoreDialog({ close, json, filename }) {
  const [sel, setSel] = useState(new Set(json.presentations.map((p) => p.file)));
  const [lib, setLib] = useState((json.library || []).length > 0);
  const toggle = (f) => {
    const n = new Set(sel);
    if (n.has(f)) n.delete(f);
    else n.add(f);
    setSel(n);
  };
  return (
    <Dialog
      title="Restore from backup"
      onClose={() => close(null)}
      width={560}
      footer={
        <>
          <Button onClick={() => close(null)}>Cancel</Button>
          <Button variant="primary" disabled={!sel.size && !lib} onClick={() => close({ presentations: [...sel], library: lib })}>Restore</Button>
        </>
      }
    >
      <div class="stack">
        <p class="muted small">
          {filename} · made {new Date(json.created_at).toLocaleString()} with version {json.app_version}
          {json.parts > 1 ? ` · part ${json.part} of ${json.parts}` : ''}
        </p>
        <div class="check-list">
          {json.presentations.map((p) => (
            <Checkbox key={p.file} label={`${p.title}${p.template ? ' (template)' : ''}${p.trashed ? ' (in Trash)' : ''}`} checked={sel.has(p.file)} onChange={() => toggle(p.file)} />
          ))}
          {(json.library || []).length > 0 && <Checkbox label={`Theme library (${json.library.length})`} checked={lib} onChange={setLib} />}
        </div>
      </div>
    </Dialog>
  );
}
