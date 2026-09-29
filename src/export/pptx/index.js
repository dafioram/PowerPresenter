// One-way PowerPoint export (spec §15.6). Editable output: native shapes, text,
// tables, charts, pictures, connectors, groups, notes, sections, transitions
// and animations. Measured values (grown boxes, shrink-to-fit scale, table
// rows) come from the shared renderer.
import { renderSlide, layoutSlide } from '../../render/renderer.js';
import { fontsReady } from '../../render/fonts.js';
import { slideOrder, walk } from '../../core/model.js';
import { SHAPE_MAP, shapeAdjust } from '../../core/shapes.js';
import { worldMap, resolveEndWorld, apply, invert, IDENTITY, geometryKind } from '../../core/geometry.js';
import { tableGrid } from '../../core/tables.js';
import { fieldContext } from '../../core/fields.js';
import { titleElement } from '../../core/titles.js';
import { isRtlLanguage, isPlaceholder } from '../../core/reading-order.js';
import { isBodyEmpty } from '../../core/text.js';
import { writeZip } from '../../io/zip.js';
import { esc, emu, fillXml, lineXml, shadowXml, xfrmXml, paragraphsXml, bodyPrXml, solidFill } from './drawing.js';
import { chartXml, buildWorkbook } from './chart.js';
import { timingXml } from './timing.js';
import { REL, CT, XML_HEAD, NSDECL, EMPTY_GRP, relsXml, contentTypesXml, themeXml, masterXml, layoutXml, notesMasterXml, notesSlideXml, presentationXml, presPropsXml, viewPropsXml, tableStylesXml, coreXml, appXml } from './parts.js';
import { assetIdsForSlides, safeName } from '../common.js';

const RECT_SITES = { top: 0, left: 1, bottom: 2, right: 3 };
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4' };

// ---------- media ----------
function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = url;
  });
}

async function rasterize(blob, width, height, type = 'image/png') {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImg(url);
    const w0 = width || img.naturalWidth || 800;
    const h0 = height || img.naturalHeight || 600;
    const s = Math.min(1, 2048 / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w0 * s * (blob.type === 'image/svg+xml' ? 2 : 1)));
    canvas.height = Math.max(1, Math.round(h0 * s * (blob.type === 'image/svg+xml' ? 2 : 1)));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((res) => canvas.toBlob(res, type));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function solidPng(w = 16, h = 9) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d');
  c.fillStyle = '#000';
  c.fillRect(0, 0, w, h);
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

class Package {
  constructor(doc, getAssetBlob) {
    this.doc = doc;
    this.getAssetBlob = getAssetBlob;
    this.files = [];
    this.media = new Map(); // assetId → { path, fallback? }
    this.mediaSeq = 0;
    this.chartSeq = 0;
    this.overrides = [];
    this.defaults = {};
  }

  add(name, data, ct = null) {
    this.files.push({ name, data, compress: typeof data === 'string' || name.endsWith('.xlsx') === false });
    if (ct) this.overrides.push([`/${name}`, ct]);
  }

  addMediaFile(blob, ext) {
    const name = `ppt/media/${ext === 'mp4' ? 'media' : 'image'}${++this.mediaSeq}.${ext}`;
    this.files.push({ name, data: blob, compress: false });
    this.defaults[ext] = ext === 'mp4' ? 'video/mp4' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
    return name;
  }

  async prepareMedia(ids) {
    for (const id of ids) {
      if (this.media.has(id)) continue;
      const rec = this.doc.assets.find((a) => a.id === id);
      if (!rec || rec.kind === 'font' || rec.kind === 'captions') continue;
      const blob = await this.getAssetBlob(id);
      if (!blob) continue;
      try {
        if (rec.kind === 'video') {
          if (rec.media_type === 'video/mp4') this.media.set(id, { path: this.addMediaFile(blob, 'mp4'), video: true });
          continue;
        }
        if (rec.media_type === 'image/svg+xml') {
          const png = await rasterize(blob, rec.width, rec.height);
          this.media.set(id, { path: this.addMediaFile(png, 'png'), svg: this.addMediaFile(blob, 'svg') });
        } else if (EXT_BY_MIME[rec.media_type]) {
          this.media.set(id, { path: this.addMediaFile(blob, EXT_BY_MIME[rec.media_type]) });
        } else {
          const png = await rasterize(blob, rec.width, rec.height);
          this.media.set(id, { path: this.addMediaFile(png, 'png') });
        }
      } catch {
        /* unreadable media is left out */
      }
    }
    this.blackPoster = this.addMediaFile(await solidPng(), 'png');
  }
}

// Relationships and shape IDs for one part.
class PartWriter {
  constructor(pkg, relDir = '..') {
    this.pkg = pkg;
    this.rels = [];
    this.relKeys = new Map();
    this.ids = new Map();
    this.nextId = 2;
    this.relDir = relDir;
  }

