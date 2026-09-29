// Slide and presentation dialogs: layout picker, change layout with preview,
// save as layout, presentation settings (details, size, theme, playback) and
// the date field dialog.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog, Button, Tabs, Select, Checkbox, NumberField, TextInput, MenuButton, confirmDialog, promptDialog, toast, openDialog } from '../../ui/components.jsx';
import { BUILTIN_LAYOUTS, layoutElements, planLayoutChange, layoutName } from '../../../core/layouts.js';
import { renderSlide, layoutSlide } from '../../../render/renderer.js';
import { SIZE_PRESETS, MEASURES, toMeasure, fromMeasure, MIN_SLIDE_SIDE, MAX_SLIDE_SIDE, physicalSize } from '../../../core/units.js';
import { TRANSITIONS } from '../../../core/builds.js';
import { newId } from '../../../core/ids.js';
import { elementLabel } from '../../../core/model.js';
import { walk } from '../../../core/model.js';
import { isBodyEmpty } from '../../../core/text.js';
import { settings } from '../../settings.js';
import { LANG_RE } from '../../../core/validate.js';
import { DATE_FORMATS, formatDate } from '../../../core/fields.js';
import { ThemeLibraryDialog, ThemePreview } from '../../dialogs/ThemeLibraryDialog.jsx';
import { applyLibraryTheme, saveThemeToLibrary } from '../theme-actions.js';

// Renders a pseudo-slide (layout preview) in edit mode so prompts show.
export function PseudoSlide({ doc, elements, background, width = 150, assetUrl = () => null }) {
  const ref = useRef(null);
  const W = doc.size.width;
  const H = doc.size.height;
  const s = width / W;
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const slide = { id: 'preview', elements, ...(background ? { background } : {}) };
    const root = renderSlide(doc, slide, { mode: 'edit', assetUrl });
    root.style.transform = `scale(${s})`;
    root.style.transformOrigin = '0 0';
    root.classList.add('thumb-inner');
    host.replaceChildren(root);
    try {
      layoutSlide(root, doc, slide);
    } catch {
      /* preview only */
    }
  }, [doc, elements, background, s]);
  return <div ref={ref} class="pseudo-slide" style={{ width: `${width}px`, height: `${H * s}px` }} aria-hidden="true" />;
}

function allLayouts(doc) {
  return [
    ...BUILTIN_LAYOUTS.map((l) => ({ id: l.id, name: l.name, custom: false })),
    ...(doc.layouts || []).map((l) => ({ id: l.id, name: l.name, custom: true })),
  ];
}

function LayoutCard({ doc, layout, onPick, menu }) {
  const [els] = useState(() => layoutElements(doc, layout.id));
  const custom = (doc.layouts || []).find((l) => l.id === layout.id);
  return (
    <div class="layout-card-wrap">
      <button type="button" class="layout-card" onClick={() => onPick(layout.id)} data-layout={layout.id}>
        <span class="lc-thumb"><PseudoSlide doc={doc} elements={els} background={custom?.background} width={150} /></span>
        <span>{layout.name}</span>
      </button>
      {menu && <MenuButton class="layout-card-menu" label={`Actions for ${layout.name}`} icon="more" buttonClass="is-small" items={menu} />}
    </div>
  );
}

