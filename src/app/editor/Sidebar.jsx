// Left sidebar (spec §12.7): slide thumbnails grouped by section, outline view
// and slide sorter.
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconButton, MenuButton, openContextMenu, openDialog, confirmDialog, promptDialog, Segmented, toast } from '../ui/components.jsx';
import { Icon } from '../ui/icons.jsx';
import { SlideThumb } from '../SlideThumb.jsx';
import { slideOrder } from '../../core/model.js';
import { buildSteps } from '../../core/builds.js';
import { resolveSlideTitle, titleElement } from '../../core/titles.js';
import { readingOrder } from '../../core/reading-order.js';
import { plainText, replaceBodyText, bodyFromText, isBodyEmpty } from '../../core/text.js';
import { layoutElements } from '../../core/layouts.js';
import * as ops from '../../core/ops.js';
import { slideMenuItems, renameSectionPrompt } from './menus.js';
import { LayoutPickerDialog } from './dialogs/SlideDialogs.jsx';
import { newId } from '../../core/ids.js';

const DRAG_TYPE = 'application/x-pe-slide-ids';

function SlideBadges({ slide }) {
  const hasBuilds = !!slide.builds?.length;
  const hasTransition = slide.transition && slide.transition.kind !== 'none';
  const hasNotes = slide.notes && !isBodyEmpty(slide.notes);
  return (
    <span class="thumb-badges" aria-hidden="true">
      {slide.hidden && <span title="Hidden"><Icon name="eyeOff" size={11} /></span>}
      {hasBuilds && <span title="Builds"><Icon name="play" size={11} /></span>}
      {hasTransition && <span title="Transition"><Icon name="slides" size={11} /></span>}
      {hasNotes && <span title="Notes"><Icon name="notes" size={11} /></span>}
    </span>
  );
}

function slideLabel(doc, id, n) {
  const s = doc.slides[id];
  const t = resolveSlideTitle(s) || 'Untitled';
  const extras = [s.hidden && 'hidden', s.builds?.length && `${buildSteps(s).clickSteps} build steps`, s.notes && !isBodyEmpty(s.notes) && 'has notes'].filter(Boolean);
  return `Slide ${n}: ${t}${extras.length ? ` (${extras.join(', ')})` : ''}`;
}

// Shared selection/drag behavior for the list and the sorter.
function useSlideInteractions(ctl) {
  const [drop, setDrop] = useState(null); // { beforeId, sectionId }
  const anchorRef = useRef(null);
  const order = slideOrder(ctl.doc);

  const click = (e, id) => {
    const st = ctl.state;
    if (e.shiftKey) {
      anchorRef.current ||= st.slideId;
      const a = order.indexOf(anchorRef.current);
      const b = order.indexOf(id);
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      if (st.slideId !== id) ctl.setSlide(id);
      ctl.set({ slideSelection: range });
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      const sel = st.slideSelection.includes(id) ? st.slideSelection.filter((x) => x !== id) : [...st.slideSelection, id];
      ctl.set({ slideSelection: sel.length ? sel : [id] });
      anchorRef.current = id;
      return;
    }
    anchorRef.current = id;
    ctl.setSlide(id);
  };

  const contextMenu = (e, id) => {
    e.preventDefault();
    let ids = ctl.state.slideSelection;
    if (!ids.includes(id)) {
      ctl.setSlide(id);
      ids = [id];
    }
    const items = slideMenuItems(ctl, ids, {
      onCopyImage: async () => {
        const { copySlideAsImage } = await import('../../export/image.js');
        copySlideAsImage(ctl, id);
      },
      onMoveToSection: () => moveToSection(ctl, ids),
      onNewSection: async () => {
        const name = await promptDialog({ title: 'New section', label: 'Section name', value: 'New section', maxLength: 100 });
        if (name === null) return;
        ctl.dispatch('New section', (d) => ops.addSection(d, { name: name.trim() || 'New section', slideIds: ids }));
      },
    });
    openContextMenu(e.clientX, e.clientY, items);
  };

  const dragStart = (e, id) => {
    if (ctl.state.readOnly) {
      e.preventDefault();
      return;
    }
    let ids = ctl.state.slideSelection.includes(id) ? ctl.state.slideSelection : [id];
    ids = order.filter((x) => ids.includes(x));
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };

  const dragOver = (e, id, { horizontal = false } = {}) => {
    if (![...e.dataTransfer.types].includes(DRAG_TYPE)) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const after = horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    const idx = order.indexOf(id);
    const beforeId = after ? order[idx + 1] || null : id;
    const sectionId = !beforeId ? ctl.doc.sections[ctl.doc.sections.length - 1].id : null;
    if (drop?.beforeId !== beforeId || drop?.sectionId !== sectionId) setDrop({ beforeId, sectionId, anchor: id, after });
  };

  const dropOn = (e) => {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    setDrop(null);
    if (!raw || !drop) return;
    e.preventDefault();
    const ids = JSON.parse(raw);
    ctl.moveSlides(ids, { beforeId: drop.beforeId, sectionId: drop.sectionId });
  };

  const dropOnSection = (e, sectionId) => {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    setDrop(null);
    if (!raw) return;
    e.preventDefault();
    ctl.moveSlides(JSON.parse(raw), { sectionId });
  };

  return { click, contextMenu, dragStart, dragOver, dropOn, dropOnSection, drop, setDrop };
}

