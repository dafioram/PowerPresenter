// Side panels (spec §12.1): layers, version history, find and replace, and the
// accessibility checker.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { IconButton, Button, Checkbox, promptDialog, confirmDialog, toast, openDialog, Dialog } from '../../ui/components.jsx';
import { Icon } from '../../ui/icons.jsx';
import { elementLabel, slideOrder } from '../../../core/model.js';
import { findMatches, replaceMatches } from '../../../core/find.js';
import { summarize } from '../../../core/a11y.js';
import { resolveSlideTitle } from '../../../core/titles.js';
import { listSnapshots, loadSnapshot, deleteSnapshot, renameSnapshot } from '../../../storage/repo.js';
import { migrateDocument, CURRENT_FORMAT_VERSION } from '../../../core/migrate.js';
import { normalizeDocument } from '../../../core/canonical.js';
import { relativeTime, formatBytes } from '../../download.js';
import { SlideThumb } from '../../SlideThumb.jsx';
import { openPresentation } from '../../nav.js';
import { addCaptions } from '../menus.js';
import * as ops from '../../../core/ops.js';

export function PanelFrame({ title, ctl, children, actions }) {
  return (
    <aside class="inspector panel" aria-label={title}>
      <div class="panel-head">
        <h2>{title}</h2>
        {actions}
        <IconButton icon="close" label={`Close ${title}`} onClick={() => ctl.set({ panel: 'inspector' })} />
      </div>
      <div class="inspector-scroll">{children}</div>
    </aside>
  );
}

// ---------- layers ----------
const DRAG = 'application/x-pe-layer';

function LayerRow({ ctl, el, depth, parentId, index, expanded, toggle, dropState, setDropState }) {
  const st = ctl.state;
  const selected = st.selection.includes(el.id);
  const ro = st.readOnly;
  const isGroup = el.type === 'group';
  const open = expanded.has(el.id);
  const onClick = (e) => {
    ctl.endTextEditing();
    // selecting inside a group enters it
    if (parentId && st.enteredGroup !== parentId) ctl.set({ enteredGroup: parentId });
    if (!parentId && st.enteredGroup) ctl.set({ enteredGroup: null });
    ctl.select([el.id], { toggle: e.shiftKey || e.metaKey || e.ctrlKey });
  };
  const rename = async () => {
    const n = await promptDialog({ title: 'Rename element', label: 'Name', value: el.name || elementLabel(el), maxLength: 100 });
    if (n !== null) ctl.setProps({ name: n.trim() || undefined }, [el.id], 'Rename');
  };
  const drop = dropState && dropState.id === el.id ? dropState.pos : null;
  return (
    <>
      <div
        class={`layer-row ${selected ? 'is-selected' : ''} ${el.hidden ? 'is-hidden-el' : ''} ${drop ? `drop-${drop}` : ''}`}
        style={{ paddingLeft: `${4 + depth * 16}px` }}
        draggable={!ro}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={selected}
        aria-expanded={isGroup ? open : undefined}
        data-testid="layer-row"
        onDragStart={(e) => { e.dataTransfer.setData(DRAG, el.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes(DRAG)) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const y = (e.clientY - r.top) / r.height;
          const pos = isGroup && y > 0.3 && y < 0.7 ? 'into' : y < 0.5 ? 'above' : 'below';
          if (dropState?.id !== el.id || dropState?.pos !== pos) setDropState({ id: el.id, pos });
        }}
        onDragLeave={() => setDropState(null)}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(DRAG);
          setDropState(null);
          if (!id || id === el.id) return;
          e.preventDefault();
          // the list is shown top layer first, so "above" means a higher index
          let ok = false;
          ctl.dispatch('Reorder layers', (d) => {
            if (drop === 'into') ok = ops.moveElementTo(d, ctl.container, id, el.id, el.group.children.length);
            else ok = ops.moveElementTo(d, ctl.container, id, parentId, drop === 'above' ? index + 1 : index);
          });
          if (!ok) toast('That element can’t go there (tables can’t be grouped).', { kind: 'info' });
        }}
      >
        {isGroup ? <IconButton icon={open ? 'chevronDown' : 'chevronRight'} class="is-small" label={open ? 'Collapse group' : 'Expand group'} onClick={() => toggle(el.id)} /> : <span class="layer-spacer" />}
        <button type="button" class="layer-name" onClick={onClick} onDblClick={rename} title="Click to select, double-click to rename">{elementLabel(el)}</button>
        <IconButton icon={el.hidden ? 'eyeOff' : 'eye'} class="is-small" label={el.hidden ? `Show ${elementLabel(el)}` : `Hide ${elementLabel(el)}`} disabled={ro} onClick={() => ctl.setProps({ hidden: el.hidden ? undefined : true }, [el.id], el.hidden ? 'Show' : 'Hide')} />
        <IconButton icon={el.locked ? 'lock' : 'unlock'} class={`is-small ${el.locked ? '' : 'faint'}`} label={el.locked ? `Unlock ${elementLabel(el)}` : `Lock ${elementLabel(el)}`} disabled={ro} onClick={() => ctl.setProps({ locked: el.locked ? undefined : true }, [el.id], el.locked ? 'Unlock' : 'Lock')} />
      </div>
      {isGroup && open && el.group.children.slice().reverse().map((c, ri) => (
        <LayerRow key={c.id} ctl={ctl} el={c} depth={depth + 1} parentId={el.id} index={el.group.children.length - 1 - ri} expanded={expanded} toggle={toggle} dropState={dropState} setDropState={setDropState} />
      ))}
    </>
  );
}

