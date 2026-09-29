// Geometry: transforms, bounding boxes, groups and connectors (spec §4.3, §13.3, §13.5).
// Matrices are [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f.
import { roundLen, roundAngle } from './units.js';

export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m, p) {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function applyVector(m, v) {
  return { x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y };
}

export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return IDENTITY.slice();
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export const translate = (x, y) => [1, 0, 0, 1, x, y];
export const scale = (sx, sy) => [sx, 0, 0, sy, 0, 0];
export function rotate(deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

export function geometryKind(el) {
  if (el.type === 'line' || el.type === 'connector') return 'points';
  if (el.type === 'table') return 'table';
  return 'box';
}

export function tableSize(table) {
  const width = (table.columns || []).reduce((s, c) => s + c.width, 0);
  const height = (table.rows || []).reduce((s, r) => s + r.min_height, 0);
  return { width, height };
}

// Box of an element in its parent's coordinates (unrotated), for box and table geometry.
export function elementBox(el) {
  const g = el.geometry;
  if (el.type === 'table') {
    const { width, height } = tableSize(el.table);
    return { x: g.x, y: g.y, width, height, rotation: 0 };
  }
  return g;
}

// Maps local box coordinates (0..w, 0..h) to parent coordinates:
// mirror, then rotate about the center, then translate (spec §4.3).
export function boxMatrix(g) {
  const w = g.width;
  const h = g.height;
  return mul(
    translate(g.x + w / 2, g.y + h / 2),
    mul(rotate(g.rotation || 0), mul(scale(g.flip_x ? -1 : 1, g.flip_y ? -1 : 1), translate(-w / 2, -h / 2))),
  );
}

export function boxCorners(g) {
  const m = boxMatrix(g);
  return [
    apply(m, { x: 0, y: 0 }),
    apply(m, { x: g.width, y: 0 }),
    apply(m, { x: g.width, y: g.height }),
    apply(m, { x: 0, y: g.height }),
  ];
}

export function aabbOfPoints(pts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionBoxes(boxes) {
  const pts = [];
  for (const b of boxes) {
    pts.push({ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height });
  }
  return aabbOfPoints(pts);
}

// Axis-aligned bounding box in parent coordinates, from stored geometry
// (never rendered size, spec §13.5). resolvePoint maps attached connector ends.
export function elementAABB(el, resolvePoint) {
  const kind = geometryKind(el);
  if (kind === 'points') {
    const pts = [pointOf(el.geometry.start, resolvePoint), pointOf(el.geometry.end, resolvePoint)].filter(Boolean);
    return aabbOfPoints(pts.length ? pts : [{ x: 0, y: 0 }]);
  }
  const box = elementBox(el);
  return aabbOfPoints(boxCorners(box));
}

export function pointOf(end, resolvePoint) {
  if (end && typeof end.x === 'number') return { x: end.x, y: end.y };
  if (resolvePoint) {
    const p = resolvePoint(end);
    if (p) return p;
  }
  return null;
}

// ---------- world matrices ----------

// Walks elements (recursing into groups) and returns id → { el, world, parentWorld, width, height }.
export function worldMap(elements, parentWorld = IDENTITY, out = new Map(), measured = null) {
  for (const el of elements || []) {
    const kind = geometryKind(el);
    if (kind === 'points') {
      out.set(el.id, { el, world: parentWorld, parentWorld, width: 0, height: 0 });
      continue;
    }
    let box = elementBox(el);
    const m = measured?.get(el.id);
    if (m) box = { ...box, width: m.width ?? box.width, height: m.height ?? box.height };
    const world = mul(parentWorld, boxMatrix(box));
    out.set(el.id, { el, world, parentWorld, width: box.width, height: box.height });
    if (el.type === 'group') worldMap(el.group.children, world, out, measured);
  }
  return out;
}

export const SITES = ['top', 'right', 'bottom', 'left'];

export function siteLocal(site, w, h) {
  switch (site) {
    case 'top': return { x: w / 2, y: 0 };
    case 'right': return { x: w, y: h / 2 };
    case 'bottom': return { x: w / 2, y: h };
    default: return { x: 0, y: h / 2 };
  }
}

const SITE_NORMALS = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

export function canAttach(el) {
  return !!el && el.type !== 'line' && el.type !== 'connector' && el.type !== 'table';
}

// Resolves a connector end to a world-space point and outward direction.
export function resolveEndWorld(end, world, parentWorld) {
  if (end && typeof end.x === 'number') return { point: apply(parentWorld, end), dir: null, attached: false };
  const target = world.get(end?.element_id);
  if (!target || !canAttach(target.el)) return null;
  const p = apply(target.world, siteLocal(end.site, target.width, target.height));
  const n = applyVector(target.world, SITE_NORMALS[end.site] || SITE_NORMALS.left);
  const len = Math.hypot(n.x, n.y) || 1;
  return { point: p, dir: { x: n.x / len, y: n.y / len }, attached: true };
}

function axisDir(v) {
  return Math.abs(v.x) >= Math.abs(v.y) ? { x: Math.sign(v.x) || 1, y: 0 } : { x: 0, y: Math.sign(v.y) || 1 };
}

// Deterministic elbow routing (spec §13.3). Points in world space.
export function elbowRoute(a, b, stub = 20) {
  const d0 = a.dir ? axisDir(a.dir) : axisDir({ x: b.point.x - a.point.x, y: b.point.y - a.point.y });
  const d1 = b.dir ? axisDir(b.dir) : axisDir({ x: a.point.x - b.point.x, y: a.point.y - b.point.y });
  const s0 = a.dir ? { x: a.point.x + d0.x * stub, y: a.point.y + d0.y * stub } : a.point;
  const s1 = b.dir ? { x: b.point.x + d1.x * stub, y: b.point.y + d1.y * stub } : b.point;
  const pts = [a.point, s0];
  const h0 = d0.x !== 0;
  const h1 = d1.x !== 0;
  if (h0 && h1) {
    const mx = (s0.x + s1.x) / 2;
    pts.push({ x: mx, y: s0.y }, { x: mx, y: s1.y });
  } else if (!h0 && !h1) {
    const my = (s0.y + s1.y) / 2;
    pts.push({ x: s0.x, y: my }, { x: s1.x, y: my });
  } else if (h0 && !h1) {
    pts.push({ x: s1.x, y: s0.y });
  } else {
    pts.push({ x: s0.x, y: s1.y });
  }
  pts.push(s1, b.point);
  return simplifyPath(pts);
}

export function simplifyPath(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  // remove collinear middle points
  let changed = true;
  while (changed && out.length > 2) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1];
      const b = out[i];
      const c = out[i + 1];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 0.01) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

// Returns the connector/line path points in the element's parent coordinates.
export function connectorPath(el, world) {
  const info = world.get(el.id);
  const parentWorld = info ? info.parentWorld : IDENTITY;
  const inv = invert(parentWorld);
  const a = resolveEndWorld(el.geometry.start, world, parentWorld) || { point: apply(parentWorld, { x: 0, y: 0 }) };
  const b = resolveEndWorld(el.geometry.end, world, parentWorld) || { point: apply(parentWorld, { x: 0, y: 0 }) };
  let pts;
  if (el.type === 'connector' && el.connector?.routing === 'elbow') pts = elbowRoute(a, b);
  else pts = [a.point, b.point];
  return pts.map((p) => apply(inv, p));
}

// ---------- groups ----------

// Group box normalization after every command (spec §13.5).
export function normalizeGroup(group) {
  const children = group.group.children;
  if (!children.length) return group;
  const world = worldMap(children);
  const resolve = (end) => {
    const r = resolveEndWorld(end, world, IDENTITY);
    return r ? r.point : null;
  };
  const u = unionBoxes(children.map((c) => elementAABB(c, resolve)));
  if (!isFinite(u.x)) return group;
  const g = group.geometry;
  const w2 = Math.max(1, u.width);
  const h2 = Math.max(1, u.height);
  if (Math.abs(u.x) < 0.005 && Math.abs(u.y) < 0.005 && Math.abs(w2 - g.width) < 0.005 && Math.abs(h2 - g.height) < 0.005) return group;
  const old = boxMatrix(g);
  const c = apply(old, { x: u.x + w2 / 2, y: u.y + h2 / 2 });
  const geometry = { ...g, x: roundLen(c.x - w2 / 2), y: roundLen(c.y - h2 / 2), width: roundLen(w2), height: roundLen(h2) };
  const newChildren = children.map((ch) => translateElement(ch, -u.x, -u.y));
  return { ...group, geometry, group: { ...group.group, children: newChildren } };
}

// Returns a copy of el moved by (dx, dy) in its parent coordinates.
export function translateElement(el, dx, dy) {
  const g = el.geometry;
  if (geometryKind(el) === 'points') {
    const mv = (p) => (typeof p.x === 'number' ? { x: roundLen(p.x + dx), y: roundLen(p.y + dy) } : p);
    return { ...el, geometry: { ...g, start: mv(g.start), end: mv(g.end) } };
  }
  return { ...el, geometry: { ...g, x: roundLen(g.x + dx), y: roundLen(g.y + dy) } };
}

// Scales children when a group is resized (spec §13.5 resize rule).
export function scaleChild(el, sx, sy) {
  const g = el.geometry;
  if (geometryKind(el) === 'points') {
    const sc = (p) => (typeof p.x === 'number' ? { x: roundLen(p.x * sx), y: roundLen(p.y * sy) } : p);
    return { ...el, geometry: { ...g, start: sc(g.start), end: sc(g.end) } };
  }
  if (el.type === 'table') {
    return {
      ...el,
      geometry: { x: roundLen(g.x * sx), y: roundLen(g.y * sy) },
      table: {
        ...el.table,
        columns: el.table.columns.map((c) => ({ ...c, width: roundLen(Math.max(8, c.width * sx)) })),
        rows: el.table.rows.map((r) => ({ ...r, min_height: roundLen(Math.max(8, r.min_height * sy)) })),
      },
    };
  }
  const th = ((g.rotation || 0) * Math.PI) / 180;
  const cx = g.x + g.width / 2;
  const cy = g.y + g.height / 2;
  const w = g.width * Math.sqrt((sx * Math.cos(th)) ** 2 + (sy * Math.sin(th)) ** 2);
  const h = g.height * Math.sqrt((sx * Math.sin(th)) ** 2 + (sy * Math.cos(th)) ** 2);
  const ncx = sx * cx;
  const ncy = sy * cy;
  let out = {
    ...el,
    geometry: { ...g, x: roundLen(ncx - w / 2), y: roundLen(ncy - h / 2), width: roundLen(Math.max(1, w)), height: roundLen(Math.max(1, h)) },
  };
  if (el.type === 'group') {
    const csx = w / g.width;
    const csy = h / g.height;
    out = { ...out, group: { ...el.group, children: el.group.children.map((c) => scaleChild(c, csx, csy)) } };
  }
  return out;
}

export function resizeGroup(group, newGeometry) {
  const g = group.geometry;
  const sx = newGeometry.width / g.width;
  const sy = newGeometry.height / g.height;
  return {
    ...group,
    geometry: { ...g, ...newGeometry },
    group: { ...group.group, children: group.group.children.map((c) => scaleChild(c, sx, sy)) },
  };
}

// Decomposes a rotation/flip matrix (no scale) into rotation + flip_x.
function decompose(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det < 0) {
    // m = R(ψ)·diag(-1, 1)  →  R(ψ) = m·diag(-1, 1)
    const a = -m[0];
    const b = -m[1];
    return { rotation: roundAngle((Math.atan2(b, a) * 180) / Math.PI), flip_x: true, flip_y: false };
  }
  return { rotation: roundAngle((Math.atan2(m[1], m[0]) * 180) / Math.PI), flip_x: false, flip_y: false };
}

// Converts group children into the group's parent coordinate space (spec §13.5 Ungroup).
export function ungroupChildren(group) {
  const G = boxMatrix(group.geometry);
  return group.group.children.map((ch) => {
    if (geometryKind(ch) === 'points') {
      const tp = (p) => {
        if (typeof p.x !== 'number') return p;
        const q = apply(G, p);
        return { x: roundLen(q.x), y: roundLen(q.y) };
      };
      return { ...ch, geometry: { ...ch.geometry, start: tp(ch.geometry.start), end: tp(ch.geometry.end) } };
    }
    const g = ch.geometry;
    const C = boxMatrix(g);
    const M = mul(G, C);
    const center = apply(M, { x: g.width / 2, y: g.height / 2 });
    const lin = [M[0], M[1], M[2], M[3], 0, 0];
    const { rotation, flip_x, flip_y } = decompose(lin);
    const geometry = { x: roundLen(center.x - g.width / 2), y: roundLen(center.y - g.height / 2), width: g.width, height: g.height };
    if (rotation) geometry.rotation = rotation;
    if (flip_x) geometry.flip_x = true;
    if (flip_y) geometry.flip_y = true;
    return { ...ch, geometry };
  });
}

// Re-expresses an element's geometry when it moves from a parent with world
// matrix `fromWorld` to one with `toWorld` (both rigid: rotation, flip, translate).
export function reparentElement(el, fromWorld, toWorld) {
  const M = mul(invert(toWorld), fromWorld);
  if (geometryKind(el) === 'points') {
    const tp = (p) => {
      if (typeof p.x !== 'number') return p;
      const q = apply(M, p);
      return { x: roundLen(q.x), y: roundLen(q.y) };
    };
    return { ...el, geometry: { ...el.geometry, start: tp(el.geometry.start), end: tp(el.geometry.end) } };
  }
  const g = elementBox(el);
  const C = boxMatrix(g);
  const W = mul(M, C);
  const center = apply(W, { x: g.width / 2, y: g.height / 2 });
  const lin = [W[0], W[1], W[2], W[3], 0, 0];
  const { rotation, flip_x, flip_y } = decompose(lin);
  if (el.type === 'table') return { ...el, geometry: { x: roundLen(center.x - g.width / 2), y: roundLen(center.y - g.height / 2) } };
  const geometry = { x: roundLen(center.x - g.width / 2), y: roundLen(center.y - g.height / 2), width: g.width, height: g.height };
  if (rotation) geometry.rotation = rotation;
  if (flip_x) geometry.flip_x = true;
  if (flip_y) geometry.flip_y = true;
  return { ...el, geometry };
}

// Wraps elements (same parent) into a new group with rotation 0.
export function makeGroup(id, elements, resolvePoint) {
  const u = unionBoxes(elements.map((e) => elementAABB(e, resolvePoint)));
  const children = elements.map((e) => translateElement(e, -u.x, -u.y));
  return {
    id,
    type: 'group',
    geometry: { x: roundLen(u.x), y: roundLen(u.y), width: roundLen(Math.max(1, u.width)), height: roundLen(Math.max(1, u.height)) },
    group: { children },
  };
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function rectContains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}