  rel(type, target, external = false) {
    const key = `${type}|${target}|${external}`;
    if (this.relKeys.has(key)) return this.relKeys.get(key);
    const id = `rId${this.rels.length + 1}`;
    this.rels.push({ id, type, target, external });
    this.relKeys.set(key, id);
    return id;
  }

  imageRel(assetId) {
    const m = this.pkg.media.get(assetId);
    if (!m) return null;
    return this.rel(REL.image, `../media/${m.path.split('/').pop()}`);
  }

  shapeId(elId) {
    if (!this.ids.has(elId)) this.ids.set(elId, this.nextId++);
    return this.ids.get(elId);
  }
}

// ---------- measurement (renderer) ----------
async function measure(doc, slideIds) {
  const host = document.createElement('div');
  host.className = 'pe-offscreen';
  document.body.appendChild(host);
  const out = new Map();
  try {
    await fontsReady();
    for (const id of slideIds) {
      const slide = doc.slides[id];
      const root = renderSlide(doc, { ...slide, builds: undefined }, { mode: 'print', assetUrl: () => null });
      host.replaceChildren(root);
      const r = { measured: new Map(), fits: new Map(), rows: new Map() };
      try {
        const { measured } = layoutSlide(root, doc, slide);
        r.measured = measured;
      } catch {
        /* keep stored sizes */
      }
      for (const w of root.querySelectorAll('[data-autofit="shrink"]')) {
        const target = w.classList.contains('pe-el-shape') ? w.querySelector('.pe-shape-text') : w;
        const v = parseFloat(target?.style.getPropertyValue('--pe-fit'));
        if (v && v < 1) r.fits.set(w.dataset.elId, v);
      }
      for (const w of root.querySelectorAll('.pe-el-table')) r.rows.set(w.dataset.elId, [...w.querySelectorAll('tr')].map((tr) => tr.offsetHeight));
      out.set(id, r);
    }
  } finally {
    host.remove();
  }
  return out;
}

// ---------- element writers ----------
function cNvPr(w, el, ctx, { name, extraInner = '' } = {}) {
  const id = w.shapeId(el.id);
  const alt = el.accessibility?.decorative ? '' : el.accessibility?.alt || '';
  const attrs = [`id="${id}"`, `name="${esc(name || el.name || `${el.type} ${id}`)}"`];
  if (alt) attrs.push(`descr="${esc(alt)}"`);
  if (el.hidden) attrs.push('hidden="1"');
  let inner = extraInner;
  if (el.link) inner += ctx.linkXml(el.link) || '';
  if (el.accessibility?.decorative) inner += '<a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst>';
  return `<p:cNvPr ${attrs.join(' ')}${inner ? `>${inner}</p:cNvPr>` : '/>'}`;
}

const locks = (el, tag) => (el.locked ? `<a:${tag} noMove="1" noResize="1" noRot="1"/>` : '');

function effectiveAlpha(el, ctx) {
  return (ctx.alpha ?? 1) * (el.opacity ?? 1);
}

function textOpts(doc, ctx, alpha, extra = {}) {
  return { lang: ctx.lang, rtl: ctx.rtl, alpha, linkXml: ctx.linkXml, fieldCtx: ctx.fieldCtx, ...extra };
}

function writeText(w, el, ctx) {
  const doc = ctx.doc;
  const theme = doc.theme;
  const a = effectiveAlpha(el, ctx);
  const c = el.text;
  const m = ctx.m?.measured.get(el.id);
  const autofit = c.box?.autofit || 'grow';
  const g = { ...el.geometry, height: autofit === 'grow' && m ? Math.max(el.geometry.height, m.height) : el.geometry.height };
  const isTitle = ctx.titleId === el.id;
  const st = el.style || {};
  const spPr = `<p:spPr>${xfrmXml(g)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${st.fill !== undefined ? fillXml(st.fill, theme, { alpha: a, imageRel: (id) => w.imageRel(id) }) : '<a:noFill/>'}${st.stroke !== undefined ? lineXml(st.stroke, theme, { alpha: a }) : ''}${shadowXml(st.shadow, theme, a)}</p:spPr>`;
  const body = `<p:txBody>${bodyPrXml(c.box, { insets: theme.defaults.text_box.insets, anchor: 'top', autofit, fit: ctx.m?.fits.get(el.id) || 1, rtl: ctx.rtl })}<a:lstStyle/>${paragraphsXml(doc, c, textOpts(doc, ctx, a, { kind: 'text', role: el.role }))}</p:txBody>`;
  const nv = isTitle
    ? `<p:nvSpPr>${cNvPr(w, el, ctx, { name: `Title ${w.shapeId(el.id)}` })}<p:cNvSpPr><a:spLocks noGrp="1"${el.locked ? ' noMove="1" noResize="1" noRot="1"' : ''}/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>`
    : `<p:nvSpPr>${cNvPr(w, el, ctx, { name: el.name || `TextBox ${w.shapeId(el.id)}` })}<p:cNvSpPr txBox="1">${locks(el, 'spLocks')}</p:cNvSpPr><p:nvPr/></p:nvSpPr>`;
  return `<p:sp>${nv}${spPr}${body}</p:sp>`;
}

