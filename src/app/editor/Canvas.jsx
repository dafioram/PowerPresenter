// The editing canvas (spec §12.1, §12.2): the rendered slide under an overlay
// with selection, handles, guides, snapping, crop and text editing.
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'preact/hooks';
import { renderSlide, layoutSlide } from '../../render/renderer.js';
import { fontsReady } from '../../render/fonts.js';
import { containerBaseStyle } from '../../core/theme.js';
import { fieldContext } from '../../core/fields.js';
import { getShape, shapeAdjust } from '../../core/shapes.js';
import { geometryKind, boxMatrix, apply, invert, resizeGroup, translateElement, scaleChild, unionBoxes, IDENTITY } from '../../core/geometry.js';
import { locate, walk, elementLabel } from '../../core/model.js';
import { roundLen, roundAngle } from '../../core/units.js';
import { resizeTable } from '../../core/tables.js';
import { buildSteps } from '../../core/builds.js';
import * as ops from '../../core/ops.js';
import { newId } from '../../core/ids.js';
import { TextSession } from './text-session.js';
import { buildWorld, hitTest, worldCorners, worldAABB, HANDLES, resizeBox, multiply, snapTargets, snapBox, nearestSite, sitesOf, linePointsWorld, hitElement } from './canvas-geom.js';
import { openContextMenu, openDialog, toast } from '../ui/components.jsx';
import { settings } from '../settings.js';
import { contextMenuItems } from './menus.js';
import { LinkDialog } from './dialogs/LinkDialog.jsx';
import { ChartDataDialog } from './dialogs/ChartDataDialog.jsx';
import { Rulers } from './Rulers.jsx';
import { coverCrop, captureFormat, applyFormat } from './format.js';

const PAD = 80; // stage margin in screen px

function targetFlow(root, el, target) {
  const w = root.querySelector(`.pe-layer:not(.pe-layer-footer) [data-el-id="${el.id}"]`);
  if (!w) return null;
  if (target === 'text') return w.querySelector(':scope > .pe-flow');
  if (target === 'shape') return w.querySelector('.pe-shape-text > .pe-flow');
  if (target.startsWith('cell:')) return w.querySelector(`[data-cell="${target.slice(5)}"] > .pe-flow`);
  return null;
}

