// Inspector (spec §12.1): properties for the selection; slide properties when
// nothing is selected; tabs for builds and accessibility.
import { Tabs, Select, Checkbox, NumberField, Button, IconButton, TextInput, openDialog } from '../../ui/components.jsx';
import { Icon } from '../../ui/icons.jsx';
import { FillEditor } from './style-editors.jsx';
import { Section, GeometrySection, ElementCommon, StyleSection, TextBoxSection, ShapeSection, ImageSection, VideoSection, TableSection, ChartSection, GroupSection } from './ElementPanels.jsx';
import { TRANSITIONS, EFFECT_LABELS, buildSteps, ENTRANCE } from '../../../core/builds.js';
import { readingOrder, isRtlLanguage } from '../../../core/reading-order.js';
import { resolveSlideTitle } from '../../../core/titles.js';
import { elementLabel } from '../../../core/model.js';
import { defaultAltText } from '../../../core/charts.js';
import { layoutName } from '../../../core/layouts.js';
import { ChangeLayoutDialog } from '../dialogs/SlideDialogs.jsx';
import * as ops from '../../../core/ops.js';

// ---------- slide properties ----------
function SlideProperties({ ctl }) {
  const st = ctl.state;
  const ro = st.readOnly;
  const doc = ctl.doc;
  if (st.mode === 'master') {
    return (
      <Section title="Master">
        <p class="small">Master elements appear beneath every slide that shows the master. Use Insert → Field for slide numbers, dates and titles.</p>
        <p class="small muted">{doc.master?.elements?.length || 0} element(s). Video can’t be placed on the master.</p>
        <Button class="btn-sm" onClick={() => ctl.setMode('slide')}>Done editing master</Button>
      </Section>
    );
  }
  if (st.mode === 'layout') {
    const l = doc.layouts.find((x) => x.id === st.layoutId);
    if (!l) return null;
    const upd = (fn, label) => ctl.dispatch(label, (d) => fn(d.layouts.find((x) => x.id === l.id)));
    return (
      <Section title="Layout">
        <TextInput label="Name" value={l.name} maxLength={100} disabled={ro} onCommit={(v) => v.trim() && upd((x) => { x.name = v.trim(); }, 'Rename layout')} />
        <FillEditor ctl={ctl} label="Background" value={l.background} onChange={(v, rec) => ctl.dispatch('Layout background', (d) => { if (rec && !d.assets.some((a) => a.id === rec.id)) d.assets.push(rec); const x = d.layouts.find((y) => y.id === l.id); if (v === undefined) delete x.background; else x.background = v; })} />
        <Checkbox label="Show master" checked={l.show_master !== false} disabled={ro} onChange={(v) => upd((x) => { if (v) delete x.show_master; else x.show_master = false; }, 'Show master')} />
        <p class="small muted">Editing a layout doesn’t change slides already made from it.</p>
        <Button class="btn-sm" onClick={() => ctl.setMode('slide')}>Done editing layout</Button>
      </Section>
    );
  }
  const slide = ctl.slide;
  if (!slide) return null;
  const set = (patch, label = 'Change slide') => ctl.setSlideProps(patch, [slide.id], label);
  const tr = slide.transition;
  const trKind = tr ? tr.kind : 'default';
  const def = doc.playback?.default_transition || { kind: 'none' };
  const title = resolveSlideTitle(slide);
  return (
    <>
      <Section title="Slide">
        <FillEditor ctl={ctl} label="Background" value={slide.background} onChange={(v, rec) => ctl.dispatch('Change background', (d) => {
          if (rec && !d.assets.some((a) => a.id === rec.id)) d.assets.push(rec);
          ops.setSlideProps(d, [slide.id], { background: v });
        }, { coalesce: `bg:${slide.id}`, window: 600 })} />
        {slide.background !== undefined && <button type="button" class="link-btn" disabled={ro} onClick={() => ctl.dispatch('Apply background to all slides', (d) => { for (const s of Object.values(d.slides)) s.background = slide.background; })}>Apply background to all slides</button>}
        <Checkbox label="Show master elements" checked={slide.show_master !== false} disabled={ro} onChange={(v) => set({ show_master: v ? undefined : false }, 'Show master')} />
        <Checkbox label="Hide slide when presenting" checked={!!slide.hidden} disabled={ro} onChange={(v) => set({ hidden: v || undefined }, v ? 'Hide slide' : 'Show slide')} />
        <div class="row">
          <span class="small grow">Layout: {slide.layout_origin ? layoutName(doc, slide.layout_origin.layout_id) : 'none'}</span>
          <Button class="btn-sm" icon="layout" disabled={ro} onClick={() => openDialog(ChangeLayoutDialog, { ctl })} data-testid="change-layout">Change layout…</Button>
        </div>
      </Section>
      <Section title="Transition">
        <div class="insp-grid">
          <Select
            label="Effect"
            compact
            value={trKind}
            disabled={ro}
            onChange={(k) => set({ transition: k === 'default' ? undefined : { kind: k, duration_ms: tr?.duration_ms || 400, ...(k === 'push' || k === 'wipe' ? { direction: tr?.direction || 'left' } : {}) } }, 'Change transition')}
            options={[{ value: 'default', label: `Default (${def.kind})` }, ...TRANSITIONS.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))]}
          />
          {tr && (tr.kind === 'push' || tr.kind === 'wipe') && (
            <Select label="Direction" compact value={tr.direction || 'left'} disabled={ro} onChange={(dv) => set({ transition: { ...tr, direction: dv } }, 'Change transition')} options={['left', 'right', 'up', 'down'].map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }))} />
          )}
          {tr && tr.kind !== 'none' && <NumberField label="Duration" compact unit="s" precision={1} step={0.1} min={0.1} max={3} value={(tr.duration_ms || 400) / 1000} disabled={ro} onChange={(v) => set({ transition: { ...tr, duration_ms: Math.round(v * 1000) } }, 'Change transition')} />}
        </div>
        {tr && <button type="button" class="link-btn" disabled={ro} onClick={() => ctl.dispatch('Apply transition to all slides', (d) => { for (const s of Object.values(d.slides)) s.transition = tr; })}>Apply to all slides</button>}
      </Section>
      <Section title="Timing">
        <Checkbox label="Custom auto-advance time" checked={slide.advance_after_ms !== undefined} disabled={ro} onChange={(v) => set({ advance_after_ms: v ? doc.playback?.auto_advance?.default_duration_ms || 5000 : undefined }, 'Slide timing')} />
        {slide.advance_after_ms !== undefined && <NumberField label="Advance after" compact unit="s" precision={1} min={1} max={600} value={slide.advance_after_ms / 1000} disabled={ro} onChange={(v) => set({ advance_after_ms: Math.round(v * 1000) }, 'Slide timing')} />}
        <p class="small muted">Auto-advance is {doc.playback?.auto_advance?.enabled ? 'on' : 'off'} for this presentation (Presentation settings → Playback).</p>
      </Section>
      <Section title="Title for navigation">
        <p class="small muted">{title ? <>Current title: “{title}”</> : 'This slide has no visible title.'}</p>
        <TextInput label="Hidden title (used when there’s no visible title)" value={slide.title || ''} maxLength={200} disabled={ro} onCommit={(v) => set({ title: v.trim() || undefined }, 'Hidden title')} />
      </Section>
    </>
  );
}