function writeShape(w, el, ctx) {
  const doc = ctx.doc;
  const theme = doc.theme;
  const a = effectiveAlpha(el, ctx);
  const shape = SHAPE_MAP.get(el.shape.preset) || SHAPE_MAP.get('rect');
  const m = ctx.m?.measured.get(el.id);
  const g = { ...el.geometry, height: m ? Math.max(el.geometry.height, m.height) : el.geometry.height };
  const adj = shape.ooxmlAdjust ? shape.ooxmlAdjust(g.width, g.height, shapeAdjust(el.shape.preset, el.shape.adjust)) : {};
  const av = Object.entries(adj).map(([k, v]) => `<a:gd name="${k}" fmla="val ${Math.round(v)}"/>`).join('');
  const st = el.style || {};
  const fill = st.fill !== undefined ? st.fill : theme.defaults.shape.fill;
  const stroke = st.stroke !== undefined ? st.stroke : theme.defaults.shape.stroke;
  const spPr = `<p:spPr>${xfrmXml(g)}<a:prstGeom prst="${shape.ooxml}"><a:avLst>${av}</a:avLst></a:prstGeom>${fillXml(fill, theme, { alpha: a, imageRel: (id) => w.imageRel(id) }) || '<a:noFill/>'}${lineXml(stroke, theme, { alpha: a }) || '<a:ln><a:noFill/></a:ln>'}${shadowXml(st.shadow, theme, a)}</p:spPr>`;
  const t = el.shape.text;
  const sd = theme.defaults.shape.text;
  const body = `<p:txBody>${bodyPrXml(t?.box, { insets: theme.defaults.text_box.insets, anchor: sd.vertical_align || 'middle', autofit: t?.box?.autofit || 'none', fit: ctx.m?.fits.get(el.id) || 1, rtl: ctx.rtl })}<a:lstStyle/>${paragraphsXml(doc, t || { body: { paragraphs: [{ inlines: [] }] } }, textOpts(doc, ctx, a, { kind: 'shape' }))}</p:txBody>`;
  return `<p:sp><p:nvSpPr>${cNvPr(w, el, ctx, { name: el.name || `${shape.label} ${w.shapeId(el.id)}` })}<p:cNvSpPr>${locks(el, 'spLocks')}</p:cNvSpPr><p:nvPr/></p:nvSpPr>${spPr}${body}</p:sp>`;
}

function picXml(w, el, ctx, { rid, svgRid, crop, mask, stroke, shadow, nvPrInner = '', cNvExtra = '' }) {
  const theme = ctx.doc.theme;
  const a = effectiveAlpha(el, ctx);
  const src = crop ? `<a:srcRect l="${Math.round(crop.left * 100000)}" t="${Math.round(crop.top * 100000)}" r="${Math.round(crop.right * 100000)}" b="${Math.round(crop.bottom * 100000)}"/>` : '<a:srcRect/>';
  const svgExt = svgRid ? `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${svgRid}"/></a:ext></a:extLst>` : '';
  const blip = `<a:blip r:embed="${rid}">${a < 0.999 ? `<a:alphaModFix amt="${Math.round(a * 100000)}"/>` : ''}${svgExt}</a:blip>`;
  const shape = mask ? SHAPE_MAP.get(mask.preset) : null;
  const g = el.geometry;
  const av = shape?.ooxmlAdjust ? Object.entries(shape.ooxmlAdjust(g.width, g.height, shapeAdjust(mask.preset, mask.adjust))).map(([k, v]) => `<a:gd name="${k}" fmla="val ${Math.round(v)}"/>`).join('') : '';
  return `<p:pic><p:nvPicPr>${cNvPr(w, el, ctx, { extraInner: cNvExtra })}<p:cNvPicPr><a:picLocks noChangeAspect="1"${el.locked ? ' noMove="1" noResize="1" noRot="1"' : ''}/></p:cNvPicPr><p:nvPr>${nvPrInner}</p:nvPr></p:nvPicPr><p:blipFill>${blip}${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmXml(g)}<a:prstGeom prst="${shape?.ooxml || 'rect'}"><a:avLst>${av}</a:avLst></a:prstGeom>${lineXml(stroke, theme, { alpha: a })}${shadowXml(shadow, theme, a)}</p:spPr></p:pic>`;
}

function writeImage(w, el, ctx) {
  if (!el.image.asset_id) return '';
  const m = w.pkg.media.get(el.image.asset_id);
  if (!m) return '';
  const theme = ctx.doc.theme;
  const rid = w.imageRel(el.image.asset_id);
  const svgRid = m.svg ? w.rel(REL.image, `../media/${m.svg.split('/').pop()}`) : null;
  const st = el.style || {};
  return picXml(w, el, ctx, {
    rid,
    svgRid,
    crop: el.image.crop,
    mask: el.image.mask,
    stroke: st.stroke !== undefined ? st.stroke : theme.defaults.image.stroke,
    shadow: st.shadow !== undefined ? st.shadow : theme.defaults.image.shadow,
  });
}

