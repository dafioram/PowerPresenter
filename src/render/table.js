// Table rendering (spec §13.6): semantic <table> with fixed layout.
import { h, px, setStyles } from './dom.js';
import { applyCssFill, color, cssBorderStyle } from './paint.js';
import { renderTextFlow } from './text.js';
import { tableGrid } from '../core/tables.js';

export function renderTable(el, ctx, index, applyCommon) {
  const dom = ctx.dom;
  const theme = ctx.doc.theme;
  const td = theme.defaults.table;
  const t = el.table;
  const w = h(dom, 'div', 'pe-el pe-el-table');
  applyCommon(w, el, ctx, index);
  const width = t.columns.reduce((a, c) => a + c.width, 0);
  setStyles(w, { left: px(el.geometry.x), top: px(el.geometry.y), width: px(width) });
  const table = h(dom, 'table', 'pe-table');
  table.style.width = px(width);
  const cg = h(dom, 'colgroup');
  for (const c of t.columns) {
    const col = h(dom, 'col');
    col.style.width = px(c.width);
    cg.appendChild(col);
  }
  table.appendChild(cg);
  const grid = tableGrid(t);
  const headerRows = t.header_rows || 0;
  const thead = headerRows ? h(dom, 'thead') : null;
  const tbody = h(dom, 'tbody');
  const defBorder = td.border;
  t.rows.forEach((row, ri) => {
    const tr = h(dom, 'tr');
    tr.style.height = px(row.min_height);
    const isHeader = ri < headerRows;
    t.columns.forEach((col, ci) => {
      const g = grid[ri][ci];
      if (g.covered) return;
      const cell = t.cells[g.key] || { body: { paragraphs: [{ inlines: [] }] } };
      const firstCol = !isHeader && ci === 0 && t.first_column;
      const c = h(dom, isHeader || firstCol ? 'th' : 'td', 'pe-cell');
      if (isHeader) c.setAttribute('scope', 'col');
      else if (firstCol) c.setAttribute('scope', 'row');
      c.dataset.cell = g.key;
      if (cell.row_span > 1) c.rowSpan = cell.row_span;
      if (cell.col_span > 1) c.colSpan = cell.col_span;
      const pad = cell.padding ?? td.padding;
      c.style.padding = px(pad);
      c.style.verticalAlign = { top: 'top', middle: 'middle', bottom: 'bottom' }[cell.vertical_align || 'top'];
      let fill = cell.fill;
      if (fill === undefined) {
        if (isHeader) fill = { type: 'solid', color: td.header_fill };
        else if (t.banded_rows && (ri - headerRows) % 2 === 1) fill = { type: 'solid', color: td.band_fill };
        else if (t.banded_columns && ci % 2 === 1) fill = { type: 'solid', color: td.band_fill };
      }
      if (fill && fill !== 'none') applyCssFill(c, fill, theme, ctx);
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const b = cell.borders?.[side] ?? defBorder;
        const cap = side[0].toUpperCase() + side.slice(1);
        if (!b || b === 'none' || !b.width) c.style[`border${cap}`] = 'none';
        else {
          c.style[`border${cap}Width`] = px(b.width);
          c.style[`border${cap}Style`] = cssBorderStyle(b.dash);
          c.style[`border${cap}Color`] = color(b.color, theme);
        }
      }
      const defaults = firstCol && td.first_column_bold ? { weight: 700, ...(cell.defaults || {}) } : cell.defaults;
      const { flow } = renderTextFlow(ctx, { ...cell, defaults }, { kind: 'cell', header: isHeader, noPrompt: true });
      c.appendChild(flow);
      tr.appendChild(c);
    });
    (isHeader ? thead : tbody).appendChild(tr);
  });
  if (thead) table.appendChild(thead);
  table.appendChild(tbody);
  w.appendChild(table);
  return w;
}
