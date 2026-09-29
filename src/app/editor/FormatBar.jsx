// Text formatting bar (spec §13.1): applies to the text being edited, or to all
// text in the selected elements.
import { IconButton, NumberField, MenuButton, promptDialog, toast } from '../ui/components.jsx';
import { ColorPicker } from '../ui/ColorPicker.jsx';
import { fontRegistry } from '../../render/fonts.js';
import { containerBaseStyle, ROLE_LABELS } from '../../core/theme.js';
import { firstMarks } from '../../core/text.js';
import { unitsToPt, ptToUnits } from '../../core/units.js';
import { DEVICE_FONT_RE } from '../../core/validate.js';
import { shortcut } from '../settings.js';
import { copyFormat, openLink } from './commands.js';

export function fontOptions(doc) {
  const reg = fontRegistry().filter((f) => !f.onDemand);
  const opts = [
    { group: 'Theme fonts', options: [
      { value: 'token:font.heading', label: `Heading (${labelFor(doc, doc.theme.fonts['font.heading'])})` },
      { value: 'token:font.body', label: `Body (${labelFor(doc, doc.theme.fonts['font.body'])})` },
      { value: 'token:font.accent', label: `Accent (${labelFor(doc, doc.theme.fonts['font.accent'])})` },
    ] },
    { group: 'Built-in fonts', options: reg.map((f) => ({ value: f.id, label: f.name })) },
  ];
  if (doc.fonts?.length) opts.push({ group: 'Added fonts', options: doc.fonts.map((f) => ({ value: f.id, label: f.family_name })) });
  return opts;
}

export function labelFor(doc, v) {
  if (!v) return 'Inter';
  if (typeof v === 'object' && v.token) return labelFor(doc, doc.theme.fonts[v.token]);
  if (typeof v === 'object' && v.device) return `${v.device} (device)`;
  if (v.startsWith('builtin.')) return fontRegistry().find((f) => f.id === v)?.name || v.slice(8);
  return doc.fonts?.find((f) => f.id === v)?.family_name || 'Custom font';
}

export function encodeFont(v) {
  if (!v) return 'token:font.body';
  if (typeof v === 'object' && v.token) return `token:${v.token}`;
  if (typeof v === 'object' && v.device) return `device:${v.device}`;
  return v;
}

export function decodeFont(s, fallback = 'builtin.inter') {
  if (s.startsWith('token:')) return { token: s.slice(6) };
  if (s.startsWith('device:')) return { device: s.slice(7), fallback };
  return s;
}

export function FontSelect({ doc, value, onChange, compact = true, label = 'Font', disabled }) {
  const enc = encodeFont(value);
  const opts = fontOptions(doc);
  const known = opts.some((g) => g.options.some((o) => o.value === enc));
  return (
    <label class={`field ${compact ? 'is-compact' : ''} fb-font`}>
      {!compact && <span class="field-label">{label}</span>}
      <select
        class="input select"
        aria-label={label}
        value={known ? enc : '__current'}
        disabled={disabled}
        onChange={async (e) => {
          const v = e.currentTarget.value;
          if (v === '__device') {
            const name = await promptDialog({ title: 'Use a font installed on this device', label: 'Font name (as installed)', maxLength: 64 });
            if (name && DEVICE_FONT_RE.test(name.trim())) onChange({ device: name.trim(), fallback: 'builtin.inter' });
            else if (name) toast('Use letters, numbers, spaces, dots, dashes or underscores.', { kind: 'error' });
            e.currentTarget.value = known ? enc : '__current';
            return;
          }
          if (v !== '__current') onChange(decodeFont(v));
        }}
      >
        {!known && <option value="__current">{labelFor(doc, value)}</option>}
        {opts.map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        ))}
        <option value="__device">Font on this device…</option>
      </select>
    </label>
  );
}

