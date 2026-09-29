// Colors (spec §5.8): token references { token, tint } or literal #RRGGBB / #RRGGBBAA.
export const HEX_RE = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isHex(v) {
  return typeof v === 'string' && HEX_RE.test(v);
}

export function parseHex(hex) {
  const h = hex.slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

const hx = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

export function toHex({ r, g, b, a = 1 }) {
  const base = `#${hx(r)}${hx(g)}${hx(b)}`;
  return a >= 1 ? base : base + hx(a * 255);
}

// tint in [-1, 1]: negative mixes toward black, positive toward white.
export function applyTint(hex, tint = 0) {
  if (!tint) return hex;
  const c = parseHex(hex);
  const t = Math.max(-1, Math.min(1, tint));
  const mix = (v) => (t < 0 ? v * (1 + t) : v + (255 - v) * t);
  return toHex({ r: mix(c.r), g: mix(c.g), b: mix(c.b), a: c.a });
}

export function resolveColor(color, theme, fallback = '#000000') {
  if (!color || color === 'none') return fallback;
  if (typeof color === 'string') return isHex(color) ? color : fallback;
  if (color.token) {
    const base = theme?.colors?.[color.token];
    if (!base) return fallback;
    return applyTint(base, color.tint || 0);
  }
  return fallback;
}

export function toCss(hex) {
  if (!isHex(hex)) return 'transparent';
  if (hex.length === 7) return hex;
  const c = parseHex(hex);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 1000) / 1000})`;
}

function channel(v) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const c = parseHex(hex);
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Composites a possibly transparent color over an opaque background.
export function composite(fg, bg) {
  const f = parseHex(fg);
  const b = parseHex(bg);
  const a = f.a;
  return toHex({ r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a) });
}
