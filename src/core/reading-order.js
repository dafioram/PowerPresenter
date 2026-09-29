// Reading order (spec §5.15).
import { elementAABB, worldMap, resolveEndWorld, IDENTITY } from './geometry.js';
import { isBodyEmpty } from './text.js';

export function isPlaceholder(el) {
  if (el.type === 'text') return isBodyEmpty(el.text?.body) && !!el.text?.prompt;
  if (el.type === 'image') return !el.image?.asset_id;
  return false;
}

export function isEmptyText(el) {
  return el.type === 'text' && isBodyEmpty(el.text?.body);
}

export function isEligible(el, { includeEmpty = false } = {}) {
  if (el.hidden) return false;
  if (el.accessibility?.decorative) return false;
  if (!includeEmpty && isPlaceholder(el)) return false;
  if ((el.type === 'line' || el.type === 'connector') && !el.accessibility?.alt) return false;
  return true;
}

function rowScan(items, rtl) {
  // items: [{ el, box }]
  const sorted = items.slice().sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const rows = [];
  for (const it of sorted) {
    const cy = it.box.y + it.box.height / 2;
    const row = rows[rows.length - 1];
    if (row && cy >= row.top && cy <= row.bottom) {
      row.items.push(it);
      row.top = Math.min(row.top, it.box.y);
      row.bottom = Math.max(row.bottom, it.box.y + it.box.height);
    } else {
      rows.push({ top: it.box.y, bottom: it.box.y + it.box.height, items: [it] });
    }
  }
  const out = [];
  for (const row of rows) {
    row.items.sort((a, b) => (rtl ? b.box.x + b.box.width - (a.box.x + a.box.width) : a.box.x - b.box.x));
    out.push(...row.items.map((i) => i.el));
  }
  return out;
}

export function automaticOrder(elements, { rtl = false, includeEmpty = false } = {}) {
  const world = worldMap(elements);
  const resolve = (end) => resolveEndWorld(end, world, IDENTITY)?.point || null;
  const eligible = elements.filter((e) => isEligible(e, { includeEmpty }));
  const items = eligible.map((el) => ({ el, box: elementAABB(el, resolve) }));
  const titles = items.filter((i) => i.el.role === 'title');
  const rest = items.filter((i) => i.el.role !== 'title');
  return [...rowScan(titles, rtl), ...rowScan(rest, rtl)];
}

export function isRtlLanguage(lang) {
  return /^(ar|he|fa|ur|ps|sd|ug|yi|dv|ku-Arab)(-|$)/i.test(lang || '');
}

// Top-level elements of a slide in reading order.
export function readingOrder(slide, { rtl = false, includeEmpty = false } = {}) {
  const auto = automaticOrder(slide.elements || [], { rtl, includeEmpty });
  if (!slide.reading_order?.length) return auto;
  const byId = new Map((slide.elements || []).map((e) => [e.id, e]));
  const explicit = [];
  const seen = new Set();
  for (const id of slide.reading_order) {
    const el = byId.get(id);
    if (el && isEligible(el, { includeEmpty }) && !seen.has(id)) {
      explicit.push(el);
      seen.add(id);
    }
  }
  for (const el of auto) if (!seen.has(el.id)) explicit.push(el);
  return explicit;
}

// Children of a group ordered among themselves.
export function groupReadingOrder(group, opts) {
  return automaticOrder(group.group.children, opts);
}
