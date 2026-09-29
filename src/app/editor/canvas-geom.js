// Canvas geometry helpers: hit testing, handles, snapping (spec §12.2).
import { worldMap, apply, invert, connectorPath, geometryKind, resolveEndWorld, IDENTITY, boxMatrix, elementAABB, canAttach, siteLocal, SITES } from '../../core/geometry.js';
import { roundLen } from '../../core/units.js';

export function buildWorld(elements, measured) {
  return worldMap(elements, IDENTITY, new Map(), measured);
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// World-space path of a line/connector.
export function linePointsWorld(el, world) {
  const info = world.get(el.id);
  const pts = connectorPath(el, world);
  return pts.map((p) => apply(info?.parentWorld || IDENTITY, p));
}

export function hitElement(el, p, world, tol) {
  const kind = geometryKind(el);
  if (kind === 'points') {
    const pts = linePointsWorld(el, world);
    for (let i = 0; i < pts.length - 1; i++) if (distToSegment(p, pts[i], pts[i + 1]) <= tol) return true;
    return false;
  }
  const info = world.get(el.id);
  if (!info) return false;
  const q = apply(invert(info.world), p);
  return q.x >= -tol && q.y >= -tol && q.x <= info.width + tol && q.y <= info.height + tol;
}

// Finds the element under point p among candidates (top-most first).
export function hitTest(elements, p, world, tol, { includeLocked = false } = {}) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.hidden) continue;
    if (el.locked && !includeLocked) continue;
    if (hitElement(el, p, world, tol)) return el;
  }
  return null;
}

// World-space corners of an element's box.
export function worldCorners(info) {
  return [
    apply(info.world, { x: 0, y: 0 }),
    apply(info.world, { x: info.width, y: 0 }),
    apply(info.world, { x: info.width, y: info.height }),
    apply(info.world, { x: 0, y: info.height }),
  ];
}

