// Table operations (spec §13.6). Pure functions: table → new table.
import { newId } from './ids.js';
import { emptyBody } from './text.js';
import { roundLen } from './units.js';

const key = (r, c) => `${r}:${c}`;

function clone(t) {
  return JSON.parse(JSON.stringify(t));
}

// Grid of cells: grid[ri][ci] = { key, anchor } where anchor is the key of the
// merge anchor covering the position (itself for anchors / unmerged cells).
export function tableGrid(t) {
  const rows = t.rows.map((r) => r.id);
  const cols = t.columns.map((c) => c.id);
  const grid = rows.map((r) => cols.map((c) => ({ key: key(r, c), anchor: key(r, c), covered: false })));
  rows.forEach((r, ri) => {
    cols.forEach((c, ci) => {
      const cell = t.cells[key(r, c)];
      if (!cell) return;
      const rs = cell.row_span || 1;
      const cs = cell.col_span || 1;
      for (let a = ri; a < Math.min(rows.length, ri + rs); a++) {
        for (let b = ci; b < Math.min(cols.length, ci + cs); b++) {
          if (a === ri && b === ci) continue;
          grid[a][b].anchor = key(r, c);
          grid[a][b].covered = true;
        }
      }
    });
  });
  return grid;
}

export function ensureCells(t) {
  const out = clone(t);
  for (const r of out.rows) for (const c of out.columns) if (!out.cells[key(r.id, c.id)]) out.cells[key(r.id, c.id)] = { body: emptyBody() };
  return out;
}

export function insertRow(t, index) {
  const out = clone(t);
  const ref = out.rows[Math.max(0, Math.min(out.rows.length - 1, index - 1))];
  const row = { id: newId(), min_height: ref ? ref.min_height : 40 };
  const grid = tableGrid(t);
  out.rows.splice(index, 0, row);
  for (const c of out.columns) out.cells[key(row.id, c.id)] = { body: emptyBody() };
  // extend merges that span across the insertion point
  if (index > 0 && index < t.rows.length) {
    const seen = new Set();
    for (let ci = 0; ci < t.columns.length; ci++) {
      const above = grid[index - 1][ci];
      const below = grid[index][ci];
      if (above.anchor === below.anchor && !seen.has(above.anchor)) {
        seen.add(above.anchor);
        const cell = out.cells[above.anchor];
        cell.row_span = (cell.row_span || 1) + 1;
      }
    }
  }
  return out;
}

export function insertColumn(t, index) {
  const out = clone(t);
  const ref = out.columns[Math.max(0, Math.min(out.columns.length - 1, index - 1))];
  const col = { id: newId(), width: ref ? ref.width : 120 };
  const grid = tableGrid(t);
  out.columns.splice(index, 0, col);
  for (const r of out.rows) out.cells[key(r.id, col.id)] = { body: emptyBody() };
  if (index > 0 && index < t.columns.length) {
    const seen = new Set();
    for (let ri = 0; ri < t.rows.length; ri++) {
      const left = grid[ri][index - 1];
      const right = grid[ri][index];
      if (left.anchor === right.anchor && !seen.has(left.anchor)) {
        seen.add(left.anchor);
        const cell = out.cells[left.anchor];
        cell.col_span = (cell.col_span || 1) + 1;
      }
    }
  }
  return out;
}

export function deleteRow(t, rowId) {
  if (t.rows.length <= 1) return t;
  const out = clone(t);
  const ri = t.rows.findIndex((r) => r.id === rowId);
  if (ri < 0) return t;
  const grid = tableGrid(t);
  const handled = new Set();
  for (let ci = 0; ci < t.columns.length; ci++) {
    const g = grid[ri][ci];
    if (handled.has(g.anchor)) continue;
    handled.add(g.anchor);
    const anchor = out.cells[g.anchor];
    const rs = anchor.row_span || 1;
    if (rs <= 1) continue;
    if (g.anchor === g.key) {
      // anchor row deleted: move the anchor down one row
      const nextKey = key(t.rows[ri + 1].id, g.key.split(':')[1]);
      const moved = { ...anchor, row_span: rs - 1 };
      if (moved.row_span === 1) delete moved.row_span;
      out.cells[nextKey] = moved;
    } else {
      anchor.row_span = rs - 1;
      if (anchor.row_span === 1) delete anchor.row_span;
    }
  }
  for (const c of t.columns) delete out.cells[key(rowId, c.id)];
  out.rows.splice(ri, 1);
  if ((out.header_rows || 0) > out.rows.length) out.header_rows = out.rows.length;
  return out;
}

export function deleteColumn(t, colId) {
  if (t.columns.length <= 1) return t;
  const out = clone(t);
  const ci = t.columns.findIndex((c) => c.id === colId);
  if (ci < 0) return t;
  const grid = tableGrid(t);
  const handled = new Set();
  for (let ri = 0; ri < t.rows.length; ri++) {
    const g = grid[ri][ci];
    if (handled.has(g.anchor)) continue;
    handled.add(g.anchor);
    const anchor = out.cells[g.anchor];
    const cs = anchor.col_span || 1;
    if (cs <= 1) continue;
    if (g.anchor === g.key) {
      const nextKey = key(g.key.split(':')[0], t.columns[ci + 1].id);
      const moved = { ...anchor, col_span: cs - 1 };
      if (moved.col_span === 1) delete moved.col_span;
      out.cells[nextKey] = moved;
    } else {
      anchor.col_span = cs - 1;
      if (anchor.col_span === 1) delete anchor.col_span;
    }
  }
  for (const r of t.rows) delete out.cells[key(r.id, colId)];
  out.columns.splice(ci, 1);
  return out;
}