// mode: 'new' (insert a slide) or 'change' (pick for Change layout)
export function LayoutPickerDialog({ close, ctl, mode = 'new' }) {
  const doc = ctl.doc;
  const pick = (id) => {
    close(id);
    if (mode === 'new') ctl.addSlide(id);
  };
  const customMenu = (l) => () => [
    { label: 'Edit layout', icon: 'layout', onSelect: () => { close(null); ctl.setMode('layout', l.id); } },
    { label: 'Rename…', onSelect: async () => {
      const n = await promptDialog({ title: 'Rename layout', label: 'Name', value: l.name, maxLength: 100 });
      if (n && n.trim()) ctl.dispatch('Rename layout', (d) => { d.layouts.find((x) => x.id === l.id).name = n.trim().slice(0, 100); });
    } },
    { label: 'Delete layout', icon: 'trash', danger: true, onSelect: async () => {
      if (await confirmDialog({ title: 'Delete layout?', message: `Slides made from “${l.name}” keep their content.`, confirmLabel: 'Delete', danger: true })) ctl.dispatch('Delete layout', (d) => { d.layouts = d.layouts.filter((x) => x.id !== l.id); });
    } },
  ];
  return (
    <Dialog title={mode === 'new' ? 'New slide' : 'Choose a layout'} onClose={() => close(null)} width={780} class="is-wide">
      <div class="layout-grid">
        {allLayouts(doc).map((l) => <LayoutCard key={l.id} doc={doc} layout={l} onPick={pick} menu={l.custom && !ctl.state.readOnly ? customMenu(l) : null} />)}
      </div>
    </Dialog>
  );
}

// Change layout with a preview (spec §5.12).
export function ChangeLayoutDialog({ close, ctl }) {
  const doc = ctl.doc;
  const slide = ctl.slide;
  const [target, setTarget] = useState(null);
  const plan = target ? planLayoutChange(doc, slide, target) : null;
  if (!target) {
    return (
      <Dialog title="Change layout" onClose={() => close(false)} width={780} class="is-wide" description="Content moves into the new layout’s slots. Nothing is deleted.">
        <div class="layout-grid">
          {allLayouts(doc).map((l) => <LayoutCard key={l.id} doc={doc} layout={l} onPick={setTarget} />)}
        </div>
      </Dialog>
    );
  }
  const byId = new Map(slide.elements.map((e) => [e.id, e]));
  return (
    <Dialog
      title={`Change layout to “${layoutName(doc, target)}”`}
      onClose={() => close(false)}
      width={720}
      footer={
        <>
          <Button onClick={() => setTarget(null)}>Back</Button>
          <Button variant="primary" onClick={() => { ctl.changeLayout(target); close(true); }} data-testid="apply-layout">Apply</Button>
        </>
      }
    >
      <div class="row-wrap align-start">
        <div class="stack">
          <span class="small muted">Before</span>
          <PseudoSlide doc={doc} elements={slide.elements} background={slide.background} width={300} assetUrl={(id) => ctl.assets.editUrl(id)} />
        </div>
        <div class="stack">
          <span class="small muted">After</span>
          <PseudoSlide doc={doc} elements={plan.elements} background={slide.background} width={300} assetUrl={(id) => ctl.assets.editUrl(id)} />
        </div>
      </div>
      <p class="small">
        {plan.placed.length} placed{plan.created.length ? `, ${plan.created.length} new empty slot${plan.created.length === 1 ? '' : 's'}` : ''}.
      </p>
      {plan.notPlaced.length > 0 && (
        <div class="stack">
          <strong class="small">Not placed (stays where it is):</strong>
          <ul class="small plain-list">{plan.notPlaced.map((id) => <li key={id}>{elementLabel(byId.get(id))}</li>)}</ul>
        </div>
      )}
    </Dialog>
  );
}

// Save slide as layout (spec §5.12): optionally turn text into prompts.
export function SaveLayoutDialog({ close, ctl }) {
  const [name, setName] = useState('Custom layout');
  const [prompts, setPrompts] = useState(true);
  const save = () => {
    const slide = ctl.slide;
    const els = structuredClone(slide.elements);
    if (prompts) {
      walk(els, (el) => {
        if (el.type === 'text' && !isBodyEmpty(el.text.body)) {
          const first = el.text.body.paragraphs[0];
          const text = first.inlines.map((i) => i.text || '').join('').slice(0, 200) || 'Click to add text';
          el.text.prompt = text;
          el.text.body = { paragraphs: [{ ...first, inlines: [] }] };
        }
        if (el.type === 'image' && el.role === 'image') el.image = { asset_id: null };
      });
    }
    const layout = { id: newId(), name: name.trim().slice(0, 100) || 'Custom layout', elements: els };
    if (slide.background) layout.background = slide.background;
    if (slide.show_master === false) layout.show_master = false;
    ctl.dispatch('Save as layout', (d) => { d.layouts = [...(d.layouts || []), layout]; });
    toast(`Saved layout “${layout.name}”. It’s in the New slide layout picker.`, { kind: 'success' });
    close(true);
  };
  return (
    <Dialog title="Save slide as layout" onClose={() => close(false)} width={440} footer={<><Button onClick={() => close(false)}>Cancel</Button><Button variant="primary" onClick={save}>Save layout</Button></>}>
      <div class="stack">
        <label class="field"><span class="field-label">Layout name</span><input class="input" value={name} maxLength={100} onInput={(e) => setName(e.currentTarget.value)} data-autofocus /></label>
        <Checkbox label="Turn text into placeholder prompts" checked={prompts} onChange={setPrompts} />
        <p class="small muted">Layouts are starting points. Editing a layout never changes existing slides.</p>
      </div>
    </Dialog>
  );
}

