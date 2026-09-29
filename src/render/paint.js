// Fills, strokes and shadows for DOM (CSS) and SVG targets (spec §5.8).
import { resolveColor, toCss } from '../core/color.js';
import { s, r2 } from './dom.js';

export function color(c, theme, fallback = '#000000') {
  return toCss(resolveColor(c, theme, fallback));
}

function cssStops(stops, theme) {
  return stops
    .slice()
    .sort((a, b) => a.offset - b.offset)
    .map((st) => `${color(st.color, theme)} ${r2(st.offset * 100)}%`)
    .join(', ');
}

// Applies a fill to an element's CSS background.
export function applyCssFill(elem, fill, theme, ctx) {
  const st = elem.style;
  if (!fill || fill === 'none') {
    st.background = 'transparent';
    return;
  }
  switch (fill.type) {
    case 'solid':
      st.backgroundColor = color(fill.color, theme);
      break;
    case 'linear':
      st.backgroundImage = `linear-gradient(${r2(fill.angle)}deg, ${cssStops(fill.stops, theme)})`;
      break;
    case 'radial':
      st.backgroundImage = `radial-gradient(circle farthest-corner at ${r2(fill.center_x * 100)}% ${r2(fill.center_y * 100)}%, ${cssStops(fill.stops, theme)})`;
      break;
    case 'image': {
      const url = ctx.assetUrl(fill.asset_id);
      if (!url) {
        st.backgroundColor = '#cbd5e1';
        break;
      }
      st.backgroundImage = `url("${url}")`;
      if (fill.mode === 'tile') {
        const info = ctx.assetInfo?.(fill.asset_id);
        const sc = fill.scale || 1;
        st.backgroundRepeat = 'repeat';
        st.backgroundSize = info?.width ? `${r2(info.width * sc)}px ${r2(info.height * sc)}px` : 'auto';
      } else {
        st.backgroundRepeat = 'no-repeat';
        st.backgroundPosition = 'center';
        st.backgroundSize = fill.mode === 'contain' ? 'contain' : fill.mode === 'stretch' ? '100% 100%' : 'cover';
      }
      break;
    }
    default:
      break;
  }
}

let gradientSeq = 0;

// Returns an SVG paint value, adding gradients/patterns to `defs` when needed.
export function svgPaint(dom, defs, fill, theme, ctx, box, idBase) {
  if (!fill || fill === 'none') return 'none';
  if (fill.type === 'solid') return color(fill.color, theme);
  const id = `pe-${idBase}-p${++gradientSeq}`;
  if (fill.type === 'linear') {
    const a = (fill.angle * Math.PI) / 180;
    const g = s(dom, 'linearGradient', {
      id,
      x1: r2(0.5 - 0.5 * Math.sin(a)),
      y1: r2(0.5 + 0.5 * Math.cos(a)),
      x2: r2(0.5 + 0.5 * Math.sin(a)),
      y2: r2(0.5 - 0.5 * Math.cos(a)),
    });
    for (const st of fill.stops.slice().sort((x, y) => x.offset - y.offset)) g.appendChild(s(dom, 'stop', { offset: st.offset, 'stop-color': color(st.color, theme) }));
    defs.appendChild(g);
    return `url(#${id})`;
  }
  if (fill.type === 'radial') {
    const cx = fill.center_x;
    const cy = fill.center_y;
    const rr = Math.max(Math.hypot(cx, cy), Math.hypot(1 - cx, cy), Math.hypot(cx, 1 - cy), Math.hypot(1 - cx, 1 - cy));
    const g = s(dom, 'radialGradient', { id, cx, cy, r: r2(rr), fx: cx, fy: cy });
    for (const st of fill.stops.slice().sort((x, y) => x.offset - y.offset)) g.appendChild(s(dom, 'stop', { offset: st.offset, 'stop-color': color(st.color, theme) }));
    defs.appendChild(g);
    return `url(#${id})`;
  }
  if (fill.type === 'image') {
    const url = ctx.assetUrl(fill.asset_id);
    if (!url) return '#cbd5e1';
    const info = ctx.assetInfo?.(fill.asset_id);
    let p;
    if (fill.mode === 'tile' && info?.width) {
      const sc = fill.scale || 1;
      const w = info.width * sc;
      const h2 = info.height * sc;
      p = s(dom, 'pattern', { id, patternUnits: 'userSpaceOnUse', width: r2(w), height: r2(h2) });
      p.appendChild(s(dom, 'image', { href: url, width: r2(w), height: r2(h2), preserveAspectRatio: 'none' }));
    } else {
      p = s(dom, 'pattern', { id, patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: r2(box.width), height: r2(box.height) });
      const par = fill.mode === 'contain' ? 'xMidYMid meet' : fill.mode === 'stretch' ? 'none' : 'xMidYMid slice';
      p.appendChild(s(dom, 'image', { href: url, x: 0, y: 0, width: r2(box.width), height: r2(box.height), preserveAspectRatio: par }));
    }
    defs.appendChild(p);
    return `url(#${id})`;
  }
  return 'none';
}

export function dashArray(dash, width) {
  const w = Math.max(1, width);
  switch (dash) {
    case 'dash': return `${r2(w * 4)} ${r2(w * 3)}`;
    case 'dot': return `${r2(w)} ${r2(w * 2)}`;
    case 'dash_dot': return `${r2(w * 4)} ${r2(w * 2)} ${r2(w)} ${r2(w * 2)}`;
    case 'long_dash': return `${r2(w * 8)} ${r2(w * 3)}`;
    default: return null;
  }
}

export function strokeAttrs(stroke, theme) {
  if (!stroke || stroke === 'none' || !stroke.width) return { stroke: 'none' };
  const out = {
    stroke: color(stroke.color, theme),
    'stroke-width': r2(stroke.width),
    'stroke-linecap': { flat: 'butt', round: 'round', square: 'square' }[stroke.cap || 'flat'],
    'stroke-linejoin': stroke.join || 'miter',
  };
  const da = dashArray(stroke.dash, stroke.width);
  if (da) out['stroke-dasharray'] = da;
  return out;
}

export function shadowFilter(shadow, theme) {
  if (!shadow || shadow === 'none') return null;
  return `drop-shadow(${r2(shadow.offset_x)}px ${r2(shadow.offset_y)}px ${r2(shadow.blur / 2)}px ${color(shadow.color, theme)})`;
}

export function cssBorderStyle(dash) {
  if (dash === 'dot') return 'dotted';
  if (dash && dash !== 'solid') return 'dashed';
  return 'solid';
}
