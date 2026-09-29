// Speaker notes pane (spec §5.13, §12.1): resizable and collapsible, with a
// fixed readable style instead of the theme.
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconButton, openDialog } from '../ui/components.jsx';
import { TextSession } from './text-session.js';
import { containerBaseStyle } from '../../core/theme.js';
import { makeContext } from '../../render/renderer.js';
import { isBodyEmpty } from '../../core/text.js';
import { LinkDialog } from './dialogs/LinkDialog.jsx';

const EMPTY = { paragraphs: [{ inlines: [] }] };

export function NotesPane({ ctl }) {
  const st = ctl.state;
  const hostRef = useRef(null);
  const sessRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const slide = st.mode === 'slide' ? ctl.slide : null;
  const open = st.notesOpen && !!slide;

  useEffect(() => {
    if (!open || !hostRef.current) return undefined;
    const host = hostRef.current;
    const flow = document.createElement('div');
    host.replaceChildren(flow);
    const sid = slide.id;
    const ctx = makeContext(ctl.doc, { mode: 'edit' });
    const s = new TextSession({
      flowEl: flow,
      body: slide.notes || EMPTY,
      ctx,
      base: containerBaseStyle(ctl.doc.theme, { kind: 'notes' }),
      bullets: ['•', '–', '◦', '▪'],
      indent: 22,
      label: 'Speaker notes',
      onChange: (body) => {
        if (ctl.state.slideId === sid && !ctl.state.readOnly) ctl.setNotes(body);
      },
      onExit: () => document.querySelector('[data-testid="canvas"]')?.focus(),
      onUndo: () => ctl.undo(),
      onRedo: () => ctl.redo(),
      onSelectionJump: () => ctl.store?.breakCoalescing(),
      onLink: async () => {
        const cur = s.activeMarks().link;
        const r = await openDialog(LinkDialog, { value: cur || null, doc: ctl.doc, hasText: true });
        if (r !== undefined && (r === null || r.kind === 'url')) s.setLink(r);
      },
      onBlur: () => setFocused(false),
    });
    s.view.dom.addEventListener('focus', () => setFocused(true));
    s.view.dom.classList.add('notes-editor');
    if (ctl.state.readOnly) s.view.setProps({ editable: () => false });
    sessRef.current = s;
    ctl.notesSession = s;
    return () => {
      s.destroy();
      sessRef.current = null;
      if (ctl.notesSession === s) ctl.notesSession = null;
    };
  }, [st.slideId, open, st.readOnly, ctl]);

  // keep in sync with undo/redo
  useEffect(() => {
    const s = sessRef.current;
    if (!s || !slide) return;
    const want = slide.notes || EMPTY;
    if (JSON.stringify(s.body()) !== JSON.stringify(want) && !s.view.hasFocus()) s.syncFromBody(want);
  }, [slide?.notes]);

  const startResize = (e) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = st.notesHeight;
    const move = (ev) => ctl.set({ notesHeight: Math.max(60, Math.min(window.innerHeight * 0.6, h0 - (ev.clientY - y0))) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (st.mode !== 'slide') return null;
  const empty = !slide?.notes || isBodyEmpty(slide.notes);
  return (
    <section class="notes-pane" aria-label="Speaker notes" style={open ? { height: `${st.notesHeight}px` } : undefined}>
      {open && (
        <div
          class="notes-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize notes"
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') ctl.set({ notesHeight: Math.min(window.innerHeight * 0.6, st.notesHeight + 20) });
            if (e.key === 'ArrowDown') ctl.set({ notesHeight: Math.max(60, st.notesHeight - 20) });
          }}
        />
      )}
      <div class="notes-head">
        <IconButton icon={open ? 'chevronDown' : 'chevronUp'} class="is-small" label={open ? 'Hide notes' : 'Show notes'} onClick={() => ctl.set({ notesOpen: !st.notesOpen })} />
        <span>Speaker notes</span>
      </div>
      {open && (
        <div class="notes-body" onClick={() => sessRef.current?.focus()}>
          {empty && !focused && <div class="notes-placeholder">Click to add speaker notes</div>}
          <div ref={hostRef} class="notes-host" data-testid="notes" />
        </div>
      )}
    </section>
  );
}