// ---------- presentation settings ----------
function DetailsTab({ ctl }) {
  const m = ctl.doc.metadata;
  const ro = ctl.state.readOnly;
  const [lang, setLang] = useState(m.language);
  const [langErr, setLangErr] = useState('');
  return (
    <div class="stack">
      <TextInput label="Title" value={m.title} maxLength={200} disabled={ro} onCommit={(v) => v.trim() && ctl.rename(v)} />
      <TextInput label="Author" value={m.author || ''} maxLength={200} disabled={ro} onCommit={(v) => ctl.setMetadata({ author: v.trim() || null })} />
      <TextInput label="Description" value={m.description || ''} maxLength={2000} multiline disabled={ro} onCommit={(v) => ctl.setMetadata({ description: v.trim() || null })} />
      <label class="field">
        <span class="field-label">Language</span>
        <input
          class="input"
          value={lang}
          disabled={ro}
          onInput={(e) => { setLang(e.currentTarget.value); setLangErr(''); }}
          onBlur={() => {
            const t = lang.trim();
            if (t === m.language) return;
            if (!LANG_RE.test(t)) {
              setLangErr('Use a language tag such as en-US, fr, ar or ja.');
              return;
            }
            ctl.setMetadata({ language: t });
          }}
        />
        {langErr ? <span class="field-hint is-error">{langErr}</span> : <span class="field-hint">Used for spell checking, screen readers, date fields, hyphenation and right-to-left reading order.</span>}
      </label>
      <p class="small muted">Created {new Date(m.created_at).toLocaleString()} · Modified {new Date(m.updated_at).toLocaleString()}</p>
    </div>
  );
}

