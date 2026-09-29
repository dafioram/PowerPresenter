// Text editing with ProseMirror (spec §3.3). The engine's editable DOM replaces
// the rendered text flow and uses the same styling rules.
import { EditorState, TextSelection, Plugin, AllSelection } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, splitBlockAs, chainCommands, deleteSelection, joinBackward, selectAll } from 'prosemirror-commands';
import { AddMarkStep, RemoveMarkStep, AttrStep, ReplaceAroundStep } from 'prosemirror-transform';
import { schema, bodyToPm, pmToBody, renderEnv } from './pm-schema.js';
import { listMarkers } from '../../core/text.js';
import { applyRunStyle } from '../../render/text.js';
import { fitPx } from '../../render/dom.js';

function markerPlugin(getBullets) {
  return new Plugin({
    props: {
      decorations(state) {
        const decos = [];
        const paras = [];
        state.doc.forEach((node, offset) => paras.push({ node, offset }));
        const markers = listMarkers(paras.map(({ node }) => ({ list: node.attrs.list })), getBullets());
        paras.forEach(({ node, offset }, i) => {
          if (!node.attrs.list) return;
          const level = node.attrs.list.level || 0;
          const text = markers[i];
          decos.push(
            Decoration.widget(
              offset + 1,
              () => {
                const env = renderEnv;
                const mk = document.createElement('span');
                mk.className = 'pe-marker';
                mk.contentEditable = 'false';
                mk.setAttribute('aria-hidden', 'true');
                mk.style.insetInlineStart = fitPx(env.indent * level);
                mk.style.width = fitPx(env.indent);
                if (env.ctx && env.base) {
                  let first = null;
                  node.forEach((c) => {
                    if (!first && c.isText) first = c;
                  });
                  const run = { ...env.base.run };
                  if (first) for (const m of first.marks) if (m.type.name !== 'link') run[m.type.name] = m.attrs.value;
                  applyRunStyle(mk, { ...run, underline: false, strike: false, highlight: null, script: 'normal', link: null }, env.ctx);
                }
                mk.textContent = text;
                return mk;
              },
              { side: -1, key: `mk-${i}-${text}-${level}`, ignoreSelection: true },
            ),
          );
        });
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

function paragraphsInSelection(state) {
  const out = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === schema.nodes.paragraph) out.push({ node, pos });
    return false;
  });
  if (!out.length) {
    const $f = state.selection.$from;
    out.push({ node: $f.parent, pos: $f.before($f.depth) });
  }
  return out;
}

export class TextSession {
  // opts: { flowEl, body, ctx, base, bullets, indent, onChange(body, { formatting }), onExit(reason),
  //         onUndo, onRedo, onLink, onTab(shift) (table cells), onSelectionChange, kind }
  constructor(opts) {
    this.opts = opts;
    this.env = { ctx: opts.ctx, base: opts.base, indent: opts.indent ?? 28 };
    this.lastFrom = null;
    const splitKeep = (state, dispatch) =>
      splitBlockAs((n) => ({ type: n.type, attrs: n.attrs }))(state, dispatch && ((tr) => {
        const marks = state.storedMarks || (state.selection.$to.parentOffset && state.selection.$from.marks());
        if (marks) tr.ensureMarks(marks);
        dispatch(tr);
      }));
    const enter = (state, dispatch) => {
      const $f = state.selection.$from;
      const para = $f.parent;
      if (state.selection.empty && para.attrs.list && para.content.size === 0) {
        const lvl = para.attrs.list.level || 0;
        const list = lvl > 0 ? { ...para.attrs.list, level: lvl - 1 } : null;
        if (dispatch) dispatch(state.tr.setNodeMarkup($f.before($f.depth), null, { ...para.attrs, list }));
        return true;
      }
      return splitKeep(state, dispatch);
    };
    const hardBreak = (state, dispatch) => {
      if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
      return true;
    };
    const tab = (shift) => (state, dispatch) => {
      if (opts.onTab) {
        opts.onTab(shift);
        return true;
      }
      const paras = paragraphsInSelection(state);
      if (paras.some((p) => p.node.attrs.list)) {
        if (dispatch) {
          const tr = state.tr;
          for (const { node, pos } of paras) {
            if (!node.attrs.list) continue;
            const level = Math.max(0, Math.min(8, (node.attrs.list.level || 0) + (shift ? -1 : 1)));
            tr.setNodeMarkup(pos, null, { ...node.attrs, list: { ...node.attrs.list, level } });
          }
          dispatch(tr);
        }
        return true;
      }
      if (shift) return true;
      if (dispatch) dispatch(state.tr.insertText('\t'));
      return true;
    };
    const backspaceList = (state, dispatch) => {
      const { $from, empty } = state.selection;
      if (!empty || $from.parentOffset !== 0) return false;
      const para = $from.parent;
      if (!para.attrs.list) return false;
      const lvl = para.attrs.list.level || 0;
      if (dispatch) dispatch(state.tr.setNodeMarkup($from.before($from.depth), null, { ...para.attrs, list: lvl > 0 ? { ...para.attrs.list, level: lvl - 1 } : null }));
      return true;
    };
    // Toggles relative to the container's base style (a bold title un-bolds to 400).
    const toggle = (key, on, offVal) => (state, dispatch) => {
      const marks = this.activeMarks(state);
      const baseVal = this.env.base?.run?.[key];
      const cur = marks[key] !== undefined ? marks[key] : baseVal;
      const isOn = key === 'weight' ? (cur || 400) >= 600 : !!cur;
      const baseOn = key === 'weight' ? (baseVal || 400) >= 600 : !!baseVal;
      const next = isOn ? (baseOn ? offVal : null) : baseOn ? null : on;
      this.setMark(key, next, state, dispatch);
      return true;
    };
    const keys = keymap({
      Enter: enter,
      'Shift-Enter': hardBreak,
      Tab: tab(false),
      'Shift-Tab': tab(true),
      Backspace: chainCommands(backspaceList, deleteSelection, joinBackward),
      'Mod-b': toggle('weight', 700, 400),
      'Mod-i': toggle('italic', true, false),
      'Mod-u': toggle('underline', true, false),
      'Mod-Shift-x': toggle('strike', true, false),
      'Mod-k': () => {
        opts.onLink?.();
        return true;
      },
      'Mod-z': () => {
        opts.onUndo?.();
        return true;
      },
      'Mod-Shift-z': () => {
        opts.onRedo?.();
        return true;
      },
      'Mod-y': () => {
        opts.onRedo?.();
        return true;
      },
      'Mod-a': selectAll,
      Escape: () => {
        opts.onExit?.('escape');
        return true;
      },
    });
    this.plugins = [keys, keymap(baseKeymap), markerPlugin(() => opts.bullets || ['•'])];
    const state = EditorState.create({ doc: bodyToPm(opts.body), plugins: this.plugins });
    this.mount(opts.flowEl, state);
  }

  mount(flowEl, state) {
    renderEnv.ctx = this.env.ctx;
    renderEnv.base = this.env.base;
    renderEnv.indent = this.env.indent;
    this.flowEl = flowEl;
    flowEl.replaceChildren();
    this.view = new EditorView(
      { mount: flowEl },
      {
        state,
        attributes: { class: 'pe-flow editing-text', spellcheck: 'true', lang: this.opts.ctx.doc.metadata?.language || 'en', role: 'textbox', 'aria-multiline': 'true', 'aria-label': this.opts.label || 'Text' },
        dispatchTransaction: (tr) => this.onTransaction(tr),
        handleDOMEvents: {
          blur: () => {
            this.opts.onBlur?.();
            return false;
          },
        },
      },
    );
  }

  // Re-attaches the editor after the canvas re-rendered the slide.
  remount(flowEl) {
    // ProseMirror reads native caret moves (arrow keys, Ctrl+End, clicks) on
    // the next selectionchange event. Pick up any pending one before the old
    // view goes away, or the caret would jump back to its previous position.
    try {
      this.view.domObserver?.flush?.();
    } catch {
      /* internal API; keep the last known state */
    }
    const state = this.view.state;
    this.view.destroy();
    this.mount(flowEl, state);
    this.view.focus();
  }

  onTransaction(tr) {
    renderEnv.ctx = this.env.ctx;
    renderEnv.base = this.env.base;
    renderEnv.indent = this.env.indent;
    const prev = this.view.state;
    const state = prev.apply(tr);
    this.view.updateState(state);
    const formatting = tr.steps.some((s) => s instanceof AddMarkStep || s instanceof RemoveMarkStep || s instanceof AttrStep || s instanceof ReplaceAroundStep) || (tr.docChanged && tr.steps.every((s) => s.jsonID === 'replace' && s.slice.size === 0 && s.from === s.to) && false);
    const setsNodeMarkup = tr.steps.some((s) => s.jsonID === 'replaceAround' || s.jsonID === 'attr');
    if (tr.docChanged) {
      this.opts.onChange?.(pmToBody(state.doc), { formatting: formatting || setsNodeMarkup });
    } else if (tr.selectionSet) {
      const from = state.selection.from;
      if (this.lastFrom !== null && Math.abs(from - this.lastFrom) > 1) this.opts.onSelectionJump?.();
    }
    this.lastFrom = state.selection.from;
    this.opts.onSelectionChange?.();
  }

  focus() {
    this.view.focus();
  }

  selectAllText() {
    const { state } = this.view;
    this.view.dispatch(state.tr.setSelection(new AllSelection(state.doc)));
  }

  placeCursorAt(clientX, clientY) {
    const { state } = this.view;
    const pos = this.view.posAtCoords({ left: clientX, top: clientY });
    // A point outside the text (empty space in the box) puts the caret at the end.
    const at = pos ? pos.pos : TextSelection.atEnd(state.doc).from;
    this.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, at)));
  }

  activeMarks(state = this.view.state) {
    const out = {};
    const marks = state.storedMarks || state.selection.$from.marks();
    for (const m of marks) out[m.type.name] = m.attrs.value;
    if (!state.selection.empty) {
      // first character's marks
      const $pos = state.doc.resolve(state.selection.from + 1 <= state.doc.content.size ? state.selection.from : state.selection.from);
      const node = $pos.nodeAfter;
      if (node) for (const m of node.marks) out[m.type.name] = m.attrs.value;
    }
    return out;
  }

  activeParagraph() {
    const $f = this.view.state.selection.$from;
    return $f.parent.attrs;
  }

  setMark(key, value, state = this.view.state, dispatch = (tr) => this.view.dispatch(tr)) {
    const type = schema.marks[key];
    const { from, to, empty } = state.selection;
    let tr = state.tr;
    if (empty) {
      const marks = (state.storedMarks || state.selection.$from.marks()).filter((m) => m.type !== type);
      tr = tr.setStoredMarks(value === null || value === undefined ? marks : [...marks, type.create({ value })]);
    } else {
      tr = tr.removeMark(from, to, type);
      if (value !== null && value !== undefined) tr = tr.addMark(from, to, type.create({ value }));
    }
    dispatch(tr);
    this.view.focus();
  }

  setParagraphAttr(key, value) {
    const { state } = this.view;
    const tr = state.tr;
    for (const { node, pos } of paragraphsInSelection(state)) tr.setNodeMarkup(pos, null, { ...node.attrs, [key]: value });
    this.view.dispatch(tr);
    this.view.focus();
  }

  toggleList(kind, numberStyle) {
    const { state } = this.view;
    const paras = paragraphsInSelection(state);
    const allOn = paras.every((p) => p.node.attrs.list?.kind === kind && (!numberStyle || (p.node.attrs.list.number_style || 'decimal') === numberStyle));
    const tr = state.tr;
    for (const { node, pos } of paras) {
      const list = allOn ? null : { kind, level: node.attrs.list?.level || 0, ...(kind === 'number' && numberStyle && numberStyle !== 'decimal' ? { number_style: numberStyle } : {}) };
      tr.setNodeMarkup(pos, null, { ...node.attrs, list });
    }
    this.view.dispatch(tr);
    this.view.focus();
  }

  changeLevel(delta) {
    const { state } = this.view;
    const tr = state.tr;
    for (const { node, pos } of paragraphsInSelection(state)) {
      if (!node.attrs.list) continue;
      const level = Math.max(0, Math.min(8, (node.attrs.list.level || 0) + delta));
      tr.setNodeMarkup(pos, null, { ...node.attrs, list: { ...node.attrs.list, level } });
    }
    this.view.dispatch(tr);
    this.view.focus();
  }

  insertField(field, extra = {}) {
    const node = schema.nodes.field.create({ field, format: extra.format || null, value: extra.value || null });
    this.view.dispatch(this.view.state.tr.replaceSelectionWith(node));
    this.view.focus();
  }

  setLink(link) {
    const { state } = this.view;
    let { from, to, empty } = state.selection;
    if (empty) {
      // extend to the link around the cursor, or insert the URL text
      if (link && link.kind === 'url') {
        const text = link.href.replace(/^mailto:|^tel:/, '');
        const node = schema.text(text, [...state.selection.$from.marks(), schema.marks.link.create({ value: link })]);
        this.view.dispatch(state.tr.replaceSelectionWith(node, false));
        this.view.focus();
        return;
      }
      const $f = state.selection.$from;
      const parent = $f.parent;
      let start = $f.parentOffset;
      let end = $f.parentOffset;
      const has = (i) => parent.childAfter(i).node?.marks.some((m) => m.type === schema.marks.link);
      while (start > 0 && has(start - 1)) start--;
      while (end < parent.content.size && has(end)) end++;
      from = $f.start() + start;
      to = $f.start() + end;
    }
    let tr = state.tr.removeMark(from, to, schema.marks.link);
    if (link) tr = tr.addMark(from, to, schema.marks.link.create({ value: link }));
    this.view.dispatch(tr);
    this.view.focus();
  }

  selectedText() {
    const { from, to } = this.view.state.selection;
    return this.view.state.doc.textBetween(from, to, ' ');
  }

  // Replaces the document from the model (after undo/redo), keeping selection.
  syncFromBody(body) {
    const doc = bodyToPm(body);
    const { from, to } = this.view.state.selection;
    const max = doc.content.size;
    let state = EditorState.create({ doc, plugins: this.plugins });
    try {
      const wasAll = this.view.state.selection instanceof AllSelection;
      const sel = wasAll ? new AllSelection(doc) : TextSelection.between(doc.resolve(Math.min(from, max)), doc.resolve(Math.min(to, max)));
      state = state.apply(state.tr.setSelection(sel));
    } catch {
      /* keep default selection */
    }
    this.view.updateState(state);
  }

  body() {
    return pmToBody(this.view.state.doc);
  }

  destroy() {
    const body = this.body();
    this.view.destroy();
    return body;
  }
}
