// The shared slide renderer (spec §3.2). One function of (document, slide,
// render context) → DOM, used by the editor, viewer, thumbnails, print view,
// image export and exported HTML.
import { h, s, px, r2, setStyles, fitPx } from './dom.js';
import { applyCssFill, svgPaint, strokeAttrs, shadowFilter, color, cssBorderStyle } from './paint.js';
import { renderTextFlow } from './text.js';
import { renderChartSvg, chartDataTable } from './chart-svg.js';
import { renderTable } from './table.js';
import { shapePath, shapeTextRect, getShape, shapeAdjust } from '../core/shapes.js';
import { containerBaseStyle } from '../core/theme.js';
import { readingOrder, isRtlLanguage, isPlaceholder } from '../core/reading-order.js';
import { worldMap, connectorPath, geometryKind, IDENTITY } from '../core/geometry.js';
import { finalVisibility, visibilityAt } from '../core/builds.js';
import { resolveSlideTitle } from '../core/titles.js';
import { defaultAltText } from '../core/charts.js';
import { fieldContext } from '../core/fields.js';
import { slideOrder } from '../core/model.js';

// ctx: { dom, doc, mode, assetUrl(id), assetInfo(id), fieldCtx, step, visibility,
//        interactiveLinks, a11y, slideNumberOf(id), showPrompts }
export function makeContext(doc, overrides = {}) {
  const order = slideOrder(doc);
  return {
    dom: globalThis.document,
    doc,
    mode: 'view',
    assetUrl: () => null,
    assetInfo: (id) => (doc.assets || []).find((a) => a.id === id) || null,
    interactiveLinks: false,
    a11y: false,
    slideNumberOf: (id) => order.indexOf(id) + 1 || null,
    ...overrides,
  };
}

function elementBoxStyle(wrapper, g, { autoHeight = false } = {}) {
  setStyles(wrapper, {
    left: px(g.x),
    top: px(g.y),
    width: px(g.width),
  });
  if (autoHeight) wrapper.style.minHeight = px(g.height);
  else wrapper.style.height = px(g.height);
  const parts = [];
  if (g.rotation) parts.push(`rotate(${r2(g.rotation)}deg)`);
  if (g.flip_x || g.flip_y) parts.push(`scale(${g.flip_x ? -1 : 1}, ${g.flip_y ? -1 : 1})`);
  if (parts.length) {
    wrapper.style.transform = parts.join(' ');
    wrapper.style.transformOrigin = `${px(g.width / 2)} ${px(g.height / 2)}`;
  }
}

function applyCommon(wrapper, el, ctx, index) {
  wrapper.dataset.elId = el.id;
  wrapper.dataset.type = el.type;
  wrapper.style.zIndex = String(index + 1);
  if (el.opacity !== undefined && el.opacity !== 1) wrapper.style.opacity = String(el.opacity);
  if (ctx.a11y && el.link) {
    if (el.link.kind === 'url') wrapper.dataset.linkUrl = el.link.href;
    else if (el.link.kind === 'slide') wrapper.dataset.linkSlide = el.link.slide_id;
    else wrapper.dataset.linkNav = el.link.target;
    wrapper.classList.add('pe-has-link');
    wrapper.setAttribute('role', 'link');
    wrapper.tabIndex = 0;
    if (el.accessibility?.alt) wrapper.setAttribute('aria-label', el.accessibility.alt);
  }
  if (el.type === 'image' || el.type === 'shape' || el.type === 'line' || el.type === 'connector') {
    if (ctx.mode === 'edit') wrapper.draggable = false;
  }
}

function semanticFor(el, ctx) {
  if (!ctx.a11y) return null;
  if (el.role === 'title' && ctx.titleElementId === el.id) return 'h2';
  if (el.role === 'heading') return 'h3';
  return null;
}

// ---------- element renderers ----------

