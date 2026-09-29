// Status bar (spec §12.1): zoom, slide position, units, snapping and grid.
import { IconButton, useSignal } from '../ui/components.jsx';
import { settings, updateSettings } from '../settings.js';
import { slideOrder } from '../../core/model.js';
import { unionBoxes } from '../../core/geometry.js';
import { setGrid } from './menus.js';

const ZOOMS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function viewport() {
  const el = document.querySelector('.canvas-scroll');
  return el ? { w: el.clientWidth, h: el.clientHeight, el } : null;
}

export function currentScale(ctl) {
  const vp = viewport();
  if (ctl.state.zoom !== 'fit') return ctl.state.zoom;
  if (!vp) return 1;
  const { width: W, height: H } = ctl.doc.size;
  return Math.max(0.05, Math.min((vp.w - 160) / W, (vp.h - 160) / H));
}

export function stepZoom(ctl, dir) {
  const s = currentScale(ctl);
  const next = dir > 0 ? ZOOMS.find((z) => z > s + 0.001) || 4 : [...ZOOMS].reverse().find((z) => z < s - 0.001) || 0.1;
  ctl.set({ zoom: next });
}

export function zoomToSelection(ctl) {
  const items = ctl.boxesFor(ctl.state.selection);
  const vp = viewport();
  if (!items.length || !vp) return;
  const b = unionBoxes(items.map((i) => i.box));
  const z = Math.max(0.1, Math.min(4, Math.min((vp.w - 80) / Math.max(1, b.width), (vp.h - 80) / Math.max(1, b.height))));
  ctl.set({ zoom: Math.round(z * 100) / 100 });
  setTimeout(() => {
    const v = viewport();
    const stage = v?.el.querySelector('.stage');
    if (!stage) return;
    const sr = stage.getBoundingClientRect();
    const vr = v.el.getBoundingClientRect();
    const cx = sr.left - vr.left + v.el.scrollLeft + (b.x + b.width / 2) * z;
    const cy = sr.top - vr.top + v.el.scrollTop + (b.y + b.height / 2) * z;
    v.el.scrollLeft = cx - v.w / 2;
    v.el.scrollTop = cy - v.h / 2;
  }, 50);
}

export function StatusBar({ ctl }) {
  const st = ctl.state;
  const s = useSignal(settings);
  const order = slideOrder(ctl.doc);
  const idx = order.indexOf(st.slideId);
  const grid = ctl.doc.authoring?.grid || {};
  const pct = Math.round(currentScale(ctl) * 100);
  return (
    <footer class="statusbar" aria-label="Status bar">
      <span data-testid="slide-position">{st.mode === 'master' ? 'Master' : st.mode === 'layout' ? 'Layout' : `Slide ${idx + 1} of ${order.length}`}</span>
      {st.selection.length > 0 && <span>{st.selection.length} selected</span>}
      <span class="spacer" />
      <label class="field is-compact">
        <span class="sr-only">Units</span>
        <select class="input select units-select" value={s.measure} onChange={(e) => updateSettings({ measure: e.currentTarget.value })} aria-label="Measurement units">
          <option value="units">units</option>
          <option value="in">in</option>
          <option value="cm">cm</option>
        </select>
      </label>
      <IconButton icon="fit" class="is-small" label="Snap to guides and elements" pressed={s.snap !== false} onClick={() => updateSettings({ snap: s.snap === false })} />
      <IconButton icon="grid" class="is-small" label="Show grid" pressed={!!grid.visible} disabled={st.readOnly} onClick={() => setGrid(ctl, { visible: !grid.visible })} />
      <button type="button" class={`chip ${grid.snap ? 'is-on' : ''}`} disabled={st.readOnly} onClick={() => setGrid(ctl, { snap: !grid.snap })} aria-pressed={!!grid.snap}>Snap to grid</button>
      <IconButton icon="notes" class="is-small" label={st.notesOpen ? 'Hide notes' : 'Show notes'} pressed={st.notesOpen} onClick={() => ctl.set({ notesOpen: !st.notesOpen })} />
      <span class="sep-v" />
      <IconButton icon="zoomOut" class="is-small" label="Zoom out" onClick={() => stepZoom(ctl, -1)} />
      <label class="field is-compact">
        <span class="sr-only">Zoom</span>
        <select class="input select zoom-select" aria-label="Zoom" value={st.zoom === 'fit' ? 'fit' : String(st.zoom)} onChange={(e) => { const v = e.currentTarget.value; if (v === 'sel') zoomToSelection(ctl); else ctl.set({ zoom: v === 'fit' ? 'fit' : Number(v) }); }} data-testid="zoom">
          <option value="fit">Fit ({pct}%)</option>
          {st.zoom !== 'fit' && !ZOOMS.includes(st.zoom) && <option value={String(st.zoom)}>{pct}%</option>}
          {ZOOMS.map((z) => <option key={z} value={String(z)}>{Math.round(z * 100)}%</option>)}
          <option value="sel" disabled={!st.selection.length}>Zoom to selection</option>
        </select>
      </label>
      <IconButton icon="zoomIn" class="is-small" label="Zoom in" onClick={() => stepZoom(ctl, 1)} />
    </footer>
  );
}