async function moveToSection(ctl, ids) {
  const named = ctl.doc.sections;
  const choice = await openDialog(({ close }) => (
    <MoveSectionDialog close={close} sections={named} />
  ));
  if (choice) ctl.moveSlides(ids, { sectionId: choice });
}

function MoveSectionDialog({ close, sections }) {
  const [v, setV] = useState(sections[0].id);
  return (
    <SimpleDialog title="Move to section" onClose={() => close(null)} onOk={() => close(v)}>
      <label class="field">
        <span class="field-label">Section</span>
        <select class="input select" value={v} onChange={(e) => setV(e.currentTarget.value)} data-autofocus>
          {sections.map((s, i) => <option key={s.id} value={s.id}>{s.name || `Untitled section ${i + 1}`}</option>)}
        </select>
      </label>
    </SimpleDialog>
  );
}

import { Dialog, Button } from '../ui/components.jsx';
function SimpleDialog({ title, onClose, onOk, children }) {
  return (
    <Dialog title={title} onClose={onClose} width={420} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={onOk}>OK</Button></>}>
      {children}
    </Dialog>
  );
}

function sectionMenu(ctl, sec, idx) {
  const ro = ctl.state.readOnly;
  const collapsed = ctl.state.collapsed.includes(sec.id);
  return [
    { label: 'Rename section…', icon: 'text', disabled: ro, onSelect: () => renameSectionPrompt(ctl, sec) },
    { label: collapsed ? 'Expand' : 'Collapse', onSelect: () => toggleCollapse(ctl, sec.id) },
    { label: 'Move section up', disabled: ro || idx === 0, onSelect: () => ctl.dispatch('Move section', (d) => ops.moveSection(d, sec.id, -1)) },
    { label: 'Move section down', disabled: ro || idx === ctl.doc.sections.length - 1, onSelect: () => ctl.dispatch('Move section', (d) => ops.moveSection(d, sec.id, 1)) },
    { separator: true },
    { label: 'Remove section (keep slides)', disabled: ro || sec.name === null, onSelect: () => ctl.dispatch('Remove section', (d) => ops.deleteSection(d, sec.id, false)) },
    {
      label: 'Delete section and its slides…',
      danger: true,
      icon: 'trash',
      disabled: ro || sec.slide_ids.length >= slideOrder(ctl.doc).length,
      onSelect: async () => {
        const ok = await confirmDialog({ title: 'Delete section?', message: `This deletes the section and its ${sec.slide_ids.length} slide${sec.slide_ids.length === 1 ? '' : 's'}. You can undo this.`, confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        const cur = ctl.state.slideId;
        ctl.dispatch('Delete section', (d) => ops.deleteSection(d, sec.id, true));
        if (!ctl.doc.slides[cur]) ctl.setSlide(slideOrder(ctl.doc)[0]);
      },
    },
  ];
}

function toggleCollapse(ctl, id) {
  const c = ctl.state.collapsed;
  ctl.set({ collapsed: c.includes(id) ? c.filter((x) => x !== id) : [...c, id] });
}

function SectionHeader({ ctl, sec, idx, count, onDrop }) {
  const collapsed = ctl.state.collapsed.includes(sec.id);
  const name = sec.name || (ctl.doc.sections.length > 1 ? 'Untitled section' : null);
  if (!name) return null;
  return (
    <div class="section-head" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, sec.id)}>
      <button type="button" class="section-toggle" aria-expanded={!collapsed} onClick={() => toggleCollapse(ctl, sec.id)} onDblClick={() => renameSectionPrompt(ctl, sec)}>
        <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={14} />
        <span class="section-name">{name}</span>
        <span class="section-count">{count}</span>
      </button>
      <MenuButton label={`Section actions for ${name}`} icon="more" buttonClass="is-small" items={() => sectionMenu(ctl, sec, idx)} />
    </div>
  );
}

