// Font registry and loading (spec §7). The registry is injected at runtime: the
// app passes the generated manifest; exported HTML passes only the families it
// embeds.
import { resolveFontValue } from '../core/theme.js';

let families = [];
let byId = new Map();
let baseUrl = './';
const registeredFaces = new Map(); // key → FontFace
const customRegistered = new Map(); // assetId → FontFace

export const EMOJI_STACK = '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';

export function setFontRegistry(list, { base = './' } = {}) {
  families = list || [];
  byId = new Map(families.map((f) => [f.id, f]));
  baseUrl = base;
}

export function fontRegistry() {
  return families;
}

export function registryFont(id) {
  return byId.get(id) || null;
}

export function registryFontIds() {
  return new Set(families.map((f) => f.id));
}

function scriptFallbacks(language = '') {
  const lang = language.toLowerCase();
  let cjk = ['builtin.noto-sans-jp', 'builtin.noto-sans-sc', 'builtin.noto-sans-kr'];
  if (lang.startsWith('zh')) cjk = ['builtin.noto-sans-sc', 'builtin.noto-sans-jp', 'builtin.noto-sans-kr'];
  else if (lang.startsWith('ko')) cjk = ['builtin.noto-sans-kr', 'builtin.noto-sans-jp', 'builtin.noto-sans-sc'];
  const ids = ['builtin.noto-sans-arabic', 'builtin.noto-sans-hebrew', 'builtin.noto-sans-devanagari', 'builtin.noto-sans-thai', ...cjk];
  return ids.map((id) => byId.get(id)).filter(Boolean).map((f) => `"${f.cssFamily}"`);
}

function genericFor(fam) {
  return fam?.genericFallback || 'sans-serif';
}

// CSS font-family value for a font value (token, registry id, custom id or device font).
export function cssFontFamily(fontValue, doc) {
  const theme = doc.theme;
  const f = resolveFontValue(theme, fontValue);
  const lang = doc.metadata?.language || '';
  const fallbacks = scriptFallbacks(lang);
  const inter = byId.get('builtin.inter');
  const tail = (generic) => [...fallbacks, EMOJI_STACK, generic].join(', ');
  if (typeof f === 'string' && f.startsWith('builtin.')) {
    const fam = byId.get(f) || inter;
    if (!fam) return tail('sans-serif');
    return [`"${fam.cssFamily}"`, tail(genericFor(fam))].join(', ');
  }
  if (typeof f === 'string') {
    const custom = (doc.fonts || []).find((x) => x.id === f);
    const fb = byId.get(custom?.fallback || 'builtin.inter') || inter;
    const fbName = fb ? `"${fb.cssFamily}", ` : '';
    return `"pe-custom-${f}", ${fbName}${tail(genericFor(fb))}`;
  }
  if (f && typeof f === 'object' && f.device) {
    const fb = byId.get(f.fallback) || inter;
    const fbName = fb ? `"${fb.cssFamily}", ` : '';
    // Device font names are validated against a strict pattern (spec §18.2).
    return `"${f.device}", ${fbName}${tail(genericFor(fb))}`;
  }
  return inter ? `"${inter.cssFamily}", ${tail('sans-serif')}` : tail('sans-serif');
}

function faceUrl(face) {
  if (face.url) return face.url;
  return baseUrl + face.file;
}

// Registers every registry face with the document's font set. Browsers only
// download a face when text needs it (unicode-range), so on-demand scripts load
// on first use.
export function registerRegistryFaces(dom = globalThis.document) {
  if (!dom?.fonts || typeof FontFace === 'undefined') return;
  const win = dom.defaultView || globalThis;
  const FF = win.FontFace || FontFace;
  for (const fam of families) {
    for (const face of fam.faces) {
      const key = `${dom === globalThis.document ? 'main' : 'other'}|${fam.id}|${face.file || face.url}`;
      if (registeredFaces.has(key) && dom === globalThis.document) continue;
      try {
        const ff = new FF(face.family || fam.cssFamily, `url("${faceUrl(face)}")`, {
          style: face.style || 'normal',
          weight: face.weight || '400',
          unicodeRange: face.unicodeRange || 'U+0-10FFFF',
          display: 'swap',
        });
        dom.fonts.add(ff);
        if (dom === globalThis.document) registeredFaces.set(key, ff);
      } catch {
        /* ignore malformed faces */
      }
    }
  }
}

// Registers a presentation's custom fonts from asset blobs/buffers.
export async function registerCustomFonts(doc, getAssetBuffer, dom = globalThis.document) {
  if (!dom?.fonts || typeof FontFace === 'undefined') return [];
  const failed = [];
  const win = dom.defaultView || globalThis;
  const FF = win.FontFace || FontFace;
  for (const fam of doc.fonts || []) {
    for (const face of fam.faces || []) {
      const cacheKey = `${dom === globalThis.document ? 'main' : 'other'}|${face.asset_id}`;
      if (customRegistered.has(cacheKey)) continue;
      try {
        const buf = await getAssetBuffer(face.asset_id);
        if (!buf) {
          failed.push(fam.id);
          continue;
        }
        const ff = new FF(`pe-custom-${fam.id}`, buf, { weight: String(face.weight), style: face.style });
        await ff.load();
        dom.fonts.add(ff);
        customRegistered.set(cacheKey, ff);
      } catch {
        failed.push(fam.id);
      }
    }
  }
  return failed;
}

export async function fontsReady(dom = globalThis.document) {
  try {
    if (dom?.fonts?.ready) await dom.fonts.ready;
  } catch {
    /* ignore */
  }
}

// Faces whose unicode-range covers any of the given characters.
export function facesForChars(fam, chars) {
  const codes = [...chars].map((c) => c.codePointAt(0));
  return fam.faces.filter((face) => {
    const ranges = parseUnicodeRange(face.unicodeRange || 'U+0-10FFFF');
    return codes.some((cp) => ranges.some(([a, b]) => cp >= a && cp <= b));
  });
}

export function parseUnicodeRange(spec) {
  return spec.split(',').map((part) => {
    const p = part.trim().replace(/^U\+/i, '');
    if (p.includes('-')) {
      const [a, b] = p.split('-');
      return [parseInt(a, 16), parseInt(b, 16)];
    }
    if (p.includes('?')) return [parseInt(p.replace(/\?/g, '0'), 16), parseInt(p.replace(/\?/g, 'F'), 16)];
    const v = parseInt(p, 16);
    return [v, v];
  });
}

// Registry font IDs referenced by a document (theme tokens + direct references).
export function usedRegistryFonts(doc) {
  const used = new Set(['builtin.inter']);
  const add = (v) => {
    const f = resolveFontValue(doc.theme, v);
    if (typeof f === 'string' && f.startsWith('builtin.')) used.add(f);
    else if (f && typeof f === 'object' && f.fallback) used.add(f.fallback);
  };
  for (const k of Object.keys(doc.theme.fonts)) add(doc.theme.fonts[k]);
  const json = JSON.stringify(doc);
  for (const m of json.matchAll(/"(builtin\.[a-z0-9-]+)"/g)) used.add(m[1]);
  for (const fam of doc.fonts || []) if (fam.fallback) used.add(fam.fallback);
  // script fallbacks are always candidates; filtered later by characters used
  for (const f of families) if (f.onDemand) used.add(f.id);
  return used;
}
