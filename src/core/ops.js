// Domain operations. Each is an immer recipe step: (draft, ...args) => void.
// The editor wraps them in store.dispatch() calls, one command per gesture.
import { current, isDraft } from 'immer';
import { newId } from './ids.js';
import { slideOrder, walk, locate, containerElements, allElementLists } from './model.js';
import {
  worldMap, resolveEndWorld, IDENTITY, invert, apply, normalizeGroup, makeGroup, ungroupChildren,
  geometryKind, translateElement, reparentElement,
} from './geometry.js';
import { roundLen, roundAngle } from './units.js';
import { scaleThemeLengths } from './theme.js';

const plain = (x) => (isDraft(x) ? current(x) : x);

// ---------- sections & slides ----------

export function normalizeSections(d) {
  const out = [];
  for (const s of d.sections) {
    if (s.name === null && s.slide_ids.length === 0) continue;
    const prev = out[out.length - 1];
    if (prev && prev.name === null && s.name === null) {
      prev.slide_ids.push(...s.slide_ids);
      continue;
    }
    out.push(s);
  }
  if (!out.length) out.push({ id: newId(), name: null, slide_ids: [] });
  d.sections = out;
}

export function insertSlides(d, slides, afterId = null, sectionId = null) {
  for (const s of slides) d.slides[s.id] = s;
  const ids = slides.map((s) => s.id);
  let sec = null;
  let idx = 0;
  if (afterId) {
    sec = d.sections.find((x) => x.slide_ids.includes(afterId));
    if (sec) idx = sec.slide_ids.indexOf(afterId) + 1;
  }
  if (!sec && sectionId) {
    sec = d.sections.find((x) => x.id === sectionId);
    idx = 0;
  }
  if (!sec) {
    sec = d.sections[d.sections.length - 1];
    idx = sec.slide_ids.length;
  }
  sec.slide_ids.splice(idx, 0, ...ids);
}

export function removeSlideLinks(d, slideIds) {
  const gone = new Set(slideIds);
  const fixBody = (body) => {
    if (!body) return;
    for (const p of body.paragraphs) {
      for (const i of p.inlines) {
        if (i.marks?.link?.kind === 'slide' && gone.has(i.marks.link.slide_id)) {
          delete i.marks.link;
          if (!Object.keys(i.marks).length) delete i.marks;
        }
      }
    }
  };
  const fixEl = (el) => {
    if (el.link?.kind === 'slide' && gone.has(el.link.slide_id)) delete el.link;
    if (el.text) {
      fixBody(el.text.body);
      if (el.text.defaults?.link?.kind === 'slide' && gone.has(el.text.defaults.link.slide_id)) delete el.text.defaults.link;
    }
    if (el.shape?.text) fixBody(el.shape.text.body);
    if (el.table) for (const c of Object.values(el.table.cells)) fixBody(c.body);
  };
  for (const { elements } of allElementLists(d)) walk(elements, fixEl);
  for (const s of Object.values(d.slides)) fixBody(s.notes);
}

export function deleteSlides(d, ids) {
  const order = slideOrder(d);
  const remaining = order.filter((id) => !ids.includes(id));
  if (!remaining.length) return false; // the last slide can't be deleted
  for (const id of ids) delete d.slides[id];
  for (const s of d.sections) s.slide_ids = s.slide_ids.filter((x) => !ids.includes(x));
  removeSlideLinks(d, ids);
  normalizeSections(d);
  return true;
}

// Moves slides so they sit before `beforeId` (or at the end of `sectionId`).
export function moveSlides(d, ids, { beforeId = null, sectionId = null } = {}) {
  const moving = slideOrder(d).filter((id) => ids.includes(id));
  for (const s of d.sections) s.slide_ids = s.slide_ids.filter((x) => !ids.includes(x));
  let sec;
  let idx;
  if (beforeId && !ids.includes(beforeId)) {
    sec = d.sections.find((x) => x.slide_ids.includes(beforeId));
    idx = sec.slide_ids.indexOf(beforeId);
  } else {
    sec = d.sections.find((x) => x.id === sectionId) || d.sections[d.sections.length - 1];
    idx = sec.slide_ids.length;
  }
  sec.slide_ids.splice(idx, 0, ...moving);
  normalizeSections(d);
}

