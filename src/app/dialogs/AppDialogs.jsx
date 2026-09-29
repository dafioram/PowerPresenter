// App-level dialogs: settings, shortcuts, about, storage, templates, welcome.
import { useEffect, useState } from 'preact/hooks';
import { Dialog, Button, Checkbox, Select, useSignal, toast } from '../ui/components.jsx';
import { Icon } from '../ui/icons.jsx';
import { settings, updateSettings, shortcut } from '../settings.js';
import { APP_VERSION } from '../../version.js';
import { LIMITS } from '../../core/limits.js';
import { formatBytes, relativeTime } from '../download.js';
import { listPresentations, presentationSizes, purgeTrash } from '../../storage/repo.js';
import { fontRegistry } from '../../render/fonts.js';
import { requestPersistence, BUILTIN_TEMPLATES } from '../workspace/actions.js';
import { SIZE_PRESETS } from '../../core/units.js';
import { BUILTIN_THEMES } from '../../core/theme.js';

export function SettingsDialog({ close }) {
  const s = useSignal(settings);
  const [downloading, setDownloading] = useState(null);
  const downloadFonts = async () => {
    const faces = fontRegistry().filter((f) => f.onDemand).flatMap((f) => f.faces);
    setDownloading(0);
    let n = 0;
    for (const face of faces) {
      try {
        await fetch(`./${face.file}`);
      } catch {
        /* offline: skip */
      }
      n++;
      if (n % 10 === 0) setDownloading(n / faces.length);
    }
    setDownloading(null);
    toast('All fonts are available offline.', { kind: 'success' });
  };
  return (
    <Dialog title="Settings" onClose={() => close()} width={520} footer={<Button variant="primary" onClick={() => close()}>Done</Button>}>
      <div class="stack">
        <Select label="Measurement units" value={s.measure} onChange={(v) => updateSettings({ measure: v })} options={[{ value: 'units', label: 'Units (1/96 in, like pixels)' }, { value: 'in', label: 'Inches' }, { value: 'cm', label: 'Centimeters' }]} />
        <Checkbox label="Snap to guides and elements by default" checked={s.snap} onChange={(v) => updateSettings({ snap: v })} />
        <Checkbox label="Remove photo metadata (location, camera) when adding images" checked={s.stripMetadata} onChange={(v) => updateSettings({ stripMetadata: v })} />
        <Checkbox label="Remind me to back up" checked={s.backupReminders} onChange={(v) => updateSettings({ backupReminders: v })} />
        <Select label="Appearance" value={s.colorScheme} onChange={(v) => updateSettings({ colorScheme: v })} options={[{ value: 'system', label: 'Match system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        <div class="field">
          <span class="field-label">Fonts for other scripts</span>
          <div class="row">
            <Button icon="download" onClick={downloadFonts} disabled={downloading !== null}>{downloading !== null ? `Downloading… ${Math.round(downloading * 100)}%` : 'Download all fonts'}</Button>
          </div>
          <span class="field-hint">Arabic, Hebrew, Devanagari, Thai, Chinese, Japanese and Korean fonts download the first time they’re needed. Download them now to use them offline.</span>
        </div>
      </div>
    </Dialog>
  );
}

const SHORTCUTS = [
  ['Undo / redo', 'Mod+Z / Mod+Shift+Z'],
  ['Copy / cut / paste', 'Mod+C / Mod+X / Mod+V'],
  ['Paste as plain text', 'Mod+Shift+V'],
  ['Duplicate', 'Mod+D'],
  ['Group / ungroup', 'Mod+G / Mod+Shift+G'],
  ['Bring forward / to front', 'Mod+] / Mod+Shift+]'],
  ['Send backward / to back', 'Mod+[ / Mod+Shift+['],
  ['Bold / italic / underline', 'Mod+B / Mod+I / Mod+U'],
  ['Insert or edit link', 'Mod+K'],
  ['New slide', 'Ctrl+M'],
  ['Find / replace', 'Mod+F / Mod+Shift+H'],
  ['Save now', 'Mod+S'],
  ['Export PDF', 'Mod+P'],
  ['Present from current slide / from beginning', 'Mod+Enter / Mod+Shift+Enter'],
  ['Present (PowerPoint keys)', 'F5 / Shift+F5'],
  ['Copy / apply formatting', 'Mod+Alt+C / Mod+Alt+V'],
  ['Move 1 unit / 10 units', 'Arrows / Shift+Arrows'],
  ['Resize by 1 unit', 'Mod+Alt+Arrows'],
  ['Cycle selection', 'Tab / Shift+Tab'],
  ['Edit text or enter group', 'Enter'],
  ['Select all', 'Mod+A'],
  ['Shortcut reference', 'Mod+/'],
];

const PRESENT_KEYS = [
  ['Next', '→ ↓ Space PageDown Enter N'],
  ['Previous', '← ↑ PageUp Backspace P'],
  ['First / last slide', 'Home / End'],
  ['Go to slide', 'Number, then Enter'],
  ['Overview', 'G'],
  ['Black / white screen', 'B or . / W or ,'],
  ['Fullscreen', 'F'],
  ['Presenter view', 'S'],
  ['Laser pointer', 'L'],
  ['Exit', 'Esc'],
];

export function ShortcutsDialog({ close }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={() => close()} width={620}>
      <h3 class="small muted" style={{ margin: '4px 0 6px' }}>Editing</h3>
      <table class="shortcut-table">
        <tbody>
          {SHORTCUTS.map(([a, k]) => (
            <tr key={a}>
              <td>{a}</td>
              <td><span class="kbd">{shortcut(k)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 class="small muted" style={{ margin: '16px 0 6px' }}>Presenting</h3>
      <table class="shortcut-table">
        <tbody>
          {PRESENT_KEYS.map(([a, k]) => (
            <tr key={a}>
              <td>{a}</td>
              <td><span class="kbd">{k}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

export function AboutDialog({ close }) {
  const rows = [
    ['Package size', formatBytes(LIMITS.packageBytes)],
    ['Slides per presentation', LIMITS.slides.toLocaleString()],
    ['Elements per slide', LIMITS.elementsPerSlide.toLocaleString()],
    ['Image file', `${formatBytes(LIMITS.imageBytes)}, 100 megapixels`],
    ['Video file', `${formatBytes(LIMITS.videoBytes)} (2 GB per presentation)`],
    ['Table', `${LIMITS.tableRows} rows × ${LIMITS.tableColumns} columns`],
    ['Chart', `${LIMITS.chartSeries} series, ${LIMITS.chartPoints.toLocaleString()} points each`],
    ['Single-file HTML export', formatBytes(LIMITS.htmlSingleFileBytes)],
  ];
  const support = [
    ['Editor', 'Chrome, Edge, Firefox, Safari (tablets best effort)'],
    ['PDF export', 'Chrome, Edge, Firefox'],
    ['Image export', 'Chrome, Edge, Firefox'],
    ['Linked files, open by double-click', 'Chrome, Edge'],
    ['Presenting and exported HTML', 'All current browsers, including phones'],
  ];
  return (
    <Dialog title="About Presentation Editor" onClose={() => close()} width={560}>
      <div class="stack">
        <p>Version {APP_VERSION} · file format version 1</p>
        <p class="muted">Your presentations are stored only in this browser on this device. Nothing is uploaded. Export backups to keep them safe.</p>
        <h3 class="small muted">Limits</h3>
        <table class="table-list">
          <tbody>{rows.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody>
        </table>
        <h3 class="small muted">Browser support</h3>
        <table class="table-list">
          <tbody>{support.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody>
        </table>
        <p class="muted small">Bundled fonts are licensed under the SIL Open Font License.</p>
      </div>
    </Dialog>
  );
}

export function StorageDialog({ close }) {
  const [info, setInfo] = useState(null);
  const refresh = async () => {
    let estimate = null;
    let persisted = null;
    try {
      estimate = await navigator.storage?.estimate?.();
      persisted = await navigator.storage?.persisted?.();
    } catch {
      /* unsupported */
    }
    const metas = await listPresentations();
    const { sizes, snapSizes } = await presentationSizes();
    setInfo({ estimate, persisted, metas, sizes, snapSizes });
  };
  useEffect(() => {
    refresh();
  }, []);
  const trashSize = info ? info.metas.filter((m) => m.trashed_at).reduce((n, m) => n + (info.sizes.get(m.id) || 0), 0) : 0;
  return (
    <Dialog title="Storage" onClose={() => close()} width={640}>
      {!info ? (
        <p class="muted">Loading…</p>
      ) : (
        <div class="stack">
          {info.estimate && (
            <div class="stack">
              <div class="row"><strong>{formatBytes(info.estimate.usage)}</strong><span class="muted">used of about {formatBytes(info.estimate.quota)} available to this site</span></div>
              <div class="storage-bar"><div style={{ width: `${Math.min(100, (info.estimate.usage / info.estimate.quota) * 100 || 0)}%` }} /></div>
            </div>
          )}
          <div class={`ws-notice ${info.persisted ? 'is-info' : ''}`}>
            <Icon name={info.persisted ? 'check' : 'alert'} />
            <div class="stack">
              <span>{info.persisted ? 'Storage is persistent: the browser won’t delete it to free space.' : 'Storage isn’t persistent yet, so the browser may delete it when space runs low or if you don’t use the app for a while.'}</span>
              {!info.persisted && (
                <div><Button class="btn-sm" onClick={async () => { const ok = await requestPersistence({ force: true }); toast(ok ? 'Storage is now persistent.' : 'The browser didn’t grant persistent storage. Keep regular backups.', { kind: ok ? 'success' : 'info' }); refresh(); }}>Request persistent storage</Button></div>
              )}
            </div>
          </div>
          <p class="muted small">Presentations exist only in this browser on this device. Clearing site data, private browsing, uninstalling the app or browser eviction deletes them. Some browsers remove data from sites that haven’t been used for a while. Regular backups are the only protection.</p>
          <table class="table-list">
            <thead><tr><th>Presentation</th><th>Size</th><th>Versions</th><th>Last backup</th></tr></thead>
            <tbody>
              {info.metas.filter((m) => !m.trashed_at).map((m) => (
                <tr key={m.id}><td>{m.title}{m.template ? ' (template)' : ''}</td><td>{formatBytes(info.sizes.get(m.id) || 0)}</td><td>{formatBytes(info.snapSizes.get(m.id) || 0)}</td><td>{relativeTime(m.last_backup_at)}</td></tr>
              ))}
            </tbody>
          </table>
          <div class="row">
            <span>Trash: {formatBytes(trashSize)}</span>
            <span class="spacer" />
            <Button class="btn-sm" onClick={async () => { const n = await purgeTrash(-1); toast(n.length ? `Emptied trash (${n.length}).` : 'Trash is empty.'); refresh(); }}>Empty trash</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function NewPresentationDialog({ close, userTemplates = [] }) {
  const [size, setSize] = useState('16:9');
  const [theme, setTheme] = useState('harbor');
  return (
    <Dialog
      title="New presentation"
      onClose={() => close(null)}
      width={720}
      class="is-wide"
      footer={
        <>
          <Button onClick={() => close(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => close({ kind: 'blank', size, theme })} data-autofocus>Create blank</Button>
        </>
      }
    >
      <div class="stack">
        <div class="insp-grid">
          <Select label="Slide size" value={size} onChange={setSize} options={SIZE_PRESETS.map((p) => ({ value: p.id, label: `${p.label}` }))} />
          <Select label="Theme" value={theme} onChange={setTheme} options={BUILTIN_THEMES.map((t) => ({ value: t.id, label: t.name }))} />
        </div>
        <h3 class="small muted">Or start from a template</h3>
        <div class="layout-grid">
          {BUILTIN_TEMPLATES.map((t) => (
            <button type="button" key={t.id} class="layout-card" onClick={() => close({ kind: 'builtin', id: t.id })}>
              <div class="lc-thumb" style={{ background: themeBg(t.themeId) }}>
                <span style={{ position: 'absolute', left: '10%', top: '38%', right: '10%', height: '12%', borderRadius: '3px', background: themeAccent(t.themeId) }} />
              </div>
              <strong>{t.name}</strong>
              <span class="muted small">{t.description}</span>
            </button>
          ))}
          {userTemplates.map((m) => (
            <button type="button" key={m.id} class="layout-card" onClick={() => close({ kind: 'user', id: m.id })}>
              <div class="lc-thumb"><Icon name="star" /></div>
              <strong>{m.title}</strong>
              <span class="muted small">Your template</span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function themeBg(id) {
  return BUILTIN_THEMES.find((t) => t.id === id)?.colors['color.background'] || '#fff';
}
function themeAccent(id) {
  return BUILTIN_THEMES.find((t) => t.id === id)?.colors['color.accent.1'] || '#4f46e5';
}

export function WelcomeDialog({ close }) {
  return (
    <Dialog
      title="Welcome to Presentation Editor"
      onClose={() => close(false)}
      width={560}
      footer={
        <>
          <Button onClick={() => close(false)}>Skip</Button>
          <Button variant="primary" onClick={() => close(true)} data-autofocus>Open the Getting started deck</Button>
        </>
      }
    >
      <div class="stack">
        <p>Everything you create is stored <strong>only in this browser, on this device</strong>. There’s no account and nothing is uploaded.</p>
        <p class="muted">That also means clearing your browser data deletes your presentations. Use <strong>Export backup</strong> or <strong>Back up everything</strong> to keep copies.</p>
        <p class="muted">Tip: install the app from your browser’s address bar to use it offline and open .pres files by double-clicking them.</p>
      </div>
    </Dialog>
  );
}
