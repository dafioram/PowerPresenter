// The editor shell (spec §12): wires the controller to the top bar, sidebar,
// canvas, inspector, panels, notes and status bar, and handles keyboard
// shortcuts and the clipboard.
import { useEffect, useState, useRef } from 'preact/hooks';
import { EditorController } from './controller.js';
import { Canvas } from './Canvas.jsx';
import { TopBar } from './TopBar.jsx';
import { FormatBar, toggleMarkOnSelection } from './FormatBar.jsx';
import { Sidebar } from './Sidebar.jsx';
import { NotesPane } from './NotesPane.jsx';
import { StatusBar, stepZoom } from './StatusBar.jsx';
import { Inspector } from './inspector/Inspector.jsx';
import { LayersPanel, HistoryPanel, FindPanel, A11yPanel } from './panels/Panels.jsx';
import { ThemeEditor } from './panels/ThemeEditor.jsx';
import { Button, openDialog, toast } from '../ui/components.jsx';
import { Icon } from '../ui/icons.jsx';
import { isMac } from '../settings.js';
import { goWorkspace, navigate } from '../nav.js';
import { handleCopy, handlePasteData, isTypingTarget, copyFormat, pasteFormat, cycleSelection, openLink } from './commands.js';
import { startPresenting, isPresenting } from './present.js';
import { saveNow } from './linked-file.js';
import { ExportDialog } from './dialogs/ExportDialog.jsx';
import { LayoutPickerDialog } from './dialogs/SlideDialogs.jsx';
import { ShortcutsDialog } from '../dialogs/AppDialogs.jsx';
import { slideOrder } from '../../core/model.js';
import { summarize } from '../../core/a11y.js';

function snapshotTransfer(dt) {
  const data = {};
  for (const t of dt.types || []) {
    if (t === 'Files') continue;
    try {
      data[t] = dt.getData(t);
    } catch {
      /* ignore */
    }
  }
  const files = [...(dt.files || [])];
  return { types: [...(dt.types || [])], files, getData: (t) => data[t] || '' };
}

function useController(id) {
  const [ctl] = useState(() => new EditorController(id, { navigate }));
  const [, force] = useState(0);
  useEffect(() => {
    let raf = 0;
    const off = ctl.subscribe(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => force((n) => n + 1));
    });
    ctl.load();
    const flush = () => ctl.session?.flush();
    window.addEventListener('pe-flush', flush);
    return () => {
      off();
      cancelAnimationFrame(raf);
      window.removeEventListener('pe-flush', flush);
      ctl.dispose();
    };
  }, [ctl]);
  return ctl;
}