function renderText(el, ctx, index) {
  const dom = ctx.dom;
  const theme = ctx.doc.theme;
  const autofit = el.text.box?.autofit || 'none';
  const w = h(dom, 'div', 'pe-el pe-el-text');
  applyCommon(w, el, ctx, index);
  elementBoxStyle(w, el.geometry, { autoHeight: autofit === 'grow' });
  if (autofit === 'shrink') w.dataset.autofit = 'shrink';
  if (autofit === 'grow') w.dataset.autofit = 'grow';
  const insets = el.text.box?.insets || theme.defaults.text_box.insets;
  setStyles(w, { paddingLeft: px(insets.left), paddingRight: px(insets.right), paddingTop: px(insets.top), paddingBottom: px(insets.bottom) });
  const base = containerBaseStyle(theme, { kind: 'text', role: el.role, defaults: el.text.defaults });
  const va = el.text.box?.vertical_align || base.vertical || 'top';
  w.style.justifyContent = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[va];
  if (el.style?.fill && el.style.fill !== 'none') applyCssFill(w, el.style.fill, theme, ctx);
  if (el.style?.stroke && el.style.stroke !== 'none' && el.style.stroke.width) {
    const f = h(dom, 'div', 'pe-frame');
    f.setAttribute('aria-hidden', 'true');
    setStyles(f, { borderWidth: px(el.style.stroke.width), borderStyle: cssBorderStyle(el.style.stroke.dash), borderColor: color(el.style.stroke.color, theme) });
    w.appendChild(f);
  }
  const { flow } = renderTextFlow(ctx, el.text, { kind: 'text', role: el.role, semantic: semanticFor(el, ctx) });
  if (el.style?.shadow && el.style.shadow !== 'none') {
    const sh = el.style.shadow;
    flow.style.textShadow = `${r2(sh.offset_x)}px ${r2(sh.offset_y)}px ${r2(sh.blur)}px ${color(sh.color, theme)}`;
  }
  w.appendChild(flow);
  return w;
}

function shapeSvg(ctx, el, width, height, defsHost) {
  const dom = ctx.dom;
  const theme = ctx.doc.theme;
  const sd = theme.defaults.shape;
  const svg = s(dom, 'svg', { class: 'pe-shape-svg', width: r2(width), height: r2(height), viewBox: `0 0 ${r2(width)} ${r2(height)}`, overflow: 'visible' });
  svg.setAttribute('aria-hidden', 'true');
  const defs = s(dom, 'defs');
  const fill = el.style?.fill ?? sd.fill;
  const stroke = el.style?.stroke ?? sd.stroke;
  const paint = svgPaint(dom, defs, fill, theme, ctx, { width, height }, el.id);
  const path = s(dom, 'path', { d: shapePath(el.shape.preset, el.shape.adjust, width, height), fill: paint, ...strokeAttrs(stroke, theme) });
  if (getShape(el.shape.preset).evenOdd) path.setAttribute('fill-rule', 'evenodd');
  if (defs.childNodes.length) svg.appendChild(defs);
  svg.appendChild(path);
  (defsHost || svg);
  return svg;
}

function renderShape(el, ctx, index) {
  const dom = ctx.dom;
  const theme = ctx.doc.theme;
  const g = el.geometry;
  const w = h(dom, 'div', 'pe-el pe-el-shape');
  applyCommon(w, el, ctx, index);
  elementBoxStyle(w, g);
  const shadow = shadowFilter(el.style?.shadow, theme);
  const svg = shapeSvg(ctx, el, g.width, g.height);
  if (shadow) svg.style.filter = shadow;
  w.appendChild(svg);
  if (el.shape.text) {
    const autofit = el.shape.text.box?.autofit || 'none';
    if (autofit === 'grow') w.dataset.autofit = 'grow-shape';
    if (autofit === 'shrink') w.dataset.autofit = 'shrink';
    const tr = shapeTextRect(el.shape.preset, el.shape.adjust, g.width, g.height);
    const box = h(dom, 'div', 'pe-shape-text');
    const insets = el.shape.text.box?.insets || theme.defaults.text_box.insets;
    setStyles(box, {
      left: px(tr.x), top: px(tr.y), width: px(tr.width), height: px(tr.height),
      paddingLeft: px(insets.left), paddingRight: px(insets.right), paddingTop: px(insets.top), paddingBottom: px(insets.bottom),
    });
    const base = containerBaseStyle(theme, { kind: 'shape', role: el.role, defaults: el.shape.text.defaults });
    const va = el.shape.text.box?.vertical_align || base.vertical || 'middle';
    box.style.justifyContent = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[va];
    const { flow } = renderTextFlow(ctx, el.shape.text, { kind: 'shape', role: el.role, semantic: semanticFor(el, ctx) });
    box.appendChild(flow);
    w.appendChild(box);
  } else if (ctx.a11y) {
    if (el.accessibility?.alt && !el.accessibility?.decorative) {
      w.setAttribute('role', 'img');
      w.setAttribute('aria-label', el.accessibility.alt);
    } else if (!el.link) w.setAttribute('aria-hidden', 'true');
  }
  return w;
}

