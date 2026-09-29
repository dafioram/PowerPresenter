// Shape catalog (spec §13.2). Every preset maps to a DrawingML preset so PPTX
// export keeps shapes editable. Geometry is generated for a w × h box.
const f = (n) => String(Math.round(n * 100) / 100);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function poly(points) {
  return 'M' + points.map((p) => `${f(p[0])} ${f(p[1])}`).join('L') + 'Z';
}

function roundRectPath(w, h, r0) {
  const r = clamp(r0, 0, Math.min(w, h) / 2);
  if (r <= 0) return `M0 0H${f(w)}V${f(h)}H0Z`;
  return (
    `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(h - r)}` +
    `A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}` +
    `V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`
  );
}

function ellipsePath(w, h, x0 = 0, y0 = 0) {
  const rx = w / 2;
  const ry = h / 2;
  return `M${f(x0)} ${f(y0 + ry)}A${f(rx)} ${f(ry)} 0 1 1 ${f(x0 + w)} ${f(y0 + ry)}A${f(rx)} ${f(ry)} 0 1 1 ${f(x0)} ${f(y0 + ry)}Z`;
}

// Scales a set of points so their bounding box fills 0..w × 0..h.
function fitPoints(pts, w, h) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return pts.map((p) => [((p[0] - minX) / (maxX - minX || 1)) * w, ((p[1] - minY) / (maxY - minY || 1)) * h]);
}

function starPoints(n, inner) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 === 0 ? 1 : inner;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

let cloudCache = null;
function cloudPoints() {
  if (cloudCache) return cloudCache;
  const pts = [];
  const N = 240;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const r = 0.8 + 0.2 * Math.abs(Math.sin(4.5 * t + 0.3)) ** 0.6;
    pts.push([Math.cos(t) * r * 1.25, Math.sin(t) * r]);
  }
  cloudCache = pts;
  return pts;
}

function calloutWedge(w, h, a) {
  const tip = { x: w / 2 + a.tail_x * w, y: h / 2 + a.tail_y * h };
  let edge;
  if (tip.y > h) edge = 'bottom';
  else if (tip.y < 0) edge = 'top';
  else if (tip.x < 0) edge = 'left';
  else if (tip.x > w) edge = 'right';
  else edge = 'none';
  return { tip, edge };
}

function rectCallout(w, h, a, r = 0) {
  const { tip, edge } = calloutWedge(w, h, a);
  const rr = clamp(r, 0, Math.min(w, h) / 2);
  const bw = Math.max(4, w / 6);
  const bh = Math.max(4, h / 6);
  const bx = clamp(w / 2 + (tip.x - w / 2) * 0.5, rr + bw / 2, w - rr - bw / 2);
  const by = clamp(h / 2 + (tip.y - h / 2) * 0.5, rr + bh / 2, h - rr - bh / 2);
  const arc = (x, y) => (rr > 0 ? `A${f(rr)} ${f(rr)} 0 0 1 ${f(x)} ${f(y)}` : `L${f(x)} ${f(y)}`);
  let d = `M${f(rr)} 0`;
  if (edge === 'top') d += `L${f(bx - bw / 2)} 0L${f(tip.x)} ${f(tip.y)}L${f(bx + bw / 2)} 0`;
  d += `L${f(w - rr)} 0` + arc(w, rr);
  if (edge === 'right') d += `L${f(w)} ${f(by - bh / 2)}L${f(tip.x)} ${f(tip.y)}L${f(w)} ${f(by + bh / 2)}`;
  d += `L${f(w)} ${f(h - rr)}` + arc(w - rr, h);
  if (edge === 'bottom') d += `L${f(bx + bw / 2)} ${f(h)}L${f(tip.x)} ${f(tip.y)}L${f(bx - bw / 2)} ${f(h)}`;
  d += `L${f(rr)} ${f(h)}` + arc(0, h - rr);
  if (edge === 'left') d += `L0 ${f(by + bh / 2)}L${f(tip.x)} ${f(tip.y)}L0 ${f(by - bh / 2)}`;
  d += `L0 ${f(rr)}` + arc(rr, 0) + 'Z';
  return d;
}

