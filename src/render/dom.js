// Small DOM helpers for the renderer. Styles are always applied through CSSOM
// property setters with validated values (spec §3.2, §18.2).
export const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(dom, tag, cls) {
  const e = dom.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

export function s(dom, tag, attrs = {}) {
  const e = dom.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) e.setAttribute(k, String(v));
  }
  return e;
}

export const r2 = (n) => Math.round(n * 100) / 100;
export const px = (n) => `${r2(n)}px`;
// Lengths inside text flows scale with --pe-fit (shrink-to-fit, spec §5.9).
export const fitPx = (n) => `calc(${r2(n)}px * var(--pe-fit, 1))`;

export function setStyles(e, styles) {
  for (const [k, v] of Object.entries(styles)) {
    if (v === undefined || v === null) continue;
    if (k.startsWith('--')) e.style.setProperty(k, String(v));
    else e.style[k] = v;
  }
  return e;
}

export function text(dom, str) {
  return dom.createTextNode(str);
}
