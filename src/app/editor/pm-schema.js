// ProseMirror schema generated from the canonical text model (spec §3.3, §5.9).
// DOM output uses CSSOM setters only (no style attributes), matching the renderer.
import { Schema } from 'prosemirror-model';
import { applyRunStyle, ALIGN_CSS } from '../../render/text.js';
import { fitPx } from '../../render/dom.js';
import { cssFontFamily } from '../../render/fonts.js';
import { color as paintColor } from '../../render/paint.js';
import { fieldText } from '../../core/fields.js';
import { isAllowedUrl } from '../../core/validate.js';
import { MARK_KEYS } from '../../core/text.js';

// The editing session sets this so toDOM can resolve theme tokens and fonts.
export const renderEnv = { ctx: null, base: null, indent: 28 };

function paragraphDom(node) {
  const p = document.createElement('p');
  p.className = 'pe-p';
  const env = renderEnv;
  const a = node.attrs;
  if (env.base) {
    const para = { ...env.base.para };
    if (a.align) para.align = a.align;
    if (a.spacing) Object.assign(para, a.spacing);
    p.style.textAlign = ALIGN_CSS[para.align] || 'start';
    p.style.lineHeight = String(para.line);
    if (para.before) p.style.paddingBlockStart = fitPx(para.before);
    if (para.after) p.style.paddingBlockEnd = fitPx(para.after);
    let first = null;
    node.forEach((child) => {
      if (!first && (child.isText || child.type.name === 'field')) first = child;
    });
    const run = { ...env.base.run };
    if (first) for (const m of first.marks) if (m.type.name !== 'link') run[m.type.name] = m.attrs.value;
    if (env.ctx) {
      p.style.fontFamily = cssFontFamily(run.font, env.ctx.doc);
      p.style.fontSize = fitPx(run.size);
      p.style.color = paintColor(run.color, env.ctx.doc.theme);
    }
  }
  if (a.list) {
    const level = a.list.level || 0;
    p.classList.add('pe-li');
    p.style.paddingInlineStart = fitPx(env.indent * (level + 1));
  }
  p.setAttribute('dir', a.dir && a.dir !== 'auto' ? a.dir : 'auto');
  return p;
}

function markSpec(key) {
  return {
    attrs: { value: {} },
    inclusive: key !== 'link',
    excludes: key,
    toDOM(mark) {
      const env = renderEnv;
      const span = document.createElement(key === 'link' ? 'a' : 'span');
      span.dataset.peMark = key;
      span.dataset.peValue = JSON.stringify(mark.attrs.value);
      if (!env.ctx) return span;
      const partial = { [key]: mark.attrs.value };
      // Apply only this mark's property; nested spans combine.
      const st = { ...env.base.run, ...partial };
      const probe = document.createElement('span');
      applyRunStyle(probe, st, env.ctx);
      const map = {
        font: ['fontFamily'],
        size: ['fontSize', 'verticalAlign'],
        weight: ['fontWeight'],
        italic: ['fontStyle'],
        underline: ['textDecorationLine'],
        strike: ['textDecorationLine'],
        script: ['verticalAlign', 'fontSize'],
        color: ['color'],
        highlight: ['backgroundColor'],
        letter_spacing: ['letterSpacing'],
        link: [],
        lang: [],
      };
      for (const prop of map[key]) if (probe.style[prop]) span.style[prop] = probe.style[prop];
      if (key === 'underline' || key === 'strike') span.style.textDecorationLine = mark.attrs.value ? (key === 'underline' ? 'underline' : 'line-through') : 'none';
      if (key === 'lang' && mark.attrs.value) span.setAttribute('lang', mark.attrs.value);
      if (key === 'link') {
        span.classList.add('pe-link');
        const theme = env.ctx.doc.theme;
        const def = theme.defaults?.link || {};
        span.style.color = paintColor(def.color, theme);
        if (def.underline) span.style.textDecorationLine = 'underline';
      }
      return span;
    },
    parseDOM: [
      {
        tag: `[data-pe-mark="${key}"]`,
        getAttrs(dom) {
          try {
            return { value: JSON.parse(dom.dataset.peValue) };
          } catch {
            return false;
          }
        },
      },
      ...externalParse(key),
    ],
  };
}

// Rich paste from outside keeps only bold, italic, underline, strikethrough,
// super/subscript and allowlisted links (spec §12.4).
function externalParse(key) {
  switch (key) {
    case 'weight':
      return [
        { tag: 'b', getAttrs: () => ({ value: 700 }) },
        { tag: 'strong', getAttrs: () => ({ value: 700 }) },
        { style: 'font-weight', getAttrs: (v) => (/^(bold|[6-9]00)$/.test(v) ? { value: 700 } : false) },
      ];
    case 'italic':
      return [{ tag: 'i', getAttrs: () => ({ value: true }) }, { tag: 'em', getAttrs: () => ({ value: true }) }, { style: 'font-style=italic', getAttrs: () => ({ value: true }) }];
    case 'underline':
      return [{ tag: 'u', getAttrs: () => ({ value: true }) }, { style: 'text-decoration', getAttrs: (v) => (/underline/.test(v) ? { value: true } : false) }];
    case 'strike':
      return [{ tag: 's', getAttrs: () => ({ value: true }) }, { tag: 'strike', getAttrs: () => ({ value: true }) }, { tag: 'del', getAttrs: () => ({ value: true }) }];
    case 'script':
      return [{ tag: 'sup', getAttrs: () => ({ value: 'super' }) }, { tag: 'sub', getAttrs: () => ({ value: 'sub' }) }];
    case 'link':
      return [
        {
          tag: 'a[href]',
          getAttrs: (dom) => {
            const href = dom.getAttribute('href');
            return isAllowedUrl(href) ? { value: { kind: 'url', href } } : false;
          },
        },
      ];
    default:
      return [];
  }
}