export function setSlideProps(d, ids, patch) {
  for (const id of ids) {
    const s = d.slides[id];
    if (!s) continue;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) delete s[k];
      else s[k] = v;
    }
  }
}

// Starts a new named section at the first of `slideIds`.
export function addSection(d, { id = newId(), name = 'New section', slideIds }) {
  const order = slideOrder(d);
  const first = slideIds.length ? slideIds.map((x) => order.indexOf(x)).sort((a, b) => a - b)[0] : order.length;
  const moving = slideIds.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const s of d.sections) s.slide_ids = s.slide_ids.filter((x) => !moving.includes(x));
  // find section that should precede: split at the position of `first`
  const beforeSlide = order.slice(0, first).filter((x) => !moving.includes(x)).pop();
  let insertAt = 0;
  if (beforeSlide) {
    const si = d.sections.findIndex((s) => s.slide_ids.includes(beforeSlide));
    const sec = d.sections[si];
    const pos = sec.slide_ids.indexOf(beforeSlide) + 1;
    const tail = sec.slide_ids.splice(pos);
    insertAt = si + 1;
    if (tail.length) d.sections.splice(insertAt, 0, { id: newId(), name: sec.name === null ? null : `${sec.name} (continued)`, slide_ids: tail });
  }
  d.sections.splice(insertAt, 0, { id, name, slide_ids: moving });
  normalizeSections(d);
}

export function renameSection(d, id, name) {
  const s = d.sections.find((x) => x.id === id);
  if (s) s.name = name && name.trim() ? name.trim().slice(0, 100) : null;
  normalizeSections(d);
}

export function deleteSection(d, id, withSlides) {
  const sec = d.sections.find((x) => x.id === id);
  if (!sec) return;
  if (withSlides) {
    const total = slideOrder(d).length;
    if (sec.slide_ids.length >= total) return; // keep at least one slide
    const ids = sec.slide_ids.slice();
    for (const x of ids) delete d.slides[x];
    d.sections = d.sections.filter((x) => x.id !== id);
    removeSlideLinks(d, ids);
  } else {
    sec.name = null;
  }
  normalizeSections(d);
}

export function moveSection(d, id, delta) {
  const i = d.sections.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= d.sections.length) return;
  const [s] = d.sections.splice(i, 1);
  d.sections.splice(j, 0, s);
  normalizeSections(d);
}

// ---------- elements ----------

export function listFor(d, container) {
  return containerElements(d, container);
}

export function insertElements(d, container, elements, index = null) {
  const list = listFor(d, container);
  if (index === null || index > list.length) list.push(...elements);
  else list.splice(index, 0, ...elements);
}

function positionsOfEnds(elements) {
  return worldMap(plain(elements));
}

// Deletes elements anywhere in the container (spec §5.2, §5.14, §5.15, §13.3).
export function deleteElements(d, container, ids) {
  const list = listFor(d, container);
  const world = positionsOfEnds(list);
  const gone = new Set(ids);
  // collect descendants of deleted groups
  walk(plain(list), (el) => {
    if (gone.has(el.id) && el.type === 'group') walk(el.group.children, (c) => { gone.add(c.id); });
  });
  // detach connectors attached to deleted targets
  walk(list, (el) => {
    if (el.type !== 'connector' || gone.has(el.id)) return;
    const info = world.get(el.id);
    for (const key of ['start', 'end']) {
      const end = el.geometry[key];
      if (end.element_id && gone.has(end.element_id)) {
        const r = resolveEndWorld(plain(end), world, info?.parentWorld || IDENTITY);
        const p = r ? apply(invert(info?.parentWorld || IDENTITY), r.point) : { x: 0, y: 0 };
        el.geometry[key] = { x: roundLen(p.x), y: roundLen(p.y) };
      }
    }
  });
  const prune = (els) => {
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (gone.has(el.id)) els.splice(i, 1);
      else if (el.type === 'group') {
        prune(el.group.children);
        if (!el.group.children.length) els.splice(i, 1);
      }
    }
  };
  prune(list);
  if (container.kind === 'slide') {
    const s = d.slides[container.slideId];
    if (s.builds) {
      s.builds = s.builds.filter((b) => !gone.has(b.element_id));
      if (!s.builds.length) delete s.builds;
    }
    if (s.reading_order) {
      s.reading_order = s.reading_order.filter((x) => !gone.has(x));
      if (!s.reading_order.length) delete s.reading_order;
    }
  }
  normalizeGroupsIn(list);
}

