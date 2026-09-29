// Element-specific inspector sections: geometry, style, text box, shape,
// image, video, table and chart (spec §13).
import { useState } from 'preact/hooks';
import { NumberField, Select, Checkbox, Button, IconButton, TextInput, openDialog, toast, Segmented, useSignal } from '../../ui/components.jsx';
import { ColorPicker } from '../../ui/ColorPicker.jsx';
import { Icon } from '../../ui/icons.jsx';
import { FillEditor, StrokeEditor, ShadowEditor, ArrowheadsEditor } from './style-editors.jsx';
import { settings } from '../../settings.js';
import { MEASURES, toMeasure, fromMeasure, roundLen, unitsToPt, ptToUnits } from '../../../core/units.js';
import { geometryKind } from '../../../core/geometry.js';
import { SHAPES, SHAPE_MAP, shapeAdjust } from '../../../core/shapes.js';
import { TEXT_ROLES, ROLE_LABELS } from '../../../core/theme.js';
import { convertChartKind } from '../../../core/charts.js';
import { insertRow, insertColumn, deleteRow, deleteColumn, mergeCells, splitCell, distributeColumns, distributeRows, resizeTable, tableGrid } from '../../../core/tables.js';
import { elementLabel } from '../../../core/model.js';
import * as ops from '../../../core/ops.js';
import { ChartDataDialog } from '../dialogs/ChartDataDialog.jsx';
import { replaceImage, addCaptions } from '../menus.js';
import { openLink } from '../commands.js';
import { ShapePicker } from '../TopBar.jsx';
import { Popover, usePopover } from '../../ui/components.jsx';

export function Section({ title, children, actions }) {
  return (
    <section class="insp-section">
      <h3>{title}{actions && <span class="spacer" />}{actions}</h3>
      {children}
    </section>
  );
}

// Sets a style property on elements, adding a new asset record if needed.
export function setStyle(ctl, ids, key, value, record = null, label) {
  ctl.dispatch(label || `Change ${key}`, (d) => {
    if (record && !d.assets.some((a) => a.id === record.id)) d.assets.push(record);
    ops.setProps(d, ctl.container, ids, { [`style.${key}`]: value });
  }, { coalesce: `style:${ids.join()}:${key}`, window: 600 });
}