function listFromDom(dom) {
  const li = dom.closest ? dom : null;
  if (!li || li.tagName !== 'LI') return null;
  let level = -1;
  let kind = 'bullet';
  let first = true;
  for (let n = li.parentElement; n; n = n.parentElement) {
    if (n.tagName === 'UL' || n.tagName === 'OL') {
      level += 1;
      if (first) {
        kind = n.tagName === 'OL' ? 'number' : 'bullet';
        first = false;
      }
    }
  }
  return { kind, level: Math.max(0, Math.min(8, level)) };
}

const marks = {};
for (const k of MARK_KEYS) marks[k] = markSpec(k);

export const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'inline*',
      attrs: { align: { default: null }, dir: { default: null }, list: { default: null }, spacing: { default: null } },
      toDOM: (node) => {
        const p = paragraphDom(node);
        return { dom: p, contentDOM: p };
      },
      parseDOM: [
        {
          tag: 'p',
          getAttrs: (dom) => {
            if (dom.dataset?.peList) {
              try {
                return { list: JSON.parse(dom.dataset.peList) };
              } catch {
                return {};
              }
            }
            return {};
          },
        },
        { tag: 'li', getAttrs: (dom) => ({ list: listFromDom(dom) }) },
        { tag: 'h1' },
        { tag: 'h2' },
        { tag: 'h3' },
        { tag: 'h4' },
        { tag: 'h5' },
        { tag: 'h6' },
        { tag: 'div', priority: 10 },
      ],
    },
    text: { group: 'inline' },
    field: {
      inline: true,
      group: 'inline',
      atom: true,
      selectable: true,
      attrs: { field: { default: 'slide_number' }, format: { default: null }, value: { default: null } },
      toDOM(node) {
        const span = document.createElement('span');
        span.className = 'pe-field-node';
        span.dataset.field = node.attrs.field;
        span.contentEditable = 'false';
        span.textContent = fieldText(node.attrs, renderEnv.ctx?.fieldCtx);
        return span;
      },
      parseDOM: [{ tag: 'span[data-field]', getAttrs: (dom) => ({ field: dom.dataset.field }) }],
    },
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      toDOM: () => document.createElement('br'),
      parseDOM: [{ tag: 'br' }],
    },
  },
  marks,
});

// ---------- conversion ----------

export function bodyToPm(body) {
  const paragraphs = (body?.paragraphs?.length ? body.paragraphs : [{ inlines: [] }]).map((p) => {
    const content = [];
    for (const i of p.inlines || []) {
      const ms = [];
      if (i.marks) {
        for (const [k, v] of Object.entries(i.marks)) if (schema.marks[k]) ms.push(schema.marks[k].create({ value: v }));
      }
      if (typeof i.text === 'string') {
        if (i.text) content.push(schema.text(i.text, ms));
      } else if (i.field) content.push(schema.nodes.field.create({ field: i.field, format: i.format || null, value: i.value || null }, null, ms));
      else if (i.break) content.push(schema.nodes.hard_break.create());
    }
    return schema.nodes.paragraph.create({ align: p.align || null, dir: p.dir || null, list: p.list || null, spacing: p.spacing || null }, content);
  });
  return schema.nodes.doc.create(null, paragraphs);
}

function marksOf(node) {
  const out = {};
  for (const m of node.marks) out[m.type.name] = m.attrs.value;
  return Object.keys(out).length ? out : undefined;
}

export function pmToBody(doc) {
  const paragraphs = [];
  doc.forEach((p) => {
    const inlines = [];
    p.forEach((n) => {
      if (n.isText) {
        const marks = marksOf(n);
        const prev = inlines[inlines.length - 1];
        if (prev && typeof prev.text === 'string' && JSON.stringify(prev.marks) === JSON.stringify(marks)) prev.text += n.text;
        else inlines.push(marks ? { text: n.text, marks } : { text: n.text });
      } else if (n.type.name === 'field') {
        const f = { field: n.attrs.field };
        if (n.attrs.format) f.format = n.attrs.format;
        if (n.attrs.value) f.value = n.attrs.value;
        const marks = marksOf(n);
        if (marks) f.marks = marks;
        inlines.push(f);
      } else if (n.type.name === 'hard_break') inlines.push({ break: true });
    });
    const para = { inlines };
    if (p.attrs.align) para.align = p.attrs.align;
    if (p.attrs.dir) para.dir = p.attrs.dir;
    if (p.attrs.list) para.list = p.attrs.list;
    if (p.attrs.spacing) para.spacing = p.attrs.spacing;
    paragraphs.push(para);
  });
  return { paragraphs };
}