function writeVideo(w, el, ctx) {
  const v = el.video;
  const media = w.pkg.media.get(v.asset_id);
  const posterRid = v.poster_asset_id && w.pkg.media.get(v.poster_asset_id) ? w.imageRel(v.poster_asset_id) : w.rel(REL.image, `../media/${w.pkg.blackPoster.split('/').pop()}`);
  const st = el.style || {};
  if (!media) {
    // WebM (or missing) video: the poster stands in (reported by the export check)
    return picXml(w, el, ctx, { rid: posterRid, stroke: st.stroke, shadow: st.shadow });
  }
  const target = `../media/${media.path.split('/').pop()}`;
  const vRid = w.rel(REL.video, target);
  const mRid = w.rel(REL.media, target);
  const rec = ctx.doc.assets.find((a) => a.id === v.asset_id);
  const dur = rec?.duration_ms || 0;
  const trimSt = v.trim_start_ms || 0;
  const trimEnd = v.trim_end_ms && dur ? Math.max(0, dur - v.trim_end_ms) : 0;
  const trim = trimSt || trimEnd ? `<p14:trim${trimSt ? ` st="${trimSt}"` : ''}${trimEnd ? ` end="${trimEnd}"` : ''}/>` : '';
  const nvPr = `<a:videoFile r:link="${vRid}"/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE6A0A7F7DF}"><p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" r:embed="${mRid}">${trim}</p14:media></p:ext></p:extLst>`;
  ctx.videos?.push({ spid: w.shapeId(el.id), auto: v.start === 'auto', loop: !!v.loop, muted: !!v.muted, elementId: el.id });
  return picXml(w, el, ctx, { rid: posterRid, stroke: st.stroke, shadow: st.shadow, nvPrInner: nvPr, cNvExtra: '<a:hlinkClick r:id="" action="ppaction://media"/>' });
}

function sitesIdx(target) {
  if (!target) return null;
  if (target.type === 'shape') return SHAPE_MAP.get(target.shape.preset)?.ooxmlSites || null;
  if (target.type === 'text' || target.type === 'image') return RECT_SITES;
  return null;
}

function writeLine(w, el, ctx) {
  const theme = ctx.doc.theme;
  const a = effectiveAlpha(el, ctx);
  const info = ctx.world.get(el.id);
  const parentWorld = info?.parentWorld || IDENTITY;
  const inv = invert(parentWorld);
  const endPoint = (end) => {
    if (typeof end.x === 'number') return end;
    const r = resolveEndWorld(end, ctx.world, parentWorld);
    return r ? apply(inv, r.point) : { x: 0, y: 0 };
  };
  const p1 = endPoint(el.geometry.start);
  const p2 = endPoint(el.geometry.end);
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const flip = `${p2.x < p1.x ? ' flipH="1"' : ''}${p2.y < p1.y ? ' flipV="1"' : ''}`;
  const st = el.style || {};
  const stroke = st.stroke !== undefined ? st.stroke : theme.defaults.line.stroke;
  const heads = st.arrowheads !== undefined ? st.arrowheads : theme.defaults.line.arrowheads;
  let prst = 'line';
  let cxn = '';
  if (el.type === 'connector') {
    prst = el.connector.routing === 'elbow' ? 'bentConnector3' : 'straightConnector1';
    for (const [which, tag] of [['start', 'stCxn'], ['end', 'endCxn']]) {
      const end = el.geometry[which];
      if (!end.element_id) continue;
      const target = ctx.world.get(end.element_id)?.el;
      const idx = sitesIdx(target)?.[end.site];
      if (idx !== undefined && idx !== null && w.ids.has(end.element_id)) cxn += `<a:${tag} id="${w.shapeId(end.element_id)}" idx="${idx}"/>`;
    }
  }
  return `<p:cxnSp><p:nvCxnSpPr>${cNvPr(w, el, ctx, { name: el.name || `${el.type === 'connector' ? 'Connector' : 'Line'} ${w.shapeId(el.id)}` })}<p:cNvCxnSpPr>${el.locked ? '<a:cxnSpLocks noMove="1" noResize="1" noRot="1"/>' : ''}${cxn}</p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm${flip}><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(Math.abs(p2.x - p1.x))}" cy="${emu(Math.abs(p2.y - p1.y))}"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${lineXml(stroke, theme, { alpha: a, arrowheads: heads })}${shadowXml(st.shadow, theme, a)}</p:spPr></p:cxnSp>`;
}