function renderImage(el, ctx, index) {
  const dom = ctx.dom;
  const theme = ctx.doc.theme;
  const g = el.geometry;
  const w = h(dom, 'div', 'pe-el pe-el-image');
  applyCommon(w, el, ctx, index);
  elementBoxStyle(w, g);
  const assetId = el.image.asset_id;
  if (!assetId) {
    if (ctx.mode === 'edit') {
      w.classList.add('pe-image-slot');
      const lab = h(dom, 'div', 'pe-slot-label');
      lab.textContent = 'Drop an image here';
      w.appendChild(lab);
    } else w.style.display = 'none';
    return w;
  }
  const defaults = theme.defaults.image;
  const stroke = el.style?.stroke ?? defaults.stroke;
  const shadow = shadowFilter(el.style?.shadow ?? defaults.shadow, theme);
  if (shadow) w.style.filter = shadow;
  const clip = h(dom, 'div', 'pe-img-clip');
  let maskPath = null;
  if (el.image.mask) {
    maskPath = shapePath(el.image.mask.preset, el.image.mask.adjust, g.width, g.height);
    clip.style.clipPath = `path('${maskPath}')`;
  }
  const img = h(dom, 'img', 'pe-img');
  const url = ctx.assetUrl(assetId);
  if (url) img.src = url;
  img.decoding = 'async';
  img.draggable = false;
  const cr = el.image.crop || { left: 0, top: 0, right: 0, bottom: 0 };
  const iw = g.width / Math.max(0.001, 1 - cr.left - cr.right);
  const ih = g.height / Math.max(0.001, 1 - cr.top - cr.bottom);
  setStyles(img, { width: px(iw), height: px(ih), left: px(-cr.left * iw), top: px(-cr.top * ih) });
  if (ctx.a11y) {
    img.alt = el.accessibility?.decorative ? '' : el.accessibility?.alt || '';
  } else img.alt = '';
  clip.appendChild(img);
  w.appendChild(clip);
  if (stroke && stroke !== 'none' && stroke.width) {
    const bsvg = s(dom, 'svg', { class: 'pe-img-border', width: r2(g.width), height: r2(g.height), viewBox: `0 0 ${r2(g.width)} ${r2(g.height)}`, overflow: 'visible' });
    bsvg.setAttribute('aria-hidden', 'true');
    bsvg.appendChild(s(dom, 'path', { d: maskPath || `M0 0H${r2(g.width)}V${r2(g.height)}H0Z`, fill: 'none', ...strokeAttrs(stroke, theme) }));
    w.appendChild(bsvg);
  }
  return w;
}

const ARROW_SCALE = { small: 2, medium: 3, large: 4.5 };