function SizeTab({ ctl }) {
  const doc = ctl.doc;
  const measure = settings.get().measure || 'units';
  const [preset, setPreset] = useState(doc.size.preset?.replace(/ portrait$/, '') || 'custom');
  const [portrait, setPortrait] = useState(/portrait$/.test(doc.size.preset || '') || doc.size.height > doc.size.width);
  const [w, setW] = useState(doc.size.width);
  const [h, setH] = useState(doc.size.height);
  const [mode, setMode] = useState('fit');
  const ro = ctl.state.readOnly;
  const choosePreset = (id, port = portrait) => {
    setPreset(id);
    const p = SIZE_PRESETS.find((x) => x.id === id);
    if (p) {
      setW(port ? p.height : p.width);
      setH(port ? p.width : p.height);
    }
  };
  const unchanged = Math.abs(w - doc.size.width) < 0.01 && Math.abs(h - doc.size.height) < 0.01;
  const apply = async () => {
    const size = { width: w, height: h, ...(preset !== 'custom' ? { preset: portrait ? `${preset} portrait` : preset } : {}) };
    const outside = await ctl.changeSize(size, mode);
    toast(outside.length ? `Slide size changed. ${outside.length} element${outside.length === 1 ? ' is' : 's are'} now partly outside the slide.` : 'Slide size changed.', { kind: outside.length ? 'info' : 'success', duration: 8000 });
  };
  const phys = physicalSize({ width: w, height: h });
  const m = MEASURES[measure];
  return (
    <div class="stack">
      <Select label="Size" value={preset} disabled={ro} onChange={(v) => choosePreset(v)} options={[...SIZE_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom' }]} />
      <Checkbox label="Portrait" checked={portrait} disabled={ro || preset === 'custom'} onChange={(v) => { setPortrait(v); choosePreset(preset, v); }} />
      <div class="insp-grid">
        <NumberField label="Width" unit={m.label} value={toMeasure(w, measure)} min={toMeasure(MIN_SLIDE_SIDE, measure)} max={toMeasure(MAX_SLIDE_SIDE, measure)} disabled={ro} onChange={(v) => { setW(fromMeasure(v, measure)); setPreset('custom'); }} />
        <NumberField label="Height" unit={m.label} value={toMeasure(h, measure)} min={toMeasure(MIN_SLIDE_SIDE, measure)} max={toMeasure(MAX_SLIDE_SIDE, measure)} disabled={ro} onChange={(v) => { setH(fromMeasure(v, measure)); setPreset('custom'); }} />
      </div>
      <p class="small muted">{phys.widthIn.toFixed(2)} × {phys.heightIn.toFixed(2)} in when printed.</p>
      <Select
        label="Existing content"
        value={mode}
        disabled={ro}
        onChange={setMode}
        options={[{ value: 'fit', label: 'Scale content to fit (keeps everything visible)' }, { value: 'keep', label: 'Keep content size (centered; may fall outside)' }]}
      />
      <div class="row">
        <Button variant="primary" disabled={ro || unchanged} onClick={apply}>Change size</Button>
        <span class="small muted">A version is saved first, and you can undo.</span>
      </div>
    </div>
  );
}

function ThemeTab({ ctl, close }) {
  const doc = ctl.doc;
  const ro = ctl.state.readOnly;
  return (
    <div class="stack">
      <div class="theme-card is-on current-theme">
        <ThemePreview theme={doc.theme} />
        <strong>{doc.theme.name}</strong>
      </div>
      <div class="row-wrap">
        <Button icon="palette" disabled={ro} onClick={() => openDialog(ThemeLibraryDialog, { currentThemeName: doc.theme.name, onApply: (c) => applyLibraryTheme(ctl, c) })}>Change theme…</Button>
        <Button icon="settings" onClick={() => { close(); ctl.set({ panel: 'theme' }); }}>Edit theme</Button>
        <Button icon="save" onClick={() => saveThemeToLibrary(ctl)}>Save theme to library…</Button>
      </div>
      <div class="field">
        <span class="field-label">Master</span>
        <div class="row">
          <Button icon="master" onClick={() => { close(); ctl.setMode('master'); }}>Edit master</Button>
          <span class="small muted">{doc.master?.elements?.length || 0} element{doc.master?.elements?.length === 1 ? '' : 's'} on every slide that shows the master.</span>
        </div>
      </div>
    </div>
  );
}

function PlaybackTab({ ctl }) {
  const pb = ctl.doc.playback || {};
  const tr = pb.default_transition || { kind: 'none', duration_ms: 400 };
  const aa = pb.auto_advance || {};
  const ro = ctl.state.readOnly;
  const set = (fn) => ctl.setPlayback(fn);
  return (
    <div class="stack">
      <div class="insp-grid">
        <Select label="Default transition" value={tr.kind} disabled={ro} onChange={(v) => set((p) => { p.default_transition = { ...(p.default_transition || {}), kind: v, duration_ms: p.default_transition?.duration_ms || 400 }; if (v === 'push' || v === 'wipe') p.default_transition.direction ||= 'left'; else delete p.default_transition.direction; })} options={TRANSITIONS.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))} />
        <NumberField label="Duration" unit="s" value={(tr.duration_ms || 400) / 1000} min={0.1} max={3} step={0.1} precision={1} disabled={ro || tr.kind === 'none'} onChange={(v) => set((p) => { p.default_transition = { ...(p.default_transition || { kind: 'none' }), duration_ms: Math.round(v * 1000) }; })} />
      </div>
      <Checkbox label="Advance on click" hint="Turn off for interactive decks; keys, links and swipes still navigate." checked={pb.click_to_advance !== false} disabled={ro} onChange={(v) => set((p) => { p.click_to_advance = v; })} />
      <Checkbox label="Advance automatically" checked={!!aa.enabled} disabled={ro} onChange={(v) => set((p) => { p.auto_advance = { ...(p.auto_advance || {}), enabled: v }; })} />
      <div class="insp-grid">
        <NumberField label="Seconds per slide" unit="s" value={(aa.default_duration_ms || 5000) / 1000} min={1} max={600} step={1} precision={1} disabled={ro || !aa.enabled} onChange={(v) => set((p) => { p.auto_advance = { ...(p.auto_advance || {}), default_duration_ms: Math.round(v * 1000) }; })} />
      </div>
      <Checkbox label="Loop (kiosk)" hint="After the last slide, start again. There’s no end screen." checked={!!aa.loop} disabled={ro} onChange={(v) => set((p) => { p.auto_advance = { ...(p.auto_advance || {}), loop: v }; })} />
      <p class="small muted">Slides can override the duration in the slide properties.</p>
    </div>
  );
}