function writeGroup(w, el, ctx) {
  const g = el.geometry;
  const childCtx = { ...ctx, alpha: effectiveAlpha(el, ctx) };
  const kids = el.group.children.map((c) => writeElement(w, c, childCtx)).join('');
  if (!kids) return '';
  const xfrm = xfrmXml(g, { extra: `<a:chOff x="0" y="0"/><a:chExt cx="${emu(g.width)}" cy="${emu(g.height)}"/>` });
  return `<p:grpSp><p:nvGrpSpPr>${cNvPr(w, el, ctx, { name: el.name || `Group ${w.shapeId(el.id)}` })}<p:cNvGrpSpPr>${el.locked ? '<a:grpSpLocks noMove="1" noResize="1" noRot="1"/>' : ''}</p:cNvGrpSpPr><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${xfrm}</p:grpSpPr>${kids}</p:grpSp>`;
}

function borderXml(tag, b, theme, a) {
  if (!b || b === 'none' || !b.width) return `<a:${tag} w="0"><a:noFill/></a:${tag}>`;
  const DASH = { solid: 'solid', dash: 'dash', dot: 'sysDot', dash_dot: 'dashDot', long_dash: 'lgDash' };
  return `<a:${tag} w="${emu(b.width)}" cap="flat" cmpd="sng" algn="ctr">${solidFill(b.color, theme, a)}<a:prstDash val="${DASH[b.dash || 'solid']}"/><a:round/></a:${tag}>`;
}

function writeTable(w, el, ctx) {
  const doc = ctx.doc;
  const theme = doc.theme;
  const td = theme.defaults.table;
  const t = el.table;
  const a = effectiveAlpha(el, ctx);
  const grid = tableGrid(t);
  const heights = ctx.m?.rows.get(el.id);
  const width = t.columns.reduce((s, c) => s + c.width, 0);
  const height = heights ? heights.reduce((s, h) => s + h, 0) : t.rows.reduce((s, r) => s + r.min_height, 0);
  const headerRows = t.header_rows || 0;
  const rows = t.rows.map((row, ri) => {
    const isHeader = ri < headerRows;
    const cells = t.columns.map((col, ci) => {
      const gcell = grid[ri][ci];
      if (gcell.covered) {
        const [ar, ac] = gcell.anchor.split(':');
        const hm = ar === row.id ? ' hMerge="1"' : '';
        const vm = ac === col.id ? ' vMerge="1"' : '';
        return `<a:tc${hm || vm ? `${hm}${vm}` : ' hMerge="1" vMerge="1"'}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="${esc(ctx.lang)}"/></a:p></a:txBody><a:tcPr/></a:tc>`;
      }
      const cell = t.cells[gcell.key] || { body: { paragraphs: [{ inlines: [] }] } };
      const firstCol = !isHeader && ci === 0 && t.first_column;
      let fill = cell.fill;
      if (fill === undefined) {
        if (isHeader) fill = { type: 'solid', color: td.header_fill };
        else if (t.banded_rows && (ri - headerRows) % 2 === 1) fill = { type: 'solid', color: td.band_fill };
        else if (t.banded_columns && ci % 2 === 1) fill = { type: 'solid', color: td.band_fill };
      }
      const defaults = firstCol && td.first_column_bold ? { weight: 700, ...(cell.defaults || {}) } : cell.defaults;
      const pad = emu(cell.padding ?? td.padding);
      const anchor = { top: 't', middle: 'ctr', bottom: 'b' }[cell.vertical_align || 'top'];
      const b = (side) => cell.borders?.[side] ?? td.border;
      const span = `${cell.col_span > 1 ? ` gridSpan="${cell.col_span}"` : ''}${cell.row_span > 1 ? ` rowSpan="${cell.row_span}"` : ''}`;
      const paras = paragraphsXml(doc, { ...cell, defaults }, textOpts(doc, ctx, a, { kind: 'cell', header: isHeader }));
      return `<a:tc${span}><a:txBody><a:bodyPr/><a:lstStyle/>${paras}</a:txBody><a:tcPr marL="${pad}" marR="${pad}" marT="${pad}" marB="${pad}" anchor="${anchor}">${borderXml('lnL', b('left'), theme, a)}${borderXml('lnR', b('right'), theme, a)}${borderXml('lnT', b('top'), theme, a)}${borderXml('lnB', b('bottom'), theme, a)}${fill && fill !== 'none' ? fillXml(fill, theme, { alpha: a, imageRel: (id) => w.imageRel(id) }) : '<a:noFill/>'}</a:tcPr></a:tc>`;
    }).join('');
    return `<a:tr h="${emu(heights?.[ri] || row.min_height)}">${cells}</a:tr>`;
  }).join('');
  const tblPr = `<a:tblPr${headerRows ? ' firstRow="1"' : ''}${t.first_column ? ' firstCol="1"' : ''}${t.banded_rows ? ' bandRow="1"' : ''}${t.banded_columns ? ' bandCol="1"' : ''}/>`;
  const gridXml = `<a:tblGrid>${t.columns.map((c) => `<a:gridCol w="${emu(c.width)}"/>`).join('')}</a:tblGrid>`;
  return `<p:graphicFrame><p:nvGraphicFramePr>${cNvPr(w, el, ctx, { name: el.name || `Table ${w.shapeId(el.id)}` })}<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(el.geometry.x)}" y="${emu(el.geometry.y)}"/><a:ext cx="${emu(width)}" cy="${emu(height)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>${tblPr}${gridXml}${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function writeChart(w, el, ctx) {
  const n = ++w.pkg.chartSeq;
  const chartName = `ppt/charts/chart${n}.xml`;
  w.pkg.pendingCharts.push({ n, chart: el.chart, name: chartName });
  const rid = w.rel(REL.chart, `../charts/chart${n}.xml`);
  const g = el.geometry;
  return `<p:graphicFrame><p:nvGraphicFramePr>${cNvPr(w, el, ctx, { name: el.name || `Chart ${w.shapeId(el.id)}` })}<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(g.x)}" y="${emu(g.y)}"/><a:ext cx="${emu(g.width)}" cy="${emu(g.height)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
}

