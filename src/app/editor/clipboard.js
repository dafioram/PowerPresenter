// Clipboard (spec §12.4): internal payloads for elements and slides, sanitized
// HTML and plain text for other apps, and conversion of external content.
import { copyElements, copySlides } from '../../core/remap.js';
import { textElement, tableElement, walk, referencedAssetIds } from '../../core/model.js';
import { plainText, bodyFromText } from '../../core/text.js';
import { resolveColor } from '../../core/color.js';
import { resolveFontValue } from '../../core/theme.js';
import { isAllowedUrl } from '../../core/validate.js';
import { validateDocument } from '../../core/validate.js';
import * as ops from '../../core/ops.js';
import { getAsset } from '../../storage/repo.js';
import { sha256 } from '../../io/hash.js';
import { toast } from '../ui/components.jsx';
import { parseDelimited } from '../../core/tables.js';
import { newId } from '../../core/ids.js';

export const MIME = 'application/x-presentation-editor+json';
const MAX_PAYLOAD = 20 * 1024 * 1024;

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bodyToHtml(body) {
  let html = '';
  let listTag = null;
  for (const p of body?.paragraphs || []) {
    let inner = '';
    for (const i of p.inlines || []) {
      if (i.break) {
        inner += '<br>';
        continue;
      }
      if (typeof i.text !== 'string') continue;
      let t = escapeHtml(i.text);
      const m = i.marks || {};
      if (m.weight >= 600) t = `<b>${t}</b>`;
      if (m.italic) t = `<i>${t}</i>`;
      if (m.underline) t = `<u>${t}</u>`;
      if (m.strike) t = `<s>${t}</s>`;
      if (m.script === 'super') t = `<sup>${t}</sup>`;
      if (m.script === 'sub') t = `<sub>${t}</sub>`;
      if (m.link?.kind === 'url' && isAllowedUrl(m.link.href)) t = `<a href="${escapeHtml(m.link.href)}">${t}</a>`;
      inner += t;
    }
    if (p.list) {
      const tag = p.list.kind === 'number' ? 'ol' : 'ul';
      if (listTag !== tag) {
        if (listTag) html += `</${listTag}>`;
        html += `<${tag}>`;
        listTag = tag;
      }
      html += `<li>${inner}</li>`;
    } else {
      if (listTag) html += `</${listTag}>`;
      listTag = null;
      html += `<p>${inner}</p>`;
    }
  }
  if (listTag) html += `</${listTag}>`;
  return html;
}

function elementsToHtml(elements) {
  let html = '';
  walk(elements, (el) => {
    if (el.text) html += bodyToHtml(el.text.body);
    if (el.shape?.text) html += bodyToHtml(el.shape.text.body);
    if (el.table) {
      html += '<table>';
      for (const r of el.table.rows) {
        html += '<tr>';
        for (const c of el.table.columns) html += `<td>${bodyToHtml(el.table.cells[`${r.id}:${c.id}`]?.body)}</td>`;
        html += '</tr>';
      }
      html += '</table>';
    }
  });
  return html;
}

function elementsToText(elements) {
  const parts = [];
  walk(elements, (el) => {
    if (el.text) parts.push(plainText(el.text.body));
    if (el.shape?.text) parts.push(plainText(el.shape.text.body));
    if (el.table) {
      for (const r of el.table.rows) parts.push(el.table.columns.map((c) => plainText(el.table.cells[`${r.id}:${c.id}`]?.body)).join('\t'));
    }
  });
  return parts.filter(Boolean).join('\n');
}

// Builds the payload for copied elements or slides.
export function makePayload(ctl, { kind, elements, slides }) {
  const doc = ctl.doc;
  const assetIds = new Set();
  const collect = (els) => walk(els, (el) => {
    const tmp = { slides: { x: { elements: [el] } }, master: { elements: [] }, layouts: [], fonts: [], theme: {} };
    for (const id of referencedAssetIds(tmp)) assetIds.add(id);
  });
  if (elements) collect(elements);
  if (slides) for (const s of slides) {
    collect(s.elements);
    if (s.background?.type === 'image') assetIds.add(s.background.asset_id);
  }
  const usedFonts = new Set(JSON.stringify({ elements, slides }).match(/"[A-Za-z0-9_-]{22}"/g) || []);
  return {
    kind,
    version: 1,
    source: doc.id,
    theme: doc.theme,
    fonts: (doc.fonts || []).filter((f) => usedFonts.has(`"${f.id}"`)),
    assets: (doc.assets || []).filter((a) => assetIds.has(a.id)),
    elements: elements || null,
    slides: slides || null,
  };
}

