// Theme editor (spec §12.9): color and font tokens, role styles with a live
// sample, background and element defaults.
import { useState } from 'preact/hooks';
import { Button, Select, NumberField, Checkbox, TextInput } from '../../ui/components.jsx';
import { ColorPicker } from '../../ui/ColorPicker.jsx';
import { COLOR_TOKENS, COLOR_TOKEN_LABELS, FONT_TOKENS, TEXT_ROLES, ROLE_LABELS } from '../../../core/theme.js';
import { applyTint, isHex, toCss } from '../../../core/color.js';
import { unitsToPt, ptToUnits } from '../../../core/units.js';
import { cssFontFamily } from '../../../render/fonts.js';
import { FontSelect } from '../FormatBar.jsx';
import { FillEditor, StrokeEditor, ShadowEditor, ArrowheadsEditor } from '../inspector/style-editors.jsx';
import { Section } from '../inspector/ElementPanels.jsx';
import { PanelFrame } from './Panels.jsx';
import { saveThemeToLibrary } from '../theme-actions.js';
import { patchAllMarks } from '../../../core/text.js';
import * as ops from '../../../core/ops.js';

function HexColor({ label, value, onChange, disabled }) {
  const [text, setText] = useState(value);
  const commit = (v) => {
    const h = v.startsWith('#') ? v : `#${v}`;
    if (isHex(h)) onChange(h.toLowerCase());
    else setText(value);
  };
  return (
    <div class="token-row">
      <input type="color" aria-label={`${label} color`} value={value.slice(0, 7)} disabled={disabled} onInput={(e) => { setText(e.currentTarget.value); onChange(e.currentTarget.value); }} />
      <span class="token-label">{label}</span>
      <input class="input hex-input" aria-label={`${label} hex`} value={text} maxLength={9} disabled={disabled} onInput={(e) => setText(e.currentTarget.value)} onBlur={(e) => commit(e.currentTarget.value.trim())} onKeyDown={(e) => { if (e.key === 'Enter') commit(e.currentTarget.value.trim()); }} />
      <span class="tint-strip" aria-hidden="true">
        {[0.8, 0.6, 0.4, -0.25, -0.5].map((t) => <span key={t} style={{ background: toCss(applyTint(value, t)) }} />)}
      </span>
    </div>
  );
}

function RoleEditor({ ctl, role }) {
  const theme = ctl.doc.theme;
  const r = theme.roles[role];
  const ro = ctl.state.readOnly;
  const [open, setOpen] = useState(false);
  const set = (k, v) => ctl.updateTheme((t) => { t.roles[role][k] = v; }, `Edit ${ROLE_LABELS[role]} style`, `role:${role}:${k}`);
  const sampleStyle = {
    fontFamily: cssFontFamily(r.font, ctl.doc),
    fontWeight: String(r.weight),
    fontStyle: r.italic ? 'italic' : 'normal',
    color: toCss(ctl.doc.theme.colors[r.color?.token] ? applyTint(ctl.doc.theme.colors[r.color.token], r.color.tint || 0) : (typeof r.color === 'string' ? r.color : '#000')),
    fontSize: `${Math.min(28, Math.max(11, r.size * 0.45))}px`,
    textAlign: r.align,
  };
  return (
    <div class="role-row">
      <button type="button" class="role-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="role-name">{ROLE_LABELS[role]}</span>
        <span class="role-sample" style={sampleStyle}>{role === 'big_number' ? '42%' : ROLE_LABELS[role]}</span>
        <span class="small muted">{unitsToPt(r.size)} pt</span>
      </button>
      {open && (
        <div class="stack tight role-body">
          <FontSelect doc={ctl.doc} value={r.font} compact={false} label="Font" disabled={ro} onChange={(v) => set('font', v)} />
          <div class="insp-grid">
            <NumberField label="Size" unit="pt" compact value={unitsToPt(r.size)} min={1} max={750} disabled={ro} onChange={(v) => set('size', ptToUnits(v))} />
            <Select label="Weight" compact value={String(r.weight)} disabled={ro} onChange={(v) => set('weight', Number(v))} options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: String(w), label: String(w) }))} />
            <Select label="Align" compact value={r.align} disabled={ro} onChange={(v) => set('align', v)} options={[{ value: 'start', label: 'Start' }, { value: 'center', label: 'Center' }, { value: 'end', label: 'End' }, { value: 'justify', label: 'Justify' }]} />
            <NumberField label="Line spacing" compact value={r.line} min={0.8} max={3} step={0.05} disabled={ro} onChange={(v) => set('line', v)} />
            <NumberField label="Space before" unit="pt" compact value={unitsToPt(r.before)} min={0} max={750} disabled={ro} onChange={(v) => set('before', ptToUnits(v))} />
            <NumberField label="Space after" unit="pt" compact value={unitsToPt(r.after)} min={0} max={750} disabled={ro} onChange={(v) => set('after', ptToUnits(v))} />
            <NumberField label="Letter spacing" unit="pt" compact value={unitsToPt(r.letter_spacing)} min={-75} max={75} step={0.5} disabled={ro} onChange={(v) => set('letter_spacing', ptToUnits(v))} />
          </div>
          <div class="row">
            <ColorPicker label="Color" value={r.color} theme={theme} onChange={(v) => v && v !== 'none' && set('color', v)} />
            <Checkbox label="Italic" checked={r.italic} disabled={ro} onChange={(v) => set('italic', v)} />
          </div>
        </div>
      )}
    </div>
  );
}