// ---------- geometry ----------
export function GeometrySection({ ctl, el }) {
  const measure = useSignal(settings).measure || 'units';
  const m = MEASURES[measure];
  const ro = ctl.state.readOnly || el.locked;
  const kind = geometryKind(el);
  const [lockAspect, setLockAspect] = useState(el.type === 'image' || el.type === 'video' || el.type === 'group');
  const T = (v) => toMeasure(v, measure);
  const F = (v) => fromMeasure(v, measure);
  const upd = (fn, label = 'Move') => ctl.updateElements([el.id], fn, label, `geom:${el.id}:${label}`);
  if (kind === 'points') {
    const g = el.geometry;
    const pt = (which, axis) => (g[which].element_id ? null : T(g[which][axis]));
    return (
      <Section title="Position">
        <div class="insp-grid">
          {['start', 'end'].flatMap((which) => ['x', 'y'].map((axis) => (
            <NumberField key={which + axis} compact label={`${which === 'start' ? 'Start' : 'End'} ${axis.toUpperCase()}`} unit={m.label} value={pt(which, axis)} disabled={ro || !!g[which].element_id} precision={m.digits} onChange={(v) => upd((x) => { x.geometry[which] = { ...x.geometry[which], [axis]: F(v) }; })} />
          )))}
        </div>
        {(g.start.element_id || g.end.element_id) && <p class="small muted">Attached ends follow their shapes. Drag an end away to detach it.</p>}
      </Section>
    );
  }
  if (el.type === 'table') {
    const w = el.table.columns.reduce((s, c) => s + c.width, 0);
    const h = ctl.state.measured.get(el.id)?.height ?? el.table.rows.reduce((s, r) => s + r.min_height, 0);
    return (
      <Section title="Position and size">
        <div class="insp-grid">
          <NumberField compact label="X" unit={m.label} precision={m.digits} value={T(el.geometry.x)} disabled={ro} onChange={(v) => upd((x) => { x.geometry.x = F(v); })} />
          <NumberField compact label="Y" unit={m.label} precision={m.digits} value={T(el.geometry.y)} disabled={ro} onChange={(v) => upd((x) => { x.geometry.y = F(v); })} />
          <NumberField compact label="Width" unit={m.label} precision={m.digits} value={T(w)} min={T(8 * el.table.columns.length)} disabled={ro} onChange={(v) => upd((x) => { x.table = resizeTable(x.table, F(v), el.table.rows.reduce((s, r) => s + r.min_height, 0)); }, 'Resize')} />
          <NumberField compact label="Height" unit={m.label} precision={m.digits} value={T(h)} disabled title="Rows grow to fit their text" onChange={() => undefined} />
        </div>
      </Section>
    );
  }
  const g = el.geometry;
  const rotatable = ops.canRotate(el);
  const setSize = (dim, v) => {
    const val = Math.max(1, F(v));
    upd((x) => {
      const ratio = g.width / g.height;
      const cx = g.x + g.width / 2;
      const cy = g.y + g.height / 2;
      let w = dim === 'width' ? val : g.width;
      let h = dim === 'height' ? val : g.height;
      if (lockAspect) {
        if (dim === 'width') h = w / ratio;
        else w = h * ratio;
      }
      if (x.type === 'group') {
        const r = ops_resizeGroup(x, { x: g.x, y: g.y, width: w, height: h });
        x.geometry = r.geometry;
        x.group = r.group;
      } else {
        x.geometry.width = roundLen(w);
        x.geometry.height = roundLen(h);
      }
      void cx;
      void cy;
    }, 'Resize');
  };
  return (
    <Section title={ctl.state.enteredGroup ? 'Position and size (in group)' : 'Position and size'}>
      <div class="insp-grid">
        <NumberField compact label="X" unit={m.label} precision={m.digits} value={T(g.x)} disabled={ro} onChange={(v) => upd((x) => { x.geometry.x = F(v); })} />
        <NumberField compact label="Y" unit={m.label} precision={m.digits} value={T(g.y)} disabled={ro} onChange={(v) => upd((x) => { x.geometry.y = F(v); })} />
        <NumberField compact label="Width" unit={m.label} precision={m.digits} value={T(g.width)} min={T(1)} disabled={ro} onChange={(v) => setSize('width', v)} />
        <NumberField compact label="Height" unit={m.label} precision={m.digits} value={T(g.height)} min={T(1)} disabled={ro} onChange={(v) => setSize('height', v)} />
        {rotatable && <NumberField compact label="Rotation" unit="°" precision={1} value={g.rotation || 0} min={-360} max={360} disabled={ro} onChange={(v) => ctl.rotateTo(((v % 360) + 360) % 360, [el.id])} />}
        <div class="field is-compact align-end">
          <Checkbox label="Lock aspect" checked={lockAspect} onChange={setLockAspect} />
        </div>
      </div>
      {rotatable && (
        <div class="row">
          <IconButton icon="flipH" label="Flip horizontal" pressed={!!g.flip_x} disabled={ro} onClick={() => ctl.flip('x')} />
          <IconButton icon="flipV" label="Flip vertical" pressed={!!g.flip_y} disabled={ro} onClick={() => ctl.flip('y')} />
          <IconButton icon="rotate" label="Rotate 90°" disabled={ro} onClick={() => ctl.rotateTo(((g.rotation || 0) + 90) % 360, [el.id])} />
        </div>
      )}
      {el.type === 'text' && ctl.state.measured.get(el.id) && Math.abs(ctl.state.measured.get(el.id).height - g.height) > 1 && (
        <p class="small muted">Shown height {T(ctl.state.measured.get(el.id).height)} {m.label} (text grew the box).</p>
      )}
    </Section>
  );
}

import { resizeGroup as ops_resizeGroup } from '../../../core/geometry.js';