function ovalCallout(w, h, a) {
  const tip = { x: w / 2 + a.tail_x * w, y: h / 2 + a.tail_y * h };
  const rx = w / 2;
  const ry = h / 2;
  const ang = Math.atan2((tip.y - ry) / ry, (tip.x - rx) / rx);
  const inside = ((tip.x - rx) / rx) ** 2 + ((tip.y - ry) / ry) ** 2 <= 1;
  if (inside) return ellipsePath(w, h);
  const d = 0.18;
  const p1 = { x: rx + rx * Math.cos(ang - d), y: ry + ry * Math.sin(ang - d) };
  const p2 = { x: rx + rx * Math.cos(ang + d), y: ry + ry * Math.sin(ang + d) };
  return `M${f(p2.x)} ${f(p2.y)}A${f(rx)} ${f(ry)} 0 1 1 ${f(p1.x)} ${f(p1.y)}L${f(tip.x)} ${f(tip.y)}Z`;
}

const full = (w, h) => ({ x: 0, y: 0, width: w, height: h });
const inset = (w, h, fx, fy) => ({ x: w * fx, y: h * fy, width: w * (1 - 2 * fx), height: h * (1 - 2 * fy) });
const ss = (w, h) => Math.min(w, h);
const rectSites = { top: 0, left: 1, bottom: 2, right: 3 };