// Merges the rectangular range [r0..r1] × [c0..c1] (indices, inclusive).
export function mergeCells(t, r0, c0, r1, c1) {
  const out = clone(t);
  const rows = t.rows.map((r) => r.id);
  const cols = t.columns.map((c) => c.id);
  // expand range to cover existing merges fully
  const grid = tableGrid(t);
  let changed = true;
  while (changed) {
    changed = false;
    for (let a = r0; a <= r1; a++) {
      for (let b = c0; b <= c1; b++) {
        const anc = grid[a][b].anchor.split(':');
        const ai = rows.indexOf(anc[0]);
        const bi = cols.indexOf(anc[1]);
        const cell = t.cells[grid[a][b].anchor];
        const ae = ai + (cell?.row_span || 1) - 1;
        const be = bi + (cell?.col_span || 1) - 1;
        if (ai < r0) { r0 = ai; changed = true; }
        if (bi < c0) { c0 = bi; changed = true; }
        if (ae > r1) { r1 = ae; changed = true; }
        if (be > c1) { c1 = be; changed = true; }
      }
    }
  }
  const anchorKey = key(rows[r0], cols[c0]);
  const anchor = out.cells[anchorKey] || { body: emptyBody() };
  const paragraphs = [...anchor.body.paragraphs.filter((p) => p.inlines.length)];
  for (let a = r0; a <= r1; a++) {
    for (let b = c0; b <= c1; b++) {
      const k = key(rows[a], cols[b]);
      if (k === anchorKey) continue;
      const cell = out.cells[k];
      if (cell) for (const p of cell.body.paragraphs) if (p.inlines.length) paragraphs.push(p);
      out.cells[k] = { body: emptyBody() };
    }
  }
  anchor.body = { paragraphs: paragraphs.length ? paragraphs : [{ inlines: [] }] };
  anchor.row_span = r1 - r0 + 1;
  anchor.col_span = c1 - c0 + 1;
  if (anchor.row_span === 1) delete anchor.row_span;
  if (anchor.col_span === 1) delete anchor.col_span;
  out.cells[anchorKey] = anchor;
  return out;
}

export function splitCell(t, cellKey) {
  const out = clone(t);
  const cell = out.cells[cellKey];
  if (!cell) return t;
  delete cell.row_span;
  delete cell.col_span;
  return ensureCells(out);
}

export function distributeColumns(t) {
  const out = clone(t);
  const total = out.columns.reduce((s, c) => s + c.width, 0);
  const w = roundLen(total / out.columns.length);
  for (const c of out.columns) c.width = w;
  return out;
}

export function distributeRows(t) {
  const out = clone(t);
  const total = out.rows.reduce((s, r) => s + r.min_height, 0);
  const h = roundLen(total / out.rows.length);
  for (const r of out.rows) r.min_height = h;
  return out;
}

export function resizeTable(t, width, height) {
  const out = clone(t);
  const tw = out.columns.reduce((s, c) => s + c.width, 0);
  const th = out.rows.reduce((s, r) => s + r.min_height, 0);
  const sx = width / tw;
  const sy = height / th;
  for (const c of out.columns) c.width = roundLen(Math.max(8, c.width * sx));
  for (const r of out.rows) r.min_height = roundLen(Math.max(8, r.min_height * sy));
  return out;
}

// Fills cells from a 2-D array of strings starting at (r0, c0). Grows the table if allowed.
export function fillFromGrid(t, data, r0 = 0, c0 = 0, { grow = true } = {}) {
  let out = clone(t);
  const needRows = r0 + data.length;
  const needCols = c0 + Math.max(0, ...data.map((r) => r.length));
  if (grow) {
    while (out.rows.length < needRows) out = insertRow(out, out.rows.length);
    while (out.columns.length < needCols) out = insertColumn(out, out.columns.length);
  }
  data.forEach((row, a) => {
    row.forEach((val, b) => {
      const ri = r0 + a;
      const ci = c0 + b;
      if (ri >= out.rows.length || ci >= out.columns.length) return;
      const k = key(out.rows[ri].id, out.columns[ci].id);
      const cell = out.cells[k] || { body: emptyBody() };
      const firstMarks = cell.body.paragraphs[0]?.inlines?.[0]?.marks;
      cell.body = { paragraphs: [{ ...(cell.body.paragraphs[0] ? { ...cell.body.paragraphs[0] } : {}), inlines: val ? [firstMarks ? { text: val, marks: firstMarks } : { text: val }] : [] }] };
      out.cells[k] = cell;
    });
  });
  return out;
}

// ---------- CSV / TSV ----------

export function parseDelimited(text) {
  const src = String(text).replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const delim = src.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"' && field === '') q = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  row.push(field);
  rows.push(row);
  return rows.map((r) => r.map((x) => x.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').slice(0, 5000)));
}

export function toCsv(rows) {
  return rows.map((r) => r.map((v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}
