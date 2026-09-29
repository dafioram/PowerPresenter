// Theme library (spec §6.4): workspace-wide themes; built-in themes too.
import { useEffect, useState } from 'preact/hooks';
import { Dialog, Button, MenuButton, promptDialog, confirmDialog, toast } from '../ui/components.jsx';
import { listLibrary, putLibraryTheme, deleteLibraryTheme } from '../../storage/repo.js';
import { BUILTIN_THEMES } from '../../core/theme.js';
import { newId } from '../../core/ids.js';
import { nowIso } from '../../core/model.js';
import { toCss } from '../../core/color.js';

export function ThemePreview({ theme }) {
  const c = theme.colors;
  return (
    <>
      <div class="theme-sample" style={{ background: toCss(c['color.background']), color: toCss(c['color.text.primary']) }}>
        <div style={{ fontWeight: 700, fontSize: '15px' }}>Aa Heading</div>
        <div style={{ fontSize: '11px', color: toCss(c['color.text.secondary']) }}>Body text sample</div>
      </div>
      <div class="theme-swatches">
        {[1, 2, 3, 4, 5, 6].map((i) => <span key={i} style={{ background: toCss(c[`color.accent.${i}`]) }} />)}
      </div>
    </>
  );
}

export function ThemeLibraryDialog({ close, onApply, currentThemeName }) {
  const [lib, setLib] = useState(null);
  const refresh = () => listLibrary().then(setLib);
  useEffect(() => {
    refresh();
  }, []);
  const entryMenu = (e) => [
    onApply && { label: 'Apply to this presentation', icon: 'check', onSelect: () => { onApply({ kind: 'library', entry: e }); close(); } },
    {
      label: 'Rename…',
      icon: 'text',
      onSelect: async () => {
        const n = await promptDialog({ title: 'Rename theme', label: 'Name', value: e.name });
        if (n && n.trim()) {
          await putLibraryTheme({ ...e, name: n.trim().slice(0, 100), theme: { ...e.theme, name: n.trim().slice(0, 100) } });
          refresh();
        }
      },
    },
    { label: 'Duplicate', icon: 'copy', onSelect: async () => { await putLibraryTheme({ ...e, id: newId(), name: `${e.name} copy`.slice(0, 100), theme: { ...e.theme, id: newId(), name: `${e.name} copy`.slice(0, 100) }, created_at: nowIso() }); refresh(); } },
    { separator: true },
    { label: 'Delete', icon: 'trash', danger: true, onSelect: async () => { if (await confirmDialog({ title: 'Delete theme?', message: `“${e.name}” will be removed from the library. Presentations that use it keep their own copy.`, confirmLabel: 'Delete', danger: true })) { await deleteLibraryTheme(e.id); refresh(); toast('Theme deleted.'); } } },
  ].filter(Boolean);
  return (
    <Dialog title="Theme library" onClose={() => close()} width={760} class="is-wide">
      <div class="stack">
        <h3 class="small muted">Built-in themes</h3>
        <div class="themes-grid">
          {BUILTIN_THEMES.map((t) => (
            <button type="button" key={t.id} class={`theme-card ${currentThemeName === t.name ? 'is-on' : ''}`} disabled={!onApply} onClick={() => { onApply?.({ kind: 'builtin', theme: t }); close(); }} aria-label={onApply ? `Apply ${t.name}` : t.name}>
              <ThemePreview theme={t} />
              <strong>{t.name}</strong>
            </button>
          ))}
        </div>
        <h3 class="small muted">Your themes</h3>
        {lib === null ? (
          <p class="muted">Loading…</p>
        ) : lib.length === 0 ? (
          <p class="muted">No saved themes yet. In the editor, open the theme editor and choose “Save to library”.</p>
        ) : (
          <div class="themes-grid">
            {lib.map((e) => (
              <div key={e.id} class="theme-card">
                <ThemePreview theme={e.theme} />
                <div class="row">
                  <strong class="grow">{e.name}</strong>
                  <MenuButton label={`Actions for ${e.name}`} icon="more" placement="bottom-end" items={entryMenu(e)} />
                </div>
                {e.fonts?.length ? <span class="muted small">{e.fonts.length} custom font{e.fonts.length === 1 ? '' : 's'}</span> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
