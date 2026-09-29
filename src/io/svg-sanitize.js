// SVG sanitizer (spec §18.2). Builds a fresh SVG from an allowlist of elements
// and attributes, inlines simple <style> rules as presentation attributes, drops
// scripts, event handlers, animation and external references. Deterministic and
// idempotent: already-sanitized output passes through unchanged (spec §8.4).
import { LIMITS } from '../core/limits.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'title', 'desc', 'linearGradient', 'radialGradient', 'stop', 'pattern',
  'clipPath', 'mask', 'image', 'marker', 'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix',
  'feComposite', 'feFlood', 'feMerge', 'feMergeNode', 'feDropShadow', 'feMorphology', 'feComponentTransfer',
  'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA',
]);
// Elements whose children are kept but which themselves are dropped.
const UNWRAP = new Set(['a', 'switch']);

const PAINT_PROPS = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'clip-path', 'clip-rule', 'mask', 'filter',
  'stop-color', 'stop-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor',
  'dominant-baseline', 'letter-spacing', 'word-spacing', 'text-decoration', 'visibility', 'display', 'color',
  'marker-start', 'marker-mid', 'marker-end', 'flood-color', 'flood-opacity', 'vector-effect', 'paint-order',
  'shape-rendering', 'color-interpolation-filters', 'mix-blend-mode',
];
const PAINT_SET = new Set(PAINT_PROPS);

const ATTRS = new Set([
  ...PAINT_PROPS, 'id', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr', 'width', 'height',
  'd', 'points', 'transform', 'viewBox', 'preserveAspectRatio', 'offset', 'gradientUnits', 'gradientTransform',
  'spreadMethod', 'patternUnits', 'patternContentUnits', 'patternTransform', 'clipPathUnits', 'maskUnits',
  'maskContentUnits', 'href', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'markerWidth', 'markerHeight',
  'refX', 'refY', 'orient', 'markerUnits', 'stdDeviation', 'in', 'in2', 'result', 'mode', 'operator', 'k1', 'k2',
  'k3', 'k4', 'values', 'type', 'radius', 'filterUnits', 'primitiveUnits', 'startOffset', 'method', 'spacing',
  'tableValues', 'slope', 'intercept', 'amplitude', 'exponent', 'xml:space',
]);

export class SvgError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SvgError';
  }
}

