// EditorController: owns the document store, the editing session (lock,
// autosave, snapshots), selection and editor UI state, and every command.
import { current } from 'immer';
import { createStore } from '../../core/store.js';
import * as ops from '../../core/ops.js';
import { validateDocument } from '../../core/validate.js';
import { normalizeDocument } from '../../core/canonical.js';
import { migrateDocument, CURRENT_FORMAT_VERSION } from '../../core/migrate.js';
import { slideOrder, locate, walk, textElement, shapeElement, lineElement, connectorElement, tableElement, chartElement, imageElement, videoElement, nowIso, referencedAssetIds, elementLabel, sectionOfSlide } from '../../core/model.js';
import { createSlideFromLayout, planLayoutChange } from '../../core/layouts.js';
import { copyElements, copySlides } from '../../core/remap.js';
import { worldMap, elementAABB, resolveEndWorld, IDENTITY, geometryKind, unionBoxes } from '../../core/geometry.js';
import { patchAllMarks, patchAllParagraphs, bodyFromText } from '../../core/text.js';
import { newId } from '../../core/ids.js';
import { roundLen } from '../../core/units.js';
import { loadDocument, getMeta, patchMeta, saveDocument, listAssetRecords, deleteAssets, snapshotDocs, getEditorState, setEditorState, loadSnapshot, createPresentation as repoCreate, addSnapshot } from '../../storage/repo.js';
import { EditorSession, broadcast } from '../../storage/session.js';
import { AssetCache } from './asset-cache.js';
import { prepareAsset } from '../../io/assets.js';
import { capturePoster } from '../../io/assets.js';
import { registerCustomFonts, registryFontIds } from '../../render/fonts.js';
import { toast, announce } from '../ui/components.jsx';
import { settings } from '../settings.js';
import { buildSteps } from '../../core/builds.js';
import { checkAccessibility } from '../../core/a11y.js';
import { sha256 } from '../../io/hash.js';

const DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

export class EditorController {
  constructor(presentationId, { navigate } = {}) {
    this.id = presentationId;
    this.navigate = navigate || (() => {});
    this.listeners = new Set();
    this.store = null;
    this.session = null;
    this.assets = new AssetCache(presentationId, () => this.emit('assets'));
    this.state = {
      loading: true,
      error: null,
      slideId: null,
      selection: [],
      slideSelection: [],
      mode: 'slide',
      layoutId: null,
      enteredGroup: null,
      editing: null,
      crop: null,
      zoom: 'fit',
      sidebarView: 'slides',
      panel: 'inspector',
      inspectorTab: 'format',
      notesOpen: true,
      notesHeight: 140,
      rulers: false,
      readOnly: true,
      lockLost: false,
      saveStatus: { state: 'saved' },
      formatPainter: null,
      overflow: new Set(),
      measured: new Map(),
      collapsed: [],
      presenting: false,
      version: 0,
      linkedFile: null,
    };
    this.textSession = null;
    this.clipboardReplay = null;
  }

