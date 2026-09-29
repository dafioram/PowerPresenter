// Layouts (spec §5.12). Built-in layouts are defined relative to the slide size
// and aren't stored in documents. Layouts are templates only: no live link.
import { newId } from './ids.js';
import { textElement, imageElement, blankSlide } from './model.js';
import { roundLen } from './units.js';
import { readingOrder } from './reading-order.js';

const r = roundLen;

function slots(W, H) {
  const mx = W * 0.0625;
  const my = H * 0.0833;
  const cw = W - 2 * mx;
  const gap = W * 0.03;
  const titleH = H * 0.14;
  const bodyY = my + titleH + H * 0.04;
  const bodyH = H - bodyY - my;
  return { mx, my, cw, gap, titleH, bodyY, bodyH };
}

const text = (role, x, y, w, h, prompt, extra = {}) => ({ type: 'text', role, geometry: { x: r(x), y: r(y), width: r(w), height: r(h) }, prompt, ...extra });
const image = (x, y, w, h) => ({ type: 'image', role: 'image', geometry: { x: r(x), y: r(y), width: r(w), height: r(h) } });

export const BUILTIN_LAYOUTS = [
  {
    id: 'title', name: 'Title',
    slots: (W, H) => {
      const { mx, cw } = slots(W, H);
      return [
        text('title', mx, H * 0.3, cw, H * 0.22, 'Click to add title', { vertical_align: 'bottom', autofit: 'shrink', align: 'center' }),
        text('subtitle', mx, H * 0.55, cw, H * 0.12, 'Click to add subtitle', { autofit: 'shrink', align: 'center' }),
      ];
    },
  },
  {
    id: 'title_body', name: 'Title and body',
    slots: (W, H) => {
      const { mx, my, cw, titleH, bodyY, bodyH } = slots(W, H);
      return [
        text('title', mx, my, cw, titleH, 'Click to add title', { vertical_align: 'bottom', autofit: 'shrink' }),
        text('body', mx, bodyY, cw, bodyH, 'Click to add text', { autofit: 'shrink', bullets: true }),
      ];
    },
  },
  {
    id: 'two_column', name: 'Two column',
    slots: (W, H) => {
      const { mx, my, cw, gap, titleH, bodyY, bodyH } = slots(W, H);
      const colW = (cw - gap) / 2;
      return [
        text('title', mx, my, cw, titleH, 'Click to add title', { vertical_align: 'bottom', autofit: 'shrink' }),
        text('body', mx, bodyY, colW, bodyH, 'Click to add text', { autofit: 'shrink', bullets: true }),
        text('body', mx + colW + gap, bodyY, colW, bodyH, 'Click to add text', { autofit: 'shrink', bullets: true }),
      ];
    },
  },
  {
    id: 'title_only', name: 'Title only',
    slots: (W, H) => {
      const { mx, my, cw, titleH } = slots(W, H);
      return [text('title', mx, my, cw, titleH, 'Click to add title', { vertical_align: 'bottom', autofit: 'shrink' })];
    },
  },
  {
    id: 'image_text', name: 'Image and text',
    slots: (W, H) => {
      const { mx, my, gap } = slots(W, H);
      const imgW = W * 0.46;
      const tx = imgW + gap * 1.5;
      const tw = W - tx - mx;
      return [
        image(0, 0, imgW, H),
        text('title', tx, my, tw, H * 0.2, 'Click to add title', { vertical_align: 'bottom', autofit: 'shrink' }),
        text('body', tx, my + H * 0.24, tw, H - my * 2 - H * 0.24, 'Click to add text', { autofit: 'shrink' }),
      ];
    },
  },
  {
    id: 'large_number', name: 'Large number',
    slots: (W, H) => {
      const { mx, cw } = slots(W, H);
      return [
        text('big_number', mx, H * 0.22, cw, H * 0.34, '42%', { vertical_align: 'bottom', autofit: 'shrink', align: 'center' }),
        text('title', mx, H * 0.6, cw, H * 0.1, 'Click to add title', { autofit: 'shrink', align: 'center' }),
        text('caption', mx, H * 0.72, cw, H * 0.1, 'Click to add caption', { autofit: 'shrink', align: 'center' }),
      ];
    },
  },
  {
    id: 'full_image', name: 'Full image',
    slots: (W, H) => {
      const { mx, cw } = slots(W, H);
      return [
        image(0, 0, W, H),
        text('title', mx, H * 0.78, cw, H * 0.14, 'Click to add title', { vertical_align: 'bottom', autofit: 'shrink' }),
      ];
    },
  },
  {
    id: 'quote', name: 'Quote',
    slots: (W, H) => {
      const { mx, cw } = slots(W, H);
      return [
        text('quote', mx + W * 0.05, H * 0.2, cw - W * 0.1, H * 0.4, 'Click to add quote', { vertical_align: 'middle', autofit: 'shrink' }),
        text('attribution', mx + W * 0.05, H * 0.64, cw - W * 0.1, H * 0.08, 'Attribution', { autofit: 'shrink' }),
      ];
    },
  },
  {
    id: 'section', name: 'Section divider',
    slots: (W, H) => {
      const { mx, cw } = slots(W, H);
      return [
        text('title', mx, H * 0.34, cw, H * 0.2, 'Section title', { vertical_align: 'bottom', autofit: 'shrink' }),
        text('subtitle', mx, H * 0.56, cw, H * 0.1, 'Click to add subtitle', { autofit: 'shrink' }),
      ];
    },
  },
  { id: 'blank', name: 'Blank', slots: () => [] },
];

