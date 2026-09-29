// Standalone HTML export (spec §15.5): one self-contained file (or a web folder
// ZIP) with the viewer bundle, inert JSON data, CSS, assets and fonts.
import rendererCss from '../render/renderer.css?raw';
import viewerCss from '../viewer/viewer.css?raw';
import { slideOrder, referencedAssetIds, walk } from '../core/model.js';
import { canonicalize } from '../core/canonical.js';
import { writeZip } from '../io/zip.js';
import { EXT_BY_TYPE } from '../io/sniff.js';
import { registryFacesFor, fetchFaceBytes, blobToBase64, linkTargets, safeName } from './common.js';

let viewerSource = null;

async function viewerScript() {
  if (viewerSource) return viewerSource;
  const res = await fetch('./viewer/viewer.js');
  if (!res.ok) throw new Error('The viewer script couldn’t be loaded. Reload the app and try again.');
  viewerSource = (await res.text()).replace(/<\/script/gi, '<\\/script');
  return viewerSource;
}

async function sha256b64(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// JSON that can't close its <script> block or start an HTML comment.
export function inertJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// Makes the document that goes into the file: excluded slides become empty
// stubs (so slide numbers keep their values), notes and layouts are dropped
// unless included.
export function prepareHtmlDoc(doc, slideIds, { notes = false } = {}) {
  const out = canonicalize(doc);
  const keep = new Set(slideIds);
  for (const id of slideOrder(out)) {
    const s = out.slides[id];
    if (!keep.has(id)) {
      out.slides[id] = { id, elements: [], hidden: true };
      continue;
    }
    if (!notes) delete s.notes;
  }
  out.layouts = [];
  delete out.authoring;
  const refs = referencedAssetIds(out);
  out.assets = (out.assets || []).filter((a) => refs.has(a.id));
  for (const fam of out.fonts || []) if (fam.restricted) fam.faces = [];
  return out;
}

// opts: { slideIds, notes, startSlideId, playback, folder, onProgress }
export async function exportHtml(doc, getAssetBlob, opts) {
  const onProgress = opts.onProgress || (() => {});
  const ids = [...opts.slideIds];
  for (const extra of linkTargets(doc, ids)) ids.push(extra);
  const order = slideOrder(doc);
  ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const out = prepareHtmlDoc(doc, ids, { notes: opts.notes });
  const assets = {};
  const media = [];
  let done = 0;
  for (const a of out.assets) {
    const blob = await getAssetBlob(a.id);
    if (!blob) continue;
    const isMedia = a.kind === 'image' || a.kind === 'svg' || a.kind === 'video';
    if (opts.folder && isMedia) {
      const name = `media/${a.id}.${EXT_BY_TYPE[a.media_type] || 'bin'}`;
      media.push({ name, data: blob, compress: false });
      assets[a.id] = { type: a.media_type, href: name };
    } else if (a.kind !== 'font') {
      assets[a.id] = { type: a.media_type, data: await blobToBase64(blob) };
    }
    onProgress((++done / Math.max(1, out.assets.length)) * 0.6);
  }
  const customFonts = {};
  for (const fam of out.fonts || []) {
    for (const face of fam.faces) {
      const blob = await getAssetBlob(face.asset_id);
      if (blob) customFonts[face.asset_id] = await blobToBase64(blob);
    }
  }
  const fonts = [];
  for (const { fam, faces } of registryFacesFor(out, ids)) {
    const list = [];
    for (const face of faces) {
      try {
        list.push({ family: face.family, style: face.style, weight: face.weight, unicodeRange: face.unicodeRange, data: await blobToBase64(await fetchFaceBytes(face)) });
      } catch {
        /* a missing subset falls back */
      }
    }
    fonts.push({ id: fam.id, name: fam.name, cssFamily: fam.cssFamily, category: fam.category, genericFallback: fam.genericFallback, faces: list });
  }
  onProgress(0.8);
  const data = {
    doc: out,
    options: {
      slideIds: ids,
      notes: !!opts.notes,
      startSlideId: opts.startSlideId && ids.includes(opts.startSlideId) ? opts.startSlideId : null,
      playback: opts.playback || null,
    },
    assets,
    fonts,
    customFonts,
  };
  const W = doc.size.width;
  const H = doc.size.height;
  const css = `${rendererCss}\n${viewerCss}\n@page { size: ${(W / 96).toFixed(4)}in ${(H / 96).toFixed(4)}in; margin: 0; }\n.pe-print-page { width: ${W}px; height: ${H}px; overflow: hidden; break-after: page; position: relative; }\n.pe-print-page:last-child { break-after: auto; }\n`;
  const script = await viewerScript();
  const [scriptHash, styleHash] = await Promise.all([sha256b64(script), sha256b64(css)]);
  const local = opts.folder ? " 'self' file:" : '';
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}'`,
    `style-src 'sha256-${styleHash}'`,
    `img-src data: blob:${local}`,
    `media-src data: blob:${local}`,
    'font-src data: blob:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
  const lang = escapeHtml(doc.metadata.language || 'en');
  const html = `<!doctype html>
<html lang="${lang}" class="pe-standalone">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="generator" content="Presentation Editor">
<title>${escapeHtml(doc.metadata.title)}</title>
${doc.metadata.description ? `<meta name="description" content="${escapeHtml(doc.metadata.description)}">\n` : ''}<style>${css}</style>
</head>
<body>
<div id="pe-root"></div>
<div id="pe-print"></div>
<script type="application/json" id="pe-data">${inertJson(data)}</script>
<script>${script}</script>
</body>
</html>
`;
  onProgress(1);
  const base = safeName(doc.metadata.title);
  if (!opts.folder) return { blob: new Blob([html], { type: 'text/html' }), filename: `${base}.html` };
  const zip = await writeZip([{ name: 'index.html', data: html, compress: true }, ...media]);
  return { blob: new Blob([zip], { type: 'application/zip' }), filename: `${base}-web.zip` };
}

export { walk };