// Moves an element to another parent (a group id, or null for the top level)
// at `index` in that parent's list, keeping its visual position (layers panel).
// Returns false when the move isn't allowed.
export function moveElementTo(d, container, id, parentId, index) {
  const list = listFor(d, container);
  const hit = locate(list, id);
  if (!hit) return false;
  const el = plain(hit.el);
  const world = worldMap(plain(list));
  let targetList = list;
  let toWorld = IDENTITY;
  if (parentId) {
    const p = locate(list, parentId);
    if (!p || p.el.type !== 'group') return false;
    // no cycles, no tables in groups
    let inside = false;
    walk([el], (x) => { if (x.id === parentId) inside = true; });
    if (inside || el.type === 'table') return false;
    targetList = p.el.group.children;
    toWorld = world.get(parentId).world;
  }
  const fromWorld = world.get(id)?.parentWorld || IDENTITY;
  const moved = reparentElement(el, fromWorld, toWorld);
  if ((el.type === 'chart') && moved.geometry.rotation) return false;
  const sameList = hit.list === targetList;
  hit.list.splice(hit.index, 1);
  let at = index;
  if (sameList && hit.index < index) at -= 1;
  targetList.splice(Math.max(0, Math.min(targetList.length, at)), 0, sameList ? el : moved);
  // prune empty groups
  const prune = (els) => {
    for (let i = els.length - 1; i >= 0; i--) {
      if (els[i].type === 'group') {
        prune(els[i].group.children);
        if (!els[i].group.children.length) els.splice(i, 1);
      }
    }
  };
  prune(list);
  if (container.kind === 'slide' && parentId) {
    const s = d.slides[container.slideId];
    if (s.builds) {
      s.builds = s.builds.filter((b) => b.element_id !== id);
      if (!s.builds.length) delete s.builds;
    }
    if (s.reading_order) {
      s.reading_order = s.reading_order.filter((x) => x !== id);
      if (!s.reading_order.length) delete s.reading_order;
    }
  }
  normalizeGroupsIn(list);
  return true;
}

export function normalizeGroupsIn(list) {
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (el.type === 'group') {
      normalizeGroupsIn(el.group.children);
      const n = normalizeGroup(plain(el));
      if (n !== plain(el)) list[i] = n;
    }
  }
}

export function getElement(d, container, id) {
  return locate(listFor(d, container), id)?.el || null;
}

// Applies fn(el) to each element by id (mutating the draft).
export function updateElements(d, container, ids, fn) {
  const list = listFor(d, container);
  for (const id of ids) {
    const hit = locate(list, id);
    if (hit) fn(hit.el, hit);
  }
  normalizeGroupsIn(list);
}

export function setIn(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] === undefined || o[keys[i]] === null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete o[last];
  else o[last] = value;
  // tidy up empty parents
  let parent = obj;
  const chain = [];
  for (let i = 0; i < keys.length - 1; i++) {
    chain.push([parent, keys[i]]);
    parent = parent[keys[i]];
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const [p, k] = chain[i];
    if (p[k] && typeof p[k] === 'object' && !Array.isArray(p[k]) && Object.keys(p[k]).length === 0) delete p[k];
    else break;
  }
}