  // ---------- events ----------
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason = 'state') {
    this.state = { ...this.state, version: this.state.version + 1 };
    for (const fn of this.listeners) fn(reason);
  }

  set(patch, reason = 'state') {
    Object.assign(this.state, patch);
    this.emit(reason);
    if ('slideId' in patch || 'zoom' in patch || 'collapsed' in patch) this.persistEditorState();
  }

  get doc() {
    return this.store?.getDoc();
  }

  get slide() {
    return this.doc?.slides[this.state.slideId] || null;
  }

  get container() {
    if (this.state.mode === 'master') return { kind: 'master' };
    if (this.state.mode === 'layout') return { kind: 'layout', layoutId: this.state.layoutId };
    return { kind: 'slide', slideId: this.state.slideId };
  }

  elements() {
    return ops.listFor(this.doc, this.container) || [];
  }

  find(id) {
    return locate(this.elements(), id);
  }

  selectedElements() {
    return this.state.selection.map((id) => this.find(id)?.el).filter(Boolean);
  }

  // ---------- loading ----------
  async load() {
    try {
      const meta = await getMeta(this.id);
      const rec = await loadDocument(this.id);
      if (!meta || !rec) throw new Error('This presentation doesn’t exist in this browser.');
      if (rec.format_version > CURRENT_FORMAT_VERSION) {
        this.state.newerVersion = true;
      }
      let doc = rec.doc;
      let migrated = false;
      if (rec.format_version < CURRENT_FORMAT_VERSION) {
        await addSnapshot(this.id, doc, { reason: 'Before format migration' });
        doc = migrateDocument(doc, rec.format_version);
        migrated = true;
      }
      doc = normalizeDocument(doc);
      this.meta = meta;
      this.store = createStore(doc, {
        validate: DEV ? (d) => validateDocument(d, { fontIds: registryFontIds() }) : null,
      });
      this.store.subscribe((e) => this.onStoreEvent(e));
      await this.assets.loadAll(doc);
      await registerCustomFonts(doc, async (id) => (await this.assets.blobAsync(id))?.arrayBuffer());
      const es = await getEditorState(this.id);
      const order = slideOrder(doc);
      const slideId = es.slideId && doc.slides[es.slideId] ? es.slideId : order[0];
      this.state = { ...this.state, loading: false, slideId, slideSelection: [slideId], zoom: es.zoom || 'fit', collapsed: es.collapsed || [], linkedFile: meta.linked_file || null };
      this.session = new EditorSession(this.id, {
        getDoc: () => this.doc,
        onStatus: (s) => this.set({ saveStatus: s }, 'status'),
        onReadOnly: (ro) => this.set({ readOnly: ro || !!this.state.newerVersion }, 'status'),
        onLockLost: () => {
          this.endTextEditing();
          this.store.clearHistory();
          this.set({ lockLost: true }, 'status');
          toast('Editing moved to another tab. This tab is now read-only.', { kind: 'info', duration: 8000 });
        },
        onReloadRequired: () => this.set({ reloadRequired: true }, 'status'),
      });
      if (!this.state.newerVersion) {
        const ok = await this.session.acquire();
        if (ok) {
          if (migrated) await saveDocument(doc);
          await this.session.snapshotOnOpen();
          this.cleanupAssets();
        }
      } else this.state.readOnly = true;
      this.emit('load');
    } catch (e) {
      this.set({ loading: false, error: e.message || String(e) });
    }
  }

  async cleanupAssets({ manual = false } = {}) {
    // Only assets referenced by nothing live: document, snapshots, undo history (spec §8.5).
    try {
      const live = referencedAssetIds(this.doc);
      for (const d of this.store.historyDocs()) for (const id of referencedAssetIds(d)) live.add(id);
      for (const d of await snapshotDocs(this.id)) for (const id of referencedAssetIds(d)) live.add(id);
      const recs = await listAssetRecords(this.id);
      const dead = recs.filter((r) => !r.pending && !live.has(r.asset_id)).map((r) => r.asset_id);
      if (dead.length) {
        await deleteAssets(this.id, dead);
        this.assets.forget(dead);
      }
      if (manual) toast(dead.length ? `Removed ${dead.length} unused media file${dead.length === 1 ? '' : 's'}.` : 'No unused media found.', { kind: 'success' });
      return dead.length;
    } catch {
      return 0;
    }
  }

  onStoreEvent(e) {
    if (e.type === 'undo' || e.type === 'redo') {
      const sel = e.type === 'undo' ? e.entry.selBefore : e.entry.selAfter;
      if (sel) {
        const patch = { selection: sel.selection || [] };
        if (sel.slideId && this.doc.slides[sel.slideId]) patch.slideId = sel.slideId;
        Object.assign(this.state, patch);
      }
      if (!this.doc.slides[this.state.slideId]) this.state.slideId = slideOrder(this.doc)[0];
      this.state.selection = this.state.selection.filter((id) => this.find(id));
      if (this.textSession) {
        const el = this.find(this.state.editing?.elementId)?.el;
        const body = el && this.bodyFor(el, this.state.editing.target);
        if (body) this.textSession.syncFromBody(body);
        else this.endTextEditing({ commit: false });
      }
      announce(`${e.type === 'undo' ? 'Undid' : 'Redid'} ${e.entry.label}`);
    }
    this.session?.markDirty();
    this.emit(e.type === 'change' && e.opts?.fromTextSession ? 'text' : 'doc');
  }

  selSnapshot() {
    return { slideId: this.state.slideId, selection: this.state.selection.slice() };
  }

  // Runs a command. Returns true when the document changed.
  dispatch(label, recipe, opts = {}) {
    if (!this.store || this.state.readOnly) {
      if (this.state.readOnly && this.store) toast('This presentation is read-only here.', { kind: 'info', id: 'ro' });
      return false;
    }
    try {
      return this.store.dispatch(
        label,
        (d) => {
          recipe(d);
          d.metadata.updated_at = nowIso();
        },
        { ...opts, selectionBefore: this.selSnapshot(), selection: opts.selection || this.selSnapshot() },
      );
    } catch (e) {
      console.error(e);
      toast(`Couldn’t ${label.toLowerCase()}: ${e.message}`, { kind: 'error' });
      return false;
    }
  }

  undo() {
    if (this.state.readOnly) return;
    this.store?.undo();
  }

  redo() {
    if (this.state.readOnly) return;
    this.store?.redo();
  }

  persistEditorState() {
    clearTimeout(this.esTimer);
    this.esTimer = setTimeout(() => {
      setEditorState(this.id, { slideId: this.state.slideId, zoom: this.state.zoom, collapsed: this.state.collapsed }).catch(() => undefined);
    }, 500);
  }

  // ---------- selection ----------
  select(ids, { add = false, toggle = false } = {}) {
    let sel = add || toggle ? this.state.selection.slice() : [];
    for (const id of ids) {
      if (toggle && sel.includes(id)) sel = sel.filter((x) => x !== id);
      else if (!sel.includes(id)) sel.push(id);
    }
    this.store?.breakCoalescing();
    this.set({ selection: sel, crop: this.state.crop && sel.includes(this.state.crop) ? this.state.crop : null });
    if (sel.length === 1) {
      const el = this.find(sel[0])?.el;
      if (el) announce(`Selected ${elementLabel(el)}`);
    } else if (sel.length > 1) announce(`${sel.length} elements selected`);
  }

  clearSelection() {
    this.endTextEditing();
    this.set({ selection: [], enteredGroup: null, crop: null });
  }

  setSlide(id, { keepSelection = false } = {}) {
    if (!this.doc.slides[id]) return;
    this.endTextEditing();
    this.set({ slideId: id, selection: keepSelection ? this.state.selection : [], enteredGroup: null, crop: null, mode: 'slide', slideSelection: [id] });
  }

  setMode(mode, layoutId = null) {
    this.endTextEditing();
    this.set({ mode, layoutId, selection: [], enteredGroup: null, crop: null });
  }

  // ---------- slides ----------
  addSlide(layoutId = 'title_body', afterId = this.state.slideId) {
    const slide = createSlideFromLayout(this.doc, layoutId);
    if (this.dispatch('New slide', (d) => ops.insertSlides(d, [slide], afterId))) {
      this.setSlide(slide.id);
      announce('Slide added');
    }
    return slide.id;
  }

  duplicateSlides(ids = this.state.slideSelection) {
    const order = slideOrder(this.doc).filter((x) => ids.includes(x));
    if (!order.length) return;
    const { slides } = copySlides(order.map((id) => this.doc.slides[id]), { inDestination: (id) => !!this.doc.slides[id] });
    if (this.dispatch('Duplicate slide', (d) => ops.insertSlides(d, slides, order[order.length - 1]))) this.set({ slideId: slides[0].id, slideSelection: slides.map((s) => s.id), selection: [] });
  }

  deleteSlides(ids = this.state.slideSelection) {
    const order = slideOrder(this.doc);
    if (ids.length >= order.length) {
      toast('A presentation needs at least one slide.', { kind: 'info' });
      return;
    }
    const idx = Math.min(...ids.map((id) => order.indexOf(id)));
    if (this.dispatch(ids.length > 1 ? 'Delete slides' : 'Delete slide', (d) => ops.deleteSlides(d, ids))) {
      const next = slideOrder(this.doc);
      this.setSlide(next[Math.min(idx, next.length - 1)]);
      announce(ids.length > 1 ? `${ids.length} slides deleted` : 'Slide deleted');
    }
  }

  moveSlides(ids, target) {
    this.dispatch('Move slides', (d) => ops.moveSlides(d, ids, target));
  }

  toggleHidden(ids = this.state.slideSelection) {
    const allHidden = ids.every((id) => this.doc.slides[id]?.hidden);
    this.dispatch(allHidden ? 'Show slide' : 'Hide slide', (d) => ops.setSlideProps(d, ids, { hidden: allHidden ? undefined : true }));
  }

  setSlideProps(patch, ids = [this.state.slideId], label = 'Change slide') {
    this.dispatch(label, (d) => ops.setSlideProps(d, ids, patch), { coalesce: `slide:${ids.join()}:${Object.keys(patch).join()}`, window: 600 });
  }

  changeLayout(layoutId) {
    const slide = this.slide;
    const plan = planLayoutChange(this.doc, slide, layoutId);
    const origin = { layout_id: layoutId, name: layoutId };
    this.dispatch('Change layout', (d) => {
      d.slides[slide.id].elements = plan.elements;
      d.slides[slide.id].layout_origin = origin;
    });
    return plan;
  }

  // ---------- elements ----------
  slideCenter() {
    return { x: this.doc.size.width / 2, y: this.doc.size.height / 2 };
  }

  insertElements(elements, { label = 'Insert', select = true } = {}) {
    const c = this.container;
    let target = c;
    if (this.state.enteredGroup) {
      // insert at top level of the current container
      target = c;
    }
    if (this.dispatch(label, (d) => ops.insertElements(d, target, elements))) {
      if (select) this.set({ selection: elements.map((e) => e.id), enteredGroup: null });
      return true;
    }
    return false;
  }

  insertText() {
    const { x, y } = this.slideCenter();
    const el = textElement({ x: x - 250, y: y - 40, width: 500, height: 80, text: '' });
    el.text.prompt = 'Type something';
    if (this.insertElements([el], { label: 'Insert text box' })) setTimeout(() => this.emit('start-edit:' + el.id), 30);
  }

  insertShape(preset = 'rect', box) {
    const { x, y } = this.slideCenter();
    const el = shapeElement({ preset, x: box?.x ?? x - 120, y: box?.y ?? y - 80, width: box?.width ?? 240, height: box?.height ?? 160 });
    this.insertElements([el], { label: 'Insert shape' });
  }

  insertLine(kind = 'line') {
    const { x, y } = this.slideCenter();
    const el = kind === 'connector' ? connectorElement({ start: { x: x - 150, y: y - 50 }, end: { x: x + 150, y: y + 50 } }) : lineElement({ x1: x - 150, y1: y, x2: x + 150, y2: y });
    if (kind === 'arrow') el.style = { arrowheads: { start: { kind: 'none', size: 'medium' }, end: { kind: 'triangle', size: 'medium' } } };
    this.insertElements([el], { label: kind === 'connector' ? 'Insert connector' : 'Insert line' });
  }

  insertTable(rows = 3, cols = 3) {
    const W = this.doc.size.width;
    const width = Math.min(W * 0.75, cols * 180);
    const el = tableElement({ rows, cols, width, x: (W - width) / 2, y: this.doc.size.height * 0.2 });
    this.insertElements([el], { label: 'Insert table' });
  }

  insertChart(kind = 'bar') {
    const W = this.doc.size.width;
    const H = this.doc.size.height;
    const el = chartElement({ kind, x: W * 0.15, y: H * 0.15, width: W * 0.7, height: H * 0.7 });
    this.insertElements([el], { label: 'Insert chart' });
  }

  // Adds a file as an asset (dedupe by SHA-256). Returns the record.
  async addAssetFile(file) {
    const prepared = await prepareAsset(file, { stripMetadata: settings.get().stripMetadata });
    const existing = (this.doc.assets || []).find((a) => a.sha256 === prepared.record.sha256 && a.media_type === prepared.record.media_type && this.assets.has(a.id));
    for (const w of prepared.warnings) toast(w, { kind: 'info', duration: 8000 });
    if (existing) return { record: existing, extra: prepared.extra, reused: true };
    await this.assets.add(prepared.record, prepared.blob);
    return { record: prepared.record, extra: prepared.extra, reused: false };
  }

  async insertFiles(files, at = null) {
    if (this.state.readOnly) return;
    for (const file of files) {
      try {
        const { record, extra } = await this.addAssetFile(file);
        if (record.kind === 'image' || record.kind === 'svg') {
          const el = this.imageElementFor(record, at);
          this.dispatch('Insert image', (d) => {
            if (!d.assets.some((a) => a.id === record.id)) d.assets.push(record);
            ops.insertElements(d, this.container, [el]);
          });
          this.set({ selection: [el.id] });
          if (extra?.metadataRemoved) toast('Photo location and camera details were removed.', { kind: 'info', id: 'meta' });
        } else if (record.kind === 'video') {
          await this.insertVideo(record, at);
        } else if (record.kind === 'font') {
          await this.addFontRecord(record, extra.font, file.name);
        } else if (record.kind === 'captions') {
          const v = this.selectedElements().find((e) => e.type === 'video');
          if (v) this.dispatch('Add captions', (d) => {
            if (!d.assets.some((a) => a.id === record.id)) d.assets.push(record);
            ops.setProps(d, this.container, [v.id], { 'video.captions_asset_id': record.id });
          });
          else toast('Select a video first to add captions to it.', { kind: 'info' });
        }
      } catch (e) {
        toast(`${file.name || 'File'}: ${e.message}`, { kind: 'error', duration: 8000 });
      }
    }
  }

  imageElementFor(record, at) {
    const W = this.doc.size.width;
    const H = this.doc.size.height;
    let w = record.width || 400;
    let h = record.height || 300;
    const s = Math.min(1, (W * 0.8) / w, (H * 0.8) / h);
    w *= s;
    h *= s;
    const x = at ? at.x - w / 2 : (W - w) / 2;
    const y = at ? at.y - h / 2 : (H - h) / 2;
    return imageElement({ assetId: record.id, x, y, width: w, height: h, alt: '' });
  }

  async insertVideo(record, at) {
    const W = this.doc.size.width;
    const H = this.doc.size.height;
    let w = record.width || 1280;
    let h = record.height || 720;
    const s = Math.min((W * 0.75) / w, (H * 0.75) / h);
    w *= s;
    h *= s;
    let poster = null;
    const blob = this.assets.blob(record.id);
    const pblob = blob ? await capturePoster(blob, 0) : null;
    if (pblob) {
      const p = await prepareAsset(new File([pblob], 'poster.jpg', { type: 'image/jpeg' }), { stripMetadata: false });
      await this.assets.add(p.record, p.blob);
      poster = p.record;
    }
    const el = videoElement({ assetId: record.id, posterId: poster?.id, x: at ? at.x - w / 2 : (W - w) / 2, y: at ? at.y - h / 2 : (H - h) / 2, width: w, height: h });
    this.dispatch('Insert video', (d) => {
      if (!d.assets.some((a) => a.id === record.id)) d.assets.push(record);
      if (poster && !d.assets.some((a) => a.id === poster.id)) d.assets.push(poster);
      ops.insertElements(d, this.container, [el]);
    });
    this.set({ selection: [el.id] });
  }

  async setPosterFromVideo(elementId, atMs) {
    const el = this.find(elementId)?.el;
    if (!el) return;
    const blob = this.assets.blob(el.video.asset_id);
    const pblob = blob ? await capturePoster(blob, atMs) : null;
    if (!pblob) {
      toast('Couldn’t capture a frame from this video.', { kind: 'error' });
      return;
    }
    const p = await prepareAsset(new File([pblob], 'poster.jpg', { type: 'image/jpeg' }), { stripMetadata: false });
    await this.assets.add(p.record, p.blob);
    this.dispatch('Set poster frame', (d) => {
      d.assets.push(p.record);
      ops.setProps(d, this.container, [elementId], { 'video.poster_asset_id': p.record.id });
    });
  }

  async addFontRecord(record, info, filename) {
    const familyName = (info?.family || filename.replace(/\.[^.]+$/, '')).slice(0, 100);
    const restricted = info && !info.packageable;
    this.dispatch('Add font', (d) => {
      d.assets.push(record);
      let fam = d.fonts.find((f) => f.family_name === familyName);
      if (!fam) {
        fam = { id: newId(), family_name: familyName, faces: [], fallback: 'builtin.inter' };
        d.fonts.push(fam);
      }
      fam.faces.push({ asset_id: record.id, weight: info?.weight || 400, style: info?.italic ? 'italic' : 'normal' });
      if (restricted) fam.restricted = true;
    });
    await registerCustomFonts(this.doc, async (id) => (await this.assets.blobAsync(id))?.arrayBuffer());
    toast(`Added font “${familyName}”.`, { kind: 'success' });
    this.emit('doc');
  }

  deleteSelection() {
    const ids = this.state.selection.filter((id) => !this.find(id)?.el.locked);
    if (!ids.length) return;
    if (this.dispatch(ids.length > 1 ? 'Delete elements' : 'Delete element', (d) => ops.deleteElements(d, this.container, ids))) {
      this.set({ selection: [] });
      announce('Deleted');
    }
  }

  duplicateSelection() {
    const sel = this.selectedElements().filter((e) => !this.state.enteredGroup || true);
    if (!sel.length) return;
    const off = this.lastDuplicateOffset || { x: 10, y: 10 };
    const { elements } = copyElements(sel);
    const moved = elements.map((e) => ({ ...e }));
    this.dispatch('Duplicate', (d) => {
      ops.insertElements(d, this.container, moved);
      ops.translateElements(d, this.container, moved.map((e) => e.id), off.x, off.y);
    });
    this.lastDuplicate = { ids: moved.map((e) => e.id), from: sel.map((e) => e.id) };
    this.set({ selection: moved.map((e) => e.id) });
  }

  // Remember the offset when the user moves a fresh duplicate (spec §12.2).
  noteDuplicateMove(dx, dy) {
    if (this.lastDuplicate && this.state.selection.join() === this.lastDuplicate.ids.join()) {
      const prev = this.lastDuplicateOffset || { x: 10, y: 10 };
      this.lastDuplicateOffset = { x: prev.x + dx, y: prev.y + dy };
    }
  }

  nudge(dx, dy) {
    const ids = this.state.selection.filter((id) => !this.find(id)?.el.locked);
    if (!ids.length) return;
    this.dispatch('Move', (d) => ops.translateElements(d, this.container, ids, dx, dy), { coalesce: `nudge:${ids.join()}`, window: 800 });
  }

  resizeBy(dw, dh) {
    const els = this.selectedElements().filter((e) => geometryKind(e) === 'box' && !e.locked);
    if (!els.length) return;
    this.dispatch('Resize', (d) => ops.updateElements(d, this.container, els.map((e) => e.id), (el) => {
      el.geometry.width = roundLen(Math.max(1, el.geometry.width + dw));
      el.geometry.height = roundLen(Math.max(1, el.geometry.height + dh));
    }), { coalesce: `kresize:${els.map((e) => e.id).join()}`, window: 800 });
  }

  setProps(props, ids = this.state.selection, label = 'Change') {
    return this.dispatch(label, (d) => ops.setProps(d, this.container, ids, props), { coalesce: `props:${ids.join()}:${Object.keys(props).join()}`, window: 600 });
  }

  updateElements(ids, fn, label = 'Change', coalesce = null) {
    return this.dispatch(label, (d) => ops.updateElements(d, this.container, ids, fn), coalesce ? { coalesce } : {});
  }

  group() {
    let gid = null;
    if (this.dispatch('Group', (d) => { gid = ops.groupElements(d, this.container, this.state.selection); })) {
      if (gid) this.set({ selection: [gid] });
      else toast('Select two or more elements that share a parent. Tables can’t be grouped.', { kind: 'info' });
    }
  }

  ungroup() {
    const groups = this.selectedElements().filter((e) => e.type === 'group');
    if (!groups.length) return;
    let ids = [];
    this.dispatch('Ungroup', (d) => {
      for (const g of groups) ids = ids.concat(ops.ungroupElement(d, this.container, g.id));
    });
    this.set({ selection: ids });
  }

  reorder(mode) {
    this.dispatch({ front: 'Bring to front', forward: 'Bring forward', backward: 'Send backward', back: 'Send to back' }[mode], (d) => ops.reorderElements(d, this.container, this.state.selection, mode));
  }

  flip(axis) {
    this.dispatch(axis === 'x' ? 'Flip horizontal' : 'Flip vertical', (d) => ops.flipElements(d, this.container, this.state.selection, axis));
  }

  rotateTo(deg, ids = this.state.selection) {
    this.dispatch('Rotate', (d) => ops.rotateElements(d, this.container, ids, deg), { coalesce: `rot:${ids.join()}`, window: 600 });
  }

  // Axis-aligned boxes (rendered bounds for grown text, spec §12.2).
  boxesFor(ids) {
    const els = this.elements();
    const world = worldMap(els, IDENTITY, new Map(), this.state.measured);
    const resolve = (end) => resolveEndWorld(end, world, IDENTITY)?.point || null;
    return ids.map((id) => {
      const hit = locate(els, id);
      if (!hit) return null;
      const el = hit.el;
      const m = this.state.measured.get(id);
      const e2 = m && geometryKind(el) === 'box' ? { ...el, geometry: { ...el.geometry, width: m.width, height: m.height } } : el;
      return { id, box: elementAABB(e2, resolve), el };
    }).filter(Boolean);
  }

  align(mode) {
    const items = this.boxesFor(this.state.selection).filter((i) => !i.el.locked);
    if (!items.length) return;
    const W = this.doc.size.width;
    const H = this.doc.size.height;
    const ref = items.length === 1 ? { x: 0, y: 0, width: W, height: H } : unionBoxes(items.map((i) => i.box));
    this.dispatch('Align', (d) => {
      for (const { id, box } of items) {
        let dx = 0;
        let dy = 0;
        if (mode === 'left') dx = ref.x - box.x;
        if (mode === 'center') dx = ref.x + ref.width / 2 - (box.x + box.width / 2);
        if (mode === 'right') dx = ref.x + ref.width - (box.x + box.width);
        if (mode === 'top') dy = ref.y - box.y;
        if (mode === 'middle') dy = ref.y + ref.height / 2 - (box.y + box.height / 2);
        if (mode === 'bottom') dy = ref.y + ref.height - (box.y + box.height);
        if (dx || dy) ops.translateElements(d, this.container, [id], dx, dy);
      }
    });
  }

  distribute(axis) {
    const items = this.boxesFor(this.state.selection).filter((i) => !i.el.locked);
    if (items.length < 3) return;
    const k = axis === 'x' ? 'x' : 'y';
    const s = axis === 'x' ? 'width' : 'height';
    items.sort((a, b) => a.box[k] - b.box[k]);
    const first = items[0].box;
    const last = items[items.length - 1].box;
    const total = items.reduce((n, i) => n + i.box[s], 0);
    const gap = (last[k] + last[s] - first[k] - total) / (items.length - 1);
    this.dispatch('Distribute', (d) => {
      let pos = first[k] + first[s] + gap;
      for (const it of items.slice(1, -1)) {
        const delta = pos - it.box[k];
        if (delta) ops.translateElements(d, this.container, [it.id], axis === 'x' ? delta : 0, axis === 'x' ? 0 : delta);
        pos += it.box[s] + gap;
      }
    });
  }

  matchSize(dim) {
    const els = this.selectedElements().filter((e) => geometryKind(e) === 'box' && !e.locked);
    if (els.length < 2) return;
    const ref = els[0].geometry;
    this.dispatch(dim === 'width' ? 'Match width' : 'Match height', (d) => ops.updateElements(d, this.container, els.slice(1).map((e) => e.id), (el) => {
      el.geometry[dim] = ref[dim];
    }));
  }

  selectAll() {
    const els = this.state.enteredGroup ? this.find(this.state.enteredGroup)?.el.group.children || [] : this.elements();
    this.set({ selection: els.filter((e) => !e.locked && !e.hidden).map((e) => e.id) });
  }

  // ---------- text formatting on whole elements ----------
  bodyFor(el, target = 'text') {
    if (!el) return null;
    if (target === 'text') return el.text?.body;
    if (target === 'shape') return el.shape?.text?.body;
    if (target.startsWith('cell:')) return el.table?.cells[target.slice(5)]?.body;
    return null;
  }

  // Applies marks to every run of the selected text-bearing elements.
  applyMarksToSelection(patch) {
    if (this.textSession) {
      for (const [k, v] of Object.entries(patch)) this.textSession.setMark(k, v);
      return;
    }
    const ids = this.selectedElements().filter((e) => e.text || e.shape || e.table).map((e) => e.id);
    if (!ids.length) return;
    this.dispatch('Format text', (d) => ops.updateElements(d, this.container, ids, (el) => {
      const apply = (container) => {
        if (!container) return;
        container.body = patchAllMarks(current(container.body), Object.fromEntries(Object.keys(patch).map((k) => [k, null])));
        const defaults = { ...(container.defaults || {}) };
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === undefined) delete defaults[k];
          else defaults[k] = v;
        }
        if (Object.keys(defaults).length) container.defaults = defaults;
        else delete container.defaults;
      };
      if (el.text) apply(el.text);
      if (el.type === 'shape') {
        if (!el.shape.text) el.shape.text = { body: { paragraphs: [{ inlines: [] }] } };
        apply(el.shape.text);
      }
      if (el.table) for (const c of Object.values(el.table.cells)) apply(c);
    }));
  }

  applyParagraphToSelection(patch) {
    if (this.textSession) {
      for (const [k, v] of Object.entries(patch)) this.textSession.setParagraphAttr(k, v);
      return;
    }
    const ids = this.selectedElements().filter((e) => e.text || e.shape?.text || e.table).map((e) => e.id);
    this.dispatch('Format paragraphs', (d) => ops.updateElements(d, this.container, ids, (el) => {
      const apply = (c) => { if (c) c.body = patchAllParagraphs(current(c.body), patch); };
      if (el.text) apply(el.text);
      if (el.shape?.text) apply(el.shape.text);
      if (el.table) for (const c of Object.values(el.table.cells)) apply(c);
    }));
  }

  toggleListOnSelection(kind) {
    if (this.textSession) {
      this.textSession.toggleList(kind);
      return;
    }
    const els = this.selectedElements().filter((e) => e.text || e.shape?.text);
    if (!els.length) return;
    const bodies = els.map((e) => e.text?.body || e.shape.text.body);
    const allOn = bodies.every((b) => b.paragraphs.every((p) => p.list?.kind === kind));
    this.applyParagraphToSelection({ list: allOn ? null : { kind, level: 0 } });
  }

  // ---------- text editing ----------
  setTextSession(session, info) {
    this.textSession = session;
    if (info?.target?.startsWith('cell:')) this.lastCell = { ...(this.lastCell || {}), [info.elementId]: info.target };
    this.set({ editing: info });
  }

  endTextEditing({ commit = true } = {}) {
    if (!this.textSession) return;
    const s = this.textSession;
    const info = this.state.editing;
    this.textSession = null;
    const body = s.destroy();
    this.state.editing = null;
    if (commit && info) this.commitText(info, body, { final: true });
    this.store?.breakCoalescing();
    this.emit('doc');
  }

  commitText(info, body, { formatting = false, final = false } = {}) {
    if (!info) return;
    const { elementId, target } = info;
    const hit = this.find(elementId);
    if (!hit) return;
    const cur = this.bodyFor(hit.el, target);
    if (cur && JSON.stringify(cur) === JSON.stringify(body)) return;
    if (formatting) this.store.breakCoalescing();
    this.dispatch(
      'Edit text',
      (d) => ops.updateElements(d, this.container, [elementId], (el) => {
        if (target === 'text') el.text.body = body;
        else if (target === 'shape') {
          if (!el.shape.text) el.shape.text = { body };
          else el.shape.text.body = body;
        } else if (target.startsWith('cell:')) {
          const key = target.slice(5);
          el.table.cells[key] = { ...(el.table.cells[key] || {}), body };
        } else if (target === 'notes') { /* handled elsewhere */ }
      }),
      { coalesce: `text:${elementId}:${target}`, fromTextSession: !final },
    );
    if (formatting) this.store.breakCoalescing();
  }

  setNotes(body, { coalesce = true } = {}) {
    const sid = this.state.slideId;
    this.dispatch('Edit notes', (d) => {
      const empty = body.paragraphs.every((p) => !p.inlines.length);
      if (empty && body.paragraphs.length <= 1) delete d.slides[sid].notes;
      else d.slides[sid].notes = body;
    }, coalesce ? { coalesce: `notes:${sid}`, fromTextSession: true } : {});
  }

  // ---------- theme & document ----------
  async applyTheme(theme, { label = 'Apply theme', snapshot = true } = {}) {
    if (snapshot) await this.session?.snapshot(`Before: ${label}`);
    this.dispatch(label, (d) => ops.applyTheme(d, theme));
  }

  updateTheme(fn, label = 'Edit theme', coalesce) {
    this.dispatch(label, (d) => fn(d.theme), coalesce ? { coalesce } : {});
  }

  async changeSize(size, mode) {
    await this.session?.snapshot('Before changing the slide size');
    this.dispatch('Change slide size', (d) => ops.changeSize(d, size, mode));
    if (mode === 'keep') return ops.elementsOutside(this.doc);
    return [];
  }

  setMetadata(patch) {
    this.dispatch('Edit presentation details', (d) => ops.setMetadata(d, patch));
    if (patch.title) broadcast({ type: 'workspace-changed' });
  }

  setPlayback(fn) {
    this.dispatch('Change playback', (d) => fn(d.playback));
  }

  // ---------- builds ----------
  addBuild(elementId, effect = 'fade_in') {
    const slide = this.slide;
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el) {
      toast('Builds can target top-level elements only. Select the whole group.', { kind: 'info' });
      return;
    }
    const b = { id: newId(), element_id: elementId, effect, trigger: 'on_click', duration_ms: 500 };
    if (effect === 'play') {
      b.effect = 'play';
      delete b.duration_ms;
    }
    this.dispatch('Add build', (d) => {
      const s = d.slides[slide.id];
      s.builds = [...(s.builds || []), b];
      if (effect === 'play') {
        const v = s.elements.find((e) => e.id === elementId);
        if (v?.video) v.video.start = 'manual';
      }
    });
  }

  updateBuilds(fn, label = 'Edit builds') {
    const sid = this.state.slideId;
    this.dispatch(label, (d) => {
      const s = d.slides[sid];
      const next = fn((s.builds || []).map((b) => ({ ...b })));
      if (next.length) s.builds = next;
      else delete s.builds;
    });
  }

  // ---------- snapshots ----------
  async saveVersion(name) {
    const ok = await this.session.snapshot(name || 'Saved version', { name: name || 'Saved version' });
    if (ok) toast('Version saved.', { kind: 'success' });
  }

  async restoreSnapshot(id) {
    const snap = await loadSnapshot(id);
    if (!snap) return;
    await this.session.snapshot('Before restoring a version');
    let doc = snap.doc;
    if (snap.format_version < CURRENT_FORMAT_VERSION) doc = migrateDocument(doc, snap.format_version);
    doc = normalizeDocument(doc);
    const v = validateDocument(doc, { fontIds: registryFontIds() });
    if (!v.ok) {
      toast('That version couldn’t be restored because it’s invalid.', { kind: 'error' });
      return;
    }
    this.endTextEditing({ commit: false });
    this.store.replace(doc, { clearHistory: true });
    const order = slideOrder(doc);
    this.set({ slideId: doc.slides[this.state.slideId] ? this.state.slideId : order[0], selection: [] });
    this.session.markDirty();
    await this.session.flush();
    toast('Version restored.', { kind: 'success' });
  }

  async openSnapshotAsCopy(id) {
    const snap = await loadSnapshot(id);
    if (!snap) return null;
    let doc = snap.doc;
    if (snap.format_version < CURRENT_FORMAT_VERSION) doc = migrateDocument(doc, snap.format_version);
    doc = normalizeDocument(doc);
    doc.id = newId();
    doc.metadata.title = `${doc.metadata.title} (copy)`.slice(0, 200);
    doc.metadata.created_at = nowIso();
    doc.metadata.updated_at = nowIso();
    const assets = new Map();
    for (const a of doc.assets) {
      const b = await this.assets.blobAsync(a.id);
      if (b) assets.set(a.id, b);
    }
    doc.assets = doc.assets.filter((a) => assets.has(a.id));
    await repoCreate(doc, assets);
    broadcast({ type: 'workspace-changed' });
    return doc.id;
  }

  // "Edit here" (spec §9.3): take over editing from another tab, then reload
  // the document from storage.
  async editHere() {
    if (!this.session || this.state.newerVersion) return false;
    const ok = await this.session.requestEdit();
    if (!ok) {
      toast('Couldn’t take over editing. Try again in a moment.', { kind: 'error' });
      return false;
    }
    const rec = await loadDocument(this.id);
    if (rec) {
      let doc = rec.doc;
      if (rec.format_version < CURRENT_FORMAT_VERSION) doc = migrateDocument(doc, rec.format_version);
      doc = normalizeDocument(doc);
      this.endTextEditing({ commit: false });
      this.store.replace(doc, { clearHistory: true });
      await this.assets.loadAll(doc);
      await registerCustomFonts(doc, async (id) => (await this.assets.blobAsync(id))?.arrayBuffer());
    }
    const slideId = this.doc.slides[this.state.slideId] ? this.state.slideId : slideOrder(this.doc)[0];
    this.set({ readOnly: false, lockLost: false, slideId, selection: [] }, 'load');
    toast('You’re editing in this tab now.', { kind: 'success' });
    return true;
  }

  // ---------- misc ----------
  accessibilityIssues() {
    return checkAccessibility(this.doc, { overflowIds: this.state.overflow });
  }

  slideStepCount(slideId = this.state.slideId) {
    return buildSteps(this.doc.slides[slideId]).clickSteps;
  }

  sectionOf(slideId) {
    return sectionOfSlide(this.doc, slideId);
  }

  async rename(title) {
    const t = title.trim().slice(0, 200) || 'Untitled presentation';
    this.setMetadata({ title: t });
    await patchMeta(this.id, { title: t }).catch(() => undefined);
  }

  async assetSha(blob) {
    return sha256(blob);
  }

  async dispose() {
    this.endTextEditing();
    await this.session?.dispose();
    this.assets.dispose();
    this.listeners.clear();
  }
}

export { walk, bodyFromText };
