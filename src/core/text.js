// Text model helpers (spec §5.9). A TextBody is { paragraphs: [Paragraph] }.
// Inline = Run { text, marks } | Field { field, format, value, marks } | LineBreak { break: true }.

export const MARK_KEYS = ['font', 'size', 'weight', 'italic', 'underline', 'strike', 'script', 'color', 'highlight', 'letter_spacing', 'link', 'lang'];

export const isRun = (i) => i && typeof i.text === 'string';
export const isField = (i) => i && typeof i.field === 'string';
export const isBreak = (i) => i && i.break === true;

export function emptyBody() {
  return { paragraphs: [{ inlines: [] }] };
}

export function bodyFromText(text, marks) {
  const lines = String(text ?? '').split(/\r\n|\r|\n/);
  return {
    paragraphs: lines.map((line) => ({
      inlines: line ? [marks && Object.keys(marks).length ? { text: line, marks } : { text: line }] : [],
    })),
  };
}

export function paragraphText(p, fieldText = () => '') {
  let s = '';
  for (const i of p.inlines || []) {
    if (isRun(i)) s += i.text;
    else if (isField(i)) s += fieldText(i);
    else if (isBreak(i)) s += '\n';
  }
  return s;
}

export function plainText(body, fieldText) {
  if (!body?.paragraphs) return '';
  return body.paragraphs.map((p) => paragraphText(p, fieldText)).join('\n');
}

export function isBodyEmpty(body) {
  if (!body?.paragraphs?.length) return true;
  return body.paragraphs.every((p) => !(p.inlines || []).some((i) => (isRun(i) && i.text.length > 0) || isField(i)));
}

export function sameMarks(a, b) {
  const ka = a ? Object.keys(a) : [];
  const kb = b ? Object.keys(b) : [];
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const va = a[k];
    const vb = b[k];
    if (typeof va === 'object' && va !== null) {
      if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
    } else if (va !== vb) return false;
  }
  return true;
}

function cleanMarks(marks) {
  if (!marks) return undefined;
  const out = {};
  for (const k of MARK_KEYS) if (marks[k] !== undefined && marks[k] !== null) out[k] = marks[k];
  return Object.keys(out).length ? out : undefined;
}

// Merges adjacent runs with identical marks and drops empty runs. Always keeps
// at least one paragraph.
export function normalizeBody(body) {
  const paragraphs = (body?.paragraphs || []).map((p) => {
    const inlines = [];
    for (const i of p.inlines || []) {
      if (isRun(i)) {
        if (!i.text) continue;
        const marks = cleanMarks(i.marks);
        const prev = inlines[inlines.length - 1];
        if (prev && isRun(prev) && sameMarks(prev.marks, marks)) prev.text += i.text;
        else inlines.push(marks ? { text: i.text, marks } : { text: i.text });
      } else if (isField(i)) {
        const f = { field: i.field };
        if (i.format) f.format = i.format;
        if (i.value) f.value = i.value;
        const marks = cleanMarks(i.marks);
        if (marks) f.marks = marks;
        inlines.push(f);
      } else if (isBreak(i)) inlines.push({ break: true });
    }
    const out = { ...p, inlines };
    return out;
  });
  return { paragraphs: paragraphs.length ? paragraphs : [{ inlines: [] }] };
}

// Replaces text paragraph by paragraph, keeping each paragraph's properties and
// the marks of its first run (used by outline mode).
export function replaceBodyText(body, text) {
  const lines = String(text).split(/\r\n|\r|\n/);
  const old = body?.paragraphs || [];
  const paragraphs = lines.map((line, idx) => {
    const src = old[Math.min(idx, old.length - 1)] || { inlines: [] };
    const first = (src.inlines || []).find(isRun);
    const { inlines: _ignored, ...props } = src;
    return {
      ...props,
      inlines: line ? [first?.marks ? { text: line, marks: first.marks } : { text: line }] : [],
    };
  });
  return { paragraphs };
}