export function setProps(d, container, ids, props) {
  updateElements(d, container, ids, (el) => {
    for (const [path, value] of Object.entries(props)) setIn(el, path, value);
  });
}

export function setGeometry(d, container, id, geometry) {
  updateElements(d, container, [id], (el) => { el.geometry = geometry; });
}

export function translateElements(d, container, ids, dx, dy) {
  const list = listFor(d, container);
  for (const id of ids) {
    const hit = locate(list, id);
    if (!hit) continue;
    hit.list[hit.index] = translateElement(plain(hit.el), dx, dy);
  }
  normalizeGroupsIn(list);
}

// Reorders elements within their parent list: front | forward | backward | back.
export function reorderElements(d, container, ids, mode) {
  const list = listFor(d, container);
  const byParent = new Map();
  for (const id of ids) {
    const hit = locate(list, id);
    if (!hit) continue;
    if (!byParent.has(hit.list)) byParent.set(hit.list, []);
    byParent.get(hit.list).push(id);
  }
  for (const [lst, sel] of byParent) {
    const set = new Set(sel);
    if (mode === 'front' || mode === 'back') {
      const moving = lst.filter((e) => set.has(e.id));
      const rest = lst.filter((e) => !set.has(e.id));
      const next = mode === 'front' ? [...rest, ...moving] : [...moving, ...rest];
      lst.splice(0, lst.length, ...next);
    } else if (mode === 'forward') {
      for (let i = lst.length - 2; i >= 0; i--) {
        if (set.has(lst[i].id) && !set.has(lst[i + 1].id)) {
          const t = lst[i];
          lst[i] = lst[i + 1];
          lst[i + 1] = t;
        }
      }
    } else if (mode === 'backward') {
      for (let i = 1; i < lst.length; i++) {
        if (set.has(lst[i].id) && !set.has(lst[i - 1].id)) {
          const t = lst[i];
          lst[i] = lst[i - 1];
          lst[i - 1] = t;
        }
      }
    }
  }
}

// Groups elements that share a parent (spec §12.2). Tables can't be grouped.
export function groupElements(d, container, ids, groupId = newId()) {
  const list = listFor(d, container);
  const hits = ids.map((id) => locate(list, id)).filter(Boolean);
  if (hits.length < 2) return null;
  const parent = hits[0].list;
  if (hits.some((h) => h.list !== parent)) return null;
  if (hits.some((h) => h.el.type === 'table')) return null;
  const world = worldMap(plain(parent));
  const resolve = (end) => resolveEndWorld(end, world, IDENTITY)?.point || null;
  const sorted = hits.slice().sort((a, b) => a.index - b.index);
  const els = sorted.map((h) => plain(h.el));
  const group = makeGroup(groupId, els, resolve);
  const topIndex = sorted[sorted.length - 1].index;
  const set = new Set(ids);
  const remaining = [];
  let insertAt = 0;
  plain(parent).forEach((e, i) => {
    if (set.has(e.id)) {
      if (i === topIndex) insertAt = remaining.length;
      return;
    }
    remaining.push(e);
  });
  remaining.splice(insertAt, 0, group);
  parent.splice(0, parent.length, ...remaining);
  normalizeGroupsIn(list);
  if (container.kind === 'slide') {
    const s = d.slides[container.slideId];
    // builds and reading order can only target top-level elements
    if (s.builds) {
      s.builds = s.builds.filter((b) => !set.has(b.element_id));
      if (!s.builds.length) delete s.builds;
    }
    if (s.reading_order) {
      s.reading_order = s.reading_order.filter((x) => !set.has(x));
      if (!s.reading_order.length) delete s.reading_order;
    }
  }
  return groupId;
}

