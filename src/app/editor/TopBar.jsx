// Editor top bar (spec §12.1): title, save status, undo/redo, Insert, Slide,
// Arrange, Present, Export and panel toggles.
import { useEffect, useState } from 'preact/hooks';
import { IconButton, MenuButton, Popover, usePopover, Button, openDialog, toast } from '../ui/components.jsx';
import { Icon } from '../ui/icons.jsx';
import { SHAPES } from '../../core/shapes.js';
import { shortcut, MOD } from '../settings.js';
import { goWorkspace } from '../nav.js';
import { pickFiles } from '../download.js';
import { arrangeItems } from './menus.js';
import { menuCopy, menuPaste, copyFormat } from './commands.js';
import { LayoutPickerDialog, ChangeLayoutDialog, SaveLayoutDialog, PresentationSettingsDialog, MasterFieldDialog } from './dialogs/SlideDialogs.jsx';
import { ExportDialog } from './dialogs/ExportDialog.jsx';
import { ShortcutsDialog, SettingsDialog } from '../dialogs/AppDialogs.jsx';
import { ThemeLibraryDialog } from '../dialogs/ThemeLibraryDialog.jsx';
import { startPresenting } from './present.js';
import { canLinkFiles, saveAsLinkedFile, saveNow } from './linked-file.js';
import { FIELD_KINDS, FIELD_LABELS } from '../../core/fields.js';
import { textElement } from '../../core/model.js';
import { applyLibraryTheme } from './theme-actions.js';

function SaveStatus({ ctl }) {
  const st = ctl.state;
  const s = st.saveStatus || {};
  if (st.lockLost) return <span class="save-status is-readonly"><Icon name="lock" size={14} />Read-only (editing in another tab)</span>;
  if (st.readOnly) return <span class="save-status is-readonly"><Icon name="lock" size={14} />Read-only</span>;
  if (s.state === 'error') {
    return (
      <span class="save-status is-error" role="alert">
        <Icon name="alert" size={14} />
        {s.quota ? 'Not saved — storage is full' : 'Not saved'}
      </span>
    );
  }
  if (s.state === 'saving' || s.state === 'dirty') return <span class="save-status" data-testid="save-status">Saving…</span>;
  return <span class="save-status" data-testid="save-status"><Icon name="check" size={14} />Saved{st.linkedFile ? ` · ${st.linkedFile}` : ''}</span>;
}

function TitleInput({ ctl }) {
  const title = ctl.doc.metadata.title;
  const [v, setV] = useState(title);
  useEffect(() => setV(title), [title]);
  const commit = () => {
    if (v.trim() && v !== title) ctl.rename(v);
    else setV(title);
  };
  return (
    <input
      class="title-input"
      value={v}
      aria-label="Presentation title"
      maxLength={200}
      disabled={ctl.state.readOnly}
      onInput={(e) => setV(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setV(title);
          e.currentTarget.blur();
        }
      }}
      data-testid="title-input"
    />
  );
}

const SHAPE_ICON_SIZE = 22;
function ShapeIcon({ shape }) {
  const d = shape.path(SHAPE_ICON_SIZE, SHAPE_ICON_SIZE * 0.75, shape.adjust ? scaledAdjust(shape) : {});
  return (
    <svg width={SHAPE_ICON_SIZE} height={SHAPE_ICON_SIZE} viewBox={`-1 -4 ${SHAPE_ICON_SIZE + 2} ${SHAPE_ICON_SIZE + 2}`} aria-hidden="true">
      <path d={d} fill="currentColor" fill-opacity="0.15" stroke="currentColor" stroke-width="1.3" fill-rule={shape.evenOdd ? 'evenodd' : 'nonzero'} />
    </svg>
  );
}

// Absolute adjustments (in units) are scaled down for the tiny icon.
function scaledAdjust(shape) {
  const out = {};
  for (const [k, v] of Object.entries(shape.adjust)) out[k] = Math.abs(v) > 1 ? v * 0.15 : v;
  return out;
}

export function ShapePicker({ onPick, onClose }) {
  const cats = [...new Set(SHAPES.map((s) => s.category))];
  return (
    <div class="shape-grid" role="menu" aria-label="Shapes">
      {cats.map((c) => [
        <div key={`c-${c}`} class="shape-cat">{c}</div>,
        ...SHAPES.filter((s) => s.category === c).map((s) => (
          <button key={s.id} type="button" role="menuitem" title={s.label} aria-label={s.label} data-shape={s.id} onClick={() => { onClose(); onPick(s.id); }}>
            <ShapeIcon shape={s} />
          </button>
        )),
      ])}
    </div>
  );
}