export function LayersPanel({ ctl }) {
  const els = ctl.elements();
  const [expanded, setExpanded] = useState(() => new Set());
  const [dropState, setDropState] = useState(null);
  const toggle = (id) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  useEffect(() => {
    // expand the group containing the selection
    if (ctl.state.enteredGroup && !expanded.has(ctl.state.enteredGroup)) toggle(ctl.state.enteredGroup);
  }, [ctl.state.enteredGroup]);
  const title = ctl.state.mode === 'master' ? 'Layers (master)' : ctl.state.mode === 'layout' ? 'Layers (layout)' : 'Layers';
  return (
    <PanelFrame title={title} ctl={ctl}>
      <p class="small muted">Top layer first. Drag to reorder or into a group. The only way to select hidden or locked elements.</p>
      {!els.length && <p class="small muted">Nothing on this slide yet.</p>}
      <div class="layer-tree" role="tree" aria-label="Layers">
        {els.slice().reverse().map((el, ri) => (
          <LayerRow key={el.id} ctl={ctl} el={el} depth={0} parentId={null} index={els.length - 1 - ri} expanded={expanded} toggle={toggle} dropState={dropState} setDropState={setDropState} />
        ))}
      </div>
    </PanelFrame>
  );
}

// ---------- version history (spec §9.5) ----------
async function loadSnapshotDoc(id) {
  const snap = await loadSnapshot(id);
  if (!snap) return null;
  let doc = snap.doc;
  if (snap.format_version < CURRENT_FORMAT_VERSION) doc = migrateDocument(doc, snap.format_version);
  return normalizeDocument(doc);
}

