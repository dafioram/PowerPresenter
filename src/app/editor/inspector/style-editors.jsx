// Fill, stroke, shadow and arrowhead editors (spec §5.8).
import { Select, NumberField, Button, IconButton } from '../../ui/components.jsx';
import { ColorPicker } from '../../ui/ColorPicker.jsx';
import { pickFiles } from '../../download.js';
import { unitsToPt, ptToUnits } from '../../../core/units.js';

const FILL_KINDS = [
  { value: 'default', label: 'Theme default' },
  { value: 'none', label: 'None' },
  { value: 'solid', label: 'Solid color' },
  { value: 'linear', label: 'Linear gradient' },
  { value: 'radial', label: 'Radial gradient' },
  { value: 'image', label: 'Image' },
];

export function fillKind(v) {
  if (v === undefined || v === null) return 'default';
  if (v === 'none') return 'none';
  return v.type;
}

function defaultStops(theme, color) {
  return [
    { offset: 0, color: color || { token: 'color.accent.1' } },
    { offset: 1, color: { token: 'color.accent.2' } },
  ];
}

export function FillEditor({ ctl, value, onChange, label = 'Fill', allowDefault = true, allowImage = true }) {
  const theme = ctl.doc.theme;
  const kind = fillKind(value);
  const ro = ctl.state.readOnly;
  const setKind = async (k) => {
    const solidColor = value?.type === 'solid' ? value.color : value?.stops?.[0]?.color;
    if (k === 'default') onChange(undefined);
    else if (k === 'none') onChange('none');
    else if (k === 'solid') onChange({ type: 'solid', color: solidColor || { token: 'color.accent.1' } });
    else if (k === 'linear') onChange({ type: 'linear', angle: 90, stops: value?.stops || defaultStops(theme, solidColor) });
    else if (k === 'radial') onChange({ type: 'radial', center_x: 0.5, center_y: 0.5, stops: value?.stops || defaultStops(theme, solidColor) });
    else if (k === 'image') {
      const files = await pickFiles({ accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml' });
      if (!files[0]) return;
      try {
        const { record } = await ctl.addAssetFile(files[0]);
        if (record.kind !== 'image' && record.kind !== 'svg') return;
        onChange({ type: 'image', asset_id: record.id, mode: 'cover' }, record);
      } catch (e) {
        ctl.toast?.(e.message);
      }
    }
  };
  const kinds = FILL_KINDS.filter((k) => (allowDefault || k.value !== 'default') && (allowImage || k.value !== 'image'));
  const setStop = (i, patch) => onChange({ ...value, stops: value.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div class="stack tight">
      <Select label={label} value={kind} disabled={ro} onChange={setKind} options={kinds} compact />
      {kind === 'solid' && <ColorPicker label={`${label} color`} value={value.color} theme={theme} onChange={(c) => onChange({ type: 'solid', color: c })} />}
      {(kind === 'linear' || kind === 'radial') && (
        <div class="stack tight">
          {kind === 'linear' ? (
            <NumberField label="Angle" unit="°" value={value.angle} min={0} max={360} step={15} precision={0} disabled={ro} onChange={(v) => onChange({ ...value, angle: v % 360 })} compact />
          ) : (
            <div class="insp-grid">
              <NumberField label="Center X" unit="%" value={value.center_x * 100} min={0} max={100} step={5} precision={0} disabled={ro} onChange={(v) => onChange({ ...value, center_x: v / 100 })} compact />
              <NumberField label="Center Y" unit="%" value={value.center_y * 100} min={0} max={100} step={5} precision={0} disabled={ro} onChange={(v) => onChange({ ...value, center_y: v / 100 })} compact />
            </div>
          )}
          {value.stops.map((s, i) => (
            <div class="row stop-row" key={i}>
              <ColorPicker label={`Stop ${i + 1}`} compact value={s.color} theme={theme} onChange={(c) => setStop(i, { color: c })} />
              <NumberField compact value={s.offset * 100} unit="%" min={0} max={100} step={5} precision={0} disabled={ro} title={`Stop ${i + 1} position`} onChange={(v) => setStop(i, { offset: v / 100 })} />
              {value.stops.length > 2 && <IconButton icon="minus" class="is-small" label={`Remove stop ${i + 1}`} disabled={ro} onClick={() => onChange({ ...value, stops: value.stops.filter((_, j) => j !== i) })} />}
            </div>
          ))}
          {value.stops.length < 8 && <Button class="btn-sm" icon="plus" disabled={ro} onClick={() => onChange({ ...value, stops: [...value.stops, { offset: 1, color: value.stops[value.stops.length - 1].color }].sort((a, b) => a.offset - b.offset) })}>Add stop</Button>}
        </div>
      )}
      {kind === 'image' && (
        <div class="stack tight">
          <Select label="Image fit" compact value={value.mode} disabled={ro} onChange={(m) => onChange({ ...value, mode: m, ...(m === 'tile' ? { scale: value.scale || 1 } : {}) })} options={[{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }, { value: 'stretch', label: 'Stretch' }, { value: 'tile', label: 'Tile' }]} />
          {value.mode === 'tile' && <NumberField label="Tile scale" unit="×" compact value={value.scale || 1} min={0.01} max={100} step={0.1} precision={2} disabled={ro} onChange={(v) => onChange({ ...value, scale: v })} />}
          <Button class="btn-sm" icon="image" disabled={ro} onClick={() => setKind('image')}>Replace image…</Button>
        </div>
      )}
    </div>
  );
}

const DASHES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dash', label: 'Dashed' },
  { value: 'dot', label: 'Dotted' },
  { value: 'dash_dot', label: 'Dash-dot' },
  { value: 'long_dash', label: 'Long dash' },
];

export function StrokeEditor({ ctl, value, onChange, label = 'Border', allowDefault = true, lineOptions = false, fallbackColor }) {
  const theme = ctl.doc.theme;
  const ro = ctl.state.readOnly;
  const kind = value === undefined || value === null ? 'default' : value === 'none' ? 'none' : 'line';
  const setKind = (k) => {
    if (k === 'default') onChange(undefined);
    else if (k === 'none') onChange('none');
    else onChange({ color: fallbackColor || { token: 'color.border' }, width: ptToUnits(1) });
  };
  return (
    <div class="stack tight">
      <Select label={label} compact value={kind} disabled={ro} onChange={setKind} options={[...(allowDefault ? [{ value: 'default', label: 'Theme default' }] : []), { value: 'none', label: 'None' }, { value: 'line', label: 'Line' }]} />
      {kind === 'line' && (
        <>
          <div class="row">
            <ColorPicker label={`${label} color`} compact value={value.color} theme={theme} onChange={(c) => onChange({ ...value, color: c })} />
            <NumberField compact title={`${label} width (pt)`} value={unitsToPt(value.width)} unit="pt" min={0} max={150} step={0.5} precision={2} disabled={ro} onChange={(v) => onChange({ ...value, width: ptToUnits(v) })} />
            <Select compact value={value.dash || 'solid'} disabled={ro} onChange={(d) => onChange({ ...value, dash: d === 'solid' ? undefined : d })} options={DASHES} />
          </div>
          {lineOptions && (
            <div class="insp-grid">
              <Select label="Cap" compact value={value.cap || 'flat'} disabled={ro} onChange={(c) => onChange({ ...value, cap: c === 'flat' ? undefined : c })} options={[{ value: 'flat', label: 'Flat' }, { value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }]} />
              <Select label="Join" compact value={value.join || 'miter'} disabled={ro} onChange={(c) => onChange({ ...value, join: c === 'miter' ? undefined : c })} options={[{ value: 'miter', label: 'Miter' }, { value: 'round', label: 'Round' }, { value: 'bevel', label: 'Bevel' }]} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ShadowEditor({ ctl, value, onChange }) {
  const theme = ctl.doc.theme;
  const ro = ctl.state.readOnly;
  const kind = value === undefined || value === null ? 'default' : value === 'none' ? 'none' : 'on';
  return (
    <div class="stack tight">
      <Select label="Shadow" compact value={kind} disabled={ro} onChange={(k) => onChange(k === 'default' ? undefined : k === 'none' ? 'none' : { color: '#0000004d', offset_x: 0, offset_y: 4, blur: 12 })} options={[{ value: 'default', label: 'Theme default' }, { value: 'none', label: 'None' }, { value: 'on', label: 'Drop shadow' }]} />
      {kind === 'on' && (
        <>
          <ColorPicker label="Shadow color" value={value.color} theme={theme} onChange={(c) => onChange({ ...value, color: c })} />
          <div class="insp-grid-3">
            <NumberField label="X" compact value={value.offset_x} min={-500} max={500} disabled={ro} onChange={(v) => onChange({ ...value, offset_x: v })} />
            <NumberField label="Y" compact value={value.offset_y} min={-500} max={500} disabled={ro} onChange={(v) => onChange({ ...value, offset_y: v })} />
            <NumberField label="Blur" compact value={value.blur} min={0} max={500} disabled={ro} onChange={(v) => onChange({ ...value, blur: v })} />
          </div>
        </>
      )}
    </div>
  );
}

const HEADS = [
  { value: 'none', label: 'None' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'stealth', label: 'Stealth' },
  { value: 'oval', label: 'Oval' },
  { value: 'diamond', label: 'Diamond' },
];
const SIZES = [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }];

export function ArrowheadsEditor({ ctl, value, onChange }) {
  const ro = ctl.state.readOnly;
  const v = value || {};
  const set = (end, patch) => onChange({ ...v, [end]: { kind: 'none', size: 'medium', ...(v[end] || {}), ...patch } });
  return (
    <div class="insp-grid">
      <Select label="Start" compact value={v.start?.kind || 'none'} disabled={ro} onChange={(k) => set('start', { kind: k })} options={HEADS} />
      <Select label="End" compact value={v.end?.kind || 'none'} disabled={ro} onChange={(k) => set('end', { kind: k })} options={HEADS} />
      <Select label="Start size" compact value={v.start?.size || 'medium'} disabled={ro || !v.start || v.start.kind === 'none'} onChange={(s) => set('start', { size: s })} options={SIZES} />
      <Select label="End size" compact value={v.end?.size || 'medium'} disabled={ro || !v.end || v.end.kind === 'none'} onChange={(s) => set('end', { size: s })} options={SIZES} />
    </div>
  );
}