function SlideList({ ctl, thumbWidth = 176 }) {
  const doc = ctl.doc;
  const st = ctl.state;
  const ix = useSlideInteractions(ctl);
  const order = slideOrder(doc);
  const listRef = useRef(null);
  useEffect(() => {
    listRef.current?.querySelector('.thumb.is-current')?.scrollIntoView({ block: 'nearest' });
  }, [st.slideId]);
  const assetUrl = (id) => ctl.assets.editUrl(id);
  return (
    <div class="sidebar-scroll" ref={listRef} role="listbox" aria-label="Slides" aria-multiselectable="true" data-clipboard-scope="slides" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) ix.setDrop(null); }}>
      {doc.sections.map((sec, si) => {
        const collapsed = st.collapsed.includes(sec.id);
        return (
          <div key={sec.id} class="section-block">
            <SectionHeader ctl={ctl} sec={sec} idx={si} count={sec.slide_ids.length} onDrop={ix.dropOnSection} />
            {!collapsed && sec.slide_ids.map((id) => {
              const n = order.indexOf(id) + 1;
              const slide = doc.slides[id];
              const cur = id === st.slideId && st.mode === 'slide';
              const selected = st.slideSelection.includes(id);
              return (
                <div key={id}>
                  {ix.drop && ix.drop.beforeId === id && <div class="drop-line" />}
                  <div class="thumb-row">
                    <span class="thumb-num" aria-hidden="true">{n}</span>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      aria-current={cur ? 'true' : undefined}
                      aria-label={slideLabel(doc, id, n)}
                      tabIndex={cur ? 0 : -1}
                      class={`thumb ${cur ? 'is-current' : ''} ${selected ? 'is-selected' : ''} ${slide.hidden ? 'is-hidden' : ''}`}
                      draggable={!st.readOnly}
                      data-slide-id={id}
                      data-testid="slide-thumb"
                      onClick={(e) => ix.click(e, id)}
                      onContextMenu={(e) => ix.contextMenu(e, id)}
                      onDragStart={(e) => ix.dragStart(e, id)}
                      onDragOver={(e) => ix.dragOver(e, id)}
                      onDrop={ix.dropOn}
                    >
                      <SlideThumb doc={doc} slide={slide} assetUrl={assetUrl} width={thumbWidth} />
                      <SlideBadges slide={slide} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      {ix.drop && ix.drop.beforeId === null && <div class="drop-line" />}
    </div>
  );
}

function SorterGrid({ ctl }) {
  const doc = ctl.doc;
  const st = ctl.state;
  const ix = useSlideInteractions(ctl);
  const order = slideOrder(doc);
  const assetUrl = (id) => ctl.assets.editUrl(id);
  return (
    <div class="sorter-scroll" role="listbox" aria-label="Slide sorter" aria-multiselectable="true" data-clipboard-scope="slides">
      {doc.sections.map((sec, si) => {
        const collapsed = st.collapsed.includes(sec.id);
        return (
          <div key={sec.id} class="sorter-section">
            <SectionHeader ctl={ctl} sec={sec} idx={si} count={sec.slide_ids.length} onDrop={ix.dropOnSection} />
            {!collapsed && (
              <div class="sorter-grid">
                {sec.slide_ids.map((id) => {
                  const n = order.indexOf(id) + 1;
                  const slide = doc.slides[id];
                  const cur = id === st.slideId;
                  const selected = st.slideSelection.includes(id);
                  const showDrop = ix.drop && ((ix.drop.anchor === id && ix.drop.after) || (ix.drop.beforeId === id && !ix.drop.after));
                  return (
                    <div key={id} class={`sorter-item ${showDrop ? (ix.drop.after ? 'drop-after' : 'drop-before') : ''}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-label={slideLabel(doc, id, n)}
                        tabIndex={cur ? 0 : -1}
                        class={`thumb ${cur ? 'is-current' : ''} ${selected ? 'is-selected' : ''} ${slide.hidden ? 'is-hidden' : ''}`}
                        draggable={!st.readOnly}
                        data-slide-id={id}
                        onClick={(e) => ix.click(e, id)}
                        onDblClick={() => { ctl.setSlide(id); ctl.set({ sidebarView: 'slides' }); }}
                        onContextMenu={(e) => ix.contextMenu(e, id)}
                        onDragStart={(e) => ix.dragStart(e, id)}
                        onDragOver={(e) => ix.dragOver(e, id, { horizontal: true })}
                        onDrop={ix.dropOn}
                      >
                        <SlideThumb doc={doc} slide={slide} assetUrl={assetUrl} width={200} />
                        <SlideBadges slide={slide} />
                      </button>
                      <div class="sorter-caption"><span class="thumb-num">{n}</span> <span class="sorter-title">{resolveSlideTitle(slide) || 'Untitled'}</span></div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- outline (spec §12.7) ----------
function bodyElement(slide) {
  return readingOrder(slide, { includeEmpty: true }).find((e) => e.role === 'body' && e.type === 'text') || null;
}

function OutlineText({ value, onCommit, label, multiline, class: cls = '', disabled }) {
  const [v, setV] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(value);
  }, [value]);
  const commit = () => {
    focused.current = false;
    if (v !== value) onCommit(v);
  };
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <Tag
      class={`input ${cls}`}
      value={v}
      aria-label={label}
      rows={multiline ? Math.min(12, Math.max(2, v.split('\n').length)) : undefined}
      disabled={disabled}
      onFocus={() => { focused.current = true; }}
      onInput={(e) => setV(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (!multiline && e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

function setOutlineText(ctl, slideId, role, text) {
  const doc = ctl.doc;
  const slide = doc.slides[slideId];
  const el = role === 'title' ? titleElement(slide) : bodyElement(slide);
  if (el) {
    ctl.dispatch(role === 'title' ? 'Edit title' : 'Edit body', (d) => {
      const s = d.slides[slideId];
      const hit = ops.getElement(d, { kind: 'slide', slideId }, el.id);
      const c = hit.text || hit.shape?.text;
      c.body = replaceBodyText(c.body, text.slice(0, 50000));
      void s;
    });
    return;
  }
  if (!text.trim()) return;
  const slot = layoutElements(doc, 'title_body').find((e) => e.role === role);
  if (!slot) return;
  slot.text.body = bodyFromText(text);
  if (role === 'body') slot.text.body.paragraphs = slot.text.body.paragraphs.map((p) => ({ ...p, list: { kind: 'bullet', level: 0 } }));
  ctl.dispatch(role === 'title' ? 'Add title' : 'Add body', (d) => ops.insertElements(d, { kind: 'slide', slideId }, [slot]));
}

function Outline({ ctl }) {
  const doc = ctl.doc;
  const st = ctl.state;
  const [showNotes, setShowNotes] = useState(false);
  const order = slideOrder(doc);
  const ro = st.readOnly;
  return (
    <div class="sidebar-scroll outline" data-clipboard-scope="slides">
      <label class="check small"><input type="checkbox" checked={showNotes} onChange={(e) => setShowNotes(e.currentTarget.checked)} /> <span>Show notes</span></label>
      {doc.sections.map((sec, si) => {
        const collapsed = st.collapsed.includes(sec.id);
        return (
          <div key={sec.id} class="stack">
            <SectionHeader ctl={ctl} sec={sec} idx={si} count={sec.slide_ids.length} onDrop={() => undefined} />
            {!collapsed && sec.slide_ids.map((id) => {
              const slide = doc.slides[id];
              const n = order.indexOf(id) + 1;
              const tEl = titleElement(slide);
              const bEl = bodyElement(slide);
              const title = tEl ? plainText(tEl.text?.body || tEl.shape?.text?.body) : '';
              const body = bEl ? plainText(bEl.text.body) : '';
              const idx = order.indexOf(id);
              return (
                <div key={id} class={`outline-slide ${id === st.slideId ? 'is-current' : ''}`} onFocusIn={() => { if (ctl.state.slideId !== id) ctl.setSlide(id); }}>
                  <div class="row">
                    <span class="thumb-num">{n}</span>
                    <OutlineText class="outline-title" value={title} label={`Slide ${n} title`} disabled={ro} onCommit={(v) => setOutlineText(ctl, id, 'title', v)} />
                    <MenuButton
                      label={`Actions for slide ${n}`}
                      icon="more"
                      buttonClass="is-small"
                      items={() => [
                        { label: 'Add slide after', icon: 'plus', disabled: ro, onSelect: () => ctl.addSlide('title_body', id) },
                        { label: 'Move up', disabled: ro || idx === 0, onSelect: () => ctl.moveSlides([id], { beforeId: order[idx - 1] }) },
                        { label: 'Move down', disabled: ro || idx === order.length - 1, onSelect: () => ctl.moveSlides([id], { beforeId: order[idx + 2] || null, sectionId: order[idx + 2] ? null : doc.sections[doc.sections.length - 1].id }) },
                        { label: 'Move to section…', disabled: ro, onSelect: () => moveToSection(ctl, [id]) },
                        { label: 'Delete slide', icon: 'trash', danger: true, disabled: ro || order.length < 2, onSelect: () => ctl.deleteSlides([id]) },
                      ]}
                    />
                  </div>
                  <OutlineText multiline value={body} label={`Slide ${n} body`} disabled={ro} onCommit={(v) => setOutlineText(ctl, id, 'body', v)} />
                  {showNotes && (
                    <OutlineText
                      multiline
                      class="outline-notes"
                      value={slide.notes ? plainText(slide.notes) : ''}
                      label={`Slide ${n} notes`}
                      disabled={ro}
                      onCommit={(v) => {
                        if (ctl.state.slideId !== id) ctl.setSlide(id);
                        ctl.setNotes(replaceBodyText(slide.notes || { paragraphs: [{ inlines: [] }] }, v), { coalesce: false });
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      <button type="button" class="btn btn-ghost" disabled={ro} onClick={() => ctl.addSlide('title_body', order[order.length - 1])}><Icon name="plus" size={16} /> Add slide</button>
    </div>
  );
}

export function Sidebar({ ctl }) {
  const st = ctl.state;
  const view = st.sidebarView;
  const onKeyDown = (e) => {
    if (e.target.closest('input, textarea, select')) return;
    const order = slideOrder(ctl.doc);
    const i = order.indexOf(st.slideId);
    const mod = e.metaKey || e.ctrlKey;
    let handled = true;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      if (mod && !st.readOnly) ctl.moveSlides(st.slideSelection, { beforeId: order[order.indexOf(st.slideSelection[st.slideSelection.length - 1]) + 2] || null, sectionId: null });
      else ctl.setSlide(order[Math.min(order.length - 1, i + 1)]);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      if (mod && !st.readOnly) ctl.moveSlides(st.slideSelection, { beforeId: order[Math.max(0, order.indexOf(st.slideSelection[0]) - 1)] });
      else ctl.setSlide(order[Math.max(0, i - 1)]);
    } else if (e.key === 'Home') ctl.setSlide(order[0]);
    else if (e.key === 'End') ctl.setSlide(order[order.length - 1]);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && !st.readOnly) ctl.deleteSlides(st.slideSelection);
    else if (mod && e.key.toLowerCase() === 'd' && !st.readOnly) ctl.duplicateSlides(st.slideSelection);
    else if (mod && e.key.toLowerCase() === 'a') ctl.set({ slideSelection: order.slice() });
    else if (e.key === 'Enter') document.querySelector('[data-testid="canvas"]')?.focus();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => document.querySelector('.thumb.is-current')?.focus({ preventScroll: false }), 0);
    }
  };
  if (view === 'sorter') {
    return (
      <section class="sorter" aria-label="Slide sorter" onKeyDown={onKeyDown}>
        <div class="sidebar-head">
          <SidebarViewSwitch ctl={ctl} />
          <span class="spacer" />
          <span class="small muted">Drag to reorder. Double-click a slide to edit it.</span>
        </div>
        <SorterGrid ctl={ctl} />
      </section>
    );
  }
  return (
    <aside class={`sidebar ${view === 'outline' ? 'is-outline' : ''}`} aria-label="Slides" onKeyDown={view === 'slides' ? onKeyDown : undefined}>
      <div class="sidebar-head">
        <SidebarViewSwitch ctl={ctl} />
        <span class="spacer" />
        <IconButton icon="plus" label="New slide" shortcut="Ctrl+M" disabled={st.readOnly} onClick={() => ctl.addSlide('title_body')} data-testid="new-slide" />
        <IconButton icon="layout" label="New slide from layout…" disabled={st.readOnly} onClick={() => openDialog(LayoutPickerDialog, { ctl, mode: 'new' })} />
      </div>
      {st.mode !== 'slide' && (
        <div class="banner is-info small master-banner">
          <Icon name="master" size={14} />
          <span class="grow">{st.mode === 'master' ? 'Editing the master' : 'Editing a layout'}</span>
          <button type="button" class="btn btn-sm" onClick={() => ctl.setMode('slide')}>Done</button>
        </div>
      )}
      {view === 'outline' ? <Outline ctl={ctl} /> : <SlideList ctl={ctl} />}
    </aside>
  );
}

function SidebarViewSwitch({ ctl }) {
  return (
    <Segmented
      label="Slide list view"
      value={ctl.state.sidebarView}
      onChange={(v) => ctl.set({ sidebarView: v })}
      options={[{ value: 'slides', label: 'Slides', icon: 'slides' }, { value: 'outline', label: 'Outline', icon: 'outline' }, { value: 'sorter', label: 'Slide sorter', icon: 'sorter' }]}
    />
  );
}

export { toast, newId };