// ---------- format tab ----------
function FormatTab({ ctl }) {
  const els = ctl.selectedElements();
  if (!els.length) return <SlideProperties ctl={ctl} />;
  const one = els.length === 1 ? els[0] : null;
  return (
    <>
      <ElementCommon ctl={ctl} els={els} />
      {one && <GeometrySection key={one.id} ctl={ctl} el={one} />}
      {els.length > 1 && (
        <Section title="Arrange">
          <div class="row-wrap">
            {[['left', 'alignLeft'], ['center', 'alignCenter'], ['right', 'alignRight']].map(([m, icon]) => <IconButton key={m} icon={icon} label={`Align ${m}`} onClick={() => ctl.align(m)} />)}
            <Button class="btn-sm" onClick={() => ctl.align('top')}>Top</Button>
            <Button class="btn-sm" onClick={() => ctl.align('middle')}>Middle</Button>
            <Button class="btn-sm" onClick={() => ctl.align('bottom')}>Bottom</Button>
          </div>
          <div class="row-wrap">
            <Button class="btn-sm" disabled={els.length < 3} onClick={() => ctl.distribute('x')}>Distribute horizontally</Button>
            <Button class="btn-sm" disabled={els.length < 3} onClick={() => ctl.distribute('y')}>Distribute vertically</Button>
            <Button class="btn-sm" icon="group" onClick={() => ctl.group()}>Group</Button>
          </div>
        </Section>
      )}
      <StyleSection ctl={ctl} els={els} />
      <TextBoxSection ctl={ctl} els={els} />
      {one?.type === 'shape' && <ShapeSection ctl={ctl} el={one} />}
      {one?.type === 'image' && <ImageSection ctl={ctl} el={one} />}
      {one?.type === 'video' && <VideoSection ctl={ctl} el={one} />}
      {one?.type === 'table' && <TableSection ctl={ctl} el={one} />}
      {one?.type === 'chart' && <ChartSection ctl={ctl} el={one} />}
      {one?.type === 'group' && <GroupSection ctl={ctl} el={one} />}
    </>
  );
}