export const SHAPES = [
  {
    id: 'rect', label: 'Rectangle', category: 'Basic', ooxml: 'rect', adjust: {}, ooxmlSites: rectSites,
    path: (w, h) => `M0 0H${f(w)}V${f(h)}H0Z`, textRect: full, ooxmlAdjust: () => ({}),
  },
  {
    id: 'round_rect', label: 'Rounded rectangle', category: 'Basic', ooxml: 'roundRect', adjust: { radius: 16 }, ooxmlSites: rectSites,
    path: (w, h, a) => roundRectPath(w, h, a.radius),
    textRect: (w, h, a) => {
      const r = clamp(a.radius, 0, ss(w, h) / 2) * 0.29289;
      return { x: r, y: r, width: w - 2 * r, height: h - 2 * r };
    },
    ooxmlAdjust: (w, h, a) => ({ adj: Math.round((clamp(a.radius, 0, ss(w, h) / 2) / ss(w, h)) * 100000) }),
    handles: [{ key: 'radius', pos: (w, h, a) => ({ x: clamp(a.radius, 0, ss(w, h) / 2), y: 0 }), set: (w, h, p) => ({ radius: Math.round(clamp(p.x, 0, ss(w, h) / 2)) }) }],
  },
  {
    id: 'ellipse', label: 'Ellipse', category: 'Basic', ooxml: 'ellipse', adjust: {},
    path: (w, h) => ellipsePath(w, h), textRect: (w, h) => inset(w, h, 0.1464, 0.1464), ooxmlAdjust: () => ({}),
  },
  {
    id: 'triangle', label: 'Triangle', category: 'Basic', ooxml: 'triangle', adjust: { apex: 0.5 },
    path: (w, h, a) => poly([[w * a.apex, 0], [w, h], [0, h]]),
    textRect: (w, h, a) => ({ x: (w * a.apex) / 2, y: h / 2, width: w / 2, height: h / 2 }),
    ooxmlAdjust: (w, h, a) => ({ adj: Math.round(a.apex * 100000) }),
    handles: [{ key: 'apex', pos: (w, h, a) => ({ x: w * a.apex, y: 0 }), set: (w, h, p) => ({ apex: Math.round(clamp(p.x / w, 0, 1) * 1000) / 1000 }) }],
  },
  {
    id: 'right_triangle', label: 'Right triangle', category: 'Basic', ooxml: 'rtTriangle', adjust: {},
    path: (w, h) => poly([[0, 0], [w, h], [0, h]]),
    textRect: (w, h) => ({ x: w / 12, y: (h * 7) / 12, width: w / 2, height: h / 3 }), ooxmlAdjust: () => ({}),
  },
  {
    id: 'diamond', label: 'Diamond', category: 'Basic', ooxml: 'diamond', adjust: {}, ooxmlSites: rectSites,
    path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]),
    textRect: (w, h) => inset(w, h, 0.25, 0.25), ooxmlAdjust: () => ({}),
  },
  {
    id: 'parallelogram', label: 'Parallelogram', category: 'Basic', ooxml: 'parallelogram', adjust: { offset: 0.25 },
    path: (w, h, a) => {
      const o = clamp(a.offset * ss(w, h), 0, w);
      return poly([[o, 0], [w, 0], [w - o, h], [0, h]]);
    },
    textRect: (w, h, a) => {
      const o = clamp(a.offset * ss(w, h), 0, w / 2);
      return { x: o / 2 + o / 4, y: h * 0.08, width: Math.max(1, w - o * 1.5), height: h * 0.84 };
    },
    ooxmlAdjust: (w, h, a) => ({ adj: Math.round(a.offset * 100000) }),
    handles: [{ key: 'offset', pos: (w, h, a) => ({ x: clamp(a.offset * ss(w, h), 0, w), y: 0 }), set: (w, h, p) => ({ offset: Math.round(clamp(p.x / ss(w, h), 0, w / ss(w, h)) * 1000) / 1000 }) }],
  },
  {
    id: 'trapezoid', label: 'Trapezoid', category: 'Basic', ooxml: 'trapezoid', adjust: { offset: 0.25 },
    path: (w, h, a) => {
      const o = clamp(a.offset * ss(w, h), 0, w / 2);
      return poly([[o, 0], [w - o, 0], [w, h], [0, h]]);
    },
    textRect: (w, h, a) => {
      const o = clamp(a.offset * ss(w, h), 0, w / 2);
      return { x: o * 0.67, y: h * 0.08, width: Math.max(1, w - o * 1.33), height: h * 0.84 };
    },
    ooxmlAdjust: (w, h, a) => ({ adj: Math.round(a.offset * 100000) }),
    handles: [{ key: 'offset', pos: (w, h, a) => ({ x: clamp(a.offset * ss(w, h), 0, w / 2), y: 0 }), set: (w, h, p) => ({ offset: Math.round(clamp(p.x / ss(w, h), 0, w / 2 / ss(w, h)) * 1000) / 1000 }) }],
  },
  {
    id: 'pentagon', label: 'Pentagon', category: 'Polygons', ooxml: 'pentagon', adjust: {},
    path: (w, h) => poly([[w / 2, 0], [w, h * 0.382], [w * 0.809, h], [w * 0.191, h], [0, h * 0.382]]),
    textRect: (w, h) => ({ x: w * 0.2, y: h * 0.3, width: w * 0.6, height: h * 0.6 }), ooxmlAdjust: () => ({}),
  },
  {
    id: 'hexagon', label: 'Hexagon', category: 'Polygons', ooxml: 'hexagon', adjust: { offset: 0.25 },
    path: (w, h, a) => {
      const o = clamp(a.offset * ss(w, h), 0, w / 2);
      return poly([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]]);
    },
    textRect: (w, h, a) => {
      const o = clamp(a.offset * ss(w, h), 0, w / 2);
      return { x: o / 2, y: h * 0.12, width: Math.max(1, w - o), height: h * 0.76 };
    },
    ooxmlAdjust: (w, h, a) => ({ adj: Math.round(a.offset * 100000), vf: 115470 }),
    handles: [{ key: 'offset', pos: (w, h, a) => ({ x: clamp(a.offset * ss(w, h), 0, w / 2), y: 0 }), set: (w, h, p) => ({ offset: Math.round(clamp(p.x / ss(w, h), 0, 0.5) * 1000) / 1000 }) }],
  },
  {
    id: 'octagon', label: 'Octagon', category: 'Polygons', ooxml: 'octagon', adjust: { offset: 0.2929 },
    path: (w, h, a) => {
      const o = clamp(a.offset * ss(w, h), 0, ss(w, h) / 2);
      return poly([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]);
    },
    textRect: (w, h, a) => {
      const o = clamp(a.offset * ss(w, h), 0, ss(w, h) / 2) / 2;
      return { x: o, y: o, width: w - 2 * o, height: h - 2 * o };
    },
    ooxmlAdjust: (w, h, a) => ({ adj: Math.round(a.offset * 100000) }),
    handles: [{ key: 'offset', pos: (w, h, a) => ({ x: clamp(a.offset * ss(w, h), 0, ss(w, h) / 2), y: 0 }), set: (w, h, p) => ({ offset: Math.round(clamp(p.x / ss(w, h), 0, 0.5) * 1000) / 1000 }) }],
  },
  {
    id: 'star5', label: '5-point star', category: 'Stars', ooxml: 'star5', adjust: {},
    path: (w, h) => poly(fitPoints(starPoints(5, 0.382), w, h)),
    textRect: (w, h) => inset(w, h, 0.3, 0.35), ooxmlAdjust: () => ({}),
  },
  {
    id: 'star6', label: '6-point star', category: 'Stars', ooxml: 'star6', adjust: {},
    path: (w, h) => poly(fitPoints(starPoints(6, 0.577), w, h)),
    textRect: (w, h) => inset(w, h, 0.25, 0.25), ooxmlAdjust: () => ({}),
  },
  {
    id: 'plus', label: 'Plus', category: 'Symbols', ooxml: 'plus', adjust: { arm: 0.25 },
    path: (w, h, a) => {
      const o = clamp(a.arm * ss(w, h), 0, ss(w, h) / 2);
      return poly([[0, o], [o, o], [o, 0], [w - o, 0], [w - o, o], [w, o], [w, h - o], [w - o, h - o], [w - o, h], [o, h], [o, h - o], [0, h - o]]);
    },
    textRect: (w, h, a) => {
      const o = clamp(a.arm * ss(w, h), 0, ss(w, h) / 2);
      return { x: 0, y: o, width: w, height: h - 2 * o };
    },
    ooxmlAdjust: (w, h, a) => ({ adj: Math.round(a.arm * 100000) }),
    handles: [{ key: 'arm', pos: (w, h, a) => ({ x: clamp(a.arm * ss(w, h), 0, ss(w, h) / 2), y: 0 }), set: (w, h, p) => ({ arm: Math.round(clamp(p.x / ss(w, h), 0, 0.5) * 1000) / 1000 }) }],
  },
  {
    id: 'heart', label: 'Heart', category: 'Symbols', ooxml: 'heart', adjust: {},
    path: (w, h) => {
      const hc = w / 2;
      const dx1 = (w * 49) / 48;
      const dx2 = (w * 10) / 48;
      const y1 = -h / 3;
      return `M${f(hc)} ${f(h / 4)}C${f(hc + dx2)} ${f(y1)} ${f(hc + dx1)} ${f(h / 4)} ${f(hc)} ${f(h)}C${f(hc - dx1)} ${f(h / 4)} ${f(hc - dx2)} ${f(y1)} ${f(hc)} ${f(h / 4)}Z`;
    },
    textRect: (w, h) => ({ x: w * 0.2, y: h * 0.22, width: w * 0.6, height: h * 0.45 }), ooxmlAdjust: () => ({}),
  },
  {
    id: 'cloud', label: 'Cloud', category: 'Symbols', ooxml: 'cloud', adjust: {},
    path: (w, h) => poly(fitPoints(cloudPoints(), w, h)),
    textRect: (w, h) => inset(w, h, 0.18, 0.2), ooxmlAdjust: () => ({}),
  },
  {
    id: 'donut', label: 'Donut', category: 'Symbols', ooxml: 'donut', adjust: { thickness: 0.25 }, evenOdd: true,
    path: (w, h, a) => {
      const t = clamp(a.thickness * ss(w, h), 1, ss(w, h) / 2 - 1);
      const rx = w / 2 - t;
      const ry = h / 2 - t;
      return ellipsePath(w, h) + `M${f(t)} ${f(h / 2)}A${f(rx)} ${f(ry)} 0 1 0 ${f(w - t)} ${f(h / 2)}A${f(rx)} ${f(ry)} 0 1 0 ${f(t)} ${f(h / 2)}Z`;
    },
    textRect: (w, h) => inset(w, h, 0.1464, 0.1464),
    ooxmlAdjust: (w, h, a) => ({ adj: Math.round(a.thickness * 100000) }),
    handles: [{ key: 'thickness', pos: (w, h, a) => ({ x: clamp(a.thickness * ss(w, h), 1, ss(w, h) / 2), y: h / 2 }), set: (w, h, p) => ({ thickness: Math.round(clamp(p.x / ss(w, h), 0.02, 0.5) * 1000) / 1000 }) }],
  },
  ...['right', 'left', 'up', 'down'].map((dir) => ({
    id: `arrow_${dir}`,
    label: `${dir[0].toUpperCase()}${dir.slice(1)} arrow`,
    category: 'Block arrows',
    ooxml: `${dir}Arrow`,
    adjust: { shaft: 0.5, head: 0.5 },
    path: (w, h, a) => {
      const horiz = dir === 'right' || dir === 'left';
      const L = horiz ? w : h;
      const T = horiz ? h : w;
      const head = clamp(a.head * ss(w, h), 0, L);
      const s1 = (T * (1 - a.shaft)) / 2;
      const s2 = T - s1;
      // right-pointing in (L, T) space
      const pts = [[0, s1], [L - head, s1], [L - head, 0], [L, T / 2], [L - head, T], [L - head, s2], [0, s2]];
      const map = {
        right: ([x, y]) => [x, y],
        left: ([x, y]) => [w - x, y],
        down: ([x, y]) => [y, x],
        up: ([x, y]) => [y, h - x],
      }[dir];
      return poly(pts.map(map));
    },
    textRect: (w, h, a) => {
      const horiz = dir === 'right' || dir === 'left';
      if (horiz) {
        const head = clamp(a.head * ss(w, h), 0, w);
        const s1 = (h * (1 - a.shaft)) / 2;
        return { x: dir === 'left' ? head * 0.5 : 0, y: s1, width: Math.max(1, w - head * 0.5), height: h - 2 * s1 };
      }
      const head = clamp(a.head * ss(w, h), 0, h);
      const s1 = (w * (1 - a.shaft)) / 2;
      return { x: s1, y: dir === 'up' ? head * 0.5 : 0, width: w - 2 * s1, height: Math.max(1, h - head * 0.5) };
    },
    ooxmlAdjust: (w, h, a) => ({ adj1: Math.round(a.shaft * 100000), adj2: Math.round(a.head * 100000) }),
    handles: [
      {
        key: 'head',
        pos: (w, h, a) => {
          const hd = a.head * ss(w, h);
          return { right: { x: w - hd, y: 0 }, left: { x: hd, y: 0 }, down: { x: 0, y: h - hd }, up: { x: 0, y: hd } }[dir];
        },
        set: (w, h, p) => {
          const m = ss(w, h);
          const v = { right: w - p.x, left: p.x, down: h - p.y, up: p.y }[dir];
          const L = dir === 'right' || dir === 'left' ? w : h;
          return { head: Math.round(clamp(v / m, 0, L / m) * 1000) / 1000 };
        },
      },
    ],
  })),
  {
    id: 'arrow_left_right', label: 'Left-right arrow', category: 'Block arrows', ooxml: 'leftRightArrow', adjust: { shaft: 0.5, head: 0.5 },
    path: (w, h, a) => {
      const head = clamp(a.head * ss(w, h), 0, w / 2);
      const s1 = (h * (1 - a.shaft)) / 2;
      const s2 = h - s1;
      return poly([[0, h / 2], [head, 0], [head, s1], [w - head, s1], [w - head, 0], [w, h / 2], [w - head, h], [w - head, s2], [head, s2], [head, h]]);
    },
    textRect: (w, h, a) => {
      const head = clamp(a.head * ss(w, h), 0, w / 2);
      const s1 = (h * (1 - a.shaft)) / 2;
      return { x: head * 0.5, y: s1, width: Math.max(1, w - head), height: h - 2 * s1 };
    },
    ooxmlAdjust: (w, h, a) => ({ adj1: Math.round(a.shaft * 100000), adj2: Math.round(a.head * 100000) }),
  },
  {
    id: 'chevron', label: 'Chevron', category: 'Block arrows', ooxml: 'chevron', adjust: { point: 0.5 },
    path: (w, h, a) => {
      const x1 = clamp(a.point * ss(w, h), 0, w);
      return poly([[0, 0], [w - x1, 0], [w, h / 2], [w - x1, h], [0, h], [x1, h / 2]]);
    },
    textRect: (w, h, a) => {
      const x1 = clamp(a.point * ss(w, h), 0, w / 2);
      return { x: x1, y: 0, width: Math.max(1, w - 2 * x1), height: h };
    },
    ooxmlAdjust: (w, h, a) => ({ adj: Math.round(a.point * 100000) }),
    handles: [{ key: 'point', pos: (w, h, a) => ({ x: w - clamp(a.point * ss(w, h), 0, w), y: 0 }), set: (w, h, p) => ({ point: Math.round(clamp((w - p.x) / ss(w, h), 0, w / ss(w, h)) * 1000) / 1000 }) }],
  },
  {
    id: 'pentagon_arrow', label: 'Pentagon arrow', category: 'Block arrows', ooxml: 'homePlate', adjust: { point: 0.5 },
    path: (w, h, a) => {
      const x1 = clamp(a.point * ss(w, h), 0, w);
      return poly([[0, 0], [w - x1, 0], [w, h / 2], [w - x1, h], [0, h]]);
    },
    textRect: (w, h, a) => {
      const x1 = clamp(a.point * ss(w, h), 0, w);
      return { x: 0, y: 0, width: Math.max(1, w - x1 / 2), height: h };
    },
    ooxmlAdjust: (w, h, a) => ({ adj: Math.round(a.point * 100000) }),
    handles: [{ key: 'point', pos: (w, h, a) => ({ x: w - clamp(a.point * ss(w, h), 0, w), y: 0 }), set: (w, h, p) => ({ point: Math.round(clamp((w - p.x) / ss(w, h), 0, w / ss(w, h)) * 1000) / 1000 }) }],
  },
  {
    id: 'callout_rect', label: 'Rectangular callout', category: 'Callouts', ooxml: 'wedgeRectCallout', adjust: { tail_x: -0.2083, tail_y: 0.625 },
    path: (w, h, a) => rectCallout(w, h, a, 0), textRect: full,
    ooxmlAdjust: (w, h, a) => ({ adj1: Math.round(a.tail_x * 100000), adj2: Math.round(a.tail_y * 100000) }),
    handles: [{ key: 'tail', pos: (w, h, a) => ({ x: w / 2 + a.tail_x * w, y: h / 2 + a.tail_y * h }), set: (w, h, p) => ({ tail_x: Math.round(((p.x - w / 2) / w) * 1000) / 1000, tail_y: Math.round(((p.y - h / 2) / h) * 1000) / 1000 }) }],
  },
  {
    id: 'callout_round_rect', label: 'Rounded callout', category: 'Callouts', ooxml: 'wedgeRoundRectCallout', adjust: { tail_x: -0.2083, tail_y: 0.625, radius: 16 },
    path: (w, h, a) => rectCallout(w, h, a, a.radius),
    textRect: (w, h, a) => {
      const r = clamp(a.radius, 0, ss(w, h) / 2) * 0.29289;
      return { x: r, y: r, width: w - 2 * r, height: h - 2 * r };
    },
    ooxmlAdjust: (w, h, a) => ({ adj1: Math.round(a.tail_x * 100000), adj2: Math.round(a.tail_y * 100000), adj3: Math.round((clamp(a.radius, 0, ss(w, h) / 2) / ss(w, h)) * 100000) }),
    handles: [{ key: 'tail', pos: (w, h, a) => ({ x: w / 2 + a.tail_x * w, y: h / 2 + a.tail_y * h }), set: (w, h, p) => ({ tail_x: Math.round(((p.x - w / 2) / w) * 1000) / 1000, tail_y: Math.round(((p.y - h / 2) / h) * 1000) / 1000 }) }],
  },
  {
    id: 'callout_oval', label: 'Oval callout', category: 'Callouts', ooxml: 'wedgeEllipseCallout', adjust: { tail_x: -0.2083, tail_y: 0.625 },
    path: (w, h, a) => ovalCallout(w, h, a), textRect: (w, h) => inset(w, h, 0.1464, 0.1464),
    ooxmlAdjust: (w, h, a) => ({ adj1: Math.round(a.tail_x * 100000), adj2: Math.round(a.tail_y * 100000) }),
    handles: [{ key: 'tail', pos: (w, h, a) => ({ x: w / 2 + a.tail_x * w, y: h / 2 + a.tail_y * h }), set: (w, h, p) => ({ tail_x: Math.round(((p.x - w / 2) / w) * 1000) / 1000, tail_y: Math.round(((p.y - h / 2) / h) * 1000) / 1000 }) }],
  },
];

export const SHAPE_MAP = new Map(SHAPES.map((s) => [s.id, s]));

export function getShape(id) {
  return SHAPE_MAP.get(id) || SHAPE_MAP.get('rect');
}

export function shapeAdjust(preset, adjust) {
  const s = getShape(preset);
  return { ...s.adjust, ...(adjust || {}) };
}

export function shapePath(preset, adjust, w, h) {
  const s = getShape(preset);
  return s.path(Math.max(1, w), Math.max(1, h), shapeAdjust(preset, adjust));
}

export function shapeTextRect(preset, adjust, w, h) {
  const s = getShape(preset);
  return s.textRect(w, h, shapeAdjust(preset, adjust));
}

export const ADJUST_KEYS = new Map(SHAPES.map((s) => [s.id, Object.keys(s.adjust)]));
