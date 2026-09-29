// Find and replace (spec §12.6).
import { slideOrder, walk } from './model.js';
import { isRun, isField, isBreak } from './text.js';

const FIELD_CHAR = '￼';

function paragraphString(p) {
  let s = '';
  for (const i of p.inlines || []) {
    if (isRun(i)) s += i.text;
    else if (isField(i)) s += FIELD_CHAR;
    else if (isBreak(i)) s += '\n';
  }
  return s;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function makeMatcher(query, { matchCase = false, wholeWord = false } = {}) {
  if (!query) return null;
  let src = escapeRe(query);
  if (wholeWord) src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
  return new RegExp(src, `g${matchCase ? '' : 'i'}u`);
}

function bodyMatches(body, re, base, out) {
  (body?.paragraphs || []).forEach((p, pi) => {
    const s = paragraphString(p);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (m[0].includes(FIELD_CHAR)) continue;
      const a = Math.max(0, m.index - 24);
      const b = Math.min(s.length, m.index + m[0].length + 24);
      out.push({ ...base, paragraph: pi, start: m.index, end: m.index + m[0].length, excerpt: (a > 0 ? '…' : '') + s.slice(a, b).replace(FIELD_CHAR, '·') + (b < s.length ? '…' : ''), matchText: m[0] });
    }
  });
}

// Returns matches in presentation order. Each match: { where, elementId, target, paragraph, start, end, excerpt }.
export function findMatches(doc, query, opts = {}) {
  const re = makeMatcher(query, opts);
  if (!re) return [];
  const out = [];
  const visit = (elements, where) => {
    walk(elements, (el) => {
      if (el.text) bodyMatches(el.text.body, re, { where, elementId: el.id, target: 'text' }, out);
      if (el.shape?.text) bodyMatches(el.shape.text.body, re, { where, elementId: el.id, target: 'shape' }, out);
      if (el.table) {
        for (const r of el.table.rows) for (const c of el.table.columns) {
          const k = `${r.id}:${c.id}`;
          const cell = el.table.cells[k];
          if (cell) bodyMatches(cell.body, re, { where, elementId: el.id, target: `cell:${k}` }, out);
        }
      }
      if (el.chart?.title) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(el.chart.title))) {
          out.push({ where, elementId: el.id, target: 'chart-title', paragraph: 0, start: m.index, end: m.index + m[0].length, excerpt: el.chart.title, matchText: m[0] });
          if (!m[0].length) re.lastIndex++;
        }
      }
    });
  };
  for (const sid of slideOrder(doc)) {
    const s = doc.slides[sid];
    visit(s.elements, { kind: 'slide', slideId: sid });
    if (opts.includeNotes && s.notes) bodyMatches(s.notes, re, { where: { kind: 'slide', slideId: sid }, elementId: null, target: 'notes' }, out);
  }
  if (opts.includeMaster) visit(doc.master.elements, { kind: 'master' });
  return out;
}

// Replaces [start, end) ranges within one paragraph (ranges sorted, non-overlapping).
// The replacement takes the formatting of the first character it replaces.
export function replaceInParagraph(p, ranges, replacement) {
  // Build a char-level view: for each inline, keep boundaries.
  let inlines = (p.inlines || []).map((i) => ({ ...i }));
  for (const { start, end } of ranges.slice().sort((a, b) => b.start - a.start)) {
    const next = [];
    let pos = 0;
    let inserted = false;
    for (const i of inlines) {
      const len = isRun(i) ? i.text.length : 1;
      const s0 = pos;
      const e0 = pos + len;
      pos = e0;
      if (e0 <= start || s0 >= end) {
        if (!inserted && s0 >= end && s0 === end && start === end) { /* no-op */ }
        next.push(i);
        continue;
      }
      if (!isRun(i)) continue; // fields/breaks in range are removed (shouldn't happen)
      const a = Math.max(start, s0) - s0;
      const b = Math.min(end, e0) - s0;
      if (a > 0) next.push({ ...i, text: i.text.slice(0, a) });
      if (!inserted) {
        if (replacement) next.push(i.marks ? { text: replacement, marks: i.marks } : { text: replacement });
        inserted = true;
      }
      if (b < len) next.push({ ...i, text: i.text.slice(b) });
    }
    inlines = next;
  }
  return { ...p, inlines: inlines.filter((i) => !isRun(i) || i.text.length) };
}

// Applies replace-all inside a draft document for the given matches.
export function replaceMatches(d, matches, replacement) {
  const groups = new Map();
  for (const m of matches) {
    const k = JSON.stringify([m.where, m.elementId, m.target, m.paragraph]);
    if (!groups.has(k)) groups.set(k, { m, ranges: [] });
    groups.get(k).ranges.push({ start: m.start, end: m.end });
  }
  const findEl = (where, id) => {
    const list = where.kind === 'master' ? d.master.elements : d.slides[where.slideId]?.elements;
    let hit = null;
    walk(list, (el) => {
      if (el.id === id) { hit = el; return false; }
      return true;
    });
    return hit;
  };
  let count = 0;
  for (const { m, ranges } of groups.values()) {
    let body = null;
    if (m.target === 'notes') body = d.slides[m.where.slideId].notes;
    else {
      const el = findEl(m.where, m.elementId);
      if (!el) continue;
      if (m.target === 'text') body = el.text.body;
      else if (m.target === 'shape') body = el.shape.text.body;
      else if (m.target.startsWith('cell:')) body = el.table.cells[m.target.slice(5)]?.body;
      else if (m.target === 'chart-title') {
        let t = el.chart.title;
        for (const r of ranges.slice().sort((a, b) => b.start - a.start)) t = t.slice(0, r.start) + replacement + t.slice(r.end);
        el.chart.title = t.slice(0, 200);
        count += ranges.length;
        continue;
      }
    }
    if (!body) continue;
    body.paragraphs[m.paragraph] = replaceInParagraph(JSON.parse(JSON.stringify(body.paragraphs[m.paragraph])), ranges, replacement);
    count += ranges.length;
  }
  return count;
}