// ---------- builds tab (spec §5.14) ----------
function BuildsTab({ ctl }) {
  const st = ctl.state;
  const ro = st.readOnly;
  if (st.mode !== 'slide') return <p class="small muted pad">Builds belong to slides, not the master or layouts.</p>;
  const slide = ctl.slide;
  const builds = slide.builds || [];
  const byId = new Map(slide.elements.map((e) => [e.id, e]));
  const { steps } = buildSteps(slide);
  const stepOf = new Map();
  steps.forEach((s, i) => s.forEach((b) => { if (!stepOf.has(b.id)) stepOf.set(b.id, i); }));
  const sel = ctl.selectedElements();
  const target = sel.length === 1 && slide.elements.some((e) => e.id === sel[0].id) ? sel[0] : null;
  const upd = (i, patch) => ctl.updateBuilds((list) => {
    list[i] = { ...list[i], ...patch };
    for (const k of Object.keys(list[i])) if (list[i][k] === undefined) delete list[i][k];
    return list;
  });
  const move = (i, d) => ctl.updateBuilds((list) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    [list[i], list[j]] = [list[j], list[i]];
    return list;
  }, 'Reorder builds');
  return (
    <div class="insp-pad">
      <Section title="Add a build">
        {target ? (
          <div class="row-wrap">
            <span class="small grow">{elementLabel(target)}</span>
            {target.type === 'video' ? (
              <Button class="btn-sm" icon="play" disabled={ro} onClick={() => ctl.addBuild(target.id, 'play')}>Play video</Button>
            ) : null}
            <Select compact value="" disabled={ro} onChange={(v) => v && ctl.addBuild(target.id, v)} options={[{ value: '', label: 'Add effect…' }, ...['appear', 'fade_in', 'fly_in', 'disappear', 'fade_out', 'fly_out'].map((e) => ({ value: e, label: EFFECT_LABELS[e] }))]} />
          </div>
        ) : (
          <p class="small muted">Select one element on the slide (not inside a group) to add a build.</p>
        )}
      </Section>
      <Section title={`Builds (${steps.length - 1} click step${steps.length === 2 ? '' : 's'})`}>
        {!builds.length && <p class="small muted">No builds. Elements show all at once.</p>}
        {builds.map((b, i) => {
          const el = byId.get(b.element_id);
          const n = stepOf.get(b.id);
          const textual = el && (el.text || el.shape?.text);
          return (
            <div class="build-item" key={b.id} data-testid="build-item">
              <span class="build-num" title={n === 0 ? 'Runs automatically' : `Click ${n}`}>{n === 0 ? 'A' : n ?? '–'}</span>
              <div class="stack tight">
                <strong class="small">{el ? elementLabel(el) : 'Missing element'}</strong>
                <div class="insp-grid">
                  <Select compact value={b.effect} disabled={ro} onChange={(v) => upd(i, { effect: v, ...(v.startsWith('fly') ? { direction: b.direction || 'left' } : { direction: undefined }), ...(v === 'play' ? { by: undefined } : {}) })} options={(el?.type === 'video' ? ['play'] : []).concat(['appear', 'fade_in', 'fly_in', 'disappear', 'fade_out', 'fly_out']).map((e) => ({ value: e, label: EFFECT_LABELS[e] }))} />
                  <Select compact value={b.trigger} disabled={ro} onChange={(v) => upd(i, { trigger: v })} options={[{ value: 'on_click', label: 'On click' }, { value: 'with_previous', label: 'With previous' }, { value: 'after_previous', label: 'After previous' }]} />
                  {b.effect?.startsWith('fly') && <Select compact value={b.direction || 'left'} disabled={ro} onChange={(v) => upd(i, { direction: v })} options={['left', 'right', 'up', 'down'].map((x) => ({ value: x, label: `From ${x}` }))} />}
                  {textual && b.effect !== 'play' && <Select compact value={b.by || 'element'} disabled={ro} onChange={(v) => upd(i, { by: v === 'element' ? undefined : v })} options={[{ value: 'element', label: 'All at once' }, { value: 'paragraph', label: 'By paragraph' }]} />}
                  {b.effect !== 'play' && b.effect !== 'appear' && b.effect !== 'disappear' && <NumberField compact title="Duration" unit="s" precision={1} step={0.1} min={0} max={10} value={(b.duration_ms ?? 500) / 1000} disabled={ro} onChange={(v) => upd(i, { duration_ms: Math.round(v * 1000) })} />}
                  <NumberField compact title="Delay" unit="s delay" precision={1} step={0.1} min={0} max={10} value={(b.delay_ms || 0) / 1000} disabled={ro} onChange={(v) => upd(i, { delay_ms: v ? Math.round(v * 1000) : undefined })} />
                </div>
              </div>
              <div class="stack tight">
                <IconButton icon="chevronUp" class="is-small" label="Move earlier" disabled={ro || i === 0} onClick={() => move(i, -1)} />
                <IconButton icon="chevronDown" class="is-small" label="Move later" disabled={ro || i === builds.length - 1} onClick={() => move(i, 1)} />
                <IconButton icon="trash" class="is-small" label="Remove build" disabled={ro} onClick={() => ctl.updateBuilds((list) => list.filter((_, j) => j !== i), 'Remove build')} />
              </div>
            </div>
          );
        })}
        {builds.some((b) => ENTRANCE.has(b.effect)) && <p class="small muted">Elements with an entrance build start hidden.</p>}
      </Section>
    </div>
  );
}