// ---------- common element properties ----------
export function ElementCommon({ ctl, els }) {
  const ro = ctl.state.readOnly;
  const el = els[0];
  const ids = els.map((e) => e.id);
  const opacity = el.opacity ?? 1;
  return (
    <Section title={els.length > 1 ? `${els.length} elements` : elementLabel(el)}>
      {els.length === 1 && <TextInput label="Name (layers panel)" value={el.name || ''} placeholder={elementLabel({ ...el, name: undefined })} maxLength={100} disabled={ro} onCommit={(v) => ctl.setProps({ name: v.trim() || undefined }, ids, 'Rename')} />}
      <div class="range-field">
        <label class="field-label" for={`op-${el.id}`}>Opacity</label>
        <input id={`op-${el.id}`} type="range" min="0" max="100" value={Math.round(opacity * 100)} disabled={ro} onInput={(e) => ctl.setProps({ opacity: Number(e.currentTarget.value) === 100 ? undefined : Number(e.currentTarget.value) / 100 }, ids, 'Change opacity')} onPointerUp={() => ctl.store?.breakCoalescing()} />
        <span class="small muted">{Math.round(opacity * 100)}%</span>
      </div>
      <div class="row-wrap">
        <Checkbox label="Locked" checked={els.every((e) => e.locked)} disabled={ro} onChange={(v) => ctl.setProps({ locked: v ? true : undefined }, ids, v ? 'Lock' : 'Unlock')} />
        <Checkbox label="Hidden" checked={els.every((e) => e.hidden)} disabled={ro} onChange={(v) => { ctl.setProps({ hidden: v ? true : undefined }, ids, v ? 'Hide' : 'Show'); }} />
      </div>
      {els.length === 1 && (
        <div class="row">
          <span class="small grow">{el.link ? <>Link: <strong>{describeLink(ctl.doc, el.link)}</strong></> : <span class="muted">No link on the element</span>}</span>
          <Button class="btn-sm" icon="link" disabled={ro} onClick={() => openLink(ctl)}>{el.link ? 'Edit' : 'Add link'}</Button>
        </div>
      )}
    </Section>
  );
}

export function describeLink(doc, link) {
  if (!link) return '';
  if (link.kind === 'url') return link.href.replace(/^https?:\/\//, '').slice(0, 40);
  if (link.kind === 'slide') {
    const n = Object.keys(doc.slides).length ? (doc.sections.flatMap((s) => s.slide_ids).indexOf(link.slide_id) + 1) : 0;
    return n ? `Slide ${n}` : 'Missing slide';
  }
  return { next: 'Next slide', previous: 'Previous slide', first: 'First slide', last: 'Last slide' }[link.target];
}

// ---------- style ----------
export function StyleSection({ ctl, els }) {
  const types = new Set(els.map((e) => e.type));
  const ids = els.map((e) => e.id);
  const el = els[0];
  const has = (k) => els.every((e) => ({ text: ['fill', 'stroke', 'shadow'], shape: ['fill', 'stroke', 'shadow'], image: ['stroke', 'shadow'], line: ['stroke', 'shadow', 'arrowheads'], connector: ['stroke', 'shadow', 'arrowheads'], chart: ['fill', 'stroke', 'shadow'], video: ['stroke', 'shadow'] }[e.type] || []).includes(k));
  if (!has('stroke') && !has('fill')) return null;
  const isLine = types.has('line') || types.has('connector');
  const st = el.style || {};
  const hasOverrides = els.some((e) => e.style && Object.keys(e.style).length);
  return (
    <Section
      title="Style"
      actions={hasOverrides && <button type="button" class="link-btn" disabled={ctl.state.readOnly} onClick={() => ctl.setProps({ style: undefined }, ids, 'Reset to theme')}>Reset to theme</button>}
    >
      {has('fill') && <FillEditor ctl={ctl} value={st.fill} onChange={(v, rec) => setStyle(ctl, ids, 'fill', v, rec, 'Change fill')} />}
      {has('stroke') && <StrokeEditor ctl={ctl} label={isLine ? 'Line' : 'Border'} value={st.stroke} lineOptions={isLine} allowDefault onChange={(v) => setStyle(ctl, ids, 'stroke', v, null, isLine ? 'Change line' : 'Change border')} />}
      {has('arrowheads') && <ArrowheadsEditor ctl={ctl} value={st.arrowheads} onChange={(v) => setStyle(ctl, ids, 'arrowheads', v, null, 'Change arrowheads')} />}
      {el.type === 'connector' && els.length === 1 && (
        <Segmented label="Routing" value={el.connector.routing} onChange={(v) => ctl.setProps({ 'connector.routing': v }, ids, 'Change routing')} options={[{ value: 'straight', label: 'Straight' }, { value: 'elbow', label: 'Elbow' }]} />
      )}
      {has('shadow') && <ShadowEditor ctl={ctl} value={st.shadow} onChange={(v) => setStyle(ctl, ids, 'shadow', v, null, 'Change shadow')} />}
    </Section>
  );
}

// ---------- text box ----------
export function TextBoxSection({ ctl, els }) {
  const ro = ctl.state.readOnly;
  const textEls = els.filter((e) => e.type === 'text' || (e.type === 'shape' && e.shape.text));
  if (!textEls.length) return null;
  const el = textEls[0];
  const c = el.text || el.shape.text;
  const box = c.box || {};
  const key = el.type === 'text' ? 'text' : 'shape.text';
  const ids = textEls.map((e) => e.id);
  const ins = box.insets || ctl.doc.theme.defaults?.text_box?.insets || { left: 0, right: 0, top: 0, bottom: 0 };
  const setBox = (patch, label = 'Change text box') => ctl.updateElements(ids, (x) => {
    const t = x.type === 'text' ? x.text : x.shape.text;
    if (!t) return;
    t.box = { ...(t.box || {}), ...patch };
    for (const k of Object.keys(t.box)) if (t.box[k] === undefined) delete t.box[k];
    if (!Object.keys(t.box).length) delete t.box;
  }, label, `box:${ids.join()}`);
  return (
    <Section title="Text box">
      {el.type === 'text' && (
        <Select label="Role" compact value={el.role || ''} disabled={ro} onChange={(v) => ctl.setProps({ role: v || undefined }, textEls.filter((e) => e.type === 'text').map((e) => e.id), 'Change role')} options={[{ value: '', label: 'None (plain text)' }, ...TEXT_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))]} />
      )}
      <div class="insp-grid">
        <Select label="Vertical align" compact value={box.vertical_align || (el.type === 'shape' ? ctl.doc.theme.defaults?.shape?.text?.vertical_align || 'middle' : 'top')} disabled={ro} onChange={(v) => setBox({ vertical_align: v })} options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
        <Select label="Autofit" compact value={box.autofit || (el.type === 'text' ? 'grow' : 'none')} disabled={ro} onChange={(v) => setBox({ autofit: v })} options={[{ value: 'grow', label: 'Grow box' }, { value: 'shrink', label: 'Shrink text' }, { value: 'none', label: 'Off (can overflow)' }]} />
      </div>
      <div class="insp-grid">
        {['left', 'right', 'top', 'bottom'].map((k) => (
          <NumberField key={k} compact label={`Inset ${k}`} value={ins[k]} min={0} max={1000} disabled={ro} onChange={(v) => setBox({ insets: { ...ins, [k]: v } }, 'Change insets')} />
        ))}
      </div>
      {el.type === 'text' && (
        <TextInput label="Placeholder prompt" value={el.text.prompt || ''} maxLength={200} disabled={ro} placeholder="Shown in the editor when empty" onCommit={(v) => ctl.setProps({ [`${key}.prompt`]: v.trim() || undefined }, [el.id], 'Change prompt')} />
      )}
      {ctl.state.overflow.has(el.id) && <p class="small warn-text"><Icon name="alert" size={13} /> Text overflows this box. Turn on autofit or make the box bigger.</p>}
    </Section>
  );
}