// Removes the selection's overrides so it follows the theme again (spec §6.3).
export function resetSelectionToTheme(ctl) {
  const ids = ctl.state.selection;
  if (!ids.length) return;
  const clear = { font: null, size: null, weight: null, italic: null, color: null, highlight: null, letter_spacing: null };
  ctl.dispatch('Reset to theme', (d) => ops.updateElements(d, ctl.container, ids, (el) => {
    delete el.style;
    const fix = (c) => {
      if (!c) return;
      delete c.defaults;
      c.body = patchAllMarks(JSON.parse(JSON.stringify(c.body)), clear);
    };
    fix(el.text);
    fix(el.shape?.text);
    if (el.table) for (const c of Object.values(el.table.cells)) { fix(c); delete c.fill; delete c.borders; }
    if (el.chart) for (const s of el.chart.series) delete s.color;
  }));
}

export function ThemeEditor({ ctl }) {
  const theme = ctl.doc.theme;
  const ro = ctl.state.readOnly;
  const [section, setSection] = useState('colors');
  const upd = (fn, label = 'Edit theme', key) => ctl.updateTheme(fn, label, key);
  const d = theme.defaults;
  return (
    <PanelFrame title="Theme" ctl={ctl}>
      <TextInput label="Theme name" value={theme.name} maxLength={100} disabled={ro} onCommit={(v) => v.trim() && upd((t) => { t.name = v.trim(); }, 'Rename theme')} />
      <div class="row-wrap">
        <Button class="btn-sm" icon="save" onClick={() => saveThemeToLibrary(ctl)}>Save to library…</Button>
        <Button class="btn-sm" disabled={ro || !ctl.state.selection.length} onClick={() => resetSelectionToTheme(ctl)} title="Remove the selection’s formatting overrides">Reset selection to theme</Button>
      </div>
      <Select compact label="Section" value={section} onChange={setSection} options={[{ value: 'colors', label: 'Colors' }, { value: 'fonts', label: 'Fonts' }, { value: 'roles', label: 'Text styles' }, { value: 'background', label: 'Background and lists' }, { value: 'defaults', label: 'Element defaults' }]} />
      {section === 'colors' && (
        <Section title="Colors">
          {COLOR_TOKENS.map((tk) => (
            <HexColor key={tk + theme.colors[tk]} label={COLOR_TOKEN_LABELS[tk]} value={theme.colors[tk]} disabled={ro} onChange={(v) => upd((t) => { t.colors[tk] = v; }, 'Edit theme color', `color:${tk}`)} />
          ))}
          <Checkbox label="Dark theme (for previews and exports)" checked={!!theme.dark} disabled={ro} onChange={(v) => upd((t) => { if (v) t.dark = true; else delete t.dark; })} />
        </Section>
      )}
      {section === 'fonts' && (
        <Section title="Fonts">
          {FONT_TOKENS.map((tk) => (
            <FontSelect
              key={tk}
              doc={{ ...ctl.doc, theme: { ...theme, fonts: { 'font.heading': 'builtin.inter', 'font.body': 'builtin.inter', 'font.accent': 'builtin.inter' } } }}
              compact={false}
              label={{ 'font.heading': 'Heading font', 'font.body': 'Body font', 'font.accent': 'Accent font' }[tk]}
              value={theme.fonts[tk]}
              disabled={ro}
              onChange={(v) => { if (v && typeof v === 'object' && v.token) return; upd((t) => { t.fonts[tk] = v; }, 'Edit theme font'); }}
            />
          ))}
          <p class="small muted">Add font files with Insert → Font file. Fonts installed on this device only look right on this device.</p>
        </Section>
      )}
      {section === 'roles' && (
        <Section title="Text styles">
          {TEXT_ROLES.map((r) => <RoleEditor key={r} ctl={ctl} role={r} />)}
        </Section>
      )}
      {section === 'background' && (
        <>
          <Section title="Background">
            <FillEditor ctl={ctl} label="Slide background" allowDefault={false} value={theme.background} onChange={(v, rec) => ctl.dispatch('Theme background', (dd) => { if (rec && !dd.assets.some((a) => a.id === rec.id)) dd.assets.push(rec); dd.theme.background = v; })} />
          </Section>
          <Section title="Lists">
            <NumberField label="Indent per level" compact value={theme.lists.indent} min={0} max={400} disabled={ro} onChange={(v) => upd((t) => { t.lists.indent = v; })} />
            <TextInput label="Bullets by level (separated by spaces)" value={theme.lists.bullets.join(' ')} disabled={ro} onCommit={(v) => {
              const b = v.trim().split(/\s+/).filter(Boolean).map((x) => [...x].slice(0, 4).join('')).slice(0, 9);
              if (b.length) upd((t) => { t.lists.bullets = b; }, 'Edit bullets');
            }} />
          </Section>
        </>
      )}
      {section === 'defaults' && (
        <>
          <Section title="Shapes">
            <FillEditor ctl={ctl} label="Fill" allowDefault={false} allowImage={false} value={d.shape.fill} onChange={(v) => upd((t) => { t.defaults.shape.fill = v; }, 'Shape default')} />
            <StrokeEditor ctl={ctl} label="Border" allowDefault={false} value={d.shape.stroke} onChange={(v) => upd((t) => { t.defaults.shape.stroke = v; }, 'Shape default')} />
            <ColorPicker label="Text color" value={d.shape.text.color} theme={theme} onChange={(v) => v && v !== 'none' && upd((t) => { t.defaults.shape.text.color = v; }, 'Shape default')} />
            <div class="insp-grid">
              <Select label="Text align" compact value={d.shape.text.align} disabled={ro} onChange={(v) => upd((t) => { t.defaults.shape.text.align = v; })} options={[{ value: 'start', label: 'Start' }, { value: 'center', label: 'Center' }, { value: 'end', label: 'End' }, { value: 'justify', label: 'Justify' }]} />
              <Select label="Vertical" compact value={d.shape.text.vertical_align} disabled={ro} onChange={(v) => upd((t) => { t.defaults.shape.text.vertical_align = v; })} options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
            </div>
          </Section>
          <Section title="Lines">
            <StrokeEditor ctl={ctl} label="Line" allowDefault={false} lineOptions value={d.line.stroke} onChange={(v) => upd((t) => { t.defaults.line.stroke = v; }, 'Line default')} />
            <ArrowheadsEditor ctl={ctl} value={d.line.arrowheads} onChange={(v) => upd((t) => { t.defaults.line.arrowheads = v; }, 'Line default')} />
          </Section>
          <Section title="Images">
            <StrokeEditor ctl={ctl} label="Border" allowDefault={false} value={d.image.stroke} onChange={(v) => upd((t) => { t.defaults.image.stroke = v; }, 'Image default')} />
            <ShadowEditor ctl={ctl} value={d.image.shadow} onChange={(v) => v !== undefined && upd((t) => { t.defaults.image.shadow = v; }, 'Image default')} />
          </Section>
          <Section title="Text boxes and links">
            <div class="insp-grid">
              {['left', 'right', 'top', 'bottom'].map((k) => <NumberField key={k} label={`Inset ${k}`} compact value={d.text_box.insets[k]} min={0} max={1000} disabled={ro} onChange={(v) => upd((t) => { t.defaults.text_box.insets[k] = v; })} />)}
            </div>
            <ColorPicker label="Link color" value={d.link.color} theme={theme} onChange={(v) => v && v !== 'none' && upd((t) => { t.defaults.link.color = v; })} />
            <Checkbox label="Underline links" checked={d.link.underline} disabled={ro} onChange={(v) => upd((t) => { t.defaults.link.underline = v; })} />
          </Section>
          <Section title="Tables">
            <ColorPicker label="Header fill" value={d.table.header_fill} theme={theme} onChange={(v) => v && v !== 'none' && upd((t) => { t.defaults.table.header_fill = v; })} />
            <ColorPicker label="Header text" value={d.table.header_color} theme={theme} onChange={(v) => v && v !== 'none' && upd((t) => { t.defaults.table.header_color = v; })} />
            <ColorPicker label="Band fill" value={d.table.band_fill} theme={theme} onChange={(v) => v && v !== 'none' && upd((t) => { t.defaults.table.band_fill = v; })} />
            <StrokeEditor ctl={ctl} label="Borders" allowDefault={false} value={d.table.border} onChange={(v) => upd((t) => { t.defaults.table.border = v; })} />
            <div class="insp-grid">
              <NumberField label="Text size" unit="pt" compact value={unitsToPt(d.table.text_size)} min={1} max={750} disabled={ro} onChange={(v) => upd((t) => { t.defaults.table.text_size = ptToUnits(v); })} />
              <NumberField label="Padding" compact value={d.table.padding} min={0} max={200} disabled={ro} onChange={(v) => upd((t) => { t.defaults.table.padding = v; })} />
            </div>
            <Checkbox label="Bold first column (when on)" checked={d.table.first_column_bold} disabled={ro} onChange={(v) => upd((t) => { t.defaults.table.first_column_bold = v; })} />
          </Section>
          <Section title="Charts">
            <ColorPicker label="Gridlines" value={d.chart.gridline} theme={theme} onChange={(v) => v && v !== 'none' && upd((t) => { t.defaults.chart.gridline = v; })} />
            <ColorPicker label="Labels" value={d.chart.label_color} theme={theme} onChange={(v) => v && v !== 'none' && upd((t) => { t.defaults.chart.label_color = v; })} />
            <div class="insp-grid">
              <NumberField label="Label size" unit="pt" compact value={unitsToPt(d.chart.label_size)} min={1} max={750} disabled={ro} onChange={(v) => upd((t) => { t.defaults.chart.label_size = ptToUnits(v); })} />
              <NumberField label="Title size" unit="pt" compact value={unitsToPt(d.chart.title_size)} min={1} max={750} disabled={ro} onChange={(v) => upd((t) => { t.defaults.chart.title_size = ptToUnits(v); })} />
            </div>
            <FontSelect doc={ctl.doc} compact={false} label="Chart font" value={d.chart.font} disabled={ro} onChange={(v) => upd((t) => { t.defaults.chart.font = v; })} />
          </Section>
        </>
      )}
    </PanelFrame>
  );
}