function arrowhead(dom, head, tip, from, sw, strokeColor) {
  if (!head || head.kind === 'none') return { node: null, pullback: 0 };
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const L = Math.max(6, sw * (ARROW_SCALE[head.size || 'medium'] || 3));
  const W = L * 0.9;
  const P = (a, b) => `${r2(tip.x - ux * a + nx * b)} ${r2(tip.y - uy * a + ny * b)}`;
  switch (head.kind) {
    case 'arrow':
      return { node: s(dom, 'path', { d: `M${P(L, W / 2)}L${P(0, 0)}L${P(L, -W / 2)}`, fill: 'none', stroke: strokeColor, 'stroke-width': r2(sw), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }), pullback: 0 };
    case 'triangle':
      return { node: s(dom, 'path', { d: `M${P(0, 0)}L${P(L, W / 2)}L${P(L, -W / 2)}Z`, fill: strokeColor }), pullback: L * 0.9 };
    case 'stealth':
      return { node: s(dom, 'path', { d: `M${P(0, 0)}L${P(L, W / 2)}L${P(L * 0.62, 0)}L${P(L, -W / 2)}Z`, fill: strokeColor }), pullback: L * 0.6 };
    case 'oval':
      return { node: s(dom, 'ellipse', { cx: r2(tip.x), cy: r2(tip.y), rx: r2(W / 2), ry: r2(W / 2), fill: strokeColor }), pullback: 0 };
    case 'diamond':
      return { node: s(dom, 'path', { d: `M${P(-L / 2, 0)}L${P(0, W / 2)}L${P(L / 2, 0)}L${P(0, -W / 2)}Z`, fill: strokeColor }), pullback: 0 };
    default:
      return { node: null, pullback: 0 };
  }
}

function renderLine(el, ctx, index, world) {
  const dom = ctx.dom;
  const theme = ctx.doc.theme;
  const pts = connectorPath(el, world);
  const pad = 40;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const width = Math.max(...xs) - minX + pad;
  const height = Math.max(...ys) - minY + pad;
  const svg = s(dom, 'svg', { class: 'pe-el pe-el-line', width: r2(width), height: r2(height), viewBox: `${r2(minX)} ${r2(minY)} ${r2(width)} ${r2(height)}`, overflow: 'visible' });
  applyCommon(svg, el, ctx, index);
  setStyles(svg, { left: px(minX), top: px(minY), width: px(width), height: px(height) });
  const ld = theme.defaults.line;
  const stroke = el.style?.stroke ?? ld.stroke;
  const heads = el.style?.arrowheads ?? ld.arrowheads;
  const attrs = strokeAttrs(stroke, theme);
  const sw = stroke && stroke !== 'none' ? stroke.width : 0;
  const strokeColor = attrs.stroke;
  const path = pts.map((p) => ({ ...p }));
  const g = s(dom, 'g');
  if (strokeColor !== 'none' && path.length >= 2) {
    const a = arrowhead(dom, heads?.end, path[path.length - 1], path[path.length - 2], sw, strokeColor);
    const b = arrowhead(dom, heads?.start, path[0], path[1], sw, strokeColor);
    const pull = (arr, i, j, amount) => {
      if (!amount) return;
      const dx = arr[i].x - arr[j].x;
      const dy = arr[i].y - arr[j].y;
      const l = Math.hypot(dx, dy) || 1;
      const k = Math.min(amount, l - 0.5) / l;
      arr[i] = { x: arr[i].x - dx * k, y: arr[i].y - dy * k };
    };
    pull(path, path.length - 1, path.length - 2, a.pullback);
    pull(path, 0, 1, b.pullback);
    const d = path.map((p, i) => `${i ? 'L' : 'M'}${r2(p.x)} ${r2(p.y)}`).join('');
    g.appendChild(s(dom, 'path', { d, fill: 'none', ...attrs }));
    if (a.node) g.appendChild(a.node);
    if (b.node) g.appendChild(b.node);
  }
  // Wide invisible hit path for the editor.
  const dHit = pts.map((p, i) => `${i ? 'L' : 'M'}${r2(p.x)} ${r2(p.y)}`).join('');
  const hit = s(dom, 'path', { d: dHit, fill: 'none', stroke: 'transparent', 'stroke-width': 12, class: 'pe-line-hit' });
  svg.append(g, hit);
  const shadow = shadowFilter(el.style?.shadow, theme);
  if (shadow) g.style.filter = shadow;
  if (ctx.a11y) {
    if (el.accessibility?.alt && !el.accessibility?.decorative) {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', el.accessibility.alt);
    } else if (!el.link) svg.setAttribute('aria-hidden', 'true');
  }
  return svg;
}