// ---------- shape ----------
export function ShapeSection({ ctl, el }) {
  const ro = ctl.state.readOnly;
  const pop = usePopover();
  const shape = SHAPE_MAP.get(el.shape.preset);
  const adj = shapeAdjust(el.shape.preset, el.shape.adjust);
  return (
    <Section title="Shape">
      <div class="row">
        <button ref={pop.anchor} type="button" class="btn btn-sm" disabled={ro} onClick={pop.toggle} aria-haspopup="menu">{shape?.label || el.shape.preset} <Icon name="chevronDown" size={14} /></button>
        <Popover anchor={pop.anchor} open={pop.open} onClose={pop.close} label="Change shape">
          <ShapePicker onClose={pop.close} onPick={(id) => ctl.updateElements([el.id], (x) => { x.shape.preset = id; delete x.shape.adjust; }, 'Change shape')} />
        </Popover>
        {!el.shape.text && <Button class="btn-sm" icon="text" disabled={ro} onClick={() => ctl.startEditing?.(el.id)}>Add text</Button>}
      </div>
      {Object.keys(adj).length > 0 && (
        <div class="insp-grid">
          {Object.entries(adj).map(([k, v]) => (
            <NumberField key={k} compact label={k.replace(/_/g, ' ')} value={v} step={Math.abs(v) <= 1 ? 0.05 : 1} precision={3} disabled={ro} onChange={(nv) => ctl.updateElements([el.id], (x) => { x.shape.adjust = { ...(x.shape.adjust || {}), [k]: nv }; }, 'Adjust shape', `adj:${el.id}`)} />
          ))}
        </div>
      )}
      {shape?.adjust && Object.keys(shape.adjust).length > 0 && <p class="small muted">Drag the yellow handles on the canvas to adjust.</p>}
    </Section>
  );
}