export function writeClipboard(e, payload) {
  const json = JSON.stringify(payload);
  const els = payload.elements || (payload.slides || []).flatMap((s) => s.elements);
  e.clipboardData.setData(MIME, json);
  const html = `<div data-pe-clipboard="${json.length < MAX_PAYLOAD ? toBase64(json) : ''}">${elementsToHtml(els)}</div>`;
  e.clipboardData.setData('text/html', html);
  e.clipboardData.setData('text/plain', elementsToText(els));
  e.preventDefault();
}

export function readPayload(dt) {
  let json = null;
  try {
    json = dt.getData(MIME);
  } catch {
    /* unsupported type */
  }
  if (!json) {
    const html = dt.getData('text/html');
    const m = html && /data-pe-clipboard="([A-Za-z0-9+/=]+)"/.exec(html);
    if (m) {
      try {
        json = fromBase64(m[1]);
      } catch {
        json = null;
      }
    }
  }
  if (!json || json.length > MAX_PAYLOAD) return null;
  try {
    const p = JSON.parse(json);
    if (p && (p.kind === 'elements' || p.kind === 'slides') && p.version === 1) return p;
  } catch {
    /* not ours */
  }
  return null;
}

// Resolves theme tokens to literal values (Keep source formatting).
function resolveTokens(value, theme) {
  if (Array.isArray(value)) return value.map((v) => resolveTokens(v, theme));
  if (value && typeof value === 'object') {
    if (typeof value.token === 'string' && Object.keys(value).every((k) => k === 'token' || k === 'tint')) {
      if (value.token.startsWith('color.')) return resolveColor(value, theme);
      if (value.token.startsWith('font.')) return resolveFontValue(theme, value);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveTokens(v, theme);
    return out;
  }
  return value;
}

// Copies the payload's assets into this presentation (by hash). Returns id map.
async function importAssets(ctl, payload) {
  const map = new Map();
  const missing = [];
  const newRecords = [];
  for (const rec of payload.assets || []) {
    const same = (ctl.doc.assets || []).find((a) => a.sha256 === rec.sha256 && a.media_type === rec.media_type && ctl.assets.has(a.id));
    if (same) {
      map.set(rec.id, same.id);
      continue;
    }
    if (payload.source === ctl.doc.id && ctl.assets.has(rec.id)) {
      map.set(rec.id, rec.id);
      if (!(ctl.doc.assets || []).some((a) => a.id === rec.id)) newRecords.push(rec);
      continue;
    }
    let blob = null;
    try {
      blob = await getAsset(payload.source, rec.id);
    } catch {
      blob = null;
    }
    if (blob && (await sha256(blob)) === rec.sha256) {
      const id = newId();
      const record = { ...rec, id, path: rec.path.replace(rec.id, id) };
      await ctl.assets.add(record, blob);
      newRecords.push(record);
      map.set(rec.id, id);
    } else missing.push(rec.id);
  }
  return { map, missing, newRecords };
}

function remapAssetRefs(elements, map, missing) {
  const miss = new Set(missing);
  walk(elements, (el) => {
    if (el.image) {
      if (miss.has(el.image.asset_id)) el.image.asset_id = null;
      else if (map.has(el.image.asset_id)) el.image.asset_id = map.get(el.image.asset_id);
    }
    if (el.video) {
      for (const k of ['asset_id', 'poster_asset_id', 'captions_asset_id']) {
        const v = el.video[k];
        if (!v) continue;
        if (miss.has(v)) delete el.video[k];
        else if (map.has(v)) el.video[k] = map.get(v);
      }
    }
    const f = el.style?.fill;
    if (f?.type === 'image') {
      if (miss.has(f.asset_id)) el.style.fill = 'none';
      else if (map.has(f.asset_id)) f.asset_id = map.get(f.asset_id);
    }
  });
}

function dropInvalidVideos(elements) {
  return elements.filter((e) => !(e.type === 'video' && !e.video.asset_id));
}

// Pastes an internal payload. keepSource: resolve tokens to literal values.
export async function pastePayload(ctl, payload, { keepSource = false, at = null } = {}) {
  const sameDoc = payload.source === ctl.doc.id;
  const { map, missing, newRecords } = await importAssets(ctl, payload);
  if (missing.length) toast(`${missing.length} media file${missing.length === 1 ? '' : 's'} couldn’t be copied and became empty slots.`, { kind: 'info' });
  // custom fonts used by pasted content are copied in both modes
  const fontsToAdd = [];
  const fontMap = new Map();
  for (const fam of payload.fonts || []) {
    const existing = (ctl.doc.fonts || []).find((f) => f.id === fam.id || f.family_name === fam.family_name);
    if (existing) {
      fontMap.set(fam.id, existing.id);
      continue;
    }
    const faces = [];
    for (const face of fam.faces) {
      if (map.has(face.asset_id)) faces.push({ ...face, asset_id: map.get(face.asset_id) });
      else {
        const rec = (payload.assets || []).find((a) => a.id === face.asset_id);
        if (!rec) continue;
      }
    }
    const nf = { ...fam, id: sameDoc ? fam.id : newId(), faces };
    fontMap.set(fam.id, nf.id);
    fontsToAdd.push(nf);
  }
  const theme = payload.theme;
  const prep = (els) => {
    let out = JSON.parse(JSON.stringify(els));
    if (keepSource && theme) out = resolveTokens(out, theme);
    let json = JSON.stringify(out);
    for (const [from, to] of fontMap) if (from !== to) json = json.split(`"${from}"`).join(`"${to}"`);
    out = JSON.parse(json);
    remapAssetRefs(out, map, missing);
    return dropInvalidVideos(out);
  };
  if (payload.kind === 'elements') {
    const { elements, droppedLinks } = copyElements(prep(payload.elements), { keepExternalSlideLinks: sameDoc });
    const valid = elements.slice();
    // Same position on the same slide gets offset.
    if (at) {
      const boxes = valid.map((e) => e.geometry).filter((g) => typeof g.x === 'number');
      if (boxes.length) {
        const minX = Math.min(...boxes.map((g) => g.x));
        const minY = Math.min(...boxes.map((g) => g.y));
        const dx = at.x - minX;
        const dy = at.y - minY;
        const moved = valid.map((e) => translate(e, dx, dy));
        valid.splice(0, valid.length, ...moved);
      }
    } else if (sameDoc) {
      const existing = new Set(ctl.elements().map((e) => JSON.stringify(e.geometry)));
      if (valid.some((e) => existing.has(JSON.stringify(e.geometry)))) {
        const moved = valid.map((e) => translate(e, 20, 20));
        valid.splice(0, valid.length, ...moved);
      }
    }
    for (const e of valid) stripSlideLinks(e, ctl.doc);
    const ok = ctl.dispatch('Paste', (d) => {
      for (const r of newRecords) if (!d.assets.some((a) => a.id === r.id)) d.assets.push(r);
      for (const f of fontsToAdd) if (!d.fonts.some((x) => x.id === f.id)) d.fonts.push(f);
      ops.insertElements(d, ctl.container, valid);
    });
    if (ok) {
      const test = validateDocument(ctl.doc);
      if (!test.ok) {
        ctl.undo();
        toast('The pasted content isn’t valid here.', { kind: 'error' });
        return false;
      }
      ctl.set({ selection: valid.map((e) => e.id) });
    }
    if (droppedLinks.length) toast('Links to slides that aren’t in this presentation were removed.', { kind: 'info' });
    return ok;
  }
  if (payload.kind === 'slides') {
    const srcSlides = payload.slides.map((s) => ({ ...s, elements: prep(s.elements), background: s.background && keepSource ? resolveTokens(s.background, theme) : s.background }));
    for (const s of srcSlides) {
      if (s.background?.type === 'image') {
        if (missing.includes(s.background.asset_id)) delete s.background;
        else if (map.has(s.background.asset_id)) s.background = { ...s.background, asset_id: map.get(s.background.asset_id) };
      }
    }
    const { slides, droppedLinks } = copySlides(srcSlides, { inDestination: (id) => sameDoc && !!ctl.doc.slides[id] });
    for (const s of slides) for (const e of s.elements) stripSlideLinks(e, ctl.doc, new Set(slides.map((x) => x.id)));
    const ok = ctl.dispatch('Paste slides', (d) => {
      for (const r of newRecords) if (!d.assets.some((a) => a.id === r.id)) d.assets.push(r);
      for (const f of fontsToAdd) if (!d.fonts.some((x) => x.id === f.id)) d.fonts.push(f);
      ops.insertSlides(d, slides, ctl.state.slideId);
    });
    if (ok) {
      const test = validateDocument(ctl.doc);
      if (!test.ok) {
        ctl.undo();
        toast('The pasted slides aren’t valid here.', { kind: 'error' });
        return false;
      }
      ctl.setSlide(slides[0].id);
      ctl.set({ slideSelection: slides.map((s) => s.id) });
    }
    if (droppedLinks.length) toast('Links to slides that aren’t in this presentation were removed.', { kind: 'info' });
    return ok;
  }
  return false;
}

function translate(el, dx, dy) {
  const g = el.geometry;
  if (g.start) {
    const mv = (p) => (typeof p.x === 'number' ? { x: p.x + dx, y: p.y + dy } : p);
    return { ...el, geometry: { start: mv(g.start), end: mv(g.end) } };
  }
  return { ...el, geometry: { ...g, x: g.x + dx, y: g.y + dy } };
}

function stripSlideLinks(el, doc, extra = new Set()) {
  const ok = (id) => !!doc.slides[id] || extra.has(id);
  walk([el], (x) => {
    if (x.link?.kind === 'slide' && !ok(x.link.slide_id)) delete x.link;
    const fix = (body) => {
      for (const p of body?.paragraphs || []) for (const i of p.inlines) if (i.marks?.link?.kind === 'slide' && !ok(i.marks.link.slide_id)) delete i.marks.link;
    };
    fix(x.text?.body);
    fix(x.shape?.text?.body);
  });
}

// ---------- external content ----------

function htmlToBody(html) {
  const tpl = new DOMParser().parseFromString(html, 'text/html');
  const paragraphs = [];
  const walkNode = (node, marks, list) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const text = child.nodeValue.replace(/\s+/g, ' ');
        if (!text.trim() && !paragraphs.length) continue;
        let para = paragraphs[paragraphs.length - 1];
        if (!para || para.closed) {
          para = { inlines: [], ...(list ? { list } : {}) };
          paragraphs.push(para);
        }
        para.inlines.push(Object.keys(marks).length ? { text, marks: { ...marks } } : { text });
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (['script', 'style', 'template', 'head', 'title', 'meta'].includes(tag)) continue;
      const m = { ...marks };
      if (tag === 'b' || tag === 'strong') m.weight = 700;
      if (tag === 'i' || tag === 'em') m.italic = true;
      if (tag === 'u') m.underline = true;
      if (tag === 's' || tag === 'strike' || tag === 'del') m.strike = true;
      if (tag === 'sup') m.script = 'super';
      if (tag === 'sub') m.script = 'sub';
      if (tag === 'a' && isAllowedUrl(child.getAttribute('href'))) m.link = { kind: 'url', href: child.getAttribute('href') };
      const fw = child.style?.fontWeight;
      if (fw && (fw === 'bold' || Number(fw) >= 600)) m.weight = 700;
      if (child.style?.fontStyle === 'italic') m.italic = true;
      if (tag === 'br') {
        const para = paragraphs[paragraphs.length - 1];
        if (para && !para.closed) para.inlines.push({ break: true });
        continue;
      }
      if (tag === 'ul' || tag === 'ol') {
        const level = list ? Math.min(8, list.level + 1) : 0;
        for (const li of child.children) {
          if (li.tagName.toLowerCase() !== 'li') continue;
          const p = { inlines: [], list: { kind: tag === 'ol' ? 'number' : 'bullet', level } };
          if (paragraphs.length) paragraphs[paragraphs.length - 1].closed = true;
          paragraphs.push(p);
          walkNode(li, m, p.list);
          p.closed = true;
        }
        continue;
      }
      const block = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'section', 'article'].includes(tag);
      if (block) {
        if (paragraphs.length) paragraphs[paragraphs.length - 1].closed = true;
        const p = { inlines: [], ...(list ? { list } : {}) };
        paragraphs.push(p);
        walkNode(child, m, list);
        p.closed = true;
      } else walkNode(child, m, list);
    }
  };
  walkNode(tpl.body, {}, null);
  const clean = paragraphs.map(({ closed, ...p }) => ({ ...p, inlines: p.inlines.filter((i) => i.break || i.text) }));
  while (clean.length > 1 && !clean[clean.length - 1].inlines.length) clean.pop();
  while (clean.length > 1 && !clean[0].inlines.length) clean.shift();
  for (const p of clean) {
    if (p.inlines[0]?.text) p.inlines[0].text = p.inlines[0].text.replace(/^\s+/, '');
    const last = p.inlines[p.inlines.length - 1];
    if (last?.text) last.text = last.text.replace(/\s+$/, '');
  }
  return { paragraphs: clean.length ? clean.map((p) => ({ ...p, inlines: p.inlines.filter((i) => i.break || i.text) })) : [{ inlines: [] }] };
}