function renderChart(el, ctx, index) {
  const dom = ctx.dom;
  const theme = ctx.doc.theme;
  const g = el.geometry;
  const w = h(dom, 'div', 'pe-el pe-el-chart');
  applyCommon(w, el, ctx, index);
  elementBoxStyle(w, g);
  if (el.style?.fill && el.style.fill !== 'none') applyCssFill(w, el.style.fill, theme, ctx);
  if (el.style?.stroke && el.style.stroke !== 'none' && el.style.stroke.width) {
    const f = h(dom, 'div', 'pe-frame');
    setStyles(f, { borderWidth: px(el.style.stroke.width), borderStyle: cssBorderStyle(el.style.stroke.dash), borderColor: color(el.style.stroke.color, theme) });
    w.appendChild(f);
  }
  const shadow = shadowFilter(el.style?.shadow, theme);
  if (shadow) w.style.filter = shadow;
  const svg = renderChartSvg(ctx, el.chart, g.width, g.height, { idBase: el.id });
  w.appendChild(svg);
  if (ctx.a11y) {
    const lang = ctx.doc.metadata?.language;
    if (el.accessibility?.decorative) svg.setAttribute('aria-hidden', 'true');
    else {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', el.accessibility?.alt || defaultAltText(el.chart, lang));
      const table = chartDataTable(dom, el.chart, lang);
      table.id = `pe-data-${el.id}`;
      svg.setAttribute('aria-describedby', table.id);
      w.appendChild(table);
    }
  } else svg.setAttribute('aria-hidden', 'true');
  return w;
}

function renderVideo(el, ctx, index) {
  const dom = ctx.dom;
  const theme = ctx.doc.theme;
  const g = el.geometry;
  const v = el.video;
  const w = h(dom, 'div', 'pe-el pe-el-video');
  applyCommon(w, el, ctx, index);
  elementBoxStyle(w, g);
  const shadow = shadowFilter(el.style?.shadow, theme);
  if (shadow) w.style.filter = shadow;
  const posterUrl = v.poster_asset_id ? ctx.assetUrl(v.poster_asset_id) : null;
  const live = ctx.mode === 'view' && ctx.playMedia !== false;
  if (live) {
    const video = h(dom, 'video', 'pe-video');
    const src = ctx.assetUrl(v.asset_id);
    if (src) video.src = src;
    if (posterUrl) video.poster = posterUrl;
    video.preload = ctx.preloadMedia ? 'metadata' : 'none';
    video.playsInline = true;
    video.muted = !!v.muted;
    video.loop = !!v.loop;
    video.style.objectFit = v.fit === 'cover' ? 'cover' : 'contain';
    if ((v.controls || 'auto') === 'show') video.controls = true;
    video.dataset.controls = v.controls || 'auto';
    video.dataset.start = v.start || 'manual';
    if (v.trim_start_ms) video.dataset.trimStart = String(v.trim_start_ms);
    if (v.trim_end_ms) video.dataset.trimEnd = String(v.trim_end_ms);
    if (v.captions_asset_id) video.dataset.captions = v.captions_asset_id;
    if (ctx.a11y && el.accessibility?.alt) video.setAttribute('aria-label', el.accessibility.alt);
    w.appendChild(video);
  } else {
    if (posterUrl) {
      const img = h(dom, 'img', 'pe-video-poster');
      img.src = posterUrl;
      img.alt = '';
      img.draggable = false;
      img.style.objectFit = v.fit === 'cover' ? 'cover' : 'contain';
      w.appendChild(img);
    } else w.classList.add('pe-video-empty');
    if (ctx.mode === 'edit') {
      const play = h(dom, 'div', 'pe-video-badge');
      play.setAttribute('aria-hidden', 'true');
      w.appendChild(play);
    }
  }
  if (el.style?.stroke && el.style.stroke !== 'none' && el.style.stroke.width) {
    const f = h(dom, 'div', 'pe-frame');
    setStyles(f, { borderWidth: px(el.style.stroke.width), borderStyle: cssBorderStyle(el.style.stroke.dash), borderColor: color(el.style.stroke.color, theme) });
    w.appendChild(f);
  }
  return w;
}