// ---------- image ----------
export function ImageSection({ ctl, el }) {
  const ro = ctl.state.readOnly;
  const rec = ctl.doc.assets.find((a) => a.id === el.image.asset_id);
  const cropping = ctl.state.crop === el.id;
  return (
    <Section title="Image">
      {rec ? <p class="small muted">{rec.original_filename || rec.media_type} · {rec.width && rec.height ? `${Math.round(rec.width)} × ${Math.round(rec.height)} px` : ''}</p> : <p class="small muted">Empty image placeholder. Drop an image on it, or choose one.</p>}
      <div class="row-wrap">
        <Button class="btn-sm" icon="image" disabled={ro} onClick={() => replaceImage(ctl, el)}>{rec ? 'Replace…' : 'Choose image…'}</Button>
        {rec && <Button class="btn-sm" icon="crop" disabled={ro} onClick={() => ctl.set({ crop: cropping ? null : el.id })}>{cropping ? 'Done cropping' : 'Crop'}</Button>}
        {el.image.crop && <Button class="btn-sm" disabled={ro} onClick={() => ctl.setProps({ 'image.crop': undefined }, [el.id], 'Reset crop')}>Reset crop</Button>}
      </div>
      <Select
        label="Mask"
        compact
        value={el.image.mask?.preset || ''}
        disabled={ro}
        onChange={(v) => ctl.setProps({ 'image.mask': v ? { preset: v } : undefined }, [el.id], 'Change mask')}
        options={[{ value: '', label: 'None (rectangle)' }, ...SHAPES.filter((s) => s.id !== 'rect').map((s) => ({ value: s.id, label: s.label }))]}
      />
      {rec && rec.width && (
        <Button class="btn-sm" disabled={ro} onClick={() => ctl.updateElements([el.id], (x) => {
          const cr = x.image.crop || { left: 0, right: 0, top: 0, bottom: 0 };
          const vis = (rec.width * (1 - cr.left - cr.right)) / (rec.height * (1 - cr.top - cr.bottom));
          x.geometry.height = roundLen(x.geometry.width / vis);
        }, 'Reset aspect ratio')}>Reset aspect ratio</Button>
      )}
    </Section>
  );
}

// ---------- video ----------
export function VideoSection({ ctl, el }) {
  const ro = ctl.state.readOnly;
  const v = el.video;
  const rec = ctl.doc.assets.find((a) => a.id === v.asset_id);
  const dur = rec?.duration_ms || 0;
  const set = (patch, label = 'Change video') => ctl.setProps(Object.fromEntries(Object.entries(patch).map(([k, val]) => [`video.${k}`, val])), [el.id], label);
  const [posterAt, setPosterAt] = useState(0);
  return (
    <Section title="Video">
      <p class="small muted">{rec?.original_filename || rec?.media_type}{dur ? ` · ${(dur / 1000).toFixed(1)} s` : ''}</p>
      <div class="insp-grid">
        <Select label="Start" compact value={v.start || 'manual'} disabled={ro} onChange={(x) => set({ start: x })} options={[{ value: 'manual', label: 'On click / build' }, { value: 'auto', label: 'Automatically' }]} />
        <Select label="Controls" compact value={v.controls || 'auto'} disabled={ro} onChange={(x) => set({ controls: x })} options={[{ value: 'auto', label: 'On hover' }, { value: 'show', label: 'Always' }, { value: 'hide', label: 'Hidden' }]} />
        <Select label="Fit" compact value={v.fit || 'contain'} disabled={ro} onChange={(x) => set({ fit: x })} options={[{ value: 'contain', label: 'Contain' }, { value: 'cover', label: 'Cover' }]} />
      </div>
      <div class="row-wrap">
        <Checkbox label="Loop" checked={!!v.loop} disabled={ro} onChange={(x) => set({ loop: x || undefined })} />
        <Checkbox label="Muted" checked={!!v.muted} disabled={ro} onChange={(x) => set({ muted: x || undefined })} />
      </div>
      <div class="insp-grid">
        <NumberField label="Trim start" unit="s" compact precision={1} step={0.5} min={0} max={dur ? dur / 1000 : 1e6} value={(v.trim_start_ms || 0) / 1000} disabled={ro} onChange={(x) => set({ trim_start_ms: x > 0 ? Math.round(x * 1000) : undefined }, 'Trim video')} />
        <NumberField label="Trim end" unit="s" compact precision={1} step={0.5} min={0} max={dur ? dur / 1000 : 1e6} value={v.trim_end_ms ? v.trim_end_ms / 1000 : dur / 1000} disabled={ro} onChange={(x) => set({ trim_end_ms: dur && Math.round(x * 1000) >= dur ? undefined : Math.round(x * 1000) }, 'Trim video')} />
      </div>
      <div class="row">
        <NumberField label="Poster frame at" unit="s" compact precision={1} step={0.5} min={0} max={dur ? dur / 1000 : 1e6} value={posterAt} onChange={setPosterAt} />
        <Button class="btn-sm align-end" disabled={ro} onClick={() => ctl.setPosterFromVideo(el.id, Math.round(posterAt * 1000))}>Set poster</Button>
      </div>
      <div class="row">
        <span class="small grow">{v.captions_asset_id ? 'Captions added' : <span class="muted">No captions</span>}</span>
        <Button class="btn-sm" icon="captions" disabled={ro} onClick={() => addCaptions(ctl, el)}>{v.captions_asset_id ? 'Replace' : 'Add .vtt…'}</Button>
        {v.captions_asset_id && <IconButton icon="trash" class="is-small" label="Remove captions" disabled={ro} onClick={() => set({ captions_asset_id: undefined }, 'Remove captions')} />}
      </div>
      {rec?.media_type === 'video/webm' && <p class="small muted">WebM video becomes its poster image in PowerPoint exports.</p>}
    </Section>
  );
}