function htmlTable(html) {
  const tpl = new DOMParser().parseFromString(html, 'text/html');
  const table = tpl.querySelector('table');
  if (!table) return null;
  const rows = [...table.querySelectorAll('tr')].slice(0, 200).map((tr) => [...tr.querySelectorAll('th, td')].slice(0, 50).map((c) => c.textContent.trim().slice(0, 5000)));
  if (!rows.length || !rows[0].length) return null;
  return rows;
}

export function tableFromGrid(ctl, rows) {
  const cols = Math.max(...rows.map((r) => r.length));
  const W = ctl.doc.size.width;
  const width = Math.min(W * 0.85, cols * 160);
  const el = tableElement({ rows: rows.length, cols, width, x: (W - width) / 2, y: ctl.doc.size.height * 0.15, rowHeight: 40 });
  el.table.rows.forEach((r, ri) => {
    el.table.columns.forEach((c, ci) => {
      const v = rows[ri][ci] || '';
      el.table.cells[`${r.id}:${c.id}`] = { body: v ? bodyFromText(v) : { paragraphs: [{ inlines: [] }] } };
    });
  });
  return el;
}

// Handles a paste of external data (files, HTML, text). Returns true if handled.
export async function pasteExternal(ctl, dt, { plain = false } = {}) {
  const files = [...(dt.files || [])];
  if (files.length) {
    await ctl.insertFiles(files);
    return true;
  }
  const html = !plain && dt.getData('text/html');
  const text = dt.getData('text/plain');
  if (html) {
    const svgMatch = /<svg[\s\S]*<\/svg>/i.exec(html);
    if (svgMatch && !/<p|<div/i.test(html.replace(svgMatch[0], ''))) {
      await ctl.insertFiles([new File([svgMatch[0]], 'pasted.svg', { type: 'image/svg+xml' })]);
      return true;
    }
    const grid = htmlTable(html);
    if (grid) {
      ctl.insertElements([tableFromGrid(ctl, grid)], { label: 'Paste table' });
      return true;
    }
    const body = htmlToBody(html);
    insertTextBody(ctl, body);
    return true;
  }
  if (text) {
    const trimmed = text.trim();
    if (/^<svg[\s>][\s\S]*<\/svg>$/i.test(trimmed)) {
      await ctl.insertFiles([new File([trimmed], 'pasted.svg', { type: 'image/svg+xml' })]);
      return true;
    }
    if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|svg)(\?\S*)?$/i.test(trimmed)) {
      await fetchRemoteImage(ctl, trimmed);
      return true;
    }
    if (text.includes('\t') && text.split('\n').length > 1) {
      const rows = parseDelimited(text);
      if (rows.length > 1 && rows[0].length > 1) {
        ctl.insertElements([tableFromGrid(ctl, rows)], { label: 'Paste table' });
        return true;
      }
    }
    insertTextBody(ctl, bodyFromText(text.replace(/\r\n?/g, '\n').slice(0, 50000)));
    return true;
  }
  return false;
}

function insertTextBody(ctl, body) {
  const W = ctl.doc.size.width;
  const H = ctl.doc.size.height;
  const el = textElement({ x: W * 0.1, y: H * 0.2, width: W * 0.8, height: 80 });
  el.text.body = body;
  ctl.insertElements([el], { label: 'Paste text' });
}

// One user-started fetch attempt for a remote image URL (spec §8.3).
export async function fetchRemoteImage(ctl, url) {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    await ctl.insertFiles([new File([blob], url.split('/').pop().split('?')[0] || 'image', { type: blob.type })]);
  } catch {
    toast('That image couldn’t be downloaded because the site doesn’t allow it. Copy the image itself (right-click → Copy image), or save it and drop the file here.', { kind: 'error', duration: 10000 });
  }
}
