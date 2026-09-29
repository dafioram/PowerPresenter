// Editor commands shared by menus, toolbars and keyboard shortcuts.
import { makePayload, writeClipboard, readPayload, pastePayload, pasteExternal } from './clipboard.js';
import { toast, announce } from '../ui/components.jsx';
import { MOD } from '../settings.js';
import { slideOrder } from '../../core/model.js';
import * as ops from '../../core/ops.js';
import { captureFormat, applyFormat } from './format.js';

// Where copy/cut/paste apply: 'slides' when the slide list has focus.
export function clipboardScope() {
  const a = document.activeElement;
  if (a?.closest?.('[data-clipboard-scope="slides"]')) return 'slides';
  return 'elements';
}

export function isTypingTarget(t) {
  if (!t || !t.closest) return false;
  return !!t.closest('input, textarea, select, [contenteditable="true"], .ProseMirror');
}

// Handles a native copy/cut event. Returns true when handled.
export function handleCopy(ctl, e, { cut = false } = {}) {
  if (!ctl.doc || ctl.textSession || isTypingTarget(e.target)) return false;
  const scope = clipboardScope();
  if (scope === 'slides') {
    const ids = slideOrder(ctl.doc).filter((id) => ctl.state.slideSelection.includes(id));
    if (!ids.length) return false;
    writeClipboard(e, makePayload(ctl, { kind: 'slides', slides: ids.map((id) => ctl.doc.slides[id]) }));
    if (cut) ctl.deleteSlides(ids);
    announce(`${ids.length} slide${ids.length === 1 ? '' : 's'} ${cut ? 'cut' : 'copied'}`);
    return true;
  }
  const els = ctl.selectedElements();
  if (!els.length) return false;
  writeClipboard(e, makePayload(ctl, { kind: 'elements', elements: els }));
  if (cut) ctl.deleteSelection();
  announce(cut ? 'Cut' : 'Copied');
  return true;
}

// Handles pasted data (from a paste event or the async clipboard).
export async function handlePasteData(ctl, dt, { plain = false } = {}) {
  if (ctl.state.readOnly) {
    toast('This presentation is read-only here.', { kind: 'info', id: 'ro' });
    return;
  }
  const payload = plain ? null : readPayload(dt);
  if (payload) {
    const ok = await pastePayload(ctl, payload);
    if (ok && payload.source !== ctl.doc.id && payload.kind === 'elements') {
      toast('Pasted with this presentation’s theme.', {
        kind: 'info',
        duration: 8000,
        id: 'paste-options',
        action: {
          label: 'Keep source formatting',
          onClick: async () => {
            ctl.undo();
            await pastePayload(ctl, payload, { keepSource: true });
          },
        },
      });
    }
    return;
  }
  await pasteExternal(ctl, dt, { plain });
}

// Copy/cut/paste from menus: native events for copy/cut, async clipboard for paste.
export function menuCopy(cut = false) {
  const ok = document.execCommand(cut ? 'cut' : 'copy');
  if (!ok) toast(`Use ${MOD}+${cut ? 'X' : 'C'} to ${cut ? 'cut' : 'copy'}.`, { kind: 'info' });
}

export async function menuPaste(ctl, { plain = false } = {}) {
  try {
    if (!navigator.clipboard?.read) throw new Error('unsupported');
    const items = await navigator.clipboard.read();
    const dt = new DataTransfer();
    for (const it of items) {
      for (const type of it.types) {
        const blob = await it.getType(type);
        if (type.startsWith('image/')) dt.items.add(new File([blob], `pasted.${type.split('/')[1].replace('svg+xml', 'svg')}`, { type }));
        else if (type === 'text/html' || type === 'text/plain') dt.setData(type, await blob.text());
      }
    }
    await handlePasteData(ctl, dt, { plain });
  } catch {
    toast(`Use ${MOD}+V to paste${plain ? ' (or ' + MOD + '+Shift+V for plain text)' : ''}.`, { kind: 'info' });
  }
}

// ---------- format painter (spec §12.5) ----------
export function copyFormat(ctl, { sticky = false } = {}) {
  const el = ctl.selectedElements()[0];
  if (!el) {
    toast('Select an element to copy its formatting.', { kind: 'info' });
    return;
  }
  ctl.set({ formatPainter: { ...captureFormat(el), sticky } });
  announce(sticky ? 'Format painter on. Click elements to apply; press Esc to stop.' : 'Formatting copied. Click an element to apply it.');
}

export function pasteFormat(ctl) {
  const fp = ctl.state.formatPainter;
  if (!fp) {
    toast('Copy formatting first.', { kind: 'info' });
    return;
  }
  const ids = ctl.state.selection;
  if (!ids.length) return;
  ctl.dispatch('Paste formatting', (d) => ops.updateElements(d, ctl.container, ids, (x) => applyFormat(x, fp)));
}

// ---------- selection cycling ----------
export function cycleSelection(ctl, dir) {
  const list = ctl.state.enteredGroup ? ctl.find(ctl.state.enteredGroup)?.el.group.children || [] : ctl.elements();
  const els = list.filter((e) => !e.hidden && !e.locked);
  if (!els.length) return;
  const cur = els.findIndex((e) => e.id === ctl.state.selection[0]);
  const next = cur < 0 ? (dir > 0 ? 0 : els.length - 1) : (cur + dir + els.length) % els.length;
  ctl.select([els[next].id]);
}

// ---------- links ----------
export function openLink(ctl) {
  if (ctl.openLinkDialog) ctl.openLinkDialog();
}

export { parseRange } from '../../core/range.js';
