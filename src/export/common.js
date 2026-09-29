// Shared export helpers: slide ranges, asset collection, font packaging.
import { slideOrder, walk, referencedAssetIds } from '../core/model.js';
import { collectChars } from '../core/text.js';
import { fontRegistry, facesForChars, usedRegistryFonts } from '../render/fonts.js';
import { resolveFontValue } from '../core/theme.js';

export function isSafari() {
  const ua = navigator.userAgent;
  return /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|Firefox\/|CriOS|FxiOS/.test(ua);
}

export function isFirefox() {
  return /Firefox\//.test(navigator.userAgent);
}

// Returns slide IDs in presentation order for a range choice.
// range: { kind: 'all'|'current'|'selected'|'section'|'custom', custom, sectionId }
export function slideIdsForRange(doc, range, { currentId, selectedIds = [], includeHidden = false } = {}) {
  const order = slideOrder(doc);
  let ids;
  switch (range.kind) {
    case 'current':
      ids = [currentId];
      break;
    case 'selected':
      ids = order.filter((id) => selectedIds.includes(id));
      break;
    case 'section': {
      const sec = doc.sections.find((s) => s.id === range.sectionId);
      ids = sec ? sec.slide_ids.slice() : [];
      break;
    }
    case 'custom':
      ids = (range.indices || []).map((i) => order[i]).filter(Boolean);
      break;
    default:
      ids = order.slice();
  }
  // explicitly chosen single slides are kept even when hidden
  if (!includeHidden && range.kind !== 'current') ids = ids.filter((id) => !doc.slides[id].hidden);
  return ids;
}

// Slide links in the given slides whose targets aren't in the output.
export function danglingSlideLinks(doc, slideIds) {
  const set = new Set(slideIds);
  const out = [];
  const checkLink = (link, sid, elId) => {
    if (link?.kind === 'slide' && !set.has(link.slide_id)) out.push({ slideId: sid, elementId: elId });
  };
  for (const sid of slideIds) {
    const s = doc.slides[sid];
    walk(s.elements, (el) => {
      checkLink(el.link, sid, el.id);
      const bodies = [el.text?.body, el.shape?.text?.body, ...(el.table ? Object.values(el.table.cells).map((c) => c.body) : [])];
      for (const b of bodies) for (const p of b?.paragraphs || []) for (const i of p.inlines) checkLink(i.marks?.link, sid, el.id);
    });
  }
  return out;
}

// Hidden slides that are link targets of included slides (always included in HTML).
export function linkTargets(doc, slideIds) {
  const set = new Set(slideIds);
  const extra = new Set();
  const add = (link) => { if (link?.kind === 'slide' && !set.has(link.slide_id) && doc.slides[link.slide_id]) extra.add(link.slide_id); };
  for (const sid of slideIds) {
    walk(doc.slides[sid].elements, (el) => {
      add(el.link);
      for (const b of [el.text?.body, el.shape?.text?.body, ...(el.table ? Object.values(el.table.cells).map((c) => c.body) : [])]) for (const p of b?.paragraphs || []) for (const i of p.inlines) add(i.marks?.link);
    });
  }
  return [...extra];
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function blobToDataUrl(blob, type) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(type && blob.type !== type ? new Blob([blob], { type }) : blob);
  });
}

// Asset IDs used by a set of slides (plus the master when shown, and the theme).
export function assetIdsForSlides(doc, slideIds) {
  const mini = {
    ...doc,
    slides: Object.fromEntries(slideIds.map((id) => [id, doc.slides[id]])),
    layouts: [],
    master: slideIds.some((id) => doc.slides[id].show_master !== false) ? doc.master : { elements: [] },
  };
  return referencedAssetIds(mini);
}

// Registry font faces needed for the characters of the given slides.
export function registryFacesFor(doc, slideIds) {
  const mini = { ...doc, slides: Object.fromEntries(slideIds.map((id) => [id, doc.slides[id]])) };
  const chars = collectChars(mini);
  const used = usedRegistryFonts(mini);
  const out = [];
  for (const fam of fontRegistry()) {
    if (!used.has(fam.id)) continue;
    const faces = facesForChars(fam, chars);
    if (faces.length) out.push({ fam, faces });
  }
  return out;
}

export async function fetchFaceBytes(face) {
  const res = await fetch(`./${face.file}`);
  if (!res.ok) throw new Error(`Font file missing: ${face.file}`);
  return res.blob();
}

// Fonts (registry + custom + device) referenced by the document, for checks.
export function documentFonts(doc) {
  const device = new Set();
  const custom = new Set();
  const registry = new Set();
  const see = (v) => {
    const f = resolveFontValue(doc.theme, v);
    if (typeof f === 'string' && f.startsWith('builtin.')) registry.add(f);
    else if (typeof f === 'string') custom.add(f);
    else if (f?.device) device.add(f.device);
  };
  for (const v of Object.values(doc.theme.fonts)) see(v);
  for (const r of Object.values(doc.theme.roles)) see(r.font);
  const json = JSON.stringify({ s: doc.slides, m: doc.master });
  for (const m of json.matchAll(/"device":"([^"]+)"/g)) device.add(m[1]);
  for (const fam of doc.fonts || []) if (json.includes(`"${fam.id}"`) || Object.values(doc.theme.fonts).includes(fam.id)) custom.add(fam.id);
  for (const m of json.matchAll(/"(builtin\.[a-z0-9-]+)"/g)) registry.add(m[1]);
  return { device: [...device], custom: [...custom], registry: [...registry] };
}

export function safeName(s, max = 60) {
  return String(s || 'untitled').normalize('NFKD').replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, max) || 'untitled';
}