// ---------- accessibility tab (spec §16) ----------
function A11yTab({ ctl }) {
  const st = ctl.state;
  const ro = st.readOnly;
  const els = ctl.selectedElements();
  const one = els.length === 1 ? els[0] : null;
  const slide = st.mode === 'slide' ? ctl.slide : null;
  const rtl = isRtlLanguage(ctl.doc.metadata.language);
  const order = slide ? readingOrder(slide, { rtl }) : [];
  const setOrder = (ids) => ctl.setSlideProps({ reading_order: ids }, [slide.id], 'Change reading order');
  const move = (i, d) => {
    const ids = order.map((e) => e.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrder(ids);
  };
  return (
    <div class="insp-pad">
      {one && (
        <Section title={`Alternative text: ${elementLabel(one)}`}>
          <Checkbox label="Decorative (skipped by screen readers)" checked={!!one.accessibility?.decorative} disabled={ro} onChange={(v) => ctl.setProps({ 'accessibility.decorative': v || undefined }, [one.id], 'Decorative')} />
          {!one.accessibility?.decorative && (
            <TextInput
              label="Alt text"
              multiline
              rows={4}
              maxLength={1000}
              value={one.accessibility?.alt || ''}
              placeholder={one.type === 'chart' ? defaultAltText(one.chart, ctl.doc.metadata.language) : 'Describe what this shows and why it matters'}
              disabled={ro}
              onCommit={(v) => ctl.setProps({ 'accessibility.alt': v.trim() || undefined }, [one.id], 'Alt text')}
            />
          )}
          {one.type === 'chart' && !one.accessibility?.alt && <button type="button" class="link-btn" disabled={ro} onClick={() => ctl.setProps({ 'accessibility.alt': defaultAltText(one.chart, ctl.doc.metadata.language).slice(0, 1000) }, [one.id], 'Alt text')}>Use the generated description</button>}
          {(one.type === 'line' || one.type === 'connector') && <p class="small muted">Lines and connectors are skipped by screen readers unless they have alt text.</p>}
        </Section>
      )}
      {els.length > 1 && <p class="small muted pad">Select one element to edit its alt text.</p>}
      {slide && (
        <Section title="Reading order" actions={slide.reading_order?.length ? <button type="button" class="link-btn" disabled={ro} onClick={() => ctl.setSlideProps({ reading_order: undefined }, [slide.id], 'Automatic reading order')}>Use automatic</button> : null}>
          <p class="small muted">{slide.reading_order?.length ? 'Custom order.' : 'Automatic: title first, then top to bottom, ' + (rtl ? 'right to left.' : 'left to right.')}</p>
          <ol class="order-list">
            {order.map((e, i) => (
              <li key={e.id} class={st.selection.includes(e.id) ? 'is-selected' : ''}>
                <button type="button" class="layer-name" onClick={() => ctl.select([e.id])}>{elementLabel(e)}</button>
                <IconButton icon="chevronUp" class="is-small" label={`Move ${elementLabel(e)} earlier`} disabled={ro || i === 0} onClick={() => move(i, -1)} />
                <IconButton icon="chevronDown" class="is-small" label={`Move ${elementLabel(e)} later`} disabled={ro || i === order.length - 1} onClick={() => move(i, 1)} />
              </li>
            ))}
          </ol>
          <p class="small muted">Hidden, decorative and empty placeholder elements aren’t read.</p>
        </Section>
      )}
      <Section title="Checker">
        <Button class="btn-sm" icon="a11y" onClick={() => ctl.set({ panel: 'a11y' })}>Open accessibility checker</Button>
      </Section>
    </div>
  );
}

export function Inspector({ ctl }) {
  const tab = ctl.state.inspectorTab;
  const nb = ctl.state.mode === 'slide' ? (ctl.slide?.builds?.length || 0) : 0;
  return (
    <aside class="inspector" aria-label="Inspector" data-testid="inspector">
      <Tabs label="Inspector" value={tab} onChange={(v) => ctl.set({ inspectorTab: v })} tabs={[{ value: 'format', label: 'Format' }, { value: 'builds', label: 'Builds', badge: nb || null }, { value: 'a11y', label: 'Accessibility' }]} />
      <div class="inspector-scroll">
        {tab === 'format' && <FormatTab ctl={ctl} />}
        {tab === 'builds' && <BuildsTab ctl={ctl} />}
        {tab === 'a11y' && <A11yTab ctl={ctl} />}
      </div>
    </aside>
  );
}

export { Icon };