function renderGroup(el, ctx, index, world) {
  const dom = ctx.dom;
  const w = h(dom, 'div', 'pe-el pe-el-group');
  applyCommon(w, el, ctx, index);
  elementBoxStyle(w, el.geometry);
  if (ctx.a11y && el.accessibility?.alt && !el.accessibility.decorative) {
    w.setAttribute('role', 'group');
    w.setAttribute('aria-label', el.accessibility.alt);
  }
  const children = el.group.children;
  const order = ctx.a11y ? readingOrder({ elements: children }, { rtl: ctx.rtl, includeEmpty: ctx.mode === 'edit' }) : children;
  const indexOf = new Map(children.map((c, i) => [c.id, i]));
  const rendered = new Set();
  for (const c of order) {
    const node = renderElement(c, ctx, indexOf.get(c.id), world);
    if (node) w.appendChild(node);
    rendered.add(c.id);
  }
  for (const c of children) {
    if (rendered.has(c.id)) continue;
    const node = renderElement(c, ctx, indexOf.get(c.id), world);
    if (node) {
      if (ctx.a11y) node.setAttribute('aria-hidden', 'true');
      w.appendChild(node);
    }
  }
  return w;
}

export function renderElement(el, ctx, index, world) {
  if (el.hidden && !ctx.showHidden) return null;
  if (ctx.mode !== 'edit' && isPlaceholder(el)) return null;
  let node;
  switch (el.type) {
    case 'text': node = renderText(el, ctx, index); break;
    case 'shape': node = renderShape(el, ctx, index); break;
    case 'image': node = renderImage(el, ctx, index); break;
    case 'line':
    case 'connector': node = renderLine(el, ctx, index, world); break;
    case 'table': node = renderTable(el, ctx, index, applyCommon); break;
    case 'chart': node = renderChart(el, ctx, index); break;
    case 'video': node = renderVideo(el, ctx, index); break;
    case 'group': node = renderGroup(el, ctx, index, world); break;
    default: return null;
  }
  const vis = ctx.visibility?.get(el.id);
  if (vis) {
    if (vis.hidden) {
      node.style.visibility = 'hidden';
      node.dataset.buildHidden = '1';
    }
    if (vis.paragraphMode) {
      for (const p of node.querySelectorAll('[data-pgroup]')) {
        const gi = Number(p.dataset.pgroup);
        const shown = vis.paragraphsShown?.has(gi) && !vis.paragraphsHidden?.has(gi);
        if (!shown) {
          p.style.visibility = 'hidden';
          p.dataset.buildHidden = '1';
        }
      }
    }
  }
  if (el.hidden) node.classList.add('pe-hidden-el');
  return node;
}

function renderLayer(elements, ctx, cls, world) {
  const dom = ctx.dom;
  const layer = h(dom, 'div', `pe-layer ${cls}`);
  const indexOf = new Map(elements.map((e, i) => [e.id, i]));
  if (ctx.a11y) {
    const order = readingOrder({ elements, reading_order: ctx.readingOrder }, { rtl: ctx.rtl, includeEmpty: false });
    const done = new Set();
    for (const el of order) {
      const node = renderElement(el, ctx, indexOf.get(el.id), world);
      if (node) layer.appendChild(node);
      done.add(el.id);
    }
    for (const el of elements) {
      if (done.has(el.id)) continue;
      const node = renderElement(el, ctx, indexOf.get(el.id), world);
      if (node) {
        node.setAttribute('aria-hidden', 'true');
        layer.appendChild(node);
      }
    }
  } else {
    elements.forEach((el, i) => {
      const node = renderElement(el, ctx, i, world);
      if (node) layer.appendChild(node);
    });
  }
  return layer;
}