export function builtinLayout(id) {
  return BUILTIN_LAYOUTS.find((l) => l.id === id) || null;
}

function slotToElement(slot) {
  if (slot.type === 'image') return imageElement({ ...slot.geometry, role: 'image' });
  const el = textElement({ ...slot.geometry, role: slot.role, prompt: slot.prompt, autofit: slot.autofit || 'grow' });
  if (slot.vertical_align) el.text.box.vertical_align = slot.vertical_align;
  if (slot.align) el.text.body.paragraphs[0].align = slot.align;
  if (slot.bullets) el.text.body.paragraphs[0].list = { kind: 'bullet', level: 0 };
  return el;
}

// Layout slots for a builtin or custom layout, as fresh elements.
export function layoutElements(doc, layoutId) {
  const W = doc.size.width;
  const H = doc.size.height;
  const builtin = builtinLayout(layoutId);
  if (builtin) return builtin.slots(W, H).map(slotToElement);
  const custom = (doc.layouts || []).find((l) => l.id === layoutId);
  if (!custom) return [];
  return structuredClone(custom.elements).map((e) => reId(e));
}

function reId(el) {
  const out = { ...el, id: newId() };
  if (el.type === 'group') out.group = { children: el.group.children.map(reId) };
  if (el.type === 'table') {
    // table rows/cols are re-identified too
    const colMap = new Map(el.table.columns.map((c) => [c.id, newId()]));
    const rowMap = new Map(el.table.rows.map((r0) => [r0.id, newId()]));
    const cells = {};
    for (const [k, v] of Object.entries(el.table.cells)) {
      const [rid, cid] = k.split(':');
      cells[`${rowMap.get(rid)}:${colMap.get(cid)}`] = v;
    }
    out.table = {
      ...el.table,
      columns: el.table.columns.map((c) => ({ ...c, id: colMap.get(c.id) })),
      rows: el.table.rows.map((r0) => ({ ...r0, id: rowMap.get(r0.id) })),
      cells,
    };
  }
  return out;
}

export function layoutName(doc, layoutId) {
  return builtinLayout(layoutId)?.name || (doc.layouts || []).find((l) => l.id === layoutId)?.name || 'Layout';
}

export function createSlideFromLayout(doc, layoutId = 'title_body') {
  const slide = blankSlide();
  slide.elements = layoutElements(doc, layoutId);
  const custom = (doc.layouts || []).find((l) => l.id === layoutId);
  if (custom?.background) slide.background = structuredClone(custom.background);
  if (custom && custom.show_master === false) slide.show_master = false;
  slide.layout_origin = { layout_id: layoutId, name: layoutName(doc, layoutId) };
  return slide;
}

function slotAccepts(slot, el) {
  if (slot.type === 'image') return el.type === 'image' || el.type === 'video';
  if (el.type !== 'text' && !(el.type === 'shape' && el.shape?.text)) return false;
  if (slot.role === 'body') return el.role === 'body' || !el.role;
  return el.role === slot.role;
}

// Change layout (spec §5.12): remaps existing content into the new layout's
// slots. Never deletes anything. Returns { elements, placed, created, notPlaced }.
export function planLayoutChange(doc, slide, layoutId) {
  const slotEls = layoutElements(doc, layoutId);
  const W = doc.size.width;
  const H = doc.size.height;
  const builtin = builtinLayout(layoutId);
  const slotDefs = builtin ? builtin.slots(W, H) : slotEls.map((e) => ({ type: e.type === 'image' ? 'image' : 'text', role: e.role || 'body', geometry: e.geometry }));
  const order = readingOrder(slide, { includeEmpty: true }).map((e) => e.id);
  const byId = new Map(slide.elements.map((e) => [e.id, e]));
  const assigned = new Set();
  const placed = [];
  const created = [];
  const result = slide.elements.map((e) => e);
  slotDefs.forEach((slot, idx) => {
    let matchId = null;
    const candidates = order.filter((id) => !assigned.has(id) && byId.get(id) && slotAccepts(slot, byId.get(id)));
    if (slot.type === 'image') matchId = candidates.find((id) => byId.get(id).role === 'image') || candidates[0];
    else if (slot.role === 'body') matchId = candidates.find((id) => byId.get(id).role === 'body') || candidates[0];
    else matchId = candidates[0];
    if (matchId) {
      assigned.add(matchId);
      const i = result.findIndex((e) => e.id === matchId);
      const src = result[i];
      const g = { ...slot.geometry };
      const next = { ...src, geometry: { ...g, ...(src.geometry.rotation ? { rotation: src.geometry.rotation } : {}) } };
      if (slot.type === 'text' || slot.role !== 'image') next.role = slot.role;
      if (slot.type === 'image' && src.role !== 'image' && src.type === 'image') next.role = 'image';
      result[i] = next;
      placed.push(matchId);
    } else {
      const el = slotEls[idx];
      if (el) {
        result.push(el);
        created.push(el.id);
      }
    }
  });
  const notPlaced = slide.elements.filter((e) => !assigned.has(e.id)).map((e) => e.id);
  return { elements: result, placed, created, notPlaced };
}