export function ungroupElement(d, container, groupId) {
  const list = listFor(d, container);
  const hit = locate(list, groupId);
  if (!hit || hit.el.type !== 'group') return [];
  const g = plain(hit.el);
  const children = ungroupChildren(g);
  if (g.opacity !== undefined && g.opacity !== 1) for (const c of children) c.opacity = Math.round((c.opacity ?? 1) * g.opacity * 1000) / 1000;
  hit.list.splice(hit.index, 1, ...children);
  if (container.kind === 'slide') {
    const s = d.slides[container.slideId];
    if (s.builds) {
      s.builds = s.builds.filter((b) => b.element_id !== groupId);
      if (!s.builds.length) delete s.builds;
    }
    if (s.reading_order) {
      s.reading_order = s.reading_order.filter((x) => x !== groupId);
      if (!s.reading_order.length) delete s.reading_order;
    }
  }
  normalizeGroupsIn(list);
  return children.map((c) => c.id);
}

// ---------- document-wide ----------

export function applyTheme(d, theme) {
  d.theme = theme;
}

export function setMetadata(d, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === '') {
      if (k !== 'title' && k !== 'language') delete d.metadata[k];
    } else d.metadata[k] = v;
  }
}

function scaleBody(body, s) {
  if (!body) return;
  for (const p of body.paragraphs) {
    if (p.spacing) {
      if (p.spacing.before !== undefined) p.spacing.before = roundLen(p.spacing.before * s);
      if (p.spacing.after !== undefined) p.spacing.after = roundLen(p.spacing.after * s);
    }
    for (const i of p.inlines) scaleMarks(i.marks, s);
  }
}

function scaleMarks(m, s) {
  if (!m) return;
  if (m.size !== undefined) m.size = roundLen(Math.max(1, m.size * s));
  if (m.letter_spacing !== undefined) m.letter_spacing = roundLen(m.letter_spacing * s);
}

function scaleStyle(st, s) {
  if (!st) return;
  if (st.stroke && st.stroke !== 'none') st.stroke.width = roundLen(st.stroke.width * s);
  if (st.shadow && st.shadow !== 'none') {
    st.shadow.offset_x = roundLen(st.shadow.offset_x * s);
    st.shadow.offset_y = roundLen(st.shadow.offset_y * s);
    st.shadow.blur = roundLen(st.shadow.blur * s);
  }
}

function scaleContainer(t, s) {
  if (!t) return;
  scaleBody(t.body, s);
  scaleMarks(t.defaults, s);
  if (t.box?.insets) for (const k of Object.keys(t.box.insets)) t.box.insets[k] = roundLen(t.box.insets[k] * s);
}

// Multiplies every length of an element by s (spec §4.4 "Fit content").
export function scaleElementLengths(el, s) {
  const g = el.geometry;
  if (geometryKind(el) === 'points') {
    for (const key of ['start', 'end']) {
      if (typeof g[key].x === 'number') {
        g[key].x = roundLen(g[key].x * s);
        g[key].y = roundLen(g[key].y * s);
      }
    }
  } else {
    g.x = roundLen(g.x * s);
    g.y = roundLen(g.y * s);
    if (g.width !== undefined) {
      g.width = roundLen(Math.max(1, g.width * s));
      g.height = roundLen(Math.max(1, g.height * s));
    }
  }
  scaleStyle(el.style, s);
  scaleContainer(el.text, s);
  if (el.shape) {
    scaleContainer(el.shape.text, s);
    if (el.shape.adjust?.radius !== undefined) el.shape.adjust.radius = roundLen(el.shape.adjust.radius * s);
  }
  if (el.image?.mask?.adjust?.radius !== undefined) el.image.mask.adjust.radius = roundLen(el.image.mask.adjust.radius * s);
  if (el.table) {
    for (const c of el.table.columns) c.width = roundLen(Math.max(8, c.width * s));
    for (const r of el.table.rows) r.min_height = roundLen(Math.max(8, r.min_height * s));
    for (const cell of Object.values(el.table.cells)) {
      scaleBody(cell.body, s);
      scaleMarks(cell.defaults, s);
      if (cell.padding !== undefined) cell.padding = roundLen(cell.padding * s);
      if (cell.borders) for (const b of Object.values(cell.borders)) if (b && b !== 'none') b.width = roundLen(b.width * s);
    }
  }
  if (el.group) for (const c of el.group.children) scaleElementLengths(c, s);
}

