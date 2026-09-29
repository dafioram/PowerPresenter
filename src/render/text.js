// Text flow rendering (spec §5.9). Paragraphs become <p>, lists become nested
// <ul>/<ol> with explicit markers, runs become styled spans or links.
import { containerBaseStyle, resolveRun, resolveParagraph } from '../core/theme.js';
import { listMarkers, isRun, isField, isBreak, isBodyEmpty } from '../core/text.js';
import { fieldText } from '../core/fields.js';
import { h, fitPx, text as textNode } from './dom.js';
import { color } from './paint.js';
import { cssFontFamily } from './fonts.js';

export const ALIGN_CSS = { start: 'start', center: 'center', end: 'end', justify: 'justify' };

export function applyRunStyle(e, st, ctx, { linkDefault = false } = {}) {
  const theme = ctx.doc.theme;
  e.style.fontFamily = cssFontFamily(st.font, ctx.doc);
  const size = st.script && st.script !== 'normal' ? st.size * 0.65 : st.size;
  e.style.fontSize = fitPx(size);
  e.style.fontWeight = String(st.weight);
  e.style.fontStyle = st.italic ? 'italic' : 'normal';
  const deco = [];
  if (st.underline) deco.push('underline');
  if (st.strike) deco.push('line-through');
  e.style.textDecorationLine = deco.length ? deco.join(' ') : 'none';
  e.style.color = color(st.color, theme);
  if (st.highlight) e.style.backgroundColor = color(st.highlight, theme);
  if (st.letter_spacing) e.style.letterSpacing = fitPx(st.letter_spacing);
  if (st.script === 'super') e.style.verticalAlign = 'super';
  else if (st.script === 'sub') e.style.verticalAlign = 'sub';
  if (st.lang) e.setAttribute('lang', st.lang);
  if (linkDefault) e.classList.add('pe-link');
}

function linkStyle(st, marks, theme) {
  if (!st.link) return st;
  const out = { ...st };
  const def = theme.defaults?.link || {};
  if (!marks?.color && def.color) out.color = def.color;
  if (marks?.underline === undefined && def.underline !== undefined) out.underline = def.underline;
  return out;
}

function makeLink(ctx, link) {
  const dom = ctx.dom;
  if (!ctx.interactiveLinks) {
    const span = h(dom, 'span', 'pe-link-span');
    return span;
  }
  const a = h(dom, 'a', 'pe-link');
  if (link.kind === 'url') {
    a.setAttribute('href', link.href);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  } else if (link.kind === 'slide') {
    const n = ctx.slideNumberOf ? ctx.slideNumberOf(link.slide_id) : null;
    a.setAttribute('href', n ? `#slide-${n}` : '#');
    a.dataset.linkSlide = link.slide_id;
  } else {
    a.setAttribute('href', '#');
    a.dataset.linkNav = link.target;
  }
  return a;
}