export function Canvas({ ctl }) {
  const st = ctl.state;
  const doc = ctl.doc;
  const scrollRef = useRef(null);
  const hostRef = useRef(null);
  const rootRef = useRef(null);
  const reasonRef = useRef('doc');
  const gestureRef = useRef(null);
  const rafRef = useRef(0);
  const [viewport, setViewport] = useState({ w: 800, h: 600 });
  const [overlay, setOverlay] = useState({ lines: [], spacing: [], marquee: null, sites: null, hover: null, newGuide: null });
  const [layoutTick, setLayoutTick] = useState(0);
  const W = doc.size.width;
  const H = doc.size.height;
  const fit = Math.max(0.05, Math.min((viewport.w - PAD * 2) / W, (viewport.h - PAD * 2) / H));
  const scale = st.zoom === 'fit' ? fit : st.zoom;
  const container = ctl.container;

  // Only document-changing reasons decide how the next render happens.
  useEffect(() => ctl.subscribe((reason) => { if (reason === 'text' || reason === 'doc' || reason === 'load') reasonRef.current = reason; }), [ctl]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // The slide being edited (a real slide, or a layout as a pseudo-slide).
  const slide = st.mode === 'layout'
    ? (() => {
        const l = doc.layouts.find((x) => x.id === st.layoutId);
        return l ? { id: `layout-${l.id}`, elements: l.elements, background: l.background, show_master: l.show_master } : ctl.slide;
      })()
    : ctl.slide;

  // ---------- render the slide ----------
  const renderNow = useCallback(async () => {
    const host = hostRef.current;
    if (!host || !slide) return;
    const fieldCtx = st.mode === 'slide' ? fieldContext(doc, slide.id) : null;
    const ctx = { mode: 'edit', assetUrl: (id) => ctl.assets.editUrl(id), fieldCtx };
    const root = renderSlide(doc, slide, ctx);
    if (st.mode === 'master') root.classList.add('is-master-mode');
    host.replaceChildren(root);
    rootRef.current = root;
    ctl.renderCtx = { ...ctx, doc, dom: document, fieldCtx: fieldCtx || fieldContext(doc, Object.keys(doc.slides)[0]) };
    await fontsReady();
    if (rootRef.current !== root) return;
    const { measured, overflow } = layoutSlide(root, doc, slide);
    ctl.state.measured = measured;
    ctl.state.overflow = overflow;
    // re-attach an active text session to the new DOM
    if (ctl.textSession && st.editing) {
      const el = ctl.find(st.editing.elementId)?.el;
      const flow = el && targetFlow(root, el, st.editing.target);
      if (flow) ctl.textSession.remount(flow);
      else ctl.endTextEditing();
    }
    setLayoutTick((n) => n + 1);
  }, [doc, slide, st.mode, st.editing, ctl]);

  useLayoutEffect(() => {
    if (reasonRef.current === 'text' && ctl.textSession) {
      // text typed in the editor: DOM is already current; re-run layout only
      const root = rootRef.current;
      if (root) {
        clearTimeout(ctl.relayoutTimer);
        ctl.relayoutTimer = setTimeout(() => {
          const live = rootRef.current;
          if (!live || !live.isConnected) return;
          const r = layoutSlide(live, ctl.doc, st.mode === 'layout' ? slide : ctl.slide || slide);
          ctl.state.measured = r.measured;
          ctl.state.overflow = r.overflow;
          setLayoutTick((n) => n + 1);
        }, 60);
      }
      return;
    }
    renderNow();
  }, [slide, doc.theme, doc.master, doc.fonts, doc.size, doc.assets, st.mode, ctl.assets.previews.size, renderNow]);

  useEffect(() => {
    const h = (reason) => {
      if (typeof reason === 'string' && reason.startsWith('start-edit:')) {
        const id = reason.slice(11);
        setTimeout(() => startEditing(id, null, null), 0);
      }
      if (reason === 'assets') renderNow();
    };
    return ctl.subscribe(h);
  });

  // ---------- coordinates ----------
  const stageOrigin = () => {
    const sc = scrollRef.current;
    const stage = sc?.querySelector('.stage');
    const r = stage.getBoundingClientRect();
    return { left: r.left, top: r.top };
  };
  const toSlide = (e) => {
    const o = stageOrigin();
    return { x: (e.clientX - o.left) / scale, y: (e.clientY - o.top) / scale };
  };

  const elements = ctl.elements();
  const world = buildWorld(elements, st.measured);
  const tol = 6 / scale;

  const candidates = () => {
    if (st.enteredGroup) {
      const g = ctl.find(st.enteredGroup)?.el;
      if (g) return g.group.children;
    }
    return elements;
  };

  const hitAt = (p) => {
    if (st.enteredGroup) {
      const g = ctl.find(st.enteredGroup)?.el;
      if (g) {
        const child = hitTest(g.group.children, p, world, tol);
        if (child) return child;
      }
    }
    return hitTest(elements, p, world, tol);
  };

  // ---------- text editing ----------
  const startEditing = (elementId, target, clientPoint) => {
    const hit = ctl.find(elementId);
    if (!hit || hit.el.locked || ctl.state.readOnly) return;
    const el = hit.el;
    let t = target;
    if (!t) t = el.type === 'text' ? 'text' : el.type === 'shape' ? 'shape' : null;
    if (!t) return;
    if (t === 'shape' && !el.shape.text) {
      ctl.dispatch('Add text to shape', (d) => ops.updateElements(d, ctl.container, [elementId], (x) => { x.shape.text = { body: { paragraphs: [{ inlines: [] }] } }; }));
      setTimeout(() => startEditing(elementId, 'shape', clientPoint), 60);
      return;
    }
    ctl.endTextEditing();
    const root = rootRef.current;
    const fresh = ctl.find(elementId).el;
    const flow = targetFlow(root, fresh, t);
    if (!flow) return;
    const theme = ctl.doc.theme;
    let container;
    let kind = 'text';
    let header = false;
    if (t === 'text') container = fresh.text;
    else if (t === 'shape') {
      container = fresh.shape.text;
      kind = 'shape';
    } else {
      const key = t.slice(5);
      container = fresh.table.cells[key];
      kind = 'cell';
      const rowId = key.split(':')[0];
      header = fresh.table.rows.findIndex((r) => r.id === rowId) < (fresh.table.header_rows || 0);
    }
    const base = containerBaseStyle(theme, { kind, role: fresh.role, defaults: container?.defaults, header });
    const info = { elementId, target: t };
    const session = new TextSession({
      flowEl: flow,
      body: container?.body || { paragraphs: [{ inlines: [] }] },
      ctx: { ...ctl.renderCtx, doc: ctl.doc },
      base,
      bullets: theme.lists?.bullets,
      indent: theme.lists?.indent,
      label: elementLabel(fresh),
      onChange: (body, { formatting }) => ctl.commitText(info, body, { formatting }),
      onExit: () => {
        ctl.endTextEditing();
        ctl.select([elementId]);
        scrollRef.current?.focus();
      },
      onUndo: () => ctl.undo(),
      onRedo: () => ctl.redo(),
      onSelectionJump: () => ctl.store.breakCoalescing(),
      onSelectionChange: () => ctl.emit('text-selection'),
      onLink: () => openLinkDialog(),
      onTab: t.startsWith('cell:') ? (shift) => moveCell(elementId, t.slice(5), shift ? -1 : 1) : null,
    });
    ctl.setTextSession(session, info);
    ctl.set({ selection: [elementId] });
    if (clientPoint) session.placeCursorAt(clientPoint.x, clientPoint.y);
    session.focus();
  };
  ctl.startEditing = startEditing;

  const moveCell = (elementId, key, dir) => {
    const el = ctl.find(elementId)?.el;
    if (!el) return;
    const cells = [];
    for (const r of el.table.rows) for (const c of el.table.columns) cells.push(`${r.id}:${c.id}`);
    const i = cells.indexOf(key);
    if (dir > 0 && i === cells.length - 1) {
      // Tab in the last cell adds a row
      ctl.endTextEditing();
      ctl.updateElements([elementId], (x) => { x.table = import_insertRow(x.table); }, 'Add row');
      const el2 = ctl.find(elementId).el;
      const lastRow = el2.table.rows[el2.table.rows.length - 1];
      setTimeout(() => startEditing(elementId, `cell:${lastRow.id}:${el2.table.columns[0].id}`), 60);
      return;
    }
    const next = cells[Math.max(0, Math.min(cells.length - 1, i + dir))];
    ctl.endTextEditing();
    startEditing(elementId, `cell:${next}`);
  };

  const openLinkDialog = async () => {
    const s = ctl.textSession;
    const current = s ? s.activeMarks().link : ctl.selectedElements()[0]?.link;
    const r = await openDialog(LinkDialog, { value: current || null, doc: ctl.doc, hasText: !!s });
    if (r === undefined) return;
    if (s) {
      s.setLink(r);
    } else if (ctl.state.selection.length) {
      ctl.setProps({ link: r || undefined }, ctl.state.selection, r ? 'Add link' : 'Remove link');
    }
  };
  ctl.openLinkDialog = openLinkDialog;

  // ---------- gestures ----------
  const commitGesture = (label, recipe, key) => ctl.dispatch(label, recipe, { coalesce: key, window: Infinity });

  const schedule = (fn) => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(fn);
  };

  const onPointerDown = (e) => {
    if (e.button === 1 || (e.button === 0 && gestureRef.current?.space)) {
      const sc = scrollRef.current;
      gestureRef.current = { kind: 'pan', x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
      sc.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (e.target.closest('.ProseMirror')) return;
    const p = toSlide(e);
    const handleEl = e.target.closest('[data-handle]');
    scrollRef.current.focus({ preventScroll: true });
    if (handleEl) {
      startHandleGesture(e, handleEl.dataset.handle, p);
      return;
    }
    if (ctl.textSession) {
      const ed = ctl.find(st.editing?.elementId)?.el;
      if (ed && hitElement(ed, p, world, tol)) return;
      ctl.endTextEditing();
    }
    // format painter
    if (st.formatPainter) {
      const target = hitAt(p);
      if (target) applyFormatPainter(target.id);
      return;
    }
    const target = hitAt(p);
    if (st.crop) {
      const cropEl = ctl.find(st.crop)?.el;
      if (cropEl && hitElement(cropEl, p, world, tol)) {
        startCropPan(e, cropEl, p);
        return;
      }
      ctl.set({ crop: null });
    }
    if (!target) {
      if (st.enteredGroup) ctl.set({ enteredGroup: null });
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) ctl.select([]);
      gestureRef.current = { kind: 'marquee', start: p, add: e.shiftKey || e.metaKey || e.ctrlKey };
      scrollRef.current.setPointerCapture(e.pointerId);
      return;
    }
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      ctl.select([target.id], { toggle: true });
      return;
    }
    if (!st.selection.includes(target.id)) ctl.select([target.id]);
    const ids = st.selection.includes(target.id) ? st.selection : [target.id];
    startMove(e, ids, p);
  };

  const startMove = (e, ids, p) => {
    const movable = ids.filter((id) => !ctl.find(id)?.el.locked);
    if (!movable.length) return;
    const originals = new Map(movable.map((id) => [id, JSON.parse(JSON.stringify(ctl.find(id).el))]));
    const box = unionBoxes(movable.map((id) => worldAABB(ctl.find(id).el, world)));
    const exclude = new Set(movable);
    const snapOn = settings.get().snap !== false;
    const grid = doc.authoring?.grid?.snap ? doc.authoring.grid.spacing : 0;
    const targets = snapTargets(candidates(), world, exclude, doc, { grid });
    const inGroup = !!st.enteredGroup;
    let groupInv = IDENTITY;
    if (inGroup) {
      const info = world.get(st.enteredGroup);
      if (info) groupInv = invert([info.world[0], info.world[1], info.world[2], info.world[3], 0, 0]);
    }
    gestureRef.current = { kind: 'move', start: p, originals, box, targets, snapOn, key: `move:${newId()}`, moved: false, alt: e.altKey, groupInv };
    scrollRef.current.setPointerCapture(e.pointerId);
  };

  const startCropPan = (e, el, p) => {
    gestureRef.current = { kind: 'crop-pan', start: p, original: JSON.parse(JSON.stringify(el)), key: `crop:${newId()}` };
    scrollRef.current.setPointerCapture(e.pointerId);
  };

  const startHandleGesture = (e, handle, p) => {
    const [kind, ...rest] = handle.split(':');
    const key = `${kind}:${newId()}`;
    const sel = ctl.selectedElements();
    if (kind === 'resize') {
      const hdef = HANDLES.find((h) => h.id === rest[0]);
      if (sel.length === 1) {
        const el = sel[0];
        const info = world.get(el.id);
        gestureRef.current = { kind: 'resize', el: JSON.parse(JSON.stringify(el)), parentWorld: info.parentWorld, hdef, key, measuredH: st.measured.get(el.id)?.height };
      } else {
        const box = unionBoxes(sel.map((x) => worldAABB(x, world)));
        gestureRef.current = { kind: 'resize-multi', originals: sel.map((x) => JSON.parse(JSON.stringify(x))), box, hdef, key };
      }
    } else if (kind === 'rotate') {
      const el = sel[0];
      const info = world.get(el.id);
      const c = apply(info.world, { x: info.width / 2, y: info.height / 2 });
      gestureRef.current = { kind: 'rotate', el: JSON.parse(JSON.stringify(el)), center: c, key, parentRot: Math.atan2(info.parentWorld[1], info.parentWorld[0]) * 180 / Math.PI };
    } else if (kind === 'end') {
      const el = sel[0];
      gestureRef.current = { kind: 'endpoint', el: JSON.parse(JSON.stringify(el)), which: rest[0], key, parentWorld: world.get(el.id)?.parentWorld || IDENTITY };
    } else if (kind === 'adjust') {
      const el = sel[0];
      const info = world.get(el.id);
      gestureRef.current = { kind: 'adjust', el: JSON.parse(JSON.stringify(el)), handleIndex: Number(rest[0]), inv: invert(info.world), key, mask: rest[1] === 'mask' };
    } else if (kind === 'crop') {
      const el = sel[0];
      const info = world.get(el.id);
      gestureRef.current = { kind: 'crop-edge', el: JSON.parse(JSON.stringify(el)), edge: rest[0], inv: invert(info.world), world: info.world, key };
    } else if (kind === 'guide') {
      const g = doc.authoring.guides.find((x) => x.id === rest[0]);
      if (g) gestureRef.current = { kind: 'guide', guide: g, key };
    } else if (kind === 'table-col' || kind === 'table-row') {
      const el = sel[0];
      gestureRef.current = { kind, el: JSON.parse(JSON.stringify(el)), index: Number(rest[0]), start: p, key };
    }
    scrollRef.current.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const g = gestureRef.current;
    if (!g) {
      // hover highlight
      if (e.buttons === 0 && !e.target.closest('.ProseMirror')) {
        const p = toSlide(e);
        const h = hitAt(p);
        if ((h?.id || null) !== overlay.hover) setOverlay((o) => ({ ...o, hover: h?.id || null }));
      }
      return;
    }
    if (g.kind === 'pan') {
      const sc = scrollRef.current;
      sc.scrollLeft = g.sl - (e.clientX - g.x);
      sc.scrollTop = g.st - (e.clientY - g.y);
      return;
    }
    const p = toSlide(e);
    const shift = e.shiftKey;
    const alt = e.altKey;
    const noSnap = e.metaKey || e.ctrlKey;
    schedule(() => handleMove(g, p, { shift, alt, noSnap }));
  };

  const handleMove = (g, p, { shift, alt, noSnap }) => {
    if (g.kind === 'marquee') {
      const r = { x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), width: Math.abs(p.x - g.start.x), height: Math.abs(p.y - g.start.y) };
      g.rect = r;
      setOverlay((o) => ({ ...o, marquee: r }));
      return;
    }
    if (g.kind === 'move') {
      let dx = p.x - g.start.x;
      let dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * scale < 3) return;
      if (!g.moved && g.alt) {
        // Alt-drag duplicates
        const { copyElements } = ctlRemap;
        const els = [...g.originals.values()];
        const copies = copyElements(els).elements;
        ctl.dispatch('Duplicate', (d) => ops.insertElements(d, ctl.container, copies), { coalesce: g.key, window: Infinity });
        g.originals = new Map(copies.map((c) => [c.id, c]));
        ctl.set({ selection: copies.map((c) => c.id) });
      }
      g.moved = true;
      if (shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      let lines = [];
      let spacing = [];
      if (g.snapOn && !noSnap) {
        const moved = { ...g.box, x: g.box.x + dx, y: g.box.y + dy };
        const s = snapBox(moved, g.targets, tol);
        dx += s.dx;
        dy += s.dy;
        lines = s.lines;
        spacing = s.spacing;
      }
      const local = apply(g.groupInv, { x: dx, y: dy });
      g.dx = dx;
      g.dy = dy;
      commitGesture('Move', (d) => {
        const list = ops.listFor(d, ctl.container);
        for (const [id, orig] of g.originals) {
          const hit = locate(list, id);
          if (hit) hit.list[hit.index] = translateElement(orig, local.x, local.y);
        }
        ops.normalizeGroupsIn(list);
      }, g.key);
      setOverlay((o) => ({ ...o, lines, spacing }));
      return;
    }
    if (g.kind === 'resize') {
      const el = g.el;
      const kind = geometryKind(el);
      if (kind !== 'box' && el.type !== 'table') return;
      const baseGeom = el.type === 'table' ? { ...el.geometry, width: el.table.columns.reduce((n, c) => n + c.width, 0), height: g.measuredH || el.table.rows.reduce((n, r) => n + r.min_height, 0) } : el.geometry;
      const keepDefault = el.type === 'image' || el.type === 'video' || el.type === 'group';
      const keepAspect = shift ? !keepDefault : keepDefault;
      let ng = resizeBox(baseGeom, g.parentWorld, g.hdef, p, { keepAspect: keepAspect && g.hdef.fx !== 0.5 && g.hdef.fy !== 0.5 ? true : keepAspect && (g.hdef.fx === 0.5 || g.hdef.fy === 0.5) ? true : false, fromCenter: alt });
      commitGesture('Resize', (d) => ops.updateElements(d, ctl.container, [el.id], (x) => {
        if (el.type === 'group') {
          const r = resizeGroup(el, { x: ng.x, y: ng.y, width: ng.width, height: ng.height });
          x.geometry = r.geometry;
          x.group = r.group;
        } else if (el.type === 'table') {
          x.geometry = { x: ng.x, y: ng.y };
          x.table = resizeTable(el.table, ng.width, ng.height);
        } else {
          x.geometry = { ...ng };
        }
      }), g.key);
      return;
    }
    if (g.kind === 'resize-multi') {
      const box = g.box;
      const pseudo = { x: box.x, y: box.y, width: box.width, height: box.height };
      const ng = resizeBox(pseudo, IDENTITY, g.hdef, p, { keepAspect: shift, fromCenter: alt });
      const sx = ng.width / box.width;
      const sy = ng.height / box.height;
      commitGesture('Resize', (d) => {
        const list = ops.listFor(d, ctl.container);
        for (const orig of g.originals) {
          const hit = locate(list, orig.id);
          if (!hit || orig.locked) continue;
          let local = translateElement(orig, -box.x, -box.y);
          if (orig.type === 'group') {
            const scaled = scaleChild(local, sx, sy);
            local = scaled;
          } else local = scaleChild(local, sx, sy);
          hit.list[hit.index] = translateElement(local, ng.x, ng.y);
        }
        ops.normalizeGroupsIn(list);
      }, g.key);
      return;
    }
    if (g.kind === 'rotate') {
      let a = (Math.atan2(p.y - g.center.y, p.x - g.center.x) * 180) / Math.PI + 90 - g.parentRot;
      if (shift) a = Math.round(a / 15) * 15;
      const deg = roundAngle(a);
      commitGesture('Rotate', (d) => ops.rotateElements(d, ctl.container, [g.el.id], deg), g.key);
      setOverlay((o) => ({ ...o, angle: deg }));
      return;
    }
    if (g.kind === 'endpoint') {
      const el = g.el;
      const inv = invert(g.parentWorld);
      let target = { x: roundLen(apply(inv, p).x), y: roundLen(apply(inv, p).y) };
      let sites = null;
      if (el.type === 'connector') {
        const near = nearestSite(candidates().filter((x) => x.id !== el.id), world, p, 14 / scale, el.id);
        sites = candidates().filter((x) => x.id !== el.id).flatMap((x) => (worldAABBNear(x, p) ? sitesOf(x, world).map((s) => ({ ...s, id: x.id })) : []));
        if (near) target = { element_id: near.element_id, site: near.site };
      } else if (shift) {
        const other = el.geometry[g.which === 'start' ? 'end' : 'start'];
        const dx = target.x - other.x;
        const dy = target.y - other.y;
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(dx, dy);
        target = { x: roundLen(other.x + Math.cos(ang) * len), y: roundLen(other.y + Math.sin(ang) * len) };
      }
      commitGesture('Move end', (d) => ops.updateElements(d, ctl.container, [el.id], (x) => { x.geometry[g.which] = target; }), g.key);
      setOverlay((o) => ({ ...o, sites }));
      return;
    }
    if (g.kind === 'adjust') {
      const el = g.el;
      const preset = g.mask ? el.image.mask.preset : el.shape.preset;
      const shape = getShape(preset);
      const h = shape.handles[g.handleIndex];
      const q = apply(g.inv, p);
      const w = el.geometry.width;
      const hh = el.geometry.height;
      const patch = h.set(w, hh, q);
      commitGesture('Adjust shape', (d) => ops.updateElements(d, ctl.container, [el.id], (x) => {
        if (g.mask) x.image.mask.adjust = { ...(x.image.mask.adjust || {}), ...patch };
        else x.shape.adjust = { ...(x.shape.adjust || {}), ...patch };
      }), g.key);
      return;
    }
    if (g.kind === 'crop-edge') {
      const el = g.el;
      const q = apply(g.inv, p);
      const gg = el.geometry;
      const cr = el.image.crop || { left: 0, top: 0, right: 0, bottom: 0 };
      const IW = gg.width / (1 - cr.left - cr.right);
      const IH = gg.height / (1 - cr.top - cr.bottom);
      const nc = { ...cr };
      let x0 = 0;
      let y0 = 0;
      let nw = gg.width;
      let nh = gg.height;
      const imgL = -cr.left * IW;
      const imgT = -cr.top * IH;
      if (g.edge.includes('e')) {
        const xr = Math.max(8, Math.min(imgL + IW, q.x));
        nw = xr;
        nc.right = Math.max(0, 1 - cr.left - nw / IW);
      }
      if (g.edge.includes('w')) {
        const xl = Math.min(gg.width - 8, Math.max(imgL, q.x));
        x0 = xl;
        nw = gg.width - xl;
        nc.left = Math.max(0, cr.left + xl / IW);
      }
      if (g.edge.includes('s')) {
        const yb = Math.max(8, Math.min(imgT + IH, q.y));
        nh = yb;
        nc.bottom = Math.max(0, 1 - cr.top - nh / IH);
      }
      if (g.edge.includes('n')) {
        const yt = Math.min(gg.height - 8, Math.max(imgT, q.y));
        y0 = yt;
        nh = gg.height - yt;
        nc.top = Math.max(0, cr.top + yt / IH);
      }
      const M = boxMatrix(gg);
      const c = apply(M, { x: x0 + nw / 2, y: y0 + nh / 2 });
      const round = (v) => Math.round(v * 10000) / 10000;
      commitGesture('Crop', (d) => ops.updateElements(d, ctl.container, [el.id], (x) => {
        x.geometry = { ...gg, x: roundLen(c.x - nw / 2), y: roundLen(c.y - nh / 2), width: roundLen(nw), height: roundLen(nh) };
        x.image.crop = { left: round(nc.left), top: round(nc.top), right: round(nc.right), bottom: round(nc.bottom) };
      }), g.key);
      return;
    }
    if (g.kind === 'crop-pan') {
      const el = g.original;
      const gg = el.geometry;
      const cr = el.image.crop || { left: 0, top: 0, right: 0, bottom: 0 };
      const IW = gg.width / (1 - cr.left - cr.right);
      const IH = gg.height / (1 - cr.top - cr.bottom);
      const rot = ((gg.rotation || 0) * Math.PI) / 180;
      const dxw = p.x - g.start.x;
      const dyw = p.y - g.start.y;
      const dx = dxw * Math.cos(rot) + dyw * Math.sin(rot);
      const dy = -dxw * Math.sin(rot) + dyw * Math.cos(rot);
      const visW = 1 - cr.left - cr.right;
      const visH = 1 - cr.top - cr.bottom;
      const l = Math.max(0, Math.min(1 - visW, cr.left - dx / IW));
      const t = Math.max(0, Math.min(1 - visH, cr.top - dy / IH));
      const round = (v) => Math.round(v * 10000) / 10000;
      commitGesture('Pan image', (d) => ops.updateElements(d, ctl.container, [el.id], (x) => {
        x.image.crop = { left: round(l), top: round(t), right: round(Math.max(0, 1 - visW - l)), bottom: round(Math.max(0, 1 - visH - t)) };
      }), g.key);
      return;
    }
    if (g.kind === 'guide') {
      const pos = roundLen(g.guide.axis === 'x' ? p.x : p.y);
      g.pos = pos;
      commitGesture('Move guide', (d) => {
        const gd = d.authoring.guides.find((x) => x.id === g.guide.id);
        if (gd) gd.position = pos;
      }, g.key);
      return;
    }
    if (g.kind === 'table-col' || g.kind === 'table-row') {
      const el = g.el;
      const delta = g.kind === 'table-col' ? p.x - g.start.x : p.y - g.start.y;
      commitGesture('Resize table', (d) => ops.updateElements(d, ctl.container, [el.id], (x) => {
        if (g.kind === 'table-col') {
          const a = el.table.columns[g.index];
          const b = el.table.columns[g.index + 1];
          if (b) {
            const nd = Math.max(8 - a.width, Math.min(b.width - 8, delta));
            x.table.columns[g.index].width = roundLen(a.width + nd);
            x.table.columns[g.index + 1].width = roundLen(b.width - nd);
          } else x.table.columns[g.index].width = roundLen(Math.max(8, a.width + delta));
        } else {
          const r = el.table.rows[g.index];
          x.table.rows[g.index].min_height = roundLen(Math.max(8, r.min_height + delta));
        }
      }), g.key);
    }
  };

  function worldAABBNear(x, p) {
    const b = worldAABB(x, world);
    const m = 60 / scale;
    return p.x > b.x - m && p.x < b.x + b.width + m && p.y > b.y - m && p.y < b.y + b.height + m;
  }

  const onPointerUp = (e) => {
    const g = gestureRef.current;
    gestureRef.current = g?.space ? { space: true } : null;
    cancelAnimationFrame(rafRef.current);
    try {
      scrollRef.current.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    if (!g) return;
    if (g.kind === 'marquee' && g.rect) {
      const r = g.rect;
      const ids = candidates()
        .filter((el) => !el.locked && !el.hidden)
        .filter((el) => {
          const b = worldAABB(el, world);
          return b.x >= r.x && b.y >= r.y && b.x + b.width <= r.x + r.width && b.y + b.height <= r.y + r.height;
        })
        .map((el) => el.id);
      ctl.select(ids, { add: g.add });
    }
    if (g.kind === 'move' && g.moved) ctl.noteDuplicateMove(g.dx || 0, g.dy || 0);
    if (g.kind === 'guide') {
      const pos = g.pos ?? g.guide.position;
      const limit = g.guide.axis === 'x' ? W : H;
      if (pos < -40 / scale || pos > limit + 40 / scale) ctl.dispatch('Delete guide', (d) => { d.authoring.guides = d.authoring.guides.filter((x) => x.id !== g.guide.id); });
    }
    ctl.store?.breakCoalescing();
    setOverlay((o) => ({ ...o, lines: [], spacing: [], marquee: null, sites: null, angle: null }));
  };

  const onDblClick = (e) => {
    if (e.target.closest('.ProseMirror')) return;
    const p = toSlide(e);
    let target = hitAt(p);
    if (!target) return;
    if (target.type === 'group' && st.enteredGroup !== target.id) {
      const child = hitTest(target.group.children, p, world, tol);
      ctl.set({ enteredGroup: target.id, selection: child ? [child.id] : [] });
      if (child && (child.type === 'text' || child.type === 'shape')) setTimeout(() => startEditing(child.id, null, { x: e.clientX, y: e.clientY }), 0);
      return;
    }
    if (target.type === 'text' || target.type === 'shape') startEditing(target.id, null, { x: e.clientX, y: e.clientY });
    else if (target.type === 'image' && target.image.asset_id) ctl.set({ crop: target.id, selection: [target.id] });
    else if (target.type === 'chart') openDialog(ChartDataDialog, { ctl, elementId: target.id });
    else if (target.type === 'table') {
      const cellEl = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.dataset?.cell);
      const key = cellEl?.dataset.cell || `${target.table.rows[0].id}:${target.table.columns[0].id}`;
      startEditing(target.id, `cell:${key}`, { x: e.clientX, y: e.clientY });
    }
  };

  const onContextMenu = (e) => {
    e.preventDefault();
    const p = toSlide(e);
    const target = hitAt(p) || hitTest(elements, p, world, tol, { includeLocked: true });
    if (target && !st.selection.includes(target.id) && !target.locked) ctl.select([target.id]);
    openContextMenu(e.clientX, e.clientY, contextMenuItems(ctl, { target, point: p }));
  };

  const applyFormatPainter = (id) => {
    const fp = st.formatPainter;
    ctl.dispatch('Paste formatting', (d) => ops.updateElements(d, ctl.container, [id], (x) => applyFormat(x, fp)));
    if (!fp.sticky) ctl.set({ formatPainter: null });
  };

  // drag & drop files onto the canvas
  const onDrop = (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => !/\.(pres|zip)$/i.test(f.name));
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    const p = toSlide(e);
    // dropping onto an empty image slot fills it
    const target = hitAt(p);
    if (target?.type === 'image' && !target.image.asset_id && files.length === 1) {
      fillSlot(target, files[0]);
      return;
    }
    ctl.insertFiles(files, p);
  };

  const fillSlot = async (slot, file) => {
    try {
      const { record } = await ctl.addAssetFile(file);
      if (record.kind !== 'image' && record.kind !== 'svg') {
        toast('Only images can go in an image placeholder.', { kind: 'info' });
        return;
      }
      const crop = coverCrop(record, slot.geometry);
      ctl.dispatch('Add image', (d) => {
        if (!d.assets.some((a) => a.id === record.id)) d.assets.push(record);
        ops.updateElements(d, ctl.container, [slot.id], (x) => {
          x.image.asset_id = record.id;
          if (crop) x.image.crop = crop;
          else delete x.image.crop;
        });
      });
    } catch (err) {
      toast(err.message, { kind: 'error' });
    }
  };
  ctl.fillSlot = fillSlot;

  const onKeyDownSpace = (e) => {
    if (e.code === 'Space' && !e.target.closest('.ProseMirror, input, textarea') && !ctl.textSession) {
      if (!gestureRef.current) gestureRef.current = { space: true };
      scrollRef.current.classList.add('is-panning');
    }
  };
  const onKeyUpSpace = (e) => {
    if (e.code === 'Space') {
      if (gestureRef.current?.space) gestureRef.current = null;
      scrollRef.current?.classList.remove('is-panning');
    }
  };

  // wheel zoom with Ctrl/Cmd
  const onWheel = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const next = Math.max(0.1, Math.min(4, scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    ctl.set({ zoom: Math.round(next * 100) / 100 });
  };
  useEffect(() => {
    const el = scrollRef.current;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // center the stage when fitting
  const stageW = W * scale;
  const stageH = H * scale;
  const padW = Math.max(viewport.w, stageW + PAD * 2);
  const padH = Math.max(viewport.h, stageH + PAD * 2);
  const stageLeft = (padW - stageW) / 2;
  const stageTop = (padH - stageH) / 2;

  // ---------- overlay ----------
  const sel = ctl.selectedElements();
  const handleSize = 9 / scale;
  const overlayNodes = [];
  const selOutline = (el, cls = '') => {
    if (geometryKind(el) === 'points') {
      const pts = linePointsWorld(el, world);
      return <polyline key={`o-${el.id}`} class={`sel-box ${cls}`} points={pts.map((q) => `${q.x},${q.y}`).join(' ')} />;
    }
    const info = world.get(el.id);
    if (!info) return null;
    const c = worldCorners(info);
    return <polygon key={`o-${el.id}`} class={`sel-box ${cls}`} points={c.map((q) => `${q.x},${q.y}`).join(' ')} />;
  };
  if (overlay.hover && !st.selection.includes(overlay.hover) && !gestureRef.current) {
    const hv = ctl.find(overlay.hover)?.el;
    if (hv) overlayNodes.push(selOutline(hv, 'is-hover'));
  }
  if (st.enteredGroup) {
    const g = ctl.find(st.enteredGroup)?.el;
    if (g) overlayNodes.push(selOutline(g, 'is-group'));
  }
  // user guides and grid
  const guides = doc.authoring?.guides || [];
  const grid = doc.authoring?.grid;
  if (grid?.visible && grid.spacing * scale >= 6) {
    const gl = [];
    for (let x = grid.spacing; x < W; x += grid.spacing) gl.push(<line key={`gx${x}`} class="grid-line" x1={x} y1={0} x2={x} y2={H} />);
    for (let y = grid.spacing; y < H; y += grid.spacing) gl.push(<line key={`gy${y}`} class="grid-line" x1={0} y1={y} x2={W} y2={y} />);
    overlayNodes.push(<g key="grid">{gl}</g>);
  }
  for (const gd of guides) {
    overlayNodes.push(
      gd.axis === 'x'
        ? <line key={`g-${gd.id}`} class="user-guide hit" data-handle={`guide:${gd.id}`} x1={gd.position} y1={-PAD / scale} x2={gd.position} y2={H + PAD / scale} style={{ cursor: 'ew-resize', strokeWidth: 1 }} />
        : <line key={`g-${gd.id}`} class="user-guide hit" data-handle={`guide:${gd.id}`} x1={-PAD / scale} y1={gd.position} x2={W + PAD / scale} y2={gd.position} style={{ cursor: 'ns-resize', strokeWidth: 1 }} />,
    );
  }
  // overflow markers and build badges
  if (st.mode === 'slide') {
    const steps = buildSteps(ctl.slide).steps;
    const stepOf = new Map();
    steps.forEach((s, i) => s.forEach((b) => { if (!stepOf.has(b.element_id)) stepOf.set(b.element_id, i); }));
    for (const [id, n] of stepOf) {
      const info = world.get(id);
      if (!info) continue;
      const q = apply(info.world, { x: 0, y: 0 });
      const r = 10 / scale;
      overlayNodes.push(
        <g key={`b-${id}`} aria-hidden="true">
          <circle class="build-badge-bg" cx={q.x - r} cy={q.y - r} r={r} />
          <text class="build-badge" x={q.x - r} y={q.y - r} text-anchor="middle" dominant-baseline="central" style={{ fontSize: `${11 / scale}px` }}>{n === 0 ? 'A' : n}</text>
        </g>,
      );
    }
  }
  for (const id of st.overflow) {
    const info = world.get(id);
    if (!info) continue;
    const q = apply(info.world, { x: info.width, y: st.measured.get(id)?.height ?? info.height });
    const s = 12 / scale;
    overlayNodes.push(
      <g key={`of-${id}`}>
        <rect class="overflow-mark" x={q.x - s} y={q.y - s / 2} width={s} height={s} rx={2 / scale} />
        <path d={`M${q.x - s / 2} ${q.y - s / 4}v${s / 2}M${q.x - s * 0.75} ${q.y}h${s / 2}`} stroke="#fff" stroke-width={1.5 / scale} />
        <title>Text overflows this box</title>
      </g>,
    );
  }
  // selection
  for (const el of sel) {
    let cls = '';
    if (el.hidden) cls = 'is-hidden-el';
    else if (el.locked) cls = 'is-locked';
    overlayNodes.push(selOutline(el, cls));
  }
  const single = sel.length === 1 ? sel[0] : null;
  if (single && !single.locked && !st.editing) {
    const kind = geometryKind(single);
    const info = world.get(single.id);
    if (st.crop === single.id && single.type === 'image') {
      const gg = single.geometry;
      const cr = single.image.crop || { left: 0, top: 0, right: 0, bottom: 0 };
      const IW = gg.width / (1 - cr.left - cr.right);
      const IH = gg.height / (1 - cr.top - cr.bottom);
      const full = [
        apply(info.world, { x: -cr.left * IW, y: -cr.top * IH }),
        apply(info.world, { x: -cr.left * IW + IW, y: -cr.top * IH }),
        apply(info.world, { x: -cr.left * IW + IW, y: -cr.top * IH + IH }),
        apply(info.world, { x: -cr.left * IW, y: -cr.top * IH + IH }),
      ];
      overlayNodes.push(<polygon key="crop-full" class="sel-box is-group" points={full.map((q) => `${q.x},${q.y}`).join(' ')} />);
      for (const h of HANDLES) {
        const q = apply(info.world, { x: h.fx * info.width, y: h.fy * info.height });
        overlayNodes.push(<rect key={`c-${h.id}`} class="sel-handle hit" data-handle={`crop:${h.id}`} x={q.x - handleSize * 0.7} y={q.y - handleSize * 0.7} width={handleSize * 1.4} height={handleSize * 1.4} style={{ cursor: h.cursor, fill: '#111' }} />);
      }
    } else if (kind === 'points') {
      const pts = linePointsWorld(single, world);
      const ends = [['start', pts[0]], ['end', pts[pts.length - 1]]];
      for (const [which, q] of ends) {
        const attached = !!single.geometry[which].element_id;
        overlayNodes.push(<circle key={`e-${which}`} class="sel-handle hit" data-handle={`end:${which}`} cx={q.x} cy={q.y} r={handleSize * 0.65} style={{ cursor: 'move', fill: attached ? '#16a34a' : '#fff' }} />);
      }
    } else if (info) {
      const canResize = true;
      if (canResize) {
        for (const h of HANDLES) {
          const hh = single.type === 'table' ? (st.measured.get(single.id)?.height ?? info.height) : info.height;
          const q = apply(info.world, { x: h.fx * info.width, y: h.fy * hh });
          overlayNodes.push(<rect key={`h-${h.id}`} class="sel-handle hit" data-handle={`resize:${h.id}`} x={q.x - handleSize / 2} y={q.y - handleSize / 2} width={handleSize} height={handleSize} style={{ cursor: h.cursor }} />);
        }
      }
      if (ops.canRotate(single) && single.type !== 'table') {
        const top = apply(info.world, { x: info.width / 2, y: 0 });
        const rot = apply(info.world, { x: info.width / 2, y: -24 / scale * (single.geometry.flip_y ? -1 : 1) });
        overlayNodes.push(<line key="rot-l" class="sel-box" x1={top.x} y1={top.y} x2={rot.x} y2={rot.y} />);
        overlayNodes.push(<circle key="rot" class="sel-handle is-rotate hit" data-handle="rotate" cx={rot.x} cy={rot.y} r={handleSize * 0.6} style={{ cursor: 'grab' }}><title>Rotate (Shift snaps to 15°)</title></circle>);
      }
      // adjustment handles
      const preset = single.type === 'shape' ? single.shape.preset : null;
      if (preset) {
        const shape = getShape(preset);
        const adj = shapeAdjust(preset, single.shape.adjust);
        (shape.handles || []).forEach((h, i) => {
          const pos = h.pos(single.geometry.width, single.geometry.height, adj);
          const q = apply(info.world, pos);
          const s = handleSize * 0.8;
          overlayNodes.push(<path key={`a-${i}`} class="adj-handle hit" data-handle={`adjust:${i}`} d={`M${q.x} ${q.y - s}L${q.x + s} ${q.y}L${q.x} ${q.y + s}L${q.x - s} ${q.y}Z`}><title>Adjust shape</title></path>);
        });
      }
      // table column/row border handles
      if (single.type === 'table') {
        let x = 0;
        single.table.columns.forEach((c, i) => {
          x += c.width;
          const a = apply(info.world, { x, y: 0 });
          const b = apply(info.world, { x, y: st.measured.get(single.id)?.height ?? info.height });
          overlayNodes.push(<line key={`tc-${i}`} class="hit" data-handle={`table-col:${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" stroke-width={8 / scale} style={{ cursor: 'col-resize' }} />);
        });
      }
    }
  } else if (sel.length > 1 && !st.editing) {
    const box = unionBoxes(sel.map((x) => worldAABB(x, world)));
    overlayNodes.push(<rect key="multi" class="sel-box is-group" x={box.x} y={box.y} width={box.width} height={box.height} />);
    if (sel.every((x) => !x.locked)) {
      for (const h of HANDLES) {
        const q = { x: box.x + h.fx * box.width, y: box.y + h.fy * box.height };
        overlayNodes.push(<rect key={`mh-${h.id}`} class="sel-handle hit" data-handle={`resize:${h.id}`} x={q.x - handleSize / 2} y={q.y - handleSize / 2} width={handleSize} height={handleSize} style={{ cursor: h.cursor }} />);
      }
    }
  }
  for (const l of overlay.lines) {
    overlayNodes.push(l.axis === 'x' ? <line key={`sl-${l.v}-x`} class="guide-line" x1={l.v} y1={-2000} x2={l.v} y2={H + 2000} /> : <line key={`sl-${l.v}-y`} class="guide-line" x1={-2000} y1={l.v} x2={W + 2000} y2={l.v} />);
  }
  for (const sp of overlay.spacing) {
    const [a, b, c, d] = sp.seg;
    overlayNodes.push(sp.axis === 'x'
      ? <g key={`sp-x-${a}`}><line class="guide-line" x1={a} y1={sp.at} x2={b} y2={sp.at} /><line class="guide-line" x1={c} y1={sp.at} x2={d} y2={sp.at} /></g>
      : <g key={`sp-y-${a}`}><line class="guide-line" x1={sp.at} y1={a} x2={sp.at} y2={b} /><line class="guide-line" x1={sp.at} y1={c} x2={sp.at} y2={d} /></g>);
  }
  if (overlay.sites) for (const s of overlay.sites) overlayNodes.push(<circle key={`site-${s.id}-${s.site}`} class="site-dot" cx={s.point.x} cy={s.point.y} r={4 / scale} />);
  if (overlay.marquee) {
    const r = overlay.marquee;
    overlayNodes.push(<rect key="marquee" class="marquee" x={r.x} y={r.y} width={r.width} height={r.height} />);
  }

  const dimSize = st.mode === 'master' ? { width: `${W}px`, height: `${H}px` } : null;

  return (
    <div class={`canvas-wrap ${st.rulers ? 'has-rulers' : ''}`}>
      {st.rulers && <Rulers ctl={ctl} scale={scale} scrollRef={scrollRef} stageLeft={stageLeft} stageTop={stageTop} layoutTick={layoutTick} />}
      <div
        ref={scrollRef}
        class="canvas-scroll"
        tabIndex={0}
        role="application"
        aria-roledescription="slide canvas"
        aria-label={`Slide canvas${sel.length ? `, ${sel.length} selected` : ''}`}
        data-testid="canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDblClick={onDblClick}
        onContextMenu={onContextMenu}
        onDragOver={(e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); }}
        onDrop={onDrop}
        onKeyDown={onKeyDownSpace}
        onKeyUp={onKeyUpSpace}
        onPointerLeave={() => overlay.hover && setOverlay((o) => ({ ...o, hover: null }))}
        style={st.formatPainter ? { cursor: 'copy' } : undefined}
      >
        <div class="stage-pad" style={{ width: `${padW}px`, height: `${padH}px` }}>
          <div class="stage" style={{ left: `${stageLeft}px`, top: `${stageTop}px`, width: `${W}px`, height: `${H}px`, transform: `scale(${scale})` }}>
            <div ref={hostRef} class="slide-host" />
            {dimSize && <div class="stage-dim" style={dimSize} />}
            <svg class="overlay" width={W} height={H} viewBox={`0 0 ${W} ${H}`} overflow="visible" aria-hidden="true">
              {overlayNodes}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- helpers ----------
import { copyElements } from '../../core/remap.js';
import { insertRow } from '../../core/tables.js';
const ctlRemap = { copyElements };
function import_insertRow(t) {
  return insertRow(t, t.rows.length);
}

export { walk, coverCrop, captureFormat, applyFormat };