// Changes the slide size (spec §4.4). mode: 'fit' | 'keep'.
export function changeSize(d, { width, height, preset }, mode = 'fit') {
  const W1 = d.size.width;
  const H1 = d.size.height;
  const W2 = width;
  const H2 = height;
  const lists = allElementLists(d);
  if (mode === 'fit') {
    const s = Math.min(W2 / W1, H2 / H1);
    const ox = (W2 - s * W1) / 2;
    const oy = (H2 - s * H1) / 2;
    for (const { elements } of lists) {
      for (let i = 0; i < elements.length; i++) {
        scaleElementLengths(elements[i], s);
        elements[i] = translateElement(plain(elements[i]), ox, oy);
      }
    }
    for (const g of d.authoring?.guides || []) g.position = roundLen(g.position * s + (g.axis === 'x' ? ox : oy));
    d.theme = scaleThemeLengths(plain(d.theme), s);
  } else {
    const ox = (W2 - W1) / 2;
    const oy = (H2 - H1) / 2;
    for (const { elements } of lists) {
      for (let i = 0; i < elements.length; i++) elements[i] = translateElement(plain(elements[i]), ox, oy);
    }
    for (const g of d.authoring?.guides || []) g.position = roundLen(g.position + (g.axis === 'x' ? ox : oy));
  }
  d.size = { width: roundLen(W2), height: roundLen(H2), ...(preset ? { preset } : {}) };
}

// Elements that fall partly or fully outside the slide (report after "Keep content size").
export function elementsOutside(doc) {
  const out = [];
  const W = doc.size.width;
  const H = doc.size.height;
  for (const sid of slideOrder(doc)) {
    const s = doc.slides[sid];
    const world = worldMap(s.elements);
    for (const el of s.elements) {
      const info = world.get(el.id);
      let box;
      if (geometryKind(el) === 'points') {
        const a = resolveEndWorld(el.geometry.start, world, IDENTITY)?.point;
        const b = resolveEndWorld(el.geometry.end, world, IDENTITY)?.point;
        if (!a || !b) continue;
        box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
      } else {
        const pts = [
          apply(info.world, { x: 0, y: 0 }), apply(info.world, { x: info.width, y: 0 }),
          apply(info.world, { x: info.width, y: info.height }), apply(info.world, { x: 0, y: info.height }),
        ];
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
      }
      if (box.x < -0.5 || box.y < -0.5 || box.x + box.width > W + 0.5 || box.y + box.height > H + 0.5) out.push({ slideId: sid, elementId: el.id });
    }
  }
  return out;
}

export function containsChart(el) {
  let found = false;
  walk([el], (x) => {
    if (x.type === 'chart') found = true;
  });
  return found;
}

export function canRotate(el) {
  return geometryKind(el) === 'box' && !containsChart(el);
}

export function rotateElements(d, container, ids, rotation) {
  updateElements(d, container, ids, (el) => {
    if (!canRotate(plain(el))) return;
    el.geometry.rotation = roundAngle(rotation);
    if (!el.geometry.rotation) delete el.geometry.rotation;
  });
}

export function flipElements(d, container, ids, axis) {
  updateElements(d, container, ids, (el) => {
    const g = el.geometry;
    if (geometryKind(el) === 'points') {
      const pts = [g.start, g.end].filter((p) => typeof p.x === 'number');
      if (pts.length < 2) return;
      if (axis === 'x') {
        const cx = (g.start.x + g.end.x) / 2;
        g.start.x = roundLen(2 * cx - g.start.x);
        g.end.x = roundLen(2 * cx - g.end.x);
      } else {
        const cy = (g.start.y + g.end.y) / 2;
        g.start.y = roundLen(2 * cy - g.start.y);
        g.end.y = roundLen(2 * cy - g.end.y);
      }
      return;
    }
    if (!canRotate(plain(el))) return;
    const key = axis === 'x' ? 'flip_x' : 'flip_y';
    if (g[key]) delete g[key];
    else g[key] = true;
  });
}