function safeValue(name, value) {
  const v = String(value).trim();
  if (!v) return null;
  if (/javascript:|vbscript:|data:(?!image\/(png|jpeg);base64,)|expression\s*\(|@import|\\/i.test(v)) return null;
  // url() references must be internal fragment references
  const urls = v.match(/url\s*\(([^)]*)\)/gi);
  if (urls) {
    for (const u of urls) {
      const inner = u.replace(/^url\s*\(\s*['"]?|['"]?\s*\)$/gi, '');
      if (!inner.startsWith('#')) return null;
    }
  }
  if (name === 'href') {
    if (v.startsWith('#')) return /^#[A-Za-z_][\w.-]*$/.test(v) ? v : null;
    if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\s]+$/i.test(v)) return v.replace(/\s+/g, '');
    return null;
  }
  if (v.length > 200000) return null;
  return v;
}

function parseDecls(text) {
  const out = [];
  for (const part of String(text).split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const val = part.slice(i + 1).trim().replace(/\s*!important\s*$/i, '');
    if (PAINT_SET.has(prop) && val) out.push([prop, val]);
  }
  return out;
}

// Parses simple CSS rules (type, class, id selectors and lists of them).
function parseStyleRules(css) {
  const rules = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m;
  // skip at-rules (with nested blocks) by removing them first
  const noAt = src.replace(/@[^{;]+;/g, '').replace(/@[^{]+\{([^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  while ((m = re.exec(noAt))) {
    const selectors = m[1].split(',').map((x) => x.trim()).filter(Boolean);
    const decls = parseDecls(m[2]);
    for (const sel of selectors) {
      if (/^[A-Za-z][\w-]*$/.test(sel)) rules.push({ kind: 'type', value: sel, decls });
      else if (/^\.[\w-]+$/.test(sel)) rules.push({ kind: 'class', value: sel.slice(1), decls });
      else if (/^#[\w-]+$/.test(sel)) rules.push({ kind: 'id', value: sel.slice(1), decls });
      else if (/^[A-Za-z][\w-]*\.[\w-]+$/.test(sel)) {
        const [t, c] = sel.split('.');
        rules.push({ kind: 'typeclass', value: t, cls: c, decls });
      }
    }
  }
  return rules;
}

function matches(rule, el) {
  const cls = (el.getAttribute('class') || '').split(/\s+/);
  switch (rule.kind) {
    case 'type': return el.localName === rule.value;
    case 'class': return cls.includes(rule.value);
    case 'id': return el.getAttribute('id') === rule.value;
    case 'typeclass': return el.localName === rule.value && cls.includes(rule.cls);
    default: return false;
  }
}

function parseLength(v) {
  if (!v) return null;
  const m = /^\s*([0-9.]+)\s*(px|pt|in|cm|mm|pc)?\s*$/.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const f = { px: 1, pt: 4 / 3, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pc: 16 }[m[2] || 'px'];
  return n * f;
}

// Returns { svg: string, width, height }.
export function sanitizeSvg(text, { DOMParserImpl, XMLSerializerImpl, docImpl } = {}) {
  if (typeof text !== 'string') throw new SvgError('SVG must be text.');
  if (text.length > LIMITS.svgBytes) throw new SvgError('The SVG file is larger than 5 MB.');
  if (/<!ENTITY/i.test(text) || /<!DOCTYPE[^>]*\[/i.test(text)) throw new SvgError('SVG files with DTD entities aren’t allowed.');
  const DP = DOMParserImpl || globalThis.DOMParser;
  const XS = XMLSerializerImpl || globalThis.XMLSerializer;
  const parsed = new DP().parseFromString(text, 'image/svg+xml');
  const src = parsed.documentElement;
  if (!src || src.localName !== 'svg' || parsed.getElementsByTagName('parsererror').length) throw new SvgError('The SVG file couldn’t be read.');
  // collect <style> rules
  const rules = [];
  for (const st of [...parsed.getElementsByTagName('style')]) rules.push(...parseStyleRules(st.textContent || ''));
  const out = (docImpl || parsed).implementation.createDocument(SVG_NS, 'svg', null);
  const root = out.documentElement;
  let count = 0;
  const copyAttrs = (from, to) => {
    const attrs = new Map();
    for (const a of [...from.attributes]) {
      let name = a.localName;
      if (a.namespaceURI === XLINK_NS && name === 'href') name = 'href';
      else if (a.prefix === 'xml' && name === 'space') name = 'xml:space';
      else if (a.namespaceURI && a.namespaceURI !== XLINK_NS && a.prefix !== 'xml') continue;
      if (/^on/i.test(name)) continue;
      if (name === 'style' || name === 'class') continue;
      if (!ATTRS.has(name)) continue;
      attrs.set(name, a.value);
    }
    for (const r of rules) if (matches(r, from)) for (const [p, v] of r.decls) attrs.set(p, v);
    const style = from.getAttribute('style');
    if (style) for (const [p, v] of parseDecls(style)) attrs.set(p, v);
    for (const name of [...attrs.keys()].sort()) {
      const v = safeValue(name, attrs.get(name));
      if (v === null) continue;
      if (name === 'xml:space') to.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', v);
      else to.setAttribute(name, v);
    }
  };
  const walk = (from, to, depth) => {
    if (depth > LIMITS.svgDepth) throw new SvgError('The SVG is nested too deeply.');
    for (const child of [...from.childNodes]) {
      if (child.nodeType === 3) {
        if (['text', 'tspan', 'textPath', 'title', 'desc'].includes(from.localName)) to.appendChild(out.createTextNode(child.nodeValue));
        continue;
      }
      if (child.nodeType !== 1) continue;
      if (child.namespaceURI !== SVG_NS) continue;
      const name = child.localName;
      if (UNWRAP.has(name)) {
        walk(child, to, depth + 1);
        continue;
      }
      if (!ELEMENTS.has(name)) continue;
      if (++count > LIMITS.svgNodes) throw new SvgError('The SVG has too many elements.');
      const n = out.createElementNS(SVG_NS, name);
      copyAttrs(child, n);
      if (name === 'image' && !n.getAttribute('href')) continue;
      if (name === 'use' && !n.getAttribute('href')) continue;
      to.appendChild(n);
      walk(child, n, depth + 1);
    }
  };
  copyAttrs(src, root);
  walk(src, root, 1);
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  let width = parseLength(root.getAttribute('width'));
  let height = parseLength(root.getAttribute('height'));
  if (vb.length === 4 && vb.every((n) => isFinite(n)) && vb[2] > 0 && vb[3] > 0) {
    if (!width && !height) {
      width = vb[2];
      height = vb[3];
    } else if (width && !height) height = (width * vb[3]) / vb[2];
    else if (height && !width) width = (height * vb[2]) / vb[3];
  }
  if (!width || !height) throw new SvgError('The SVG has no viewBox or size, so it can’t be placed.');
  if (!root.getAttribute('width') || !/^[0-9.]+$/.test(root.getAttribute('width'))) root.setAttribute('width', String(Math.round(width * 100) / 100));
  if (!root.getAttribute('height') || !/^[0-9.]+$/.test(root.getAttribute('height'))) root.setAttribute('height', String(Math.round(height * 100) / 100));
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${Math.round(width * 100) / 100} ${Math.round(height * 100) / 100}`);
  // re-sort root attributes after additions for determinism
  const rootAttrs = [...root.attributes].map((a) => [a.name, a.value]).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [n] of rootAttrs) root.removeAttribute(n);
  for (const [n, v] of rootAttrs) {
    if (n === 'xml:space') root.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', v);
    else root.setAttribute(n, v);
  }
  let svg = new XS().serializeToString(root);
  if (!svg.includes('xmlns=')) svg = svg.replace('<svg', `<svg xmlns="${SVG_NS}"`);
  return { svg, width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100 };
}
