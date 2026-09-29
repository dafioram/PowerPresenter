// Image export (spec §15.4): the renderer's DOM for a slide goes into an SVG
// foreignObject with every font and asset inlined, which is drawn to a canvas.
import rendererCss from '../render/renderer.css?raw';
import { renderSlide, layoutSlide } from '../render/renderer.js';
import { fontsReady } from '../render/fonts.js';
import { slideOrder } from '../core/model.js';
import { resolveSlideTitle } from '../core/titles.js';
import { writeZip } from '../io/zip.js';
import { assetIdsForSlides, registryFacesFor, fetchFaceBytes, blobToDataUrl, safeName } from './common.js';
import { toast } from '../app/ui/components.jsx';

const MAX_SIDE = 8192;

const faceCache = new Map(); // file → data URL

async function fontCss(doc, slideIds, getAssetBlob) {
  const parts = [];
  for (const { fam, faces } of registryFacesFor(doc, slideIds)) {
    for (const face of faces) {
      let url = faceCache.get(face.file);
      if (!url) {
        try {
          url = await blobToDataUrl(await fetchFaceBytes(face), 'font/woff2');
          faceCache.set(face.file, url);
        } catch {
          continue;
        }
      }
      parts.push(`@font-face{font-family:"${face.family || fam.cssFamily}";src:url(${url}) format("woff2");font-weight:${face.weight || 400};font-style:${face.style || 'normal'};unicode-range:${face.unicodeRange || 'U+0-10FFFF'};}`);
    }
  }
  for (const fam of doc.fonts || []) {
    for (const face of fam.faces || []) {
      const blob = await getAssetBlob(face.asset_id);
      if (!blob) continue;
      const url = await blobToDataUrl(blob);
      parts.push(`@font-face{font-family:"pe-custom-${fam.id}";src:url(${url});font-weight:${face.weight};font-style:${face.style};}`);
    }
  }
  return parts.join('\n');
}

async function assetDataUrls(doc, slideIds, getAssetBlob) {
  const urls = new Map();
  for (const id of assetIdsForSlides(doc, slideIds)) {
    const rec = doc.assets.find((a) => a.id === id);
    if (!rec || rec.kind === 'video' || rec.kind === 'captions' || rec.kind === 'font') continue;
    const blob = await getAssetBlob(id);
    if (blob) urls.set(id, await blobToDataUrl(blob, rec.media_type));
  }
  return urls;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The slide couldn’t be drawn as an image in this browser.'));
    img.src = src;
  });
}

// Prepares shared resources once for several slides.
export async function prepareImageExport(doc, slideIds, getAssetBlob) {
  const [css, urls] = await Promise.all([fontCss(doc, slideIds, getAssetBlob), assetDataUrls(doc, slideIds, getAssetBlob)]);
  return { css, urls };
}

// Renders one slide to a canvas at `scale`.
export async function renderSlideCanvas(doc, slide, { scale = 2, prepared, background = null }) {
  const W = doc.size.width;
  const H = doc.size.height;
  const s = Math.min(scale, MAX_SIDE / W, MAX_SIDE / H);
  const host = document.createElement('div');
  host.className = 'pe-offscreen';
  document.body.appendChild(host);
  try {
    const root = renderSlide(doc, slide, { mode: 'print', assetUrl: (id) => prepared.urls.get(id) || null });
    host.appendChild(root);
    await fontsReady();
    await Promise.all([...root.querySelectorAll('img')].map((i) => (i.complete ? null : i.decode().catch(() => null))));
    layoutSlide(root, doc, slide);
    const xhtml = new XMLSerializer().serializeToString(root);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W * s)}" height="${Math.round(H * s)}" viewBox="0 0 ${W} ${H}"><foreignObject x="0" y="0" width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;height:${H}px"><style>${escapeCss(prepared.css)}\n${escapeCss(rendererCss)}</style>${xhtml}</div></foreignObject></svg>`;
    const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * s);
    canvas.height = Math.round(H * s);
    const c2d = canvas.getContext('2d');
    if (background) {
      c2d.fillStyle = background;
      c2d.fillRect(0, 0, canvas.width, canvas.height);
    }
    // give the browser a moment to decode fonts inside the SVG image
    await new Promise((r) => setTimeout(r, 30));
    c2d.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    host.remove();
  }
}

function escapeCss(css) {
  return css.replace(/<\/style/gi, '<\\/style').replace(/]]>/g, ']] >');
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image couldn’t be encoded.'))), type, quality);
    } catch (e) {
      reject(e);
    }
  });
}

// opts: { format: 'png'|'jpeg', quality (0.6–1), scale, onProgress, signal }
export async function exportImages(doc, slideIds, getAssetBlob, opts = {}) {
  const format = opts.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = opts.format === 'jpeg' ? 'jpg' : 'png';
  const prepared = await prepareImageExport(doc, slideIds, getAssetBlob);
  const order = slideOrder(doc);
  const files = [];
  for (let i = 0; i < slideIds.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const slide = doc.slides[slideIds[i]];
    const canvas = await renderSlideCanvas(doc, slide, { scale: opts.scale || 2, prepared, background: format === 'image/jpeg' ? '#ffffff' : null });
    const blob = await canvasBlob(canvas, format, opts.quality ?? 0.9);
    const n = String(order.indexOf(slide.id) + 1).padStart(2, '0');
    files.push({ name: `${n}-${safeName(resolveSlideTitle(slide) || 'slide')}.${ext}`, data: blob });
    opts.onProgress?.((i + 1) / slideIds.length);
  }
  if (files.length === 1) return { blob: files[0].data, filename: files[0].name };
  const zip = await writeZip(files.map((f) => ({ ...f, compress: false })));
  return { blob: new Blob([zip], { type: 'application/zip' }), filename: `${safeName(doc.metadata.title)}-slides.zip` };
}

// Sidebar "Copy slide as image" (spec §15.4): puts a PNG on the clipboard.
export async function copySlideAsImage(ctl, slideId) {
  try {
    if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error('Copying images isn’t supported in this browser.');
    const doc = ctl.doc;
    const getBlob = (id) => ctl.assets.blobAsync(id);
    const item = new ClipboardItem({
      'image/png': (async () => {
        const prepared = await prepareImageExport(doc, [slideId], getBlob);
        const canvas = await renderSlideCanvas(doc, doc.slides[slideId], { scale: 1, prepared });
        return canvasBlob(canvas, 'image/png');
      })(),
    });
    await navigator.clipboard.write([item]);
    toast('Slide copied as an image.', { kind: 'success' });
  } catch (e) {
    toast(e.message || 'Couldn’t copy the slide.', { kind: 'error' });
  }
}