// Applies a marks patch to every run of a body (value null removes the mark).
export function patchAllMarks(body, patch) {
  return {
    paragraphs: body.paragraphs.map((p) => ({
      ...p,
      inlines: (p.inlines || []).map((i) => {
        if (!isRun(i) && !isField(i)) return i;
        const marks = { ...(i.marks || {}) };
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === undefined) delete marks[k];
          else marks[k] = v;
        }
        const out = { ...i };
        if (Object.keys(marks).length) out.marks = marks;
        else delete out.marks;
        return out;
      }),
    })),
  };
}

export function patchAllParagraphs(body, patch) {
  return {
    paragraphs: body.paragraphs.map((p) => {
      const out = { ...p };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined) delete out[k];
        else out[k] = v;
      }
      return out;
    }),
  };
}

// The first run's marks (used by the inspector to show current formatting).
export function firstMarks(body) {
  for (const p of body?.paragraphs || []) for (const i of p.inlines || []) if (isRun(i) || isField(i)) return i.marks || {};
  return {};
}

// ---------- list markers ----------

function toAlpha(n, upper) {
  let s = '';
  let v = n;
  while (v > 0) {
    v -= 1;
    s = String.fromCharCode(97 + (v % 26)) + s;
    v = Math.floor(v / 26);
  }
  return upper ? s.toUpperCase() : s;
}

function toRoman(n, upper) {
  const table = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let v = Math.max(1, Math.min(3999, n));
  let s = '';
  for (const [k, r] of table) while (v >= k) { s += r; v -= k; }
  return upper ? s.toUpperCase() : s;
}

export function formatNumber(n, style = 'decimal') {
  switch (style) {
    case 'lower_alpha': return toAlpha(n, false) + '.';
    case 'upper_alpha': return toAlpha(n, true) + '.';
    case 'lower_roman': return toRoman(n, false) + '.';
    case 'upper_roman': return toRoman(n, true) + '.';
    default: return n + '.';
  }
}

// Computes the marker text for every paragraph: '' for non-list paragraphs.
export function listMarkers(paragraphs, bullets = ['•', '–', '◦', '▪']) {
  const counters = new Array(9).fill(0);
  const kinds = new Array(9).fill(null);
  return (paragraphs || []).map((p) => {
    const list = p.list;
    if (!list) {
      counters.fill(0);
      kinds.fill(null);
      return '';
    }
    const level = Math.max(0, Math.min(8, list.level || 0));
    for (let l = level + 1; l < 9; l++) { counters[l] = 0; kinds[l] = null; }
    if (list.kind === 'number') {
      if (kinds[level] !== 'number') counters[level] = 0;
      kinds[level] = 'number';
      counters[level] = list.start_at ? list.start_at : counters[level] + 1;
      return formatNumber(counters[level], list.number_style || 'decimal');
    }
    kinds[level] = 'bullet';
    counters[level] = 0;
    return bullets[level % bullets.length] || '•';
  });
}

// All characters used by text in a document; used to pick font subsets.
export function collectChars(doc) {
  const chars = new Set();
  const addBody = (body) => {
    for (const p of body?.paragraphs || []) for (const i of p.inlines || []) if (isRun(i)) for (const ch of i.text) chars.add(ch);
  };
  const addString = (s) => { for (const ch of String(s || '')) chars.add(ch); };
  const visit = (els) => {
    for (const el of els || []) {
      if (el.text) addBody(el.text.body);
      if (el.shape?.text) addBody(el.shape.text.body);
      if (el.table) for (const c of Object.values(el.table.cells || {})) addBody(c.body);
      if (el.chart) {
        addString(el.chart.title); addString(el.chart.x_title); addString(el.chart.y_title);
        for (const c of el.chart.categories || []) addString(c);
        for (const s of el.chart.series || []) addString(s.name);
        addString('0123456789.,-%$€£¥+ ');
      }
      if (el.group) visit(el.group.children);
    }
  };
  for (const s of Object.values(doc.slides || {})) { visit(s.elements); addBody(s.notes); }
  visit(doc.master?.elements);
  addString(doc.metadata?.title);
  addString('0123456789 ');
  return chars;
}