export function worldAABB(el, world) {
  if (geometryKind(el) === 'points') {
    const pts = linePointsWorld(el, world);
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  const c = worldCorners(world.get(el.id));
  const xs = c.map((q) => q.x);
  const ys = c.map((q) => q.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export const HANDLES = [
  { id: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { id: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { id: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { id: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { id: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { id: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { id: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { id: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
];

// Computes a resized box geometry in the element's own frame (rotation kept).
// g: original geometry (box, parent coords), parentWorld: parent → world matrix,
// handle: handle def, pWorld: pointer in world coords.
export function resizeBox(g, parentWorld, handle, pWorld, { keepAspect = false, fromCenter = false, minSize = 1 } = {}) {
  const M = boxMatrix(g);
  const toLocal = invert(apply ? multiply(parentWorld, M) : M);
  const p = apply(toLocal, pWorld);
  const w = g.width;
  const h = g.height;
  // anchor: opposite handle (or center)
  const ax = fromCenter ? w / 2 : (1 - handle.fx) * w;
  const ay = fromCenter ? h / 2 : (1 - handle.fy) * h;
  let x0 = 0;
  let y0 = 0;
  let x1 = w;
  let y1 = h;
  const movesX = handle.fx !== 0.5;
  const movesY = handle.fy !== 0.5;
  if (movesX) {
    if (fromCenter) {
      const half = Math.max(minSize / 2, Math.abs(p.x - ax));
      x0 = ax - half;
      x1 = ax + half;
    } else if (handle.fx === 1) {
      x0 = ax;
      x1 = Math.max(ax + minSize, p.x);
    } else {
      x1 = ax;
      x0 = Math.min(ax - minSize, p.x);
    }
  }
  if (movesY) {
    if (fromCenter) {
      const half = Math.max(minSize / 2, Math.abs(p.y - ay));
      y0 = ay - half;
      y1 = ay + half;
    } else if (handle.fy === 1) {
      y0 = ay;
      y1 = Math.max(ay + minSize, p.y);
    } else {
      y1 = ay;
      y0 = Math.min(ay - minSize, p.y);
    }
  }
  let nw = x1 - x0;
  let nh = y1 - y0;
  if (keepAspect && w && h) {
    const ratio = w / h;
    if (movesX && movesY) {
      if (nw / ratio > nh) nh = nw / ratio;
      else nw = nh * ratio;
    } else if (movesX) nh = nw / ratio;
    else nw = nh * ratio;
    // re-anchor
    if (fromCenter) {
      x0 = w / 2 - nw / 2;
      y0 = h / 2 - nh / 2;
    } else {
      x0 = handle.fx === 0 ? ax - nw : handle.fx === 1 ? ax : w / 2 - nw / 2;
      y0 = handle.fy === 0 ? ay - nh : handle.fy === 1 ? ay : h / 2 - nh / 2;
    }
    x1 = x0 + nw;
    y1 = y0 + nh;
  }
  // new center in parent coords
  const cLocal = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const cParent = apply(M, cLocal);
  return { ...g, x: roundLen(cParent.x - nw / 2), y: roundLen(cParent.y - nh / 2), width: roundLen(nw), height: roundLen(nh) };
}

export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

// Snap candidates from other elements, slide edges, guides and grid.
export function snapTargets(elements, world, excludeIds, doc, { grid } = {}) {
  const W = doc.size.width;
  const H = doc.size.height;
  const xs = [{ v: 0, kind: 'slide' }, { v: W / 2, kind: 'slide' }, { v: W, kind: 'slide' }];
  const ys = [{ v: 0, kind: 'slide' }, { v: H / 2, kind: 'slide' }, { v: H, kind: 'slide' }];
  const boxes = [];
  for (const el of elements) {
    if (excludeIds.has(el.id) || el.hidden) continue;
    const b = worldAABB(el, world);
    boxes.push(b);
    xs.push({ v: b.x, kind: 'el' }, { v: b.x + b.width / 2, kind: 'el' }, { v: b.x + b.width, kind: 'el' });
    ys.push({ v: b.y, kind: 'el' }, { v: b.y + b.height / 2, kind: 'el' }, { v: b.y + b.height, kind: 'el' });
  }
  for (const g of doc.authoring?.guides || []) (g.axis === 'x' ? xs : ys).push({ v: g.position, kind: 'guide' });
  return { xs, ys, boxes, grid };
}

// Returns { dx, dy, lines } adjustments snapping a moving box.
export function snapBox(box, targets, tol) {
  let best = { x: null, y: null };
  const edgesX = [box.x, box.x + box.width / 2, box.x + box.width];
  const edgesY = [box.y, box.y + box.height / 2, box.y + box.height];
  for (const t of targets.xs) for (const e of edgesX) {
    const d = t.v - e;
    if (Math.abs(d) <= tol && (best.x === null || Math.abs(d) < Math.abs(best.x.d))) best.x = { d, v: t.v };
  }
  for (const t of targets.ys) for (const e of edgesY) {
    const d = t.v - e;
    if (Math.abs(d) <= tol && (best.y === null || Math.abs(d) < Math.abs(best.y.d))) best.y = { d, v: t.v };
  }
  // equal spacing between neighbors
  const rowBoxes = targets.boxes.filter((b) => b.y < box.y + box.height && b.y + b.height > box.y);
  const left = rowBoxes.filter((b) => b.x + b.width <= box.x + 1).sort((a, b) => b.x + b.width - (a.x + a.width))[0];
  const right = rowBoxes.filter((b) => b.x >= box.x + box.width - 1).sort((a, b) => a.x - b.x)[0];
  if (left && right && best.x === null) {
    const target = (left.x + left.width + right.x - box.width) / 2;
    const d = target - box.x;
    if (Math.abs(d) <= tol) best.x = { d, v: null, spacing: [left.x + left.width, target, target + box.width, right.x] };
  }
  const colBoxes = targets.boxes.filter((b) => b.x < box.x + box.width && b.x + b.width > box.x);
  const above = colBoxes.filter((b) => b.y + b.height <= box.y + 1).sort((a, b) => b.y + b.height - (a.y + a.height))[0];
  const below = colBoxes.filter((b) => b.y >= box.y + box.height - 1).sort((a, b) => a.y - b.y)[0];
  if (above && below && best.y === null) {
    const target = (above.y + above.height + below.y - box.height) / 2;
    const d = target - box.y;
    if (Math.abs(d) <= tol) best.y = { d, v: null, spacing: [above.y + above.height, target, target + box.height, below.y] };
  }
  if (targets.grid && targets.grid > 0) {
    if (best.x === null) {
      const gx = Math.round(box.x / targets.grid) * targets.grid;
      if (Math.abs(gx - box.x) <= tol) best.x = { d: gx - box.x, v: null };
    }
    if (best.y === null) {
      const gy = Math.round(box.y / targets.grid) * targets.grid;
      if (Math.abs(gy - box.y) <= tol) best.y = { d: gy - box.y, v: null };
    }
  }
  const lines = [];
  if (best.x?.v !== null && best.x?.v !== undefined) lines.push({ axis: 'x', v: best.x.v });
  if (best.y?.v !== null && best.y?.v !== undefined) lines.push({ axis: 'y', v: best.y.v });
  const spacing = [];
  if (best.x?.spacing) spacing.push({ axis: 'x', seg: best.x.spacing, at: box.y + box.height / 2 + (best.y?.d || 0) });
  if (best.y?.spacing) spacing.push({ axis: 'y', seg: best.y.spacing, at: box.x + box.width / 2 + (best.x?.d || 0) });
  return { dx: best.x?.d || 0, dy: best.y?.d || 0, lines, spacing };
}

export function snapValue(v, targets, tol) {
  let best = null;
  for (const t of targets) {
    const d = t.v - v;
    if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, v: t.v };
  }
  return best;
}

// Nearest connection site of attachable elements within tol (world coords).
export function nearestSite(elements, world, p, tol, excludeId) {
  let best = null;
  const visit = (els) => {
    for (const el of els) {
      if (el.id === excludeId || el.hidden) continue;
      if (canAttach(el)) {
        const info = world.get(el.id);
        if (info) {
          for (const site of SITES) {
            const q = apply(info.world, siteLocal(site, info.width, info.height));
            const d = Math.hypot(q.x - p.x, q.y - p.y);
            if (d <= tol && (!best || d < best.d)) best = { d, element_id: el.id, site, point: q };
          }
        }
      }
      if (el.type === 'group') visit(el.group.children);
    }
  };
  visit(elements);
  return best;
}

export function sitesOf(el, world) {
  const info = world.get(el.id);
  if (!info || !canAttach(el)) return [];
  return SITES.map((site) => ({ site, point: apply(info.world, siteLocal(site, info.width, info.height)) }));
}

export { resolveEndWorld, elementAABB, apply, invert, geometryKind, IDENTITY };
