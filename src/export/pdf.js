// PDF export through the browser's print dialog (spec §15.3; Chromium and
// Firefox). Builds a print view with the shared renderer in print mode.
import { renderSlide, layoutSlide } from '../render/renderer.js';
import { fontsReady } from '../render/fonts.js';
import { buildSteps, visibilityAt } from '../core/builds.js';
import { slideOrder } from '../core/model.js';
import { containerBaseStyle } from '../core/theme.js';
import { renderTextFlow } from '../render/text.js';
import { makeContext } from '../render/renderer.js';

const PAPER = {
  letter: { w: 8.5, h: 11, css: 'letter' },
  a4: { w: 8.27, h: 11.69, css: 'A4' },
};

export function defaultPaper() {
  const lang = (navigator.language || 'en-US').toLowerCase();
  return /^en-(us|ca)|^es-(mx|us)|^fr-ca/.test(lang) ? 'letter' : 'a4';
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

async function waitForImages(root) {
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
}

// opts: { layout: 'slides'|'notes'|'handout', perPage: 2|3|4|6|9, paper: 'letter'|'a4', steps: 'final'|'each' }
export async function buildPrintView(doc, slideIds, assetUrl, opts = {}) {
  const layout = opts.layout || 'slides';
  const W = doc.size.width;
  const H = doc.size.height;
  const order = slideOrder(doc);
  const root = el('div', 'pe-print-root');
  root.setAttribute('aria-hidden', 'true');
  document.body.appendChild(root);
  const ctxBase = { mode: 'print', assetUrl, interactiveLinks: true, slideNumberOf: (id) => order.indexOf(id) + 1 || null };

  // one entry per page image: { slide, visibility }
  const frames = [];
  for (const id of slideIds) {
    const slide = doc.slides[id];
    if (opts.steps === 'each') {
      const n = buildSteps(slide).clickSteps;
      for (let s = 0; s <= n; s++) frames.push({ slide, visibility: visibilityAt(slide, s), first: s === 0 });
    } else frames.push({ slide, visibility: undefined, first: true });
  }

  const renderFrame = (f) => {
    const node = renderSlide(doc, f.slide, { ...ctxBase, ...(f.visibility ? { visibility: f.visibility } : {}) });
    return node;
  };

  const laid = [];
  if (layout === 'slides') {
    for (const f of frames) {
      const page = el('div', 'pe-print-page is-slide');
      page.style.width = `${W}px`;
      page.style.height = `${H}px`;
      if (f.first) page.id = `slide-${order.indexOf(f.slide.id) + 1}`;
      const node = renderFrame(f);
      page.appendChild(node);
      root.appendChild(page);
      laid.push([node, f.slide]);
    }
  } else {
    const paper = PAPER[opts.paper || defaultPaper()];
    const PW = paper.w * 96;
    const PH = paper.h * 96;
    const margin = 48;
    if (layout === 'notes') {
      const ctx = makeContext(doc, { mode: 'print' });
      const base = containerBaseStyle(doc.theme, { kind: 'notes' });
      for (const f of frames) {
        const page = el('div', 'pe-print-page is-paper');
        page.style.width = `${PW}px`;
        page.style.height = `${PH}px`;
        page.style.padding = `${margin}px`;
        if (f.first) page.id = `slide-${order.indexOf(f.slide.id) + 1}`;
        const boxW = PW - margin * 2;
        const s = boxW / W;
        const box = el('div', 'pe-print-slidebox');
        box.style.width = `${boxW}px`;
        box.style.height = `${H * s}px`;
        const node = renderFrame(f);
        node.style.transform = `scale(${s})`;
        node.style.transformOrigin = '0 0';
        box.appendChild(node);
        page.appendChild(box);
        const label = el('div', 'pe-print-label');
        label.textContent = `Slide ${order.indexOf(f.slide.id) + 1}`;
        page.appendChild(label);
        if (f.slide.notes) {
          const { flow } = renderTextFlow(ctx, { body: f.slide.notes }, { kind: 'notes' });
          flow.classList.add('pe-print-notes');
          void base;
          page.appendChild(flow);
        }
        root.appendChild(page);
        laid.push([node, f.slide]);
      }
    } else {
      const per = opts.perPage || 6;
      const cols = per === 2 ? 1 : per === 3 ? 1 : per === 4 ? 2 : per === 6 ? 2 : 3;
      const rows = Math.ceil(per / cols);
      const gap = 24;
      const innerW = PW - margin * 2;
      const innerH = PH - margin * 2;
      const withLines = per === 3;
      const cellW = withLines ? innerW * 0.5 : (innerW - gap * (cols - 1)) / cols;
      const cellH = (innerH - gap * (rows - 1)) / rows;
      const s = Math.min(cellW / W, cellH / H);
      for (let i = 0; i < frames.length; i += per) {
        const page = el('div', 'pe-print-page is-paper is-handout');
        page.style.width = `${PW}px`;
        page.style.height = `${PH}px`;
        page.style.padding = `${margin}px`;
        const grid = el('div', 'pe-print-handout');
        grid.style.gridTemplateColumns = withLines ? '1fr 1fr' : `repeat(${cols}, 1fr)`;
        grid.style.gridAutoRows = `${cellH}px`;
        grid.style.gap = `${gap}px`;
        for (const f of frames.slice(i, i + per)) {
          const box = el('div', 'pe-print-slidebox');
          box.style.width = `${W * s}px`;
          box.style.height = `${H * s}px`;
          const node = renderFrame(f);
          node.style.transform = `scale(${s})`;
          node.style.transformOrigin = '0 0';
          box.appendChild(node);
          grid.appendChild(box);
          laid.push([node, f.slide]);
          if (withLines) {
            const lines = el('div', 'pe-print-lines');
            for (let k = 0; k < 6; k++) lines.appendChild(el('div', 'pe-print-line'));
            grid.appendChild(lines);
          }
        }
        page.appendChild(grid);
        root.appendChild(page);
      }
    }
  }
  await fontsReady();
  await waitForImages(root);
  for (const [node, slide] of laid) {
    try {
      layoutSlide(node, doc, slide);
    } catch {
      /* keep going */
    }
  }
  const pageCss = layout === 'slides'
    ? `@page { size: ${(W / 96).toFixed(4)}in ${(H / 96).toFixed(4)}in; margin: 0; }`
    : `@page { size: ${PAPER[opts.paper || defaultPaper()].css} portrait; margin: 0; }`;
  return { root, pageCss };
}

// Opens the print dialog for the print view. Resolves once the dialog closed.
export async function printPdf(doc, slideIds, assetUrl, opts = {}) {
  const { root, pageCss } = await buildPrintView(doc, slideIds, assetUrl, opts);
  let sheet = null;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(pageCss);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    sheet = null;
  }
  const prevTitle = document.title;
  document.title = doc.metadata.title;
  document.documentElement.classList.add('pe-printing');
  const cleanup = () => {
    document.documentElement.classList.remove('pe-printing');
    document.title = prevTitle;
    root.remove();
    if (sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
  };
  await new Promise((r) => setTimeout(r, 50));
  try {
    window.print();
  } finally {
    // Chromium and Firefox block in print(); afterprint also fires.
    // (Automated tests set __PE_KEEP_PRINT_VIEW__ to inspect the print view.)
    if (!window.__PE_KEEP_PRINT_VIEW__) setTimeout(cleanup, 500);
  }
}