function SnapshotPreview({ close, ctl, snap }) {
  const [doc, setDoc] = useState(null);
  useEffect(() => {
    loadSnapshotDoc(snap.id).then(setDoc);
  }, [snap.id]);
  return (
    <Dialog
      title={snap.name || snap.reason || 'Version'}
      description={`${new Date(snap.created_at).toLocaleString()} · read-only preview`}
      onClose={() => close()}
      width={900}
      class="is-wide"
      footer={
        <>
          <Button onClick={() => close()}>Close</Button>
          <Button onClick={async () => { const id = await ctl.openSnapshotAsCopy(snap.id); close(); if (id) openPresentation(id); }}>Open as copy</Button>
          <Button variant="primary" disabled={ctl.state.readOnly} onClick={async () => { close(); await ctl.restoreSnapshot(snap.id); }}>Restore this version</Button>
        </>
      }
    >
      {!doc ? <p class="muted">Loading…</p> : (
        <div class="sorter-grid">
          {slideOrder(doc).map((id, i) => (
            <div key={id} class="sorter-item">
              <div class={`thumb ${doc.slides[id].hidden ? 'is-hidden' : ''}`}><SlideThumb doc={doc} slide={doc.slides[id]} assetUrl={(a) => ctl.assets.editUrl(a)} width={200} /></div>
              <div class="sorter-caption"><span class="thumb-num">{i + 1}</span> <span class="sorter-title">{resolveSlideTitle(doc.slides[id]) || 'Untitled'}</span></div>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

export function HistoryPanel({ ctl }) {
  const [list, setList] = useState(null);
  const refresh = () => listSnapshots(ctl.id).then(setList).catch(() => setList([]));
  useEffect(() => {
    refresh();
  }, [ctl.id]);
  const ro = ctl.state.readOnly;
  const saveVersion = async () => {
    const name = await promptDialog({ title: 'Save version', label: 'Version name', value: `Version ${new Date().toLocaleString()}`, maxLength: 100 });
    if (name === null) return;
    await ctl.saveVersion(name.trim() || 'Saved version');
    refresh();
  };
  return (
    <PanelFrame title="Version history" ctl={ctl} actions={<Button class="btn-sm" icon="save" disabled={ro} onClick={saveVersion} data-testid="save-version">Save version…</Button>}>
      <p class="small muted">Versions stay in this browser. Undo history is separate and lasts until you close the tab.</p>
      {list === null && <p class="muted">Loading…</p>}
      {list?.length === 0 && <p class="muted small">No versions yet.</p>}
      <div class="stack">
        {list?.map((s) => (
          <div class="snapshot" key={s.id} data-testid="snapshot">
            <div class="row">
              <span class="snapshot-title grow">{s.name || s.reason || 'Automatic'}</span>
              {!s.automatic && <span class="pill is-accent">Named</span>}
            </div>
            <span class="small muted" title={new Date(s.created_at).toLocaleString()}>{relativeTime(s.created_at)} · {formatBytes(s.size)}</span>
            <div class="row-wrap">
              <Button class="btn-sm" icon="eye" onClick={() => openDialog(SnapshotPreview, { ctl, snap: s })}>Preview</Button>
              <Button class="btn-sm" icon="restore" disabled={ro} onClick={async () => { if (await confirmDialog({ title: 'Restore this version?', message: 'The current state is saved as a version first. Undo history is cleared.', confirmLabel: 'Restore' })) { await ctl.restoreSnapshot(s.id); refresh(); } }}>Restore</Button>
              <Button class="btn-sm" onClick={async () => { const id = await ctl.openSnapshotAsCopy(s.id); if (id) { toast('Opened as a new presentation.', { kind: 'success' }); openPresentation(id); } }}>Open as copy</Button>
              {!s.automatic && <IconButton icon="text" class="is-small" label="Rename version" onClick={async () => { const n = await promptDialog({ title: 'Rename version', label: 'Name', value: s.name || '', maxLength: 100 }); if (n && n.trim()) { await renameSnapshot(s.id, n.trim()); refresh(); } }} />}
              <IconButton icon="trash" class="is-small" label="Delete version" onClick={async () => { if (await confirmDialog({ title: 'Delete this version?', message: 'This can’t be undone.', confirmLabel: 'Delete', danger: true })) { await deleteSnapshot(s.id); refresh(); } }} />
            </div>
          </div>
        ))}
      </div>
    </PanelFrame>
  );
}

// ---------- find and replace (spec §12.6) ----------
export function FindPanel({ ctl, replaceMode = false }) {
  const [q, setQ] = useState(ctl.findQuery || '');
  const [rep, setRep] = useState('');
  const [opts, setOpts] = useState({ matchCase: false, wholeWord: false, includeNotes: false, includeMaster: false });
  const [cur, setCur] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [ctl.state.findFocus]);
  const doc = ctl.doc;
  const matches = useMemo(() => (q ? findMatches(doc, q, opts) : []), [doc, q, opts]);
  const order = slideOrder(doc);
  const ro = ctl.state.readOnly;
  useEffect(() => { ctl.findQuery = q; }, [q]);
  const go = (i) => {
    if (!matches.length) return;
    const n = (i + matches.length) % matches.length;
    setCur(n);
    const m = matches[n];
    if (m.where.kind === 'master') {
      if (ctl.state.mode !== 'master') ctl.setMode('master');
    } else if (ctl.state.slideId !== m.where.slideId || ctl.state.mode !== 'slide') ctl.setSlide(m.where.slideId);
    if (m.elementId) {
      const hit = ctl.find(m.elementId);
      if (hit) ctl.select([hit.el.id]);
    } else ctl.set({ notesOpen: true });
  };
  const replaceOne = () => {
    const m = matches[cur];
    if (!m) return;
    ctl.dispatch('Replace', (d) => replaceMatches(d, [m], rep));
  };
  const replaceAll = async () => {
    if (!matches.length) return;
    await ctl.session?.snapshot('Before replace all');
    let n = 0;
    ctl.dispatch('Replace all', (d) => { n = replaceMatches(d, matches, rep); });
    toast(`Replaced ${n} match${n === 1 ? '' : 'es'}.`, { kind: 'success' });
  };
  // group results by slide
  const groups = [];
  matches.forEach((m, i) => {
    const key = m.where.kind === 'master' ? 'master' : m.where.slideId;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: key === 'master' ? 'Master' : `Slide ${order.indexOf(key) + 1}: ${resolveSlideTitle(doc.slides[key]) || 'Untitled'}`, items: [] };
      groups.push(g);
    }
    g.items.push({ m, i });
  });
  return (
    <PanelFrame title="Find and replace" ctl={ctl}>
      <form class="stack" onSubmit={(e) => { e.preventDefault(); go(cur + 1); }}>
        <label class="field">
          <span class="field-label">Find</span>
          <input ref={inputRef} class="input" value={q} onInput={(e) => { setQ(e.currentTarget.value); setCur(0); }} data-testid="find-input" onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); go(cur - 1); } }} />
        </label>
        <div class="row-wrap">
          <Checkbox label="Match case" checked={opts.matchCase} onChange={(v) => setOpts({ ...opts, matchCase: v })} />
          <Checkbox label="Whole words" checked={opts.wholeWord} onChange={(v) => setOpts({ ...opts, wholeWord: v })} />
          <Checkbox label="Notes" checked={opts.includeNotes} onChange={(v) => setOpts({ ...opts, includeNotes: v })} />
          <Checkbox label="Master" checked={opts.includeMaster} onChange={(v) => setOpts({ ...opts, includeMaster: v })} />
        </div>
        <div class="row">
          <span class="small grow" aria-live="polite" data-testid="find-count">{q ? (matches.length ? `${Math.min(cur + 1, matches.length)} of ${matches.length}` : 'No matches') : ''}</span>
          <IconButton icon="chevronUp" label="Previous match" disabled={!matches.length} onClick={() => go(cur - 1)} />
          <IconButton icon="chevronDown" label="Next match" disabled={!matches.length} onClick={() => go(cur + 1)} />
        </div>
        <label class="field">
          <span class="field-label">Replace with</span>
          <input class="input" value={rep} onInput={(e) => setRep(e.currentTarget.value)} data-testid="replace-input" autoFocus={replaceMode} />
        </label>
        <div class="row">
          <Button class="btn-sm" disabled={ro || !matches.length} onClick={replaceOne}>Replace</Button>
          <Button class="btn-sm" variant="primary" disabled={ro || !matches.length} onClick={replaceAll} data-testid="replace-all">Replace all</Button>
        </div>
      </form>
      <div class="stack find-results">
        {groups.map((g) => (
          <div key={g.key} class="stack tight">
            <strong class="small">{g.label}</strong>
            {g.items.map(({ m, i }) => (
              <button type="button" key={i} class={`find-result ${i === cur ? 'is-current' : ''}`} onClick={() => go(i)}>
                {m.target === 'notes' ? <span class="pill">Notes</span> : null} {m.excerpt}
              </button>
            ))}
          </div>
        ))}
      </div>
    </PanelFrame>
  );
}