// ---------- table ----------
function currentCell(ctl, el) {
  const t = ctl.state.editing?.elementId === el.id ? ctl.state.editing.target : ctl.lastCell?.[el.id];
  if (t && t.startsWith('cell:')) {
    const key = t.slice(5);
    const [r, c] = key.split(':');
    const ri = el.table.rows.findIndex((x) => x.id === r);
    const ci = el.table.columns.findIndex((x) => x.id === c);
    if (ri >= 0 && ci >= 0) return { key, ri, ci };
  }
  return null;
}

export function TableSection({ ctl, el }) {
  const ro = ctl.state.readOnly;
  const t = el.table;
  const cur = currentCell(ctl, el);
  const upd = (fn, label) => {
    ctl.endTextEditing();
    ctl.updateElements([el.id], (x) => { x.table = fn(JSON.parse(JSON.stringify(x.table))); }, label);
  };
  const ri = cur?.ri ?? t.rows.length - 1;
  const ci = cur?.ci ?? t.columns.length - 1;
  const cell = cur ? t.cells[cur.key] : null;
  const grid = tableGrid(t);
  const setCell = (patch, label = 'Format cell') => ctl.updateElements([el.id], (x) => {
    const keys = cur ? [cur.key] : Object.keys(x.table.cells);
    for (const k of keys) {
      const c = x.table.cells[k];
      if (!c) continue;
      for (const [pk, pv] of Object.entries(patch)) {
        if (pv === undefined) delete c[pk];
        else c[pk] = pv;
      }
    }
  }, label, `cell:${el.id}`);
  return (
    <Section title="Table">
      <div class="row-wrap">
        <Select label="Header rows" compact value={String(t.header_rows || 0)} disabled={ro} onChange={(v) => ctl.setProps({ 'table.header_rows': Number(v) || undefined }, [el.id], 'Header rows')} options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))} />
      </div>
      <div class="row-wrap">
        <Checkbox label="First column" checked={!!t.first_column} disabled={ro} onChange={(v) => ctl.setProps({ 'table.first_column': v || undefined }, [el.id], 'First column')} />
        <Checkbox label="Banded rows" checked={!!t.banded_rows} disabled={ro} onChange={(v) => ctl.setProps({ 'table.banded_rows': v || undefined }, [el.id], 'Banded rows')} />
        <Checkbox label="Banded columns" checked={!!t.banded_columns} disabled={ro} onChange={(v) => ctl.setProps({ 'table.banded_columns': v || undefined }, [el.id], 'Banded columns')} />
      </div>
      <p class="small muted">{cur ? `Cell: row ${cur.ri + 1}, column ${cur.ci + 1}` : 'Double-click a cell to edit it. Row and column commands use the last cell you edited, or the end of the table.'}</p>
      <div class="btn-grid">
        <Button class="btn-sm" disabled={ro} onClick={() => upd((x) => insertRow(x, ri), 'Insert row')}>Row above</Button>
        <Button class="btn-sm" disabled={ro} onClick={() => upd((x) => insertRow(x, ri + 1), 'Insert row')}>Row below</Button>
        <Button class="btn-sm" disabled={ro} onClick={() => upd((x) => insertColumn(x, ci), 'Insert column')}>Column left</Button>
        <Button class="btn-sm" disabled={ro} onClick={() => upd((x) => insertColumn(x, ci + 1), 'Insert column')}>Column right</Button>
        <Button class="btn-sm" disabled={ro || t.rows.length < 2} onClick={() => upd((x) => deleteRow(x, t.rows[ri].id), 'Delete row')}>Delete row</Button>
        <Button class="btn-sm" disabled={ro || t.columns.length < 2} onClick={() => upd((x) => deleteColumn(x, t.columns[ci].id), 'Delete column')}>Delete column</Button>
        <Button class="btn-sm" disabled={ro || !cur || ci + (cell?.col_span || 1) >= t.columns.length} onClick={() => upd((x) => mergeCells(x, ri, ci, ri + (cell?.row_span || 1) - 1, ci + (cell?.col_span || 1)), 'Merge cells')}>Merge right</Button>
        <Button class="btn-sm" disabled={ro || !cur || ri + (cell?.row_span || 1) >= t.rows.length} onClick={() => upd((x) => mergeCells(x, ri, ci, ri + (cell?.row_span || 1), ci + (cell?.col_span || 1) - 1), 'Merge cells')}>Merge down</Button>
        <Button class="btn-sm" disabled={ro || !cur || !(cell?.row_span > 1 || cell?.col_span > 1)} onClick={() => upd((x) => splitCell(x, grid[ri][ci].anchor), 'Split cell')}>Split cell</Button>
        <Button class="btn-sm" disabled={ro} onClick={() => upd(distributeColumns, 'Distribute columns')}>Even columns</Button>
        <Button class="btn-sm" disabled={ro} onClick={() => upd(distributeRows, 'Distribute rows')}>Even rows</Button>
      </div>
      <h4 class="small muted">{cur ? 'This cell' : 'All cells'}</h4>
      <FillEditor ctl={ctl} label="Cell fill" allowImage={false} value={cur ? cell?.fill : undefined} onChange={(v) => setCell({ fill: v }, 'Cell fill')} />
      <div class="insp-grid">
        <Select label="Vertical align" compact value={(cur ? cell?.vertical_align : undefined) || 'top'} disabled={ro} onChange={(v) => setCell({ vertical_align: v === 'top' ? undefined : v })} options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
        <NumberField label="Padding" compact value={(cur ? cell?.padding : undefined) ?? ctl.doc.theme.defaults?.table?.padding ?? 8} min={0} max={200} disabled={ro} onChange={(v) => setCell({ padding: v })} />
      </div>
      <StrokeEditor ctl={ctl} label="Cell borders" value={cur ? cell?.borders?.top : undefined} onChange={(v) => setCell({ borders: v === undefined ? undefined : { top: v, right: v, bottom: v, left: v } }, 'Cell borders')} />
    </Section>
  );
}