// Resolved run and paragraph values shown in the bar.
function currentFormat(ctl) {
  const doc = ctl.doc;
  const s = ctl.textSession;
  if (s && ctl.state.editing) {
    const el = ctl.find(ctl.state.editing.elementId)?.el;
    const target = ctl.state.editing.target;
    const container = target === 'text' ? el?.text : target === 'shape' ? el?.shape?.text : el?.table?.cells[target.slice(5)];
    const kind = target === 'text' ? 'text' : target === 'shape' ? 'shape' : 'cell';
    const base = containerBaseStyle(doc.theme, { kind, role: el?.role, defaults: container?.defaults });
    let marks = {};
    let para = {};
    try {
      marks = s.activeMarks();
      para = s.activeParagraph();
    } catch {
      /* view gone */
    }
    return { base: base.run, run: { ...base.run, ...marks }, para: { align: para.align || base.para.align, list: para.list, spacing: para.spacing }, target: 'session' };
  }
  const el = ctl.selectedElements().find((e) => e.text || e.type === 'shape' || e.table);
  if (!el) return null;
  const container = el.text || el.shape?.text || (el.table ? Object.values(el.table.cells)[0] : null);
  const kind = el.text ? 'text' : el.type === 'shape' ? 'shape' : 'cell';
  const base = containerBaseStyle(doc.theme, { kind, role: el.role, defaults: container?.defaults });
  const p0 = container?.body?.paragraphs[0];
  return { base: base.run, run: { ...base.run, ...(container ? firstMarks(container.body) : {}) }, para: { align: p0?.align || base.para.align, list: p0?.list, spacing: p0?.spacing }, target: 'elements' };
}

// Keyboard Cmd/Ctrl+B/I/U on selected elements (outside text editing).
export function toggleMarkOnSelection(ctl, key) {
  const f = currentFormat(ctl);
  if (!f) return false;
  const run = f.run;
  const base = f.base || {};
  if (key === 'weight') {
    const active = (run.weight || 400) >= 600;
    const baseBold = (base.weight || 400) >= 600;
    ctl.applyMarksToSelection({ weight: active ? (baseBold ? 400 : null) : baseBold ? null : 700 });
  } else {
    const active = !!run[key];
    const baseOn = !!base[key];
    ctl.applyMarksToSelection({ [key]: active ? (baseOn ? false : null) : baseOn ? null : true });
  }
  return true;
}