// Renders a slide. Returns the root element (not yet attached).
export function renderSlide(doc, slide, ctxIn = {}) {
  const ctx = { ...makeContext(doc), ...ctxIn, doc };
  const dom = ctx.dom;
  const W = doc.size.width;
  const H = doc.size.height;
  ctx.rtl = isRtlLanguage(doc.metadata?.language);
  if (!ctx.fieldCtx) ctx.fieldCtx = fieldContext(doc, slide.id);
  if (ctx.visibility === undefined) {
    if (ctx.mode === 'view' && typeof ctx.step === 'number') ctx.visibility = visibilityAt(slide, ctx.step);
    else if (ctx.mode === 'edit') ctx.visibility = null;
    else ctx.visibility = finalVisibility(slide);
  }
  const root = h(dom, ctx.a11y ? 'section' : 'div', 'pe-slide');
  root.dataset.slideId = slide.id;
  root.dataset.mode = ctx.mode;
  setStyles(root, { width: px(W), height: px(H) });
  if (ctx.a11y) {
    root.setAttribute('aria-roledescription', 'slide');
    const title = resolveSlideTitle(slide, { rtl: ctx.rtl });
    const n = ctx.slideNumberOf(slide.id);
    const total = ctx.slideTotal || slideOrder(doc).length;
    root.setAttribute('aria-label', `Slide ${n} of ${total}${title ? `: ${title}` : ''}`);
    const titleEl = readingOrder(slide, { rtl: ctx.rtl }).find((e) => e.role === 'title');
    ctx.titleElementId = titleEl?.id || null;
    ctx.readingOrder = slide.reading_order;
    if (!titleEl && title) {
      const hTitle = h(dom, 'h2', 'pe-sr-only');
      hTitle.textContent = title;
      root.appendChild(hTitle);
    }
  }
  const bg = h(dom, 'div', 'pe-bg');
  bg.setAttribute('aria-hidden', 'true');
  applyCssFill(bg, slide.background ?? doc.theme.background, doc.theme, ctx);
  root.appendChild(bg);

  let footerEls = [];
  if (slide.show_master !== false && doc.master?.elements?.length) {
    const masterWorld = worldMap(doc.master.elements);
    const mctx = { ...ctx, visibility: null, readingOrder: null, titleElementId: null, a11y: false };
    // Master elements are hidden from assistive technology, except footer
    // text, which is read after the slide's content (spec §5.11).
    const main = ctx.a11y ? doc.master.elements.filter((e) => e.role !== 'footer') : doc.master.elements;
    footerEls = ctx.a11y ? doc.master.elements.filter((e) => e.role === 'footer') : [];
    const layer = renderLayer(main, mctx, 'pe-layer-master', masterWorld);
    layer.style.zIndex = '0';
    if (ctx.a11y) layer.setAttribute('aria-hidden', 'true');
    root.appendChild(layer);
    ctx.masterWorld = masterWorld;
  }

  const world = worldMap(slide.elements);
  ctx.world = world;
  const content = renderLayer(slide.elements, ctx, 'pe-layer-content', world);
  content.style.zIndex = '1';
  root.appendChild(content);
  if (footerEls.length) {
    const fl = renderLayer(footerEls, { ...ctx, visibility: null, readingOrder: null, titleElementId: null }, 'pe-layer-footer', ctx.masterWorld);
    fl.style.zIndex = '0';
    root.appendChild(fl);
  }
  return root;
}

// ---------- post-layout pass ----------

