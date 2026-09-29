// Entry point of the standalone viewer embedded in exported HTML (spec §15.5).
// Reads inert JSON data, turns embedded media into blob URLs, loads embedded
// fonts and starts the viewer. Only this script runs; presentation data is never
// interpreted as markup.
import { createViewer, slideIndexFromHash, needsStartOverlay } from './viewer.js';
import { setFontRegistry, registerRegistryFaces, registerCustomFonts } from '../render/fonts.js';
import { renderSlide, layoutSlide } from '../render/renderer.js';
import { slideOrder } from '../core/model.js';

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function boot() {
  const dataEl = document.getElementById('pe-data');
  if (!dataEl) return;
  const data = JSON.parse(dataEl.textContent);
  const { doc, options = {} } = data;
  const urls = new Map();
  const buffers = new Map();
  for (const [id, a] of Object.entries(data.assets || {})) {
    if (a.data) {
      const bytes = b64ToBytes(a.data);
      buffers.set(id, bytes);
      urls.set(id, URL.createObjectURL(new Blob([bytes], { type: a.type })));
    } else if (a.href) urls.set(id, a.href);
  }
  const families = (data.fonts || []).map((fam) => ({
    ...fam,
    faces: fam.faces.map((f) => ({ ...f, url: URL.createObjectURL(new Blob([b64ToBytes(f.data)], { type: 'font/woff2' })), data: undefined })),
  }));
  setFontRegistry(families, { base: '' });
  registerRegistryFaces(document);
  const customBufs = new Map();
  for (const [id, a] of Object.entries(data.customFonts || {})) customBufs.set(id, b64ToBytes(a).buffer);
  await registerCustomFonts(doc, async (id) => customBufs.get(id) || null, document);

  const assetUrl = (id) => urls.get(id) || null;
  const assetInfo = (id) => (doc.assets || []).find((a) => a.id === id) || null;
  const slideIds = options.slideIds || slideOrder(doc);
  const root = document.getElementById('pe-root');
  const viewer = createViewer(root, {
    doc,
    slideIds,
    assetUrl,
    assetInfo,
    mode: 'standalone',
    presenter: !!options.notes,
    notes: !!options.notes,
    playback: options.playback,
    getCaptionsText: async (id) => {
      const b = buffers.get(id);
      return b ? new TextDecoder().decode(b) : null;
    },
    registerFonts: (d) => {
      registerRegistryFaces(d);
      registerCustomFonts(doc, async (id) => customBufs.get(id) || null, d);
    },
    onPopupBlocked: () => alert('Allow pop-ups for this file to open the presenter view.'),
  });
  let start = slideIndexFromHash(location.hash);
  if (start < 0 || start >= slideIds.length) {
    const s = options.startSlideId ? slideIds.indexOf(options.startSlideId) : -1;
    start = s >= 0 ? s : viewer.firstVisible();
  }
  window.addEventListener('hashchange', () => {
    const i = slideIndexFromHash(location.hash);
    if (i >= 0 && i !== viewer.getState().index) viewer.goto(i);
  });
  await viewer.start(start, { fullscreen: false, overlay: needsStartOverlay(doc, doc.slides[slideIds[start]]) });
  buildPrintView(doc, slideIds, assetUrl, assetInfo);
}

// Printing the HTML file gives one slide per page (spec §15.5).
function buildPrintView(doc, slideIds, assetUrl, assetInfo) {
  const host = document.getElementById('pe-print');
  if (!host) return;
  window.addEventListener('beforeprint', () => {
    if (host.childElementCount) return;
    for (const id of slideIds) {
      const slide = doc.slides[id];
      if (slide.hidden) continue;
      const page = document.createElement('div');
      page.className = 'pe-print-page';
      const node = renderSlide(doc, slide, { mode: 'print', assetUrl, assetInfo });
      page.appendChild(node);
      host.appendChild(page);
      layoutSlide(node, doc, slide);
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
