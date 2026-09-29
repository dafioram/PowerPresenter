// Canonical form (spec §5.6): fields equal to their defaults are omitted.
// normalize() fills in container defaults after loading; canonicalize() strips
// defaults before export. Both are pure and deterministic.
import { DEFAULT_PLAYBACK, DEFAULT_AUTHORING } from './model.js';

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

export function normalizeDocument(input) {
  const doc = clone(input);
  doc.fonts ||= [];
  doc.master ||= { elements: [] };
  doc.master.elements ||= [];
  doc.layouts ||= [];
  doc.assets ||= [];
  const pb = doc.playback || {};
  doc.playback = {
    default_transition: { ...DEFAULT_PLAYBACK.default_transition, ...(pb.default_transition || {}) },
    click_to_advance: pb.click_to_advance ?? DEFAULT_PLAYBACK.click_to_advance,
    auto_advance: { ...DEFAULT_PLAYBACK.auto_advance, ...(pb.auto_advance || {}) },
  };
  const au = doc.authoring || {};
  doc.authoring = {
    guides: au.guides || [],
    grid: { ...DEFAULT_AUTHORING.grid, ...(au.grid || {}) },
  };
  return doc;
}

function stripElement(el) {
  const out = { ...el };
  if (out.opacity === 1) delete out.opacity;
  if (out.hidden === false) delete out.hidden;
  if (out.locked === false) delete out.locked;
  if (out.name === '') delete out.name;
  if (out.accessibility) {
    const a = { ...out.accessibility };
    if (a.decorative === false) delete a.decorative;
    if (a.alt === '') delete a.alt;
    if (Object.keys(a).length) out.accessibility = a;
    else delete out.accessibility;
  }
  if (out.style) {
    const s = { ...out.style };
    for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k];
    if (Object.keys(s).length) out.style = s;
    else delete out.style;
  }
  if (out.geometry && 'width' in out.geometry) {
    const g = { ...out.geometry };
    if (!g.rotation) delete g.rotation;
    if (!g.flip_x) delete g.flip_x;
    if (!g.flip_y) delete g.flip_y;
    out.geometry = g;
  }
  const stripContainer = (t) => {
    if (!t) return t;
    const o = { ...t };
    if (o.box) {
      const b = { ...o.box };
      if (b.autofit === 'none') delete b.autofit;
      if (b.vertical_align === 'top') delete b.vertical_align;
      if (Object.keys(b).length) o.box = b;
      else delete o.box;
    }
    if (o.defaults && !Object.keys(o.defaults).length) delete o.defaults;
    if (o.prompt === '') delete o.prompt;
    return o;
  };
  if (out.text) out.text = stripContainer(out.text);
  if (out.shape) {
    const sh = { ...out.shape };
    if (sh.adjust && !Object.keys(sh.adjust).length) delete sh.adjust;
    if (sh.text) sh.text = stripContainer(sh.text);
    out.shape = sh;
  }
  if (out.group) out.group = { ...out.group, children: out.group.children.map(stripElement) };
  if (out.table) {
    const t = { ...out.table };
    if (t.header_rows === 0) delete t.header_rows;
    for (const k of ['first_column', 'banded_rows', 'banded_columns']) if (t[k] === false) delete t[k];
    out.table = t;
  }
  if (out.video) {
    const v = { ...out.video };
    if (v.trim_start_ms === 0) delete v.trim_start_ms;
    if (v.loop === false) delete v.loop;
    if (v.muted === false) delete v.muted;
    out.video = v;
  }
  return out;
}

function stripSlide(s) {
  const out = { ...s, elements: s.elements.map(stripElement) };
  if (out.hidden === false) delete out.hidden;
  if (out.show_master === true) delete out.show_master;
  if (out.builds && !out.builds.length) delete out.builds;
  if (out.reading_order && !out.reading_order.length) delete out.reading_order;
  if (out.title === '') delete out.title;
  if (out.notes && out.notes.paragraphs.every((p) => !p.inlines.length) && out.notes.paragraphs.length <= 1) delete out.notes;
  return out;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function canonicalize(input) {
  const doc = normalizeDocument(input);
  const out = { ...doc };
  const md = { ...doc.metadata };
  if (!md.author) delete md.author;
  if (!md.description) delete md.description;
  out.metadata = md;
  out.slides = {};
  for (const [k, s] of Object.entries(doc.slides)) out.slides[k] = stripSlide(s);
  out.master = { elements: doc.master.elements.map(stripElement) };
  out.layouts = doc.layouts.map((l) => {
    const o = { ...l, elements: l.elements.map(stripElement) };
    if (o.show_master === true) delete o.show_master;
    return o;
  });
  const pb = {};
  if (!sameJson(doc.playback.default_transition, DEFAULT_PLAYBACK.default_transition)) pb.default_transition = doc.playback.default_transition;
  if (doc.playback.click_to_advance !== DEFAULT_PLAYBACK.click_to_advance) pb.click_to_advance = doc.playback.click_to_advance;
  if (!sameJson(doc.playback.auto_advance, DEFAULT_PLAYBACK.auto_advance)) pb.auto_advance = doc.playback.auto_advance;
  if (Object.keys(pb).length) out.playback = pb;
  else delete out.playback;
  const au = {};
  if (doc.authoring.guides.length) au.guides = doc.authoring.guides;
  if (!sameJson(doc.authoring.grid, DEFAULT_AUTHORING.grid)) au.grid = doc.authoring.grid;
  if (Object.keys(au).length) out.authoring = au;
  else delete out.authoring;
  return JSON.parse(JSON.stringify(out));
}