export function writeElement(w, el, ctx) {
  if (isPlaceholder(el)) return '';
  switch (el.type) {
    case 'text': return writeText(w, el, ctx);
    case 'shape': return writeShape(w, el, ctx);
    case 'image': return writeImage(w, el, ctx);
    case 'video': return writeVideo(w, el, ctx);
    case 'line':
    case 'connector': return writeLine(w, el, ctx);
    case 'group': return writeGroup(w, el, ctx);
    case 'table': return writeTable(w, el, ctx);
    case 'chart': return writeChart(w, el, ctx);
    default: return '';
  }
}

function assignIds(w, elements) {
  walk(elements, (el) => { w.shapeId(el.id); });
}

function hasField(el, kinds) {
  let found = false;
  walk([el], (x) => {
    for (const b of [x.text?.body, x.shape?.text?.body]) for (const p of b?.paragraphs || []) for (const i of p.inlines) if (i.field && kinds.includes(i.field)) found = true;
  });
  return found;
}

const SPEED = (ms) => (ms < 500 ? 'fast' : ms < 1000 ? 'med' : 'slow');
const DIR = { left: 'l', right: 'r', up: 'u', down: 'd' };

function transitionXml(doc, slide) {
  const pb = doc.playback || {};
  const tr = slide.transition || pb.default_transition || { kind: 'none' };
  const aa = pb.auto_advance || {};
  const attrs = [];
  if (tr.kind !== 'none') attrs.push(`spd="${SPEED(tr.duration_ms || 400)}"`);
  if (pb.click_to_advance === false) attrs.push('advClick="0"');
  if (aa.enabled) attrs.push(`advTm="${slide.advance_after_ms || aa.default_duration_ms || 5000}"`);
  const child = tr.kind === 'fade' ? '<p:fade/>' : tr.kind === 'push' ? `<p:push dir="${DIR[tr.direction || 'left']}"/>` : tr.kind === 'wipe' ? `<p:wipe dir="${DIR[tr.direction || 'left']}"/>` : '';
  if (!attrs.length && !child) return '';
  return `<p:transition ${attrs.join(' ')}>${child}</p:transition>`;
}

