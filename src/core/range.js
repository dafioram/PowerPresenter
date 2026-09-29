// Slide range parsing for exports (spec §15.1).

// Parses a slide range like "1-5, 8" (1-based, inclusive). Returns indices or null.
export function parseRange(text, count) {
  const out = new Set();
  const parts = String(text || '').split(/[,;]\s*/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const p of parts) {
    const m = /^(\d+)\s*(?:[-–—]\s*(\d+))?$/.exec(p);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < 1 || a > count || b > count) return null;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}