export function FormatBar({ ctl }) {
  const st = ctl.state;
  const doc = ctl.doc;
  const f = currentFormat(ctl);
  const ro = st.readOnly;
  const dis = ro || !f;
  const run = f?.run || {};
  const para = f?.para || {};
  const setMark = (k, v) => ctl.applyMarksToSelection({ [k]: v });
  const base = f?.base || {};
  // Toggles relative to the role style: turning bold off on a bold title writes 400.
  const toggle = (k, on, off = false) => {
    const active = !!run[k] && run[k] !== off;
    const baseOn = !!base[k] && base[k] !== off;
    if (active) setMark(k, baseOn ? (off === false ? false : off) : null);
    else setMark(k, baseOn ? null : on);
  };
  const toggleBold = () => {
    const active = (run.weight || 400) >= 600;
    const baseBold = (base.weight || 400) >= 600;
    if (active) setMark('weight', baseBold ? 400 : null);
    else setMark('weight', baseBold ? null : 700);
  };
  const setPara = (k, v) => ctl.applyParagraphToSelection({ [k]: v });
  const lineSpacing = para.spacing?.line;
  const inSession = !!ctl.textSession;
  const fp = st.formatPainter;

  const spacingItems = [1, 1.15, 1.5, 2, 2.5, 3].map((v) => ({
    label: String(v),
    checked: Math.abs((lineSpacing || 0) - v) < 0.01,
    onSelect: () => setPara('spacing', { ...(para.spacing || {}), line: v }),
  }));
  const moreItems = [
    { label: 'Superscript', checked: run.script === 'super', onSelect: () => setMark('script', run.script === 'super' ? null : 'super') },
    { label: 'Subscript', checked: run.script === 'sub', onSelect: () => setMark('script', run.script === 'sub' ? null : 'sub') },
    { separator: true },
    { label: 'Numbered list: 1, 2, 3', onSelect: () => (inSession ? ctl.textSession.toggleList('number', 'decimal') : ctl.toggleListOnSelection('number')) },
    { label: 'Numbered list: a, b, c', disabled: !inSession, onSelect: () => ctl.textSession.toggleList('number', 'lower_alpha') },
    { label: 'Numbered list: A, B, C', disabled: !inSession, onSelect: () => ctl.textSession.toggleList('number', 'upper_alpha') },
    { label: 'Numbered list: i, ii, iii', disabled: !inSession, onSelect: () => ctl.textSession.toggleList('number', 'lower_roman') },
    { separator: true },
    { label: 'Letter spacing…', onSelect: async () => {
      const v = await promptDialog({ title: 'Letter spacing', label: 'Letter spacing in points (can be negative)', value: String(unitsToPt(run.letter_spacing || 0)) });
      if (v === null) return;
      const n = Number(v);
      if (Number.isFinite(n) && Math.abs(n) <= 75) setMark('letter_spacing', n === 0 ? null : ptToUnits(n));
    } },
    { label: 'Text language…', onSelect: async () => {
      const v = await promptDialog({ title: 'Text language', label: 'Language tag, such as en-US or fr (empty for the presentation language)', value: run.lang || '' });
      if (v === null) return;
      const t = v.trim();
      if (!t) setMark('lang', null);
      else if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,4}$/.test(t)) setMark('lang', t);
      else toast('That isn’t a valid language tag.', { kind: 'error' });
    } },
    { separator: true },
    { label: 'Clear formatting', onSelect: () => ctl.applyMarksToSelection({ font: null, size: null, weight: null, italic: null, underline: null, strike: null, script: null, color: null, highlight: null, letter_spacing: null }) },
  ];

  const roleNote = !inSession && f && ctl.selectedElements()[0]?.role ? ROLE_LABELS[ctl.selectedElements()[0].role] : null;

  return (
    <div class="formatbar" role="toolbar" aria-label="Text formatting" data-testid="formatbar">
      <IconButton
        icon="paint"
        label={fp ? (fp.sticky ? 'Format painter (on — Esc to stop)' : 'Format painter (click an element)') : 'Format painter (double-click to keep on)'}
        pressed={!!fp}
        disabled={ro || (!fp && st.selection.length !== 1)}
        onClick={() => (fp ? ctl.set({ formatPainter: null }) : copyFormat(ctl))}
        onDblClick={() => copyFormat(ctl, { sticky: true })}
      />
      <span class="sep" />
      <FontSelect doc={doc} value={run.font} disabled={dis} onChange={(v) => setMark('font', v)} />
      <NumberField compact class="fb-size" title="Font size (pt)" unit="pt" value={run.size ? unitsToPt(run.size) : null} min={1} max={750} step={1} precision={1} disabled={dis} onChange={(v) => setMark('size', ptToUnits(v))} />
      <span class="sep" />
      <IconButton icon="bold" label="Bold" shortcut={shortcut('Mod+B')} pressed={(run.weight || 400) >= 600} disabled={dis} onClick={toggleBold} />
      <IconButton icon="italic" label="Italic" shortcut={shortcut('Mod+I')} pressed={!!run.italic} disabled={dis} onClick={() => toggle('italic', true)} />
      <IconButton icon="underline" label="Underline" shortcut={shortcut('Mod+U')} pressed={!!run.underline} disabled={dis} onClick={() => toggle('underline', true)} />
      <IconButton icon="strike" label="Strikethrough" pressed={!!run.strike} disabled={dis} onClick={() => toggle('strike', true)} />
      <ColorPicker label="Text color" compact value={run.color} theme={doc.theme} onChange={(v) => setMark('color', v)} />
      <ColorPicker label="Highlight" compact allowNone value={run.highlight || 'none'} theme={doc.theme} onChange={(v) => setMark('highlight', v === 'none' ? null : v)} />
      <span class="sep" />
      {[['start', 'alignLeft', 'Align start'], ['center', 'alignCenter', 'Center'], ['end', 'alignRight', 'Align end'], ['justify', 'alignJustify', 'Justify']].map(([v, icon, label]) => (
        <IconButton key={v} icon={icon} label={label} pressed={para.align === v} disabled={dis} onClick={() => setPara('align', v)} />
      ))}
      <span class="sep" />
      <IconButton icon="listBullet" label="Bulleted list" pressed={para.list?.kind === 'bullet'} disabled={dis} onClick={() => (inSession ? ctl.textSession.toggleList('bullet') : ctl.toggleListOnSelection('bullet'))} />
      <IconButton icon="listNumber" label="Numbered list" pressed={para.list?.kind === 'number'} disabled={dis} onClick={() => (inSession ? ctl.textSession.toggleList('number') : ctl.toggleListOnSelection('number'))} />
      <IconButton icon="outdent" label="Decrease list level" shortcut="Shift+Tab" disabled={!inSession} onClick={() => ctl.textSession.changeLevel(-1)} />
      <IconButton icon="indent" label="Increase list level" shortcut="Tab" disabled={!inSession} onClick={() => ctl.textSession.changeLevel(1)} />
      <MenuButton label="Line spacing" icon="menu" items={spacingItems} />
      <span class="sep" />
      <IconButton icon="link" label="Link" shortcut={shortcut('Mod+K')} disabled={ro || (!inSession && !st.selection.length)} onClick={() => openLink(ctl)} />
      <MenuButton label="More text options" icon="more" items={dis ? [] : moreItems} />
      {roleNote && <span class="small muted fb-role" title="Text role (style from the theme)">{roleNote}</span>}
    </div>
  );
}