// ---------- accessibility checker (spec §16.3) ----------
export function A11yPanel({ ctl }) {
  const [tick, setTick] = useState(0);
  const issues = useMemo(() => ctl.accessibilityIssues(), [ctl.doc, tick, ctl.state.overflow.size]);
  const s = summarize(issues);
  const order = slideOrder(ctl.doc);
  const ro = ctl.state.readOnly;
  const goTo = (i) => {
    if (i.slideId && (ctl.state.slideId !== i.slideId || ctl.state.mode !== 'slide')) ctl.setSlide(i.slideId);
    if (i.elementId && ctl.find(i.elementId)) ctl.select([i.elementId]);
  };
  const fix = async (i) => {
    goTo(i);
    if (i.fix === 'alt') ctl.set({ panel: 'inspector', inspectorTab: 'a11y' });
    else if (i.fix === 'add-title') {
      const t = await promptDialog({ title: 'Add a hidden title', label: 'Title (read by screen readers and shown in navigation)', maxLength: 200 });
      if (t && t.trim()) ctl.setSlideProps({ title: t.trim() }, [i.slideId], 'Hidden title');
    } else if (i.fix === 'delete') ctl.dispatch('Delete placeholder', (d) => ops.deleteElements(d, { kind: 'slide', slideId: i.slideId }, [i.elementId]));
    else if (i.fix === 'table-header') ctl.dispatch('Header row', (d) => ops.setProps(d, { kind: 'slide', slideId: i.slideId }, [i.elementId], { 'table.header_rows': 1 }));
    else if (i.fix === 'captions') {
      const el = ctl.find(i.elementId)?.el;
      if (el) addCaptions(ctl, el);
    } else if (i.fix === 'theme') ctl.updateTheme((t) => { t.defaults.link.underline = true; }, 'Underline links');
    setTick((n) => n + 1);
  };
  const FIX_LABELS = { alt: 'Add alt text', 'add-title': 'Add hidden title', delete: 'Delete placeholder', 'table-header': 'Add header row', captions: 'Add captions…', theme: 'Underline links' };
  return (
    <PanelFrame title="Accessibility" ctl={ctl} actions={<Button class="btn-sm" onClick={() => setTick((n) => n + 1)}>Check again</Button>}>
      <div class="row-wrap">
        <span class="pill is-warn" data-testid="a11y-errors">{s.error} error{s.error === 1 ? '' : 's'}</span>
        <span class="pill">{s.warning} warning{s.warning === 1 ? '' : 's'}</span>
        <span class="pill">{s.tip} tip{s.tip === 1 ? '' : 's'}</span>
      </div>
      {!issues.length && <p class="small"><Icon name="check" size={14} /> No issues found.</p>}
      <div class="stack">
        {['error', 'warning', 'tip'].flatMap((sev) => issues.filter((i) => i.severity === sev)).map((i, k) => {
          const el = i.elementId ? ctl.find(i.elementId)?.el || null : null;
          const where = i.slideId ? `Slide ${order.indexOf(i.slideId) + 1}` : 'Presentation';
          return (
            <div key={k} class={`issue is-${i.severity}`}>
              <Icon name={i.severity === 'error' ? 'alert' : i.severity === 'warning' ? 'alert' : 'info'} size={16} />
              <div class="issue-body">
                <span>{i.message}</span>
                <span class="small muted">{where}{el ? ` · ${elementLabel(el)}` : ''}</span>
                <div class="issue-actions">
                  {i.slideId && <button type="button" class="link-btn" onClick={() => goTo(i)}>Go to</button>}
                  {i.fix && <button type="button" class="link-btn" disabled={ro} onClick={() => fix(i)}>{FIX_LABELS[i.fix]}</button>}
                  {i.fix === 'alt' && <button type="button" class="link-btn" disabled={ro} onClick={() => { ctl.dispatch('Decorative', (d) => ops.setProps(d, { kind: 'slide', slideId: i.slideId }, [i.elementId], { 'accessibility.decorative': true })); setTick((n) => n + 1); }}>Mark decorative</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </PanelFrame>
  );
}