// ---------- entry point ----------
export async function exportPptx(doc, getAssetBlob, { slideIds, notes = true, onProgress = () => {} } = {}) {
  const pkg = new Package(doc, getAssetBlob);
  pkg.pendingCharts = [];
  const order = slideOrder(doc);
  const ids = order.filter((id) => slideIds.includes(id));
  const lang = doc.metadata.language || 'en-US';
  const rtl = isRtlLanguage(lang);
  onProgress(0.02);
  const measures = await measure(doc, ids);
  onProgress(0.2);
  const assetIds = assetIdsForSlides(doc, ids);
  await pkg.prepareMedia(assetIds);
  onProgress(0.4);

  const slideFile = new Map(ids.map((id, i) => [id, `slide${i + 1}.xml`]));
  const linkXmlFor = (w) => (link) => {
    if (link.kind === 'url') return `<a:hlinkClick r:id="${w.rel(REL.hyperlink, link.href, true)}"/>`;
    if (link.kind === 'slide') {
      const f = slideFile.get(link.slide_id);
      if (!f) return '';
      return `<a:hlinkClick r:id="${w.rel(REL.slide, f)}" action="ppaction://hlinksldjump"/>`;
    }
    const jump = { next: 'nextslide', previous: 'previousslide', first: 'firstslide', last: 'lastslide' }[link.target];
    return `<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=${jump}"/>`;
  };

  // ----- master -----
  const masterW = new PartWriter(pkg);
  masterW.rel(REL.slideLayout, '../slideLayouts/slideLayout1.xml');
  masterW.rel(REL.slideLayout, '../slideLayouts/slideLayout2.xml');
  const masterEls = (doc.master?.elements || []).filter((e) => !hasField(e, ['section_title']));
  const perSlideMasterEls = (doc.master?.elements || []).filter((e) => hasField(e, ['section_title']));
  assignIds(masterW, masterEls);
  const firstShowing = ids.find((id) => doc.slides[id].show_master !== false) || ids[0];
  const masterCtx = { doc, lang, rtl, alpha: 1, fieldCtx: firstShowing ? { ...fieldContext(doc, firstShowing), slideNumber: '‹#›' } : null, m: firstShowing ? measures.get(firstShowing) : null, world: worldMap(masterEls), linkXml: linkXmlFor(masterW) };
  const masterTree = masterEls.map((e) => writeElement(masterW, e, masterCtx)).join('');
  const masterBg = fillXml(doc.theme.background, doc.theme, { imageRel: (id) => masterW.imageRel(id) });
  masterW.rel(REL.theme, '../theme/theme1.xml');
  pkg.add('ppt/slideMasters/slideMaster1.xml', masterXml(doc, masterTree, masterBg), CT.slideMaster);
  pkg.add('ppt/slideMasters/_rels/slideMaster1.xml.rels', relsXml(masterW.rels));
  for (const [i, kind] of [[1, 'blank'], [2, 'titleOnly']]) {
    pkg.add(`ppt/slideLayouts/slideLayout${i}.xml`, layoutXml(kind, doc.size.width, doc.size.height), CT.slideLayout);
    pkg.add(`ppt/slideLayouts/_rels/slideLayout${i}.xml.rels`, relsXml([{ id: 'rId1', type: REL.slideMaster, target: '../slideMasters/slideMaster1.xml' }]));
  }
  pkg.add('ppt/theme/theme1.xml', themeXml(doc), CT.theme);

  // ----- slides -----
  const includeNotes = notes && ids.some((id) => doc.slides[id].notes && !isBodyEmpty(doc.slides[id].notes));
  let notesCount = 0;
  let hiddenCount = 0;
  const sldRefs = [];
  ids.forEach((id, i) => {
    const slide = doc.slides[id];
    const n = i + 1;
    const w = new PartWriter(pkg);
    w.self = `slide${n}.xml`;
    const titleEl = titleElement(slide);
    const hasTitle = !!titleEl && titleEl.type === 'text';
    w.rel(REL.slideLayout, `../slideLayouts/slideLayout${hasTitle || slide.title ? 2 : 1}.xml`);
    const extraMaster = slide.show_master !== false ? perSlideMasterEls : [];
    assignIds(w, [...extraMaster, ...slide.elements]);
    const ctx = {
      doc, lang, rtl, alpha: 1,
      fieldCtx: fieldContext(doc, id),
      m: measures.get(id),
      world: worldMap(slide.elements, IDENTITY, new Map(), measures.get(id)?.measured),
      linkXml: linkXmlFor(w),
      titleId: hasTitle ? titleEl.id : null,
      videos: [],
    };
    const mctx = { ...ctx, world: worldMap(extraMaster), titleId: null };
    let tree = extraMaster.map((e) => writeElement(w, e, mctx)).join('');
    tree += slide.elements.map((e) => writeElement(w, e, ctx)).join('');
    // hidden title → title placeholder positioned off-slide (spec §15.6)
    if (!hasTitle && slide.title) {
      const tid = w.nextId++;
      tree += `<p:sp><p:nvSpPr><p:cNvPr id="${tid}" name="Title ${tid}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="${-emu(200)}"/><a:ext cx="${emu(doc.size.width)}" cy="${emu(100)}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="${esc(lang)}"/><a:t>${esc(slide.title)}</a:t></a:r></a:p></p:txBody></p:sp>`;
    }
    const bg = slide.background !== undefined ? `<p:bg><p:bgPr>${fillXml(slide.background, doc.theme, { imageRel: (aid) => w.imageRel(aid) }) || '<a:noFill/>'}<a:effectLst/></p:bgPr></p:bg>` : '';
    // builds + autoplay videos → timing
    const autoPlays = ctx.videos.filter((v) => v.auto && !(slide.builds || []).some((b) => b.element_id === v.elementId && b.effect === 'play'));
    const timingSlide = autoPlays.length ? { ...slide, builds: [...autoPlays.map((v) => ({ id: `auto-${v.elementId}`, element_id: v.elementId, effect: 'play', trigger: 'with_previous' })), ...(slide.builds || [])] } : slide;
    const spidOf = (elId) => (slide.elements.some((e) => e.id === elId) && w.ids.has(elId) ? w.shapeId(elId) : null);
    const timing = timingXml(timingSlide, spidOf, { videoIds: ctx.videos });
    const attrs = `${slide.hidden ? ' show="0"' : ''}${slide.show_master === false ? ' showMasterSp="0"' : ''}`;
    if (slide.hidden) hiddenCount++;
    const xml = `${XML_HEAD}<p:sld ${NSDECL}${attrs}><p:cSld>${bg}<p:spTree>${EMPTY_GRP}${tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transitionXml(doc, slide)}${timing}</p:sld>`;
    if (includeNotes && slide.notes && !isBodyEmpty(slide.notes)) {
      notesCount++;
      w.rel(REL.notesSlide, `../notesSlides/notesSlide${n}.xml`);
      const nw = new PartWriter(pkg);
      nw.rel(REL.notesMaster, '../notesMasters/notesMaster1.xml');
      nw.rel(REL.slide, `../slides/slide${n}.xml`);
      // links inside notes need the notes part's relationships
      const paras2 = paragraphsXml(doc, { body: slide.notes }, { kind: 'notes', lang, rtl, linkXml: (link) => (link.kind === 'url' ? `<a:hlinkClick r:id="${nw.rel(REL.hyperlink, link.href, true)}"/>` : '') });
      pkg.add(`ppt/notesSlides/notesSlide${n}.xml`, notesSlideXml(paras2), CT.notesSlide);
      pkg.add(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, relsXml(nw.rels));
    }
    pkg.add(`ppt/slides/slide${n}.xml`, xml, CT.slide);
    pkg.add(`ppt/slides/_rels/slide${n}.xml.rels`, relsXml(w.rels));
    sldRefs.push({ sldId: 256 + i, file: `slides/slide${n}.xml`, slideId: id });
    onProgress(0.4 + (0.4 * (i + 1)) / ids.length);
  });

  // ----- charts -----
  for (const c of pkg.pendingCharts) {
    pkg.add(c.name, chartXml(doc, c.chart), CT.chart);
    const xlsx = await buildWorkbook(c.chart);
    pkg.files.push({ name: `ppt/embeddings/Microsoft_Excel_Worksheet${c.n}.xlsx`, data: xlsx, compress: false });
    pkg.defaults.xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    pkg.add(`ppt/charts/_rels/chart${c.n}.xml.rels`, relsXml([{ id: 'rId1', type: REL.package, target: `../embeddings/Microsoft_Excel_Worksheet${c.n}.xlsx` }]));
  }

  // ----- notes master -----
  if (notesCount) {
    pkg.add('ppt/notesMasters/notesMaster1.xml', notesMasterXml(), CT.notesMaster);
    pkg.add('ppt/notesMasters/_rels/notesMaster1.xml.rels', relsXml([{ id: 'rId1', type: REL.theme, target: '../theme/theme2.xml' }]));
    pkg.add('ppt/theme/theme2.xml', themeXml(doc, 'Notes'), CT.theme);
  }

  // ----- presentation -----
  const presRels = [{ id: 'rId1', type: REL.slideMaster, target: 'slideMasters/slideMaster1.xml' }];
  const slideRefs = sldRefs.map((s, i) => {
    const rid = `rId${i + 2}`;
    presRels.push({ id: rid, type: REL.slide, target: s.file });
    return { sldId: s.sldId, rid };
  });
  let k = presRels.length + 1;
  let notesRid = null;
  if (notesCount) {
    notesRid = `rId${k++}`;
    presRels.push({ id: notesRid, type: REL.notesMaster, target: 'notesMasters/notesMaster1.xml' });
  }
  presRels.push({ id: `rId${k++}`, type: REL.presProps, target: 'presProps.xml' });
  presRels.push({ id: `rId${k++}`, type: REL.viewProps, target: 'viewProps.xml' });
  presRels.push({ id: `rId${k++}`, type: REL.theme, target: 'theme/theme1.xml' });
  presRels.push({ id: `rId${k++}`, type: REL.tableStyles, target: 'tableStyles.xml' });
  // sections: PowerPoint sections; unnamed groups become "Untitled Section"
  let sections = null;
  if (doc.sections.some((s) => s.name)) {
    sections = doc.sections
      .map((s) => ({ name: s.name || 'Untitled Section', sldIds: sldRefs.filter((r) => s.slide_ids.includes(r.slideId)).map((r) => r.sldId) }))
      .filter((s) => s.sldIds.length);
  }
  pkg.add('ppt/presentation.xml', presentationXml(doc, { slideRefs, notesRid, sections }), CT.presentation);
  pkg.add('ppt/_rels/presentation.xml.rels', relsXml(presRels));
  pkg.add('ppt/presProps.xml', presPropsXml(doc), CT.presProps);
  pkg.add('ppt/viewProps.xml', viewPropsXml(), CT.viewProps);
  pkg.add('ppt/tableStyles.xml', tableStylesXml(), CT.tableStyles);
  pkg.add('docProps/core.xml', coreXml(doc), CT.core);
  pkg.add('docProps/app.xml', appXml({ slides: ids.length, notes: notesCount, hidden: hiddenCount }), CT.app);
  pkg.add('_rels/.rels', relsXml([
    { id: 'rId1', type: REL.officeDocument, target: 'ppt/presentation.xml' },
    { id: 'rId2', type: REL.core, target: 'docProps/core.xml' },
    { id: 'rId3', type: REL.extended, target: 'docProps/app.xml' },
  ]));
  const ctXml = contentTypesXml(pkg.overrides, pkg.defaults);
  const files = [{ name: '[Content_Types].xml', data: ctXml, compress: true }, ...pkg.files];
  onProgress(0.9);
  const zip = await writeZip(files);
  onProgress(1);
  return { blob: new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), filename: `${safeName(doc.metadata.title)}.pptx` };
}

export { geometryKind };