function handleKeyDown(ctl, e) {
  if (!ctl.doc || isPresenting()) return;
  if (document.querySelector('.dialog-backdrop')) return;
  const st = ctl.state;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const code = e.code;
  const typing = isTypingTarget(e.target);
  const stop = () => {
    e.preventDefault();
    e.stopPropagation();
  };
  // ---- shortcuts that work everywhere ----
  if (mod && !e.altKey && key === 's') { stop(); saveNow(ctl); return; }
  if (mod && !e.altKey && key === 'p') { stop(); openDialog(ExportDialog, { ctl, target: 'pdf' }); return; }
  if (mod && key === 'Enter') { stop(); startPresenting(ctl, { fromBeginning: e.shiftKey }); return; }
  if (key === 'F5' && !mod) { stop(); startPresenting(ctl, { fromBeginning: !e.shiftKey }); return; }
  if (mod && !e.shiftKey && key === 'f') { stop(); ctl.set({ panel: 'find', findFocus: (st.findFocus || 0) + 1 }); return; }
  if (mod && e.shiftKey && key === 'h') { stop(); ctl.set({ panel: 'find', findFocus: (st.findFocus || 0) + 1 }); return; }
  if (mod && (key === '/' || code === 'Slash')) { stop(); openDialog(ShortcutsDialog); return; }
  if (e.ctrlKey && !e.metaKey && !e.altKey && key === 'm') {
    stop();
    if (st.mode === 'slide' && !st.readOnly) {
      if (e.shiftKey) openDialog(LayoutPickerDialog, { ctl, mode: 'new' });
      else ctl.addSlide();
    }
    return;
  }
  if (typing) return;
  const inCanvas = e.target === document.body || !!e.target.closest?.('.canvas-scroll, .layer-tree');
  // ---- editing shortcuts (not while typing) ----
  if (mod && !e.altKey && key === 'z') { stop(); if (e.shiftKey) ctl.redo(); else ctl.undo(); return; }
  if (mod && !e.altKey && key === 'y') { stop(); ctl.redo(); return; }
  if (mod && e.altKey && code === 'KeyC') { stop(); copyFormat(ctl); return; }
  if (mod && e.altKey && code === 'KeyV') { stop(); pasteFormat(ctl); return; }
  if (mod && e.shiftKey && code === 'KeyV') { ctl.plainPasteNext = true; return; }
  if (mod && key === 'd') { stop(); ctl.duplicateSelection(); return; }
  if (mod && key === 'g') { stop(); if (e.shiftKey) ctl.ungroup(); else ctl.group(); return; }
  if (mod && code === 'BracketRight') { stop(); ctl.reorder(e.shiftKey ? 'front' : 'forward'); return; }
  if (mod && code === 'BracketLeft') { stop(); ctl.reorder(e.shiftKey ? 'back' : 'backward'); return; }
  if (mod && key === 'a') { stop(); ctl.selectAll(); return; }
  if (mod && key === 'k') { stop(); openLink(ctl); return; }
  if (mod && !e.shiftKey && (key === 'b' || key === 'i' || key === 'u')) {
    if (toggleMarkOnSelection(ctl, { b: 'weight', i: 'italic', u: 'underline' }[key])) stop();
    return;
  }
  if (mod && (key === '=' || key === '+')) { stop(); stepZoom(ctl, 1); return; }
  if (mod && key === '-') { stop(); stepZoom(ctl, -1); return; }
  if (!inCanvas) return;
  const sel = st.selection;
  if (key === 'Delete' || key === 'Backspace') {
    if (sel.length) { stop(); ctl.deleteSelection(); }
    return;
  }
  if (key.startsWith('Arrow')) {
    const dx = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
    const dy = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
    if (!sel.length) {
      if (st.mode === 'slide') {
        const order = slideOrder(ctl.doc);
        const i = order.indexOf(st.slideId);
        const n = order[Math.max(0, Math.min(order.length - 1, i + dx + dy))];
        if (n !== st.slideId) { stop(); ctl.setSlide(n); }
      }
      return;
    }
    stop();
    if (mod && e.altKey) ctl.resizeBy(dx, dy);
    else ctl.nudge(dx * (e.shiftKey ? 10 : 1), dy * (e.shiftKey ? 10 : 1));
    return;
  }
  if (key === 'PageDown' || key === 'PageUp') {
    const order = slideOrder(ctl.doc);
    const i = order.indexOf(st.slideId);
    const n = order[Math.max(0, Math.min(order.length - 1, i + (key === 'PageDown' ? 1 : -1)))];
    stop();
    if (n !== st.slideId) ctl.setSlide(n);
    return;
  }
  if (key === 'Tab') { stop(); cycleSelection(ctl, e.shiftKey ? -1 : 1); return; }
  if (key === 'Enter') {
    if (sel.length !== 1) return;
    const el = ctl.find(sel[0])?.el;
    if (!el) return;
    stop();
    if (el.type === 'group') ctl.set({ enteredGroup: el.id, selection: [el.group.children[0].id] });
    else if (el.type === 'text' || el.type === 'shape') {
      ctl.startEditing?.(el.id);
      setTimeout(() => ctl.textSession?.selectAllText(), 0);
    } else if (el.type === 'table') ctl.startEditing?.(el.id, `cell:${el.table.rows[0].id}:${el.table.columns[0].id}`);
    return;
  }
  if (key === 'Escape') {
    if (st.formatPainter) { stop(); ctl.set({ formatPainter: null }); return; }
    if (st.crop) { stop(); ctl.set({ crop: null }); return; }
    if (st.enteredGroup) { stop(); const g = st.enteredGroup; ctl.set({ enteredGroup: null, selection: [g] }); return; }
    if (sel.length) { stop(); ctl.clearSelection(); return; }
    if (st.mode !== 'slide') { stop(); ctl.setMode('slide'); }
  }
}

