// DrawingML helpers for the PPTX writer (spec §15.6): colors, fills, lines,
// effects and text bodies.
import { resolveColor, parseHex } from '../../core/color.js';
import { containerBaseStyle, resolveRun, resolveParagraph, resolveFontValue } from '../../core/theme.js';
import { isRun, isField, isBreak, listMarkers } from '../../core/text.js';
import { fieldText, formatDate } from '../../core/fields.js';
import { EMU_PER_UNIT } from '../../core/units.js';
import { fontRegistry } from '../../render/fonts.js';

export const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  p14: 'http://schemas.microsoft.com/office/powerpoint/2010/main',
};

export function esc(s) {
  // eslint-disable-next-line no-control-regex
  return String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export const emu = (u) => Math.round((u || 0) * EMU_PER_UNIT);
export const pt100 = (u) => Math.round(u * 0.75 * 100); // units → hundredths of a point
export const angle = (deg) => Math.round((((deg % 360) + 360) % 360) * 60000);

const SCHEME = {
  'color.text.primary': 'tx1',
  'color.background': 'bg1',
  'color.text.secondary': 'tx2',
  'color.surface': 'bg2',
  'color.accent.1': 'accent1',
  'color.accent.2': 'accent2',
  'color.accent.3': 'accent3',
  'color.accent.4': 'accent4',
  'color.accent.5': 'accent5',
  'color.accent.6': 'accent6',
  'color.link': 'hlink',
};

function alphaXml(a) {
  return a < 0.999 ? `<a:alpha val="${Math.max(0, Math.round(a * 100000))}"/>` : '';
}

// A color (hex or theme token) as DrawingML; `alpha` multiplies in opacity.
export function colorXml(c, theme, alpha = 1) {
  if (c && typeof c === 'object' && c.token && SCHEME[c.token]) {
    const t = c.tint || 0;
    let mods = '';
    if (t > 0) mods = `<a:lumMod val="${Math.round((1 - t) * 100000)}"/><a:lumOff val="${Math.round(t * 100000)}"/>`;
    else if (t < 0) mods = `<a:lumMod val="${Math.round((1 + t) * 100000)}"/>`;
    return `<a:schemeClr val="${SCHEME[c.token]}">${mods}${alphaXml(alpha)}</a:schemeClr>`;
  }
  const hex = resolveColor(c, theme, '#000000');
  const { r, g, b, a } = parseHex(hex);
  const h = [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  return `<a:srgbClr val="${h}">${alphaXml((a ?? 1) * alpha)}</a:srgbClr>`;
}

export function solidFill(c, theme, alpha = 1) {
  return `<a:solidFill>${colorXml(c, theme, alpha)}</a:solidFill>`;
}

// Fill → DrawingML. `imageRel(assetId)` returns a relationship ID for image fills.
export function fillXml(fill, theme, { alpha = 1, imageRel = null } = {}) {
  if (fill === undefined || fill === null) return '';
  if (fill === 'none') return '<a:noFill/>';
  const stops = (list) => `<a:gsLst>${list.slice().sort((x, y) => x.offset - y.offset).map((s) => `<a:gs pos="${Math.round(s.offset * 100000)}">${colorXml(s.color, theme, alpha)}</a:gs>`).join('')}</a:gsLst>`;
  switch (fill.type) {
    case 'solid':
      return solidFill(fill.color, theme, alpha);
    case 'linear':
      // CSS angles point "to" (0 = up); DrawingML lin angles are clockwise from "to the right".
      return `<a:gradFill rotWithShape="1">${stops(fill.stops)}<a:lin ang="${angle(fill.angle - 90)}" scaled="0"/></a:gradFill>`;
    case 'radial': {
      const l = Math.round(fill.center_x * 100000);
      const t = Math.round(fill.center_y * 100000);
      return `<a:gradFill rotWithShape="1">${stops(fill.stops)}<a:path path="circle"><a:fillToRect l="${l}" t="${t}" r="${100000 - l}" b="${100000 - t}"/></a:path></a:gradFill>`;
    }
    case 'image': {
      const rid = imageRel?.(fill.asset_id);
      if (!rid) return '<a:noFill/>';
      const blip = `<a:blip r:embed="${rid}">${alpha < 0.999 ? `<a:alphaModFix amt="${Math.round(alpha * 100000)}"/>` : ''}</a:blip>`;
      if (fill.mode === 'tile') {
        const s = Math.round((fill.scale || 1) * 100000);
        return `<a:blipFill dpi="0" rotWithShape="1">${blip}<a:srcRect/><a:tile tx="0" ty="0" sx="${s}" sy="${s}" flip="none" algn="tl"/></a:blipFill>`;
      }
      return `<a:blipFill dpi="0" rotWithShape="1">${blip}<a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`;
    }
    default:
      return '';
  }
}

const DASH = { solid: 'solid', dash: 'dash', dot: 'sysDot', dash_dot: 'dashDot', long_dash: 'lgDash' };
const CAP = { flat: 'flat', round: 'rnd', square: 'sq' };
const HEAD = { arrow: 'arrow', triangle: 'triangle', stealth: 'stealth', oval: 'oval', diamond: 'diamond' };
const HSIZE = { small: 'sm', medium: 'med', large: 'lg' };

export function lineXml(stroke, theme, { alpha = 1, arrowheads = null } = {}) {
  if (stroke === undefined || stroke === null) return '';
  if (stroke === 'none') return '<a:ln><a:noFill/></a:ln>';
  const cap = stroke.cap ? ` cap="${CAP[stroke.cap] || 'flat'}"` : '';
  const join = stroke.join === 'round' ? '<a:round/>' : stroke.join === 'bevel' ? '<a:bevel/>' : stroke.join === 'miter' ? '<a:miter lim="800000"/>' : '';
  const end = (tag, h) => (h && h.kind && h.kind !== 'none' ? `<a:${tag} type="${HEAD[h.kind] || 'triangle'}" w="${HSIZE[h.size] || 'med'}" len="${HSIZE[h.size] || 'med'}"/>` : '');
  return `<a:ln w="${emu(stroke.width)}"${cap}>${solidFill(stroke.color, theme, alpha)}<a:prstDash val="${DASH[stroke.dash || 'solid']}"/>${join}${end('headEnd', arrowheads?.start)}${end('tailEnd', arrowheads?.end)}</a:ln>`;
}

export function shadowXml(shadow, theme, alpha = 1) {
  if (!shadow || shadow === 'none') return shadow === 'none' ? '<a:effectLst/>' : '';
  const dist = Math.hypot(shadow.offset_x, shadow.offset_y);
  const dir = (Math.atan2(shadow.offset_y, shadow.offset_x) * 180) / Math.PI;
  return `<a:effectLst><a:outerShdw blurRad="${emu(shadow.blur)}" dist="${emu(dist)}" dir="${angle(dir)}" algn="ctr" rotWithShape="0">${colorXml(shadow.color, theme, alpha)}</a:outerShdw></a:effectLst>`;
}

export function xfrmXml(g, { flipsAllowed = true, tag = 'a:xfrm', extra = '' } = {}) {
  const rot = g.rotation ? ` rot="${angle(g.rotation)}"` : '';
  const fh = flipsAllowed && g.flip_x ? ' flipH="1"' : '';
  const fv = flipsAllowed && g.flip_y ? ' flipV="1"' : '';
  return `<${tag}${rot}${fh}${fv}><a:off x="${emu(g.x)}" y="${emu(g.y)}"/><a:ext cx="${emu(Math.max(1, g.width))}" cy="${emu(Math.max(1, g.height))}"/>${extra}</${tag}>`;
}

// ---------- fonts ----------
export function fontName(doc, fontId) {
  if (!fontId) return 'Calibri';
  if (typeof fontId === 'object' && fontId.device) return fontId.device;
  if (fontId.startsWith('builtin.')) return fontRegistry().find((f) => f.id === fontId)?.name || fontId.slice(8);
  return doc.fonts?.find((f) => f.id === fontId)?.family_name || 'Calibri';
}

function typeface(doc, font) {
  if (font && typeof font === 'object' && font.token === 'font.heading') return '+mj-lt';
  if (font && typeof font === 'object' && font.token === 'font.body') return '+mn-lt';
  return esc(fontName(doc, resolveFontValue(doc.theme, font)));
}

// ---------- text ----------
const NUM_TYPE = { decimal: 'arabicPeriod', lower_alpha: 'alphaLcPeriod', upper_alpha: 'alphaUcPeriod', lower_roman: 'romanLcPeriod', upper_roman: 'romanUcPeriod' };
const ALIGN = { start: 'l', center: 'ctr', end: 'r', justify: 'just' };
const DATE_TYPE = { short: 'datetime1', medium: 'datetime4', long: 'datetime2', iso: 'datetime1' };

function guid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}`;
}

// Run properties. st: fully resolved run style.
export function rPrXml(doc, st, { lang, alpha = 1, linkRel = null, tag = 'a:rPr', noLink = false } = {}) {
  const theme = doc.theme;
  const attrs = [`lang="${esc(st.lang || lang || 'en-US')}"`, `sz="${Math.max(100, Math.min(400000, pt100(st.size)))}"`];
  if (st.weight >= 600) attrs.push('b="1"');
  else attrs.push('b="0"');
  if (st.italic) attrs.push('i="1"');
  if (st.underline) attrs.push('u="sng"');
  if (st.strike) attrs.push('strike="sngStrike"');
  if (st.script === 'super') attrs.push('baseline="30000"');
  if (st.script === 'sub') attrs.push('baseline="-25000"');
  if (st.letter_spacing) attrs.push(`spc="${Math.round(st.letter_spacing * 0.75 * 100)}"`);
  attrs.push('dirty="0"');
  let inner = solidFill(st.color, theme, alpha);
  if (st.highlight) inner += `<a:highlight>${colorXml(st.highlight, theme)}</a:highlight>`;
  const tf = typeface(doc, st.font);
  inner += `<a:latin typeface="${tf}"/><a:ea typeface="${tf}"/><a:cs typeface="${tf}"/>`;
  if (linkRel && !noLink) inner += linkRel;
  return `<${tag} ${attrs.join(' ')}>${inner}</${tag}>`;
}

// Writes a TextBody's paragraphs. opts: { kind, role, header, defaults, lang,
// rtl, alpha, linkXml(link) → '<a:hlinkClick …/>' or '', fieldCtx, listIndent, bullets }
export function paragraphsXml(doc, container, opts = {}) {
  const theme = doc.theme;
  const base = containerBaseStyle(theme, { kind: opts.kind || 'text', role: opts.role, defaults: container?.defaults ?? opts.defaults, header: opts.header });
  const paragraphs = container?.body?.paragraphs || [{ inlines: [] }];
  const bullets = opts.bullets || theme.lists?.bullets || ['•'];
  const indent = opts.listIndent ?? theme.lists?.indent ?? 28;
  const markers = listMarkers(paragraphs, bullets);
  const linkDef = theme.defaults?.link || {};
  return paragraphs.map((p, pi) => {
    const para = resolveParagraph(base.para, p);
    const pAttrs = [`algn="${ALIGN[para.align] || 'l'}"`];
    const rtl = p.dir === 'rtl' || (p.dir !== 'ltr' && opts.rtl);
    if (rtl) pAttrs.push('rtl="1"');
    let bu = '<a:buNone/>';
    if (p.list) {
      const lvl = Math.min(8, p.list.level || 0);
      pAttrs.push(`marL="${emu(indent * (lvl + 1))}"`, `indent="${-emu(indent)}"`);
      if (lvl) pAttrs.push(`lvl="${lvl}"`);
      if (p.list.kind === 'number') bu = `<a:buFontTx/><a:buAutoNum type="${NUM_TYPE[p.list.number_style || 'decimal']}"${p.list.start_at ? ` startAt="${p.list.start_at}"` : ''}/>`;
      else bu = `<a:buFontTx/><a:buChar char="${esc(markers[pi] || bullets[lvl % bullets.length] || '•')}"/>`;
    } else pAttrs.push('marL="0"', 'indent="0"');
    const pPr = `<a:pPr ${pAttrs.join(' ')}><a:lnSpc><a:spcPct val="${Math.round((para.line || 1.2) * 100000)}"/></a:lnSpc><a:spcBef><a:spcPts val="${Math.round((para.before || 0) * 0.75 * 100)}"/></a:spcBef><a:spcAft><a:spcPts val="${Math.round((para.after || 0) * 0.75 * 100)}"/></a:spcAft>${bu}</a:pPr>`;
    let runs = '';
    let lastSt = base.run;
    for (const i of p.inlines || []) {
      if (isBreak(i)) {
        runs += `<a:br>${rPrXml(doc, lastSt, { lang: opts.lang, alpha: opts.alpha })}</a:br>`;
        continue;
      }
      let st = resolveRun(base.run, i.marks);
      if (st.link) {
        st = { ...st };
        if (!i.marks?.color && linkDef.color) st.color = linkDef.color;
        if (i.marks?.underline === undefined && linkDef.underline !== undefined) st.underline = linkDef.underline;
      }
      lastSt = st;
      const link = st.link ? opts.linkXml?.(st.link) || '' : '';
      if (isRun(i)) {
        if (!i.text) continue;
        // tabs and text split around control characters
        runs += `<a:r>${rPrXml(doc, st, { lang: opts.lang, alpha: opts.alpha, linkRel: link })}<a:t>${esc(i.text)}</a:t></a:r>`;
      } else if (isField(i)) {
        const text = opts.fieldCtx ? fieldText(i, opts.fieldCtx) : '';
        if (i.field === 'slide_number') runs += `<a:fld id="${guid()}" type="slidenum">${rPrXml(doc, st, { lang: opts.lang, alpha: opts.alpha })}<a:t>${esc(text || '‹#›')}</a:t></a:fld>`;
        else if (i.field === 'date' && (i.value || 'auto') === 'auto') runs += `<a:fld id="${guid()}" type="${DATE_TYPE[i.format || 'medium']}">${rPrXml(doc, st, { lang: opts.lang, alpha: opts.alpha })}<a:t>${esc(text || formatDate(new Date(), i.format || 'medium', opts.lang))}</a:t></a:fld>`;
        else runs += `<a:r>${rPrXml(doc, st, { lang: opts.lang, alpha: opts.alpha, linkRel: link })}<a:t>${esc(text)}</a:t></a:r>`;
      }
    }
    return `<a:p>${pPr}${runs}${rPrXml(doc, lastSt, { lang: opts.lang, alpha: opts.alpha, tag: 'a:endParaRPr' })}</a:p>`;
  }).join('');
}

const ANCHOR = { top: 't', middle: 'ctr', bottom: 'b' };

// bodyPr for a text container. autofit: 'grow' | 'shrink' | 'none'; fit: measured scale.
export function bodyPrXml(box, { insets, anchor = 'top', autofit = 'none', fit = 1, rtl = false, wrap = true } = {}) {
  const ins = box?.insets || insets || { left: 0, right: 0, top: 0, bottom: 0 };
  const a = ANCHOR[box?.vertical_align || anchor] || 't';
  let fitXml = '<a:noAutofit/>';
  const mode = box?.autofit || autofit;
  if (mode === 'grow') fitXml = '<a:spAutoFit/>';
  else if (mode === 'shrink') fitXml = fit < 0.999 ? `<a:normAutofit fontScale="${Math.round(fit * 100000)}"/>` : '<a:normAutofit/>';
  return `<a:bodyPr rot="0" spcFirstLastPara="0" vertOverflow="overflow" horzOverflow="overflow" vert="horz" wrap="${wrap ? 'square' : 'none'}" lIns="${emu(ins.left)}" tIns="${emu(ins.top)}" rIns="${emu(ins.right)}" bIns="${emu(ins.bottom)}" numCol="1" spcCol="0" rtlCol="${rtl ? 1 : 0}" anchor="${a}" anchorCtr="0">${fitXml}</a:bodyPr>`;
}

export { guid };