// Runs after the slide is attached and fonts are ready: shrink-to-fit, growing
// shapes, connector re-routing to rendered boxes, and overflow detection.
export function layoutSlide(root, doc, slide, ctxIn = {}) {
  const measured = new Map();
  const overflow = new Set();
  // shrink-to-fit
  for (const w of root.querySelectorAll('[data-autofit="shrink"]')) {
    const target = w.classList.contains('pe-el-shape') ? w.querySelector('.pe-shape-text') : w;
    const flow = target.querySelector('.pe-flow');
    if (!flow) continue;
    const avail = () => target.clientHeight - parseFloat(getComputedStyle(target).paddingTop) - parseFloat(getComputedStyle(target).paddingBottom);
    const fits = () => flow.scrollHeight <= avail() + 0.5 && flow.scrollWidth <= target.clientWidth + 0.5;
    target.style.setProperty('--pe-fit', '1');
    if (fits()) continue;
    let lo = 25;
    let hi = 100;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      target.style.setProperty('--pe-fit', String(mid / 100));
      if (fits()) lo = mid;
      else hi = mid - 1;
    }
    target.style.setProperty('--pe-fit', String(lo / 100));
    if (!fits()) overflow.add(w.dataset.elId);
  }
  // shapes that grow with their text
  for (const w of root.querySelectorAll('[data-autofit="grow-shape"]')) {
    const id = w.dataset.elId;
    const el = findEl(doc, slide, id, ctxIn);
    if (!el) continue;
    const box = w.querySelector('.pe-shape-text');
    const flow = box?.querySelector('.pe-flow');
    if (!flow) continue;
    const cs = getComputedStyle(box);
    const need = flow.scrollHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const g = el.geometry;
    let hgt = g.height;
    for (let i = 0; i < 4; i++) {
      const tr = shapeTextRect(el.shape.preset, el.shape.adjust, g.width, hgt);
      if (tr.height >= need - 0.5) break;
      hgt += need - tr.height;
    }
    if (hgt > g.height + 0.5) {
      w.style.height = px(hgt);
      const svg = w.querySelector('.pe-shape-svg');
      const path = svg.querySelector('path');
      svg.setAttribute('height', r2(hgt));
      svg.setAttribute('viewBox', `0 0 ${r2(g.width)} ${r2(hgt)}`);
      path.setAttribute('d', shapePath(el.shape.preset, el.shape.adjust, g.width, hgt));
      const tr = shapeTextRect(el.shape.preset, el.shape.adjust, g.width, hgt);
      setStyles(box, { top: px(tr.y), height: px(tr.height) });
      measured.set(id, { width: g.width, height: hgt });
    }
  }
  // grow text, tables: measure rendered size
  for (const w of root.querySelectorAll('.pe-layer-content [data-autofit="grow"], .pe-layer-content .pe-el-table, .pe-layer-master [data-autofit="grow"]')) {
    const id = w.dataset.elId;
    measured.set(id, { width: w.offsetWidth, height: w.offsetHeight });
  }
  // fixed boxes: overflow detection
  for (const w of root.querySelectorAll('.pe-el-text:not([data-autofit])')) {
    const flow = w.querySelector('.pe-flow');
    if (!flow) continue;
    const cs = getComputedStyle(w);
    const avail = w.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (flow.scrollHeight > avail + 1) overflow.add(w.dataset.elId);
  }
  for (const w of root.querySelectorAll('.pe-el-shape:not([data-autofit])')) {
    const box = w.querySelector('.pe-shape-text');
    const flow = box?.querySelector('.pe-flow');
    if (!flow) continue;
    const cs = getComputedStyle(box);
    if (flow.scrollHeight > box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) + 1) overflow.add(w.dataset.elId);
  }
  // connectors attached to grown elements follow the rendered boxes
  const hasConnector = (els) => els.some((e) => e.type === 'connector' || (e.type === 'group' && hasConnector(e.group.children)));
  if (measured.size && hasConnector(slide.elements)) {
    const world = worldMap(slide.elements, IDENTITY, new Map(), measured);
    const ctx = { ...makeContext(doc), ...ctxIn, doc };
    rerenderConnectors(root, slide.elements, world, ctx);
  }
  for (const id of overflow) {
    const n = root.querySelector(`[data-el-id="${id}"]`);
    if (n) n.dataset.overflow = '1';
  }
  return { measured, overflow };
}

function findEl(doc, slide, id, ctxIn) {
  const lists = [slide.elements, doc.master?.elements || []];
  for (const list of lists) {
    const stack = [...list];
    while (stack.length) {
      const e = stack.pop();
      if (e.id === id) return e;
      if (e.type === 'group') stack.push(...e.group.children);
    }
  }
  return ctxIn.findElement?.(id) || null;
}

function rerenderConnectors(root, elements, world, ctx) {
  const visit = (els) => {
    els.forEach((el, i) => {
      if (el.type === 'connector') {
        const old = root.querySelector(`.pe-layer-content [data-el-id="${el.id}"]`);
        if (old) {
          const node = renderLine(el, ctx, i, world);
          node.style.visibility = old.style.visibility;
          if (old.getAttribute('aria-hidden')) node.setAttribute('aria-hidden', old.getAttribute('aria-hidden'));
          old.replaceWith(node);
        }
      }
      if (el.type === 'group') visit(el.group.children);
    });
  };
  visit(elements);
}

export { geometryKind, fitPx, shapeAdjust };