// ---------- chart ----------
export function ChartSection({ ctl, el }) {
  const ro = ctl.state.readOnly;
  const c = el.chart;
  const set = (patch, label = 'Change chart') => ctl.updateElements([el.id], (x) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete x.chart[k];
      else x.chart[k] = v;
    }
  }, label, `chart:${el.id}`);
  const pie = c.kind === 'pie' || c.kind === 'donut';
  const nf = c.number_format || {};
  return (
    <Section title="Chart">
      <div class="row-wrap">
        <Button class="btn-sm" icon="table" disabled={ro} onClick={() => openDialog(ChartDataDialog, { ctl, elementId: el.id })} data-testid="edit-chart-data">Edit data…</Button>
      </div>
      <div class="insp-grid">
        <Select label="Type" compact value={c.kind} disabled={ro} onChange={(k) => ctl.updateElements([el.id], (x) => { x.chart = convertChartKind(JSON.parse(JSON.stringify(x.chart)), k); }, 'Change chart type')} options={[{ value: 'bar', label: 'Bar' }, { value: 'line', label: 'Line' }, { value: 'pie', label: 'Pie' }, { value: 'donut', label: 'Donut' }, { value: 'scatter', label: 'Scatter' }]} />
        {c.kind === 'bar' && <Select label="Direction" compact value={c.orientation || 'vertical'} disabled={ro} onChange={(v) => set({ orientation: v })} options={[{ value: 'vertical', label: 'Columns' }, { value: 'horizontal', label: 'Bars' }]} />}
        {c.kind === 'bar' && <Select label="Grouping" compact value={c.grouping || 'clustered'} disabled={ro} onChange={(v) => set({ grouping: v })} options={[{ value: 'clustered', label: 'Clustered' }, { value: 'stacked', label: 'Stacked' }, { value: 'percent', label: '100% stacked' }]} />}
        <Select label="Legend" compact value={c.legend || 'none'} disabled={ro} onChange={(v) => set({ legend: v })} options={['none', 'top', 'bottom', 'left', 'right'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))} />
        <Select label="Data labels" compact value={c.labels || 'none'} disabled={ro} onChange={(v) => set({ labels: v })} options={[{ value: 'none', label: 'None' }, { value: 'value', label: 'Values' }, ...(pie ? [{ value: 'percent', label: 'Percentages' }] : [])]} />
      </div>
      {c.kind === 'line' && <Checkbox label="Markers" checked={!!c.markers} disabled={ro} onChange={(v) => set({ markers: v || undefined })} />}
      <TextInput label="Title" value={c.title || ''} maxLength={200} disabled={ro} onCommit={(v) => set({ title: v.trim() || undefined }, 'Chart title')} />
      {!pie && (
        <>
          <div class="insp-grid">
            <TextInput label="X axis title" value={c.x_title || ''} maxLength={100} disabled={ro} onCommit={(v) => set({ x_title: v.trim() || undefined }, 'Axis title')} />
            <TextInput label="Y axis title" value={c.y_title || ''} maxLength={100} disabled={ro} onCommit={(v) => set({ y_title: v.trim() || undefined }, 'Axis title')} />
          </div>
          <div class="row-wrap">
            <Checkbox label="Vertical gridlines" checked={!!c.gridlines?.x} disabled={ro} onChange={(v) => set({ gridlines: { ...(c.gridlines || {}), x: v } })} />
            <Checkbox label="Horizontal gridlines" checked={!!c.gridlines?.y} disabled={ro} onChange={(v) => set({ gridlines: { ...(c.gridlines || {}), y: v } })} />
          </div>
          <div class="insp-grid">
            <NumberField label="Axis min" compact value={c.axis?.min ?? null} disabled={ro} precision={4} onChange={(v) => set({ axis: { ...(c.axis || {}), min: v } })} />
            <NumberField label="Axis max" compact value={c.axis?.max ?? null} disabled={ro} precision={4} onChange={(v) => set({ axis: { ...(c.axis || {}), max: v } })} />
          </div>
          {(c.axis?.min != null || c.axis?.max != null) && <button type="button" class="link-btn" onClick={() => set({ axis: undefined })}>Automatic axis range</button>}
        </>
      )}
      <div class="insp-grid">
        <Select label="Numbers" compact value={nf.style || 'number'} disabled={ro} onChange={(v) => set({ number_format: { ...nf, style: v === 'number' ? undefined : v } })} options={[{ value: 'number', label: 'Number' }, { value: 'percent', label: 'Percent' }]} />
        <NumberField label="Decimals" compact value={nf.decimals ?? null} min={0} max={6} precision={0} disabled={ro} onChange={(v) => set({ number_format: { ...nf, decimals: v } })} />
        <TextInput label="Prefix" value={nf.prefix || ''} maxLength={8} disabled={ro} onCommit={(v) => set({ number_format: { ...nf, prefix: v || undefined } })} />
        <TextInput label="Suffix" value={nf.suffix || ''} maxLength={8} disabled={ro} onCommit={(v) => set({ number_format: { ...nf, suffix: v || undefined } })} />
      </div>
      <Checkbox label="Thousands separators" checked={!!nf.thousands} disabled={ro} onChange={(v) => set({ number_format: { ...nf, thousands: v || undefined } })} />
      {!pie && (
        <div class="stack tight">
          <span class="field-label">Series colors</span>
          {c.series.map((s, i) => (
            <div class="row" key={s.id}>
              <ColorPicker label={s.name} compact allowAuto value={s.color} theme={ctl.doc.theme} onChange={(v) => ctl.updateElements([el.id], (x) => { if (v === undefined) delete x.chart.series[i].color; else x.chart.series[i].color = v; }, 'Series color')} />
              <span class="small">{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------- group ----------
export function GroupSection({ ctl, el }) {
  return (
    <Section title="Group">
      <p class="small muted">{el.group.children.length} elements. Double-click to select inside the group.</p>
      <div class="row">
        <Button class="btn-sm" icon="ungroup" disabled={ctl.state.readOnly} onClick={() => ctl.ungroup()}>Ungroup</Button>
        <Button class="btn-sm" onClick={() => ctl.set({ enteredGroup: el.id, selection: [el.group.children[0].id] })}>Select inside</Button>
      </div>
    </Section>
  );
}

export { toast, unitsToPt, ptToUnits };