export function PresentationSettingsDialog({ close, ctl, tab: initialTab = 'details' }) {
  const [tab, setTab] = useState(initialTab);
  const [, force] = useState(0);
  useEffect(() => ctl.subscribe((r) => { if (r !== 'text-selection') force((n) => n + 1); }), [ctl]);
  return (
    <Dialog title="Presentation settings" onClose={() => close()} width={560} footer={<Button variant="primary" onClick={() => close()}>Done</Button>}>
      <Tabs label="Settings sections" value={tab} onChange={setTab} tabs={[{ value: 'details', label: 'Details' }, { value: 'size', label: 'Size' }, { value: 'theme', label: 'Theme & master' }, { value: 'playback', label: 'Playback' }]} />
      <div class="settings-tab">
        {tab === 'details' && <DetailsTab ctl={ctl} />}
        {tab === 'size' && <SizeTab ctl={ctl} />}
        {tab === 'theme' && <ThemeTab ctl={ctl} close={close} />}
        {tab === 'playback' && <PlaybackTab ctl={ctl} />}
      </div>
    </Dialog>
  );
}

// Date field options (spec §5.11).
export function MasterFieldDialog({ close, ctl }) {
  const [format, setFormat] = useState('medium');
  const [auto, setAuto] = useState(true);
  const [fixed, setFixed] = useState(new Date().toISOString().slice(0, 10));
  const lang = ctl.doc.metadata.language;
  const insert = () => {
    const field = { field: 'date', format, value: auto ? 'auto' : fixed };
    if (ctl.textSession) ctl.textSession.insertField('date', { format, value: field.value });
    else {
      const W = ctl.doc.size.width;
      const H = ctl.doc.size.height;
      const el = { id: newId(), type: 'text', role: 'footer', geometry: { x: 40, y: H - 60, width: 240, height: 36 }, text: { body: { paragraphs: [{ inlines: [field] }] }, box: { autofit: 'grow' } } };
      void W;
      ctl.insertElements([el], { label: 'Insert date' });
    }
    close(true);
  };
  return (
    <Dialog title="Insert date" onClose={() => close(false)} width={420} footer={<><Button onClick={() => close(false)}>Cancel</Button><Button variant="primary" onClick={insert}>Insert</Button></>}>
      <div class="stack">
        <Select label="Format" value={format} onChange={setFormat} options={DATE_FORMATS.map((f) => ({ value: f, label: formatDate(new Date(), f, lang) }))} />
        <Checkbox label="Update automatically" checked={auto} onChange={setAuto} />
        {!auto && <label class="field"><span class="field-label">Date</span><input class="input" type="date" value={fixed} onInput={(e) => setFixed(e.currentTarget.value)} /></label>}
      </div>
    </Dialog>
  );
}