// Renders a text container into a flow element.
// opts: { kind, role, header, semantic: 'h2'|'h3'|null, prompt }
export function renderTextFlow(ctx, container, opts = {}) {
  const dom = ctx.dom;
  const theme = ctx.doc.theme;
  const base = containerBaseStyle(theme, { kind: opts.kind || 'text', role: opts.role, defaults: container?.defaults, header: opts.header });
  const body = container?.body || { paragraphs: [{ inlines: [] }] };
  const flow = h(dom, opts.semantic || 'div', 'pe-flow');
  const empty = isBodyEmpty(body);
  if (empty && ctx.mode === 'edit' && container?.prompt && !opts.noPrompt) {
    const p = h(dom, 'p', 'pe-p pe-prompt');
    const para = resolveParagraph(base.para, body.paragraphs[0]);
    styleParagraph(p, para, base.run, ctx);
    p.style.textAlign = ALIGN_CSS[para.align] || 'start';
    p.appendChild(textNode(dom, container.prompt));
    flow.appendChild(p);
    return { flow, base };
  }
  const bullets = theme.lists?.bullets || ['•'];
  const markers = listMarkers(body.paragraphs, bullets);
  const indent = theme.lists?.indent ?? 28;
  const stack = []; // [{ list, kind, level }]
  const listAt = (level, tag) => {
    while (stack.length && stack[stack.length - 1].level > level) stack.pop();
    let top = stack[stack.length - 1];
    if (top && top.level === level) {
      if (top.kind === tag) return top.list;
      stack.pop();
      top = stack[stack.length - 1];
    }
    const lst = h(dom, tag, 'pe-list');
    if (top) {
      let holder = top.list.lastElementChild;
      if (!holder) {
        holder = h(dom, 'li', 'pe-li-holder');
        top.list.appendChild(holder);
      }
      const pad = holder.classList.contains('pe-li') ? indent * (Number(holder.dataset.level) + 1) : 0;
      if (pad) lst.style.marginInlineStart = fitPx(-pad);
      holder.appendChild(lst);
    } else flow.appendChild(lst);
    stack.push({ list: lst, kind: tag, level });
    return lst;
  };
  let group = -1;
  body.paragraphs.forEach((p, pi) => {
    if (!p.list || (p.list.level || 0) === 0) group += 1;
    const para = resolveParagraph(base.para, p);
    const firstInline = (p.inlines || []).find((i) => isRun(i) || isField(i));
    const firstStyle = resolveRun(base.run, firstInline?.marks);
    let pe;
    if (p.list) {
      const level = p.list.level || 0;
      const tag = p.list.kind === 'number' ? 'ol' : 'ul';
      const lst = listAt(level, tag);
      pe = h(dom, 'li', 'pe-p pe-li');
      pe.dataset.level = String(level);
      lst.appendChild(pe);
      pe.style.paddingInlineStart = fitPx(indent * (level + 1));
      const mk = h(dom, 'span', 'pe-marker');
      mk.setAttribute('aria-hidden', 'true');
      mk.style.insetInlineStart = fitPx(indent * level);
      mk.style.width = fitPx(indent);
      applyRunStyle(mk, { ...firstStyle, underline: false, strike: false, highlight: null, script: 'normal', link: null }, ctx);
      mk.appendChild(textNode(dom, markers[pi]));
      pe.appendChild(mk);
    } else {
      stack.length = 0;
      pe = h(dom, opts.semantic ? 'span' : 'p', 'pe-p');
      flow.appendChild(pe);
    }
    pe.dataset.pgroup = String(group);
    pe.dataset.pindex = String(pi);
    if (p.dir && p.dir !== 'auto') pe.setAttribute('dir', p.dir);
    else pe.setAttribute('dir', 'auto');
    styleParagraph(pe, para, firstStyle, ctx);
    let hasContent = false;
    for (const inl of p.inlines || []) {
      if (isBreak(inl)) {
        pe.appendChild(h(dom, 'br'));
        continue;
      }
      const marks = inl.marks;
      let st = resolveRun(base.run, marks);
      st = linkStyle(st, marks, theme);
      let span;
      if (st.link) {
        span = makeLink(ctx, st.link);
      } else span = h(dom, 'span', 'pe-run');
      applyRunStyle(span, st, ctx);
      if (isRun(inl)) span.appendChild(textNode(dom, inl.text));
      else if (isField(inl)) {
        span.dataset.field = inl.field;
        span.appendChild(textNode(dom, fieldText(inl, ctx.fieldCtx)));
      }
      pe.appendChild(span);
      hasContent = true;
    }
    if (!hasContent || (p.inlines.length && isBreak(p.inlines[p.inlines.length - 1]))) pe.appendChild(h(dom, 'br'));
  });
  return { flow, base };
}

function styleParagraph(pe, para, firstStyle, ctx) {
  pe.style.textAlign = ALIGN_CSS[para.align] || 'start';
  pe.style.lineHeight = String(para.line);
  if (para.before) pe.style.paddingBlockStart = fitPx(para.before);
  if (para.after) pe.style.paddingBlockEnd = fitPx(para.after);
  pe.style.fontFamily = cssFontFamily(firstStyle.font, ctx.doc);
  pe.style.fontSize = fitPx(firstStyle.size);
  pe.style.color = color(firstStyle.color, ctx.doc.theme);
}
