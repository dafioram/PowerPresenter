// Document model factories and traversal (spec §5).
import { newId } from './ids.js';
import { builtinTheme } from './theme.js';
import { emptyBody, bodyFromText } from './text.js';
import { roundLen } from './units.js';

export const FORMAT_VERSION = 1;

export const ELEMENT_TYPES = ['text', 'shape', 'image', 'line', 'connector', 'group', 'table', 'chart', 'video'];

export const DEFAULT_PLAYBACK = {
  default_transition: { kind: 'none', duration_ms: 400 },
  click_to_advance: true,
  auto_advance: { enabled: false, default_duration_ms: 5000, loop: false },
};

export const DEFAULT_AUTHORING = { guides: [], grid: { spacing: 40, visible: false, snap: false } };

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function defaultLanguage() {
  try {
    const l = globalThis.navigator?.language;
    if (l && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(l)) return l;
  } catch {
    /* ignore */
  }
  return 'en-US';
}

export function createPresentation({ title = 'Untitled presentation', width = 1280, height = 720, preset = '16:9', themeId = 'harbor', language, withTitleSlide = true, layoutFactory } = {}) {
  const now = nowIso();
  const doc = {
    id: newId(),
    metadata: { title, language: language || defaultLanguage(), created_at: now, updated_at: now },
    size: { width, height, ...(preset ? { preset } : {}) },
    theme: builtinTheme(themeId),
    fonts: [],
    master: { elements: [] },
    layouts: [],
    assets: [],
    sections: [{ id: newId(), name: null, slide_ids: [] }],
    slides: {},
    playback: structuredClone(DEFAULT_PLAYBACK),
    authoring: structuredClone(DEFAULT_AUTHORING),
  };
  const slide = layoutFactory ? layoutFactory(doc, withTitleSlide ? 'title' : 'blank') : blankSlide();
  doc.slides[slide.id] = slide;
  doc.sections[0].slide_ids.push(slide.id);
  return doc;
}

export function blankSlide() {
  return { id: newId(), elements: [] };
}

// ---------- element factories ----------

export function textElement({ x = 100, y = 100, width = 400, height = 60, role, text = '', prompt, autofit = 'grow', marks } = {}) {
  const el = {
    id: newId(),
    type: 'text',
    geometry: { x: roundLen(x), y: roundLen(y), width: roundLen(width), height: roundLen(height) },
    text: { body: text ? bodyFromText(text, marks) : emptyBody(), box: { autofit } },
  };
  if (role) el.role = role;
  if (prompt) el.text.prompt = prompt;
  return el;
}

export function shapeElement({ preset = 'rect', x = 100, y = 100, width = 240, height = 160, adjust } = {}) {
  const el = {
    id: newId(),
    type: 'shape',
    geometry: { x: roundLen(x), y: roundLen(y), width: roundLen(width), height: roundLen(height) },
    shape: { preset },
  };
  if (adjust && Object.keys(adjust).length) el.shape.adjust = adjust;
  return el;
}

export function imageElement({ assetId = null, x = 100, y = 100, width = 400, height = 300, alt, role, crop } = {}) {
  const el = {
    id: newId(),
    type: 'image',
    geometry: { x: roundLen(x), y: roundLen(y), width: roundLen(width), height: roundLen(height) },
    image: { asset_id: assetId },
  };
  if (crop) el.image.crop = crop;
  if (role) el.role = role;
  if (alt) el.accessibility = { alt };
  return el;
}

export function lineElement({ x1 = 100, y1 = 100, x2 = 400, y2 = 100 } = {}) {
  return { id: newId(), type: 'line', geometry: { start: { x: x1, y: y1 }, end: { x: x2, y: y2 } } };
}

export function connectorElement({ start, end, routing = 'elbow' } = {}) {
  return {
    id: newId(),
    type: 'connector',
    geometry: { start: start || { x: 100, y: 100 }, end: end || { x: 400, y: 300 } },
    connector: { routing },
    style: { arrowheads: { start: { kind: 'none', size: 'medium' }, end: { kind: 'arrow', size: 'medium' } } },
  };
}

export function tableElement({ x = 100, y = 120, rows = 3, cols = 3, width = 720, rowHeight = 48 } = {}) {
  const columns = Array.from({ length: cols }, () => ({ id: newId(), width: roundLen(width / cols) }));
  const rowList = Array.from({ length: rows }, () => ({ id: newId(), min_height: rowHeight }));
  const cells = {};
  for (const r of rowList) for (const c of columns) cells[`${r.id}:${c.id}`] = { body: emptyBody() };
  return {
    id: newId(),
    type: 'table',
    geometry: { x: roundLen(x), y: roundLen(y) },
    table: { columns, rows: rowList, cells, header_rows: 1, banded_rows: true },
  };
}