export function Editor({ id, readOnlyForced }) {
  const ctl = useController(id);
  const st = ctl.state;
  const a11yTimer = useRef(0);

  // keyboard and clipboard
  useEffect(() => {
    const onKey = (e) => handleKeyDown(ctl, e);
    const onCopy = (e) => { if (!isPresenting()) handleCopy(ctl, e); };
    const onCut = (e) => { if (!isPresenting()) handleCopy(ctl, e, { cut: true }); };
    const onPaste = (e) => {
      if (isPresenting() || !ctl.doc || isTypingTarget(e.target) || document.querySelector('.dialog-backdrop')) return;
      e.preventDefault();
      const plain = !!ctl.plainPasteNext;
      ctl.plainPasteNext = false;
      handlePasteData(ctl, snapshotTransfer(e.clipboardData), { plain });
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, [ctl]);

  // storage blocked by an app update in another tab
  useEffect(() => {
    if (readOnlyForced && ctl.store) ctl.set({ readOnly: true }, 'status');
  }, [readOnlyForced, ctl.store]);

  // title and a11y badge
  useEffect(() => {
    if (!ctl.doc) return undefined;
    document.title = `${ctl.doc.metadata.title} — Presentation Editor`;
    clearTimeout(a11yTimer.current);
    a11yTimer.current = setTimeout(() => {
      try {
        const s = summarize(ctl.accessibilityIssues());
        if (s.error !== ctl.state.a11yCount) ctl.set({ a11yCount: s.error }, 'status');
      } catch {
        /* ignore */
      }
    }, 800);
    return () => clearTimeout(a11yTimer.current);
  }, [ctl.doc]);

  useEffect(() => () => { document.title = 'Presentation Editor'; }, []);

  if (st.loading) return <div class="editor-loading" role="status"><span class="spinner" aria-hidden="true" /> Opening presentation…</div>;
  if (st.error || !ctl.doc) {
    return (
      <div class="editor-loading" role="alert">
        <Icon name="alert" size={20} />
        <p>{st.error || 'This presentation couldn’t be opened.'}</p>
        <Button variant="primary" onClick={goWorkspace}>Back to all presentations</Button>
      </div>
    );
  }

  const sorter = st.sidebarView === 'sorter';
  const panel = st.panel;
  return (
    <div class={`editor ${st.readOnly ? 'is-readonly' : ''}`} data-testid="editor">
      <TopBar ctl={ctl} />
      {st.newerVersion && (
        <div class="banner is-error" role="alert"><Icon name="alert" size={16} /><span class="grow">This presentation was saved by a newer version of the app, so it’s read-only here.</span><Button class="btn-sm" variant="primary" onClick={() => location.reload()}>Reload to update</Button></div>
      )}
      {st.readOnly && !st.newerVersion && !readOnlyForced && (
        <div class="banner" role="status" data-testid="readonly-banner">
          <Icon name="lock" size={16} />
          <span class="grow">{st.lockLost ? 'Editing moved to another tab. This tab is read-only.' : 'Open for editing in another tab.'}</span>
          <Button class="btn-sm" variant="primary" onClick={() => ctl.editHere()} data-testid="edit-here">Edit here</Button>
        </div>
      )}
      {st.saveStatus?.state === 'error' && (
        <div class="banner is-error" role="alert">
          <Icon name="alert" size={16} />
          <span class="grow">{st.saveStatus.quota ? 'Changes aren’t being saved because browser storage is full. Free up space (Storage in the workspace) or export a copy now.' : 'Changes aren’t being saved. The app keeps retrying.'}</span>
          <Button class="btn-sm" onClick={() => openDialog(ExportDialog, { ctl })}>Export a copy</Button>
        </div>
      )}
      {!sorter && <FormatBar ctl={ctl} />}
      <div class="editor-main">
        {sorter ? (
          <Sidebar ctl={ctl} />
        ) : (
          <>
            <Sidebar ctl={ctl} />
            <main class="canvas-col" aria-label="Slide editor">
              <Canvas ctl={ctl} />
              <NotesPane ctl={ctl} />
              <StatusBar ctl={ctl} />
            </main>
            {panel === 'layers' && <LayersPanel ctl={ctl} />}
            {panel === 'history' && <HistoryPanel ctl={ctl} />}
            {panel === 'find' && <FindPanel ctl={ctl} />}
            {panel === 'a11y' && <A11yPanel ctl={ctl} />}
            {panel === 'theme' && <ThemeEditor ctl={ctl} />}
            {(panel === 'inspector' || !panel) && <Inspector ctl={ctl} />}
          </>
        )}
      </div>
    </div>
  );
}

export { toast };