function TablePicker({ onPick, onClose }) {
  const [hover, setHover] = useState({ r: 3, c: 3 });
  const R = 8;
  const C = 10;
  return (
    <div class="table-picker" role="group" aria-label="Table size">
      <div class="table-picker-grid" onPointerLeave={() => setHover({ r: 3, c: 3 })}>
        {Array.from({ length: R * C }, (_, i) => {
          const r = Math.floor(i / C) + 1;
          const c = (i % C) + 1;
          return (
            <button
              key={i}
              type="button"
              class={r <= hover.r && c <= hover.c ? 'is-on' : ''}
              aria-label={`${r} by ${c} table`}
              onPointerEnter={() => setHover({ r, c })}
              onFocus={() => setHover({ r, c })}
              onClick={() => { onClose(); onPick(r, c); }}
            />
          );
        })}
      </div>
      <div class="small muted table-picker-label">{hover.r} × {hover.c}</div>
    </div>
  );
}

function InsertMenu({ ctl }) {
  const pop = usePopover();
  const [sub, setSub] = useState(null);
  const ro = ctl.state.readOnly;
  const master = ctl.state.mode !== 'slide';
  const close = () => {
    pop.close();
    setSub(null);
  };
  const insertImage = async () => {
    close();
    const files = await pickFiles({ accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml', multiple: true });
    if (files.length) ctl.insertFiles(files);
  };
  const insertVideo = async () => {
    close();
    const files = await pickFiles({ accept: 'video/mp4,video/webm' });
    if (files.length) ctl.insertFiles(files);
  };
  const insertFont = async () => {
    close();
    const files = await pickFiles({ accept: '.woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf', multiple: true });
    if (files.length) ctl.insertFiles(files);
  };
  const insertField = (kind) => {
    close();
    if (ctl.textSession) {
      ctl.textSession.insertField(kind, kind === 'date' ? { format: 'medium', value: 'auto' } : {});
      return;
    }
    if (kind === 'date') {
      openDialog(MasterFieldDialog, { ctl });
      return;
    }
    const W = ctl.doc.size.width;
    const H = ctl.doc.size.height;
    const el = textElement({ x: W - 200, y: H - 60, width: 160, height: 36, role: 'footer' });
    el.text.body = { paragraphs: [{ align: 'end', inlines: [{ field: kind }] }] };
    ctl.insertElements([el], { label: 'Insert field' });
  };
  const items = [
    { label: 'Text box', icon: 'text', onSelect: () => { close(); ctl.insertText(); } },
    { label: 'Shape', icon: 'shape', sub: 'shape' },
    { label: 'Line', icon: 'line', onSelect: () => { close(); ctl.insertLine('line'); } },
    { label: 'Arrow', icon: 'line', onSelect: () => { close(); ctl.insertLine('arrow'); } },
    { label: 'Connector', icon: 'connector', onSelect: () => { close(); ctl.insertLine('connector'); } },
    { label: 'Image…', icon: 'image', onSelect: insertImage },
    { label: master ? 'Video (not on the master)' : 'Video…', icon: 'video', disabled: master, onSelect: insertVideo },
    { label: 'Table', icon: 'table', sub: 'table' },
    { label: 'Chart', icon: 'chart', sub: 'chart' },
    { label: 'Font file…', icon: 'text', onSelect: insertFont },
    { label: 'Field', icon: 'master', sub: 'field' },
  ];
  return (
    <span class="menu-wrap">
      <button ref={pop.anchor} type="button" class="btn btn-ghost" aria-haspopup="menu" aria-expanded={pop.open} disabled={ro} onClick={() => { pop.toggle(); setSub(null); }} data-testid="insert-menu">
        <Icon name="plus" size={16} /><span>Insert</span><Icon name="chevronDown" size={14} />
      </button>
      <Popover anchor={pop.anchor} open={pop.open} onClose={close} label="Insert">
        {sub === null && (
          <div class="menu" role="menu" aria-label="Insert">
            {items.map((it) => (
              <button key={it.label} type="button" role="menuitem" class="menu-item" disabled={it.disabled} aria-haspopup={it.sub ? 'menu' : undefined} onClick={() => (it.sub ? setSub(it.sub) : it.onSelect())} data-testid={`insert-${it.label.replace(/[^a-z]/gi, '').toLowerCase()}`}>
                <span class="menu-icon"><Icon name={it.icon} size={15} /></span>
                <span class="menu-label">{it.label}</span>
                {it.sub && <Icon name="chevronRight" size={14} />}
              </button>
            ))}
          </div>
        )}
        {sub && (
          <div class="submenu">
            <button type="button" class="menu-item submenu-back" onClick={() => setSub(null)}><Icon name="chevronLeft" size={14} /> Back</button>
            {sub === 'shape' && <ShapePicker onClose={close} onPick={(id) => ctl.insertShape(id)} />}
            {sub === 'table' && <TablePicker onClose={close} onPick={(r, c) => ctl.insertTable(r, c)} />}
            {sub === 'chart' && (
              <div class="menu" role="menu" aria-label="Chart type">
                {[['bar', 'Bar or column'], ['line', 'Line'], ['pie', 'Pie'], ['donut', 'Donut'], ['scatter', 'Scatter']].map(([k, l]) => (
                  <button key={k} type="button" role="menuitem" class="menu-item" onClick={() => { close(); ctl.insertChart(k); }} data-testid={`chart-${k}`}>
                    <span class="menu-icon"><Icon name="chart" size={15} /></span><span class="menu-label">{l}</span>
                  </button>
                ))}
              </div>
            )}
            {sub === 'field' && (
              <div class="menu" role="menu" aria-label="Field">
                {FIELD_KINDS.map((k) => (
                  <button key={k} type="button" role="menuitem" class="menu-item" onClick={() => insertField(k)}>
                    <span class="menu-icon" /><span class="menu-label">{FIELD_LABELS[k]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Popover>
    </span>
  );
}

export function TopBar({ ctl }) {
  const st = ctl.state;
  const ro = st.readOnly;
  const canUndo = !ro && ctl.store?.canUndo();
  const canRedo = !ro && ctl.store?.canRedo();
  const undoLabel = ctl.store?.undoLabel?.();
  const redoLabel = ctl.store?.redoLabel?.();
  const panel = st.panel;
  const togglePanel = (p) => ctl.set({ panel: panel === p ? 'inspector' : p });
  const a11yCount = st.a11yCount || 0;

  const slideItems = () => [
    { label: 'New slide…', icon: 'plus', shortcut: 'Ctrl+M', disabled: ro || st.mode !== 'slide', onSelect: () => openDialog(LayoutPickerDialog, { ctl, mode: 'new' }) },
    { label: 'Duplicate slide', icon: 'copy', disabled: ro || st.mode !== 'slide', onSelect: () => ctl.duplicateSlides() },
    { label: 'Delete slide', icon: 'trash', disabled: ro || st.mode !== 'slide', onSelect: () => ctl.deleteSlides() },
    { label: ctl.slide?.hidden ? 'Show slide' : 'Hide slide', icon: 'eyeOff', disabled: ro || st.mode !== 'slide', onSelect: () => ctl.toggleHidden() },
    { separator: true },
    { label: 'Change layout…', icon: 'layout', disabled: ro || st.mode !== 'slide', onSelect: () => openDialog(ChangeLayoutDialog, { ctl }) },
    { label: 'Save slide as layout…', disabled: ro || st.mode !== 'slide', onSelect: () => openDialog(SaveLayoutDialog, { ctl }) },
    { separator: true },
    st.mode === 'slide'
      ? { label: 'Edit master', icon: 'master', onSelect: () => ctl.setMode('master') }
      : { label: 'Close master', icon: 'master', onSelect: () => ctl.setMode('slide') },
    { label: 'Theme editor', icon: 'palette', onSelect: () => ctl.set({ panel: 'theme' }) },
    { label: 'Theme library…', icon: 'palette', disabled: ro, onSelect: () => openDialog(ThemeLibraryDialog, { currentThemeName: ctl.doc.theme.name, onApply: (choice) => applyLibraryTheme(ctl, choice) }) },
    { separator: true },
    { label: 'Presentation settings…', icon: 'settings', onSelect: () => openDialog(PresentationSettingsDialog, { ctl }) },
  ];

  const editItems = () => [
    { label: undoLabel ? `Undo ${undoLabel}` : 'Undo', icon: 'undo', shortcut: shortcut('Mod+Z'), disabled: !canUndo, onSelect: () => ctl.undo() },
    { label: redoLabel ? `Redo ${redoLabel}` : 'Redo', icon: 'redo', shortcut: shortcut('Mod+Shift+Z'), disabled: !canRedo, onSelect: () => ctl.redo() },
    { separator: true },
    { label: 'Cut', shortcut: shortcut('Mod+X'), disabled: ro, onSelect: () => menuCopy(true) },
    { label: 'Copy', icon: 'copy', shortcut: shortcut('Mod+C'), onSelect: () => menuCopy(false) },
    { label: 'Paste', shortcut: shortcut('Mod+V'), disabled: ro, onSelect: () => menuPaste(ctl) },
    { label: 'Paste as plain text', shortcut: shortcut('Mod+Shift+V'), disabled: ro, onSelect: () => menuPaste(ctl, { plain: true }) },
    { label: 'Duplicate', shortcut: shortcut('Mod+D'), disabled: ro || !st.selection.length, onSelect: () => ctl.duplicateSelection() },
    { label: 'Delete', icon: 'trash', disabled: ro || !st.selection.length, onSelect: () => ctl.deleteSelection() },
    { label: 'Select all', shortcut: shortcut('Mod+A'), onSelect: () => ctl.selectAll() },
    { separator: true },
    { label: 'Copy formatting', icon: 'paint', shortcut: shortcut('Mod+Alt+C'), disabled: st.selection.length !== 1, onSelect: () => copyFormat(ctl) },
    { label: 'Find and replace', icon: 'search', shortcut: shortcut('Mod+F'), onSelect: () => ctl.set({ panel: 'find' }) },
  ];

  const presentItems = () => [
    { label: 'From current slide', icon: 'play', shortcut: shortcut('Mod+Enter'), onSelect: () => startPresenting(ctl, {}) },
    { label: 'From beginning', icon: 'present', shortcut: shortcut('Mod+Shift+Enter'), onSelect: () => startPresenting(ctl, { fromBeginning: true }) },
    { label: 'With presenter view', icon: 'notes', onSelect: () => startPresenting(ctl, { presenter: true }) },
  ];

  const moreItems = () => [
    canLinkFiles && { label: 'Save to file…', icon: 'save', disabled: ro, onSelect: () => saveAsLinkedFile(ctl) },
    { label: 'Save now', icon: 'save', shortcut: shortcut('Mod+S'), onSelect: () => saveNow(ctl) },
    { label: 'Save version…', icon: 'history', disabled: ro, onSelect: () => ctl.set({ panel: 'history' }) },
    { separator: true },
    { label: 'Remove unused media', disabled: ro, onSelect: () => ctl.cleanupAssets({ manual: true }) },
    { label: 'Show rulers', checked: !!st.rulers, onSelect: () => ctl.set({ rulers: !st.rulers }) },
    { separator: true },
    { label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: shortcut('Mod+/'), onSelect: () => openDialog(ShortcutsDialog) },
    { label: 'Settings…', icon: 'settings', onSelect: () => openDialog(SettingsDialog) },
  ].filter(Boolean);

  return (
    <header class="topbar" aria-label="Editor toolbar">
      <IconButton icon="chevronLeft" label="All presentations" onClick={goWorkspace} data-testid="back-to-workspace" />
      <img src="./icons/icon.svg" alt="" width="22" height="22" class="topbar-logo" />
      <TitleInput ctl={ctl} />
      <SaveStatus ctl={ctl} />
      <span class="sep" />
      <IconButton icon="undo" label={undoLabel ? `Undo ${undoLabel}` : 'Undo'} shortcut={shortcut('Mod+Z')} disabled={!canUndo} onClick={() => ctl.undo()} data-testid="undo" />
      <IconButton icon="redo" label={redoLabel ? `Redo ${redoLabel}` : 'Redo'} shortcut={shortcut('Mod+Shift+Z')} disabled={!canRedo} onClick={() => ctl.redo()} data-testid="redo" />
      <MenuButton label="Edit" items={editItems}>Edit</MenuButton>
      <InsertMenu ctl={ctl} />
      <MenuButton label="Slide" items={slideItems}>Slide</MenuButton>
      <MenuButton label="Arrange" items={() => arrangeItems(ctl)}>Arrange</MenuButton>
      <span class="spacer" />
      <IconButton icon="search" label="Find and replace" shortcut={shortcut('Mod+F')} pressed={panel === 'find'} onClick={() => togglePanel('find')} data-testid="toggle-find" />
      <IconButton icon="layers" label="Layers" pressed={panel === 'layers'} onClick={() => togglePanel('layers')} data-testid="toggle-layers" />
      <IconButton icon="history" label="Version history" pressed={panel === 'history'} onClick={() => togglePanel('history')} data-testid="toggle-history" />
      <span class="badge-wrap">
        <IconButton icon="a11y" label="Accessibility checker" pressed={panel === 'a11y'} onClick={() => togglePanel('a11y')} data-testid="toggle-a11y" />
        {a11yCount > 0 && <span class="dot-badge" aria-hidden="true">{a11yCount > 99 ? '99+' : a11yCount}</span>}
      </span>
      <MenuButton label="More" icon="more" items={moreItems} placement="bottom-end" />
      <span class="sep" />
      <Button icon="download" onClick={() => openDialog(ExportDialog, { ctl })} data-testid="export-button">Export</Button>
      <span class="split-btn">
        <Button variant="primary" icon="play" onClick={() => startPresenting(ctl, {})} title={`Present from current slide (${MOD}+Enter)`} data-testid="present-button">Present</Button>
        <MenuButton label="Present options" icon="chevronDown" items={presentItems} placement="bottom-end" buttonClass="btn-primary-icon" />
      </span>
    </header>
  );
}

export { toast };