export function chartElement({ kind = 'bar', x = 160, y = 140, width = 640, height = 400 } = {}) {
  const chart = { kind, legend: 'bottom', gridlines: { x: false, y: true }, labels: 'none' };
  if (kind === 'scatter') {
    chart.series = [
      { id: newId(), name: 'Series 1', points: [{ x: 1, y: 2 }, { x: 2, y: 3.5 }, { x: 3, y: 3 }, { x: 4, y: 5 }, { x: 5, y: 4.2 }] },
    ];
    chart.gridlines = { x: true, y: true };
  } else if (kind === 'pie' || kind === 'donut') {
    chart.categories = ['North', 'South', 'East', 'West'];
    chart.series = [{ id: newId(), name: 'Share', values: [35, 25, 22, 18] }];
    chart.labels = 'percent';
    chart.legend = 'right';
  } else {
    chart.categories = ['Q1', 'Q2', 'Q3', 'Q4'];
    chart.series = [
      { id: newId(), name: '2025', values: [12, 18, 15, 22] },
      { id: newId(), name: '2026', values: [16, 21, 19, 27] },
    ];
    if (kind === 'bar') {
      chart.orientation = 'vertical';
      chart.grouping = 'clustered';
    }
    if (kind === 'line') chart.markers = true;
  }
  return {
    id: newId(),
    type: 'chart',
    geometry: { x: roundLen(x), y: roundLen(y), width: roundLen(width), height: roundLen(height) },
    chart,
  };
}

export function videoElement({ assetId, posterId = null, x = 160, y = 90, width = 960, height = 540 } = {}) {
  const video = { asset_id: assetId, start: 'manual', controls: 'auto', fit: 'contain' };
  if (posterId) video.poster_asset_id = posterId;
  return { id: newId(), type: 'video', geometry: { x: roundLen(x), y: roundLen(y), width: roundLen(width), height: roundLen(height) }, video };
}

// ---------- traversal ----------

export function slideOrder(doc) {
  const out = [];
  for (const s of doc.sections || []) out.push(...s.slide_ids);
  return out;
}

export function sectionOfSlide(doc, slideId) {
  return (doc.sections || []).find((s) => s.slide_ids.includes(slideId)) || null;
}

export function slideIndex(doc, slideId) {
  return slideOrder(doc).indexOf(slideId);
}

// Calls fn(el, parentList, index, parentGroup) for every element, recursively.
export function walk(elements, fn, parentGroup = null) {
  if (!elements) return;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (fn(el, elements, i, parentGroup) === false) return false;
    if (el.type === 'group' && el.group?.children) {
      if (walk(el.group.children, fn, el) === false) return false;
    }
  }
  return true;
}

export function flatten(elements) {
  const out = [];
  walk(elements, (el) => { out.push(el); });
  return out;
}

// Finds an element in a list (recursively). Returns { el, list, index, parent }.
export function locate(elements, id) {
  let hit = null;
  walk(elements, (el, list, index, parent) => {
    if (el.id === id) {
      hit = { el, list, index, parent };
      return false;
    }
    return true;
  });
  return hit;
}

// The element list being edited: slide elements, master elements or a layout's.
export function containerElements(doc, container) {
  if (!container || container.kind === 'slide') return doc.slides[container?.slideId]?.elements;
  if (container.kind === 'master') return doc.master.elements;
  if (container.kind === 'layout') return doc.layouts.find((l) => l.id === container.layoutId)?.elements;
  return null;
}

export function allElementLists(doc) {
  const lists = [];
  for (const s of Object.values(doc.slides || {})) lists.push({ where: { kind: 'slide', slideId: s.id }, elements: s.elements });
  lists.push({ where: { kind: 'master' }, elements: doc.master?.elements || [] });
  for (const l of doc.layouts || []) lists.push({ where: { kind: 'layout', layoutId: l.id }, elements: l.elements });
  return lists;
}

export function assetById(doc, id) {
  return (doc.assets || []).find((a) => a.id === id) || null;
}

// Every asset id referenced by the document (spec §8.5).
export function referencedAssetIds(doc) {
  const ids = new Set();
  const fill = (f) => { if (f && f.type === 'image' && f.asset_id) ids.add(f.asset_id); };
  const visit = (els) => walk(els, (el) => {
    if (el.image?.asset_id) ids.add(el.image.asset_id);
    if (el.video) {
      if (el.video.asset_id) ids.add(el.video.asset_id);
      if (el.video.poster_asset_id) ids.add(el.video.poster_asset_id);
      if (el.video.captions_asset_id) ids.add(el.video.captions_asset_id);
    }
    fill(el.style?.fill);
    if (el.table) for (const c of Object.values(el.table.cells)) fill(c.fill);
  });
  for (const s of Object.values(doc.slides || {})) {
    visit(s.elements);
    fill(s.background);
  }
  visit(doc.master?.elements);
  for (const l of doc.layouts || []) {
    visit(l.elements);
    fill(l.background);
  }
  fill(doc.theme?.background);
  for (const fam of doc.fonts || []) for (const face of fam.faces || []) ids.add(face.asset_id);
  return ids;
}

export function elementLabel(el) {
  if (el.name) return el.name;
  const typeNames = { text: 'Text', shape: 'Shape', image: 'Image', line: 'Line', connector: 'Connector', group: 'Group', table: 'Table', chart: 'Chart', video: 'Video' };
  let base = typeNames[el.type] || 'Element';
  if (el.role && el.role !== 'image') base = el.role.replace('_', ' ').replace(/^./, (c) => c.toUpperCase());
  const body = el.text?.body || el.shape?.text?.body;
  if (body) {
    const t = body.paragraphs.map((p) => (p.inlines || []).map((i) => i.text || '').join('')).join(' ').trim();
    if (t) return `${base}: ${t.length > 28 ? t.slice(0, 28) + '…' : t}`;
  }
  if (el.type === 'shape') return `${base} (${el.shape.preset.replace(/_/g, ' ')})`;
  if (el.type === 'chart') return `Chart (${el.chart.kind})`;
  return base;
}
