// Deterministic SVG chart renderer (spec §13.7).
import { niceScale, formatValue, seriesExtent } from '../core/charts.js';
import { resolveColor, applyTint, toCss, relativeLuminance } from '../core/color.js';
import { s, r2, h } from './dom.js';
import { cssFontFamily } from './fonts.js';
import { resolveFontValue } from '../core/theme.js';

let measureCanvas = null;
export function measureText(str, size, fontFamily, weight = 400) {
  try {
    if (!measureCanvas && typeof document !== 'undefined') measureCanvas = document.createElement('canvas').getContext('2d');
    if (measureCanvas) {
      measureCanvas.font = `${weight} ${size}px ${fontFamily}`;
      return measureCanvas.measureText(str).width;
    }
  } catch {
    /* fall through */
  }
  return String(str).length * size * 0.56;
}

export function seriesColors(chart, theme) {
  const accents = [1, 2, 3, 4, 5, 6].map((i) => theme.colors[`color.accent.${i}`]);
  const palette = [...accents, ...accents.map((c) => applyTint(c, 0.45)), ...accents.map((c) => applyTint(c, -0.35))];
  return (i, own) => (own ? resolveColor(own, theme) : palette[i % palette.length]);
}

function textEl(dom, str, x, y, { size, fill, family, weight = 400, anchor = 'middle', baseline = 'central', rotate = 0 }) {
  const t = s(dom, 'text', {
    x: r2(x),
    y: r2(y),
    'text-anchor': anchor,
    'dominant-baseline': baseline,
    'font-size': r2(size),
    'font-weight': weight,
    fill,
    transform: rotate ? `rotate(${rotate} ${r2(x)} ${r2(y)})` : undefined,
  });
  t.style.fontFamily = family;
  t.textContent = str;
  return t;
}

export function renderChartSvg(ctx, chart, width, height, { idBase = 'c' } = {}) {
  const dom = ctx.dom;
  const theme = ctx.doc.theme;
  const cd = theme.defaults.chart;
  const lang = ctx.doc.metadata?.language || 'en-US';
  const family = cssFontFamily(cd.font, ctx.doc);
  const fontForMeasure = `"${resolveFontValue(theme, cd.font)}"`;
  const labelSize = cd.label_size;
  const titleSize = cd.title_size;
  const labelColor = toCss(resolveColor(cd.label_color, theme));
  const gridColor = toCss(resolveColor(cd.gridline, theme));
  const textColor = toCss(resolveColor({ token: 'color.text.primary' }, theme));
  const colorFor = seriesColors(chart, theme);
  const fmt = chart.number_format || {};
  const mw = (str, size = labelSize, weight = 400) => measureText(str, size, family || fontForMeasure, weight);

  const root = s(dom, 'svg', { viewBox: `0 0 ${r2(width)} ${r2(height)}`, width: r2(width), height: r2(height), class: 'pe-chart-svg' });
  root.setAttribute('overflow', 'visible');
  const pad = Math.max(8, Math.min(width, height) * 0.03);
  let top = pad;
  let bottom = height - pad;
  let left = pad;
  let right = width - pad;

  if (chart.title) {
    root.appendChild(textEl(dom, chart.title, width / 2, top + titleSize / 2, { size: titleSize, fill: textColor, family, weight: 700 }));
    top += titleSize * 1.5;
  }

  // Legend
  const isPie = chart.kind === 'pie' || chart.kind === 'donut';
  const legendItems = isPie
    ? (chart.categories || []).map((c, i) => ({ name: c, color: colorFor(i) }))
    : chart.series.map((sr, i) => ({ name: sr.name, color: colorFor(i, sr.color) }));
  const legend = chart.legend || 'bottom';
  if (legend !== 'none' && legendItems.length) {
    const sw = labelSize * 0.8;
    const itemW = (it) => sw + labelSize * 0.4 + mw(it.name) + labelSize * 1.2;
    const g = s(dom, 'g', { class: 'pe-chart-legend' });
    if (legend === 'top' || legend === 'bottom') {
      const rows = [];
      let row = [];
      let rowW = 0;
      const maxW = right - left;
      for (const it of legendItems) {
        const w = itemW(it);
        if (row.length && rowW + w > maxW) {
          rows.push({ row, rowW });
          row = [];
          rowW = 0;
        }
        row.push(it);
        rowW += w;
      }
      if (row.length) rows.push({ row, rowW });
      const lh = labelSize * 1.5;
      const blockH = rows.length * lh;
      let y = legend === 'top' ? top + lh / 2 : bottom - blockH + lh / 2;
      for (const { row: items, rowW: rw } of rows) {
        let x = (width - rw) / 2;
        for (const it of items) {
          g.appendChild(s(dom, 'rect', { x: r2(x), y: r2(y - sw / 2), width: r2(sw), height: r2(sw), rx: r2(sw * 0.2), fill: toCss(it.color) }));
          g.appendChild(textEl(dom, it.name, x + sw + labelSize * 0.4, y, { size: labelSize, fill: labelColor, family, anchor: 'start' }));
          x += itemW(it);
        }
        y += lh;
      }
      if (legend === 'top') top += blockH + labelSize * 0.5;
      else bottom -= blockH + labelSize * 0.5;
    } else {
      const lw = Math.min((right - left) * 0.35, Math.max(...legendItems.map((it) => itemW(it))));
      const lh = labelSize * 1.5;
      const blockH = legendItems.length * lh;
      let y = (top + bottom) / 2 - blockH / 2 + lh / 2;
      const x0 = legend === 'left' ? left : right - lw;
      for (const it of legendItems) {
        g.appendChild(s(dom, 'rect', { x: r2(x0), y: r2(y - sw / 2), width: r2(sw), height: r2(sw), rx: r2(sw * 0.2), fill: toCss(it.color) }));
        g.appendChild(textEl(dom, it.name, x0 + sw + labelSize * 0.4, y, { size: labelSize, fill: labelColor, family, anchor: 'start' }));
        y += lh;
      }
      if (legend === 'left') left += lw + labelSize;
      else right -= lw + labelSize;
    }
    root.appendChild(g);
  }

  if (isPie) {
    renderPie(dom, root, chart, { left, top, right, bottom }, { colorFor, labelSize, family, fmt, lang, theme });
    return root;
  }

  // Axes
  const horizontal = chart.kind === 'bar' && chart.orientation === 'horizontal';
  const ext = seriesExtent(chart);
  const ax = chart.axis || {};
  const vScale = niceScale(ext.min, ext.max, 6, { fixedMin: typeof ax.min === 'number' ? ax.min : null, fixedMax: typeof ax.max === 'number' ? ax.max : null });
  if (chart.grouping === 'percent' && ax.min == null && ax.max == null) {
    vScale.min = ext.min < 0 ? -1 : 0;
    vScale.max = 1;
    vScale.step = 0.25;
    vScale.ticks = [];
    for (let v = vScale.min; v <= 1.0001; v += 0.25) vScale.ticks.push(Math.round(v * 100) / 100);
  }
  const valueFmt = chart.grouping === 'percent' ? { ...fmt, style: 'percent', decimals: 0 } : fmt;
  const tickLabels = vScale.ticks.map((t) => formatValue(t, valueFmt, lang));
  let xScale = null;
  let xTickLabels = [];
  if (chart.kind === 'scatter') {
    xScale = niceScale(ext.xmin, ext.xmax, 6);
    xTickLabels = xScale.ticks.map((t) => formatValue(t, fmt, lang));
  }
  const cats = chart.categories || [];

  // axis titles
  if (chart.y_title) {
    const x = left + labelSize * 0.6;
    root.appendChild(textEl(dom, chart.y_title, x, (top + bottom) / 2, { size: labelSize, fill: labelColor, family, rotate: -90, weight: 600 }));
    left += labelSize * 1.6;
  }
  if (chart.x_title) {
    root.appendChild(textEl(dom, chart.x_title, (left + right) / 2, bottom - labelSize * 0.6, { size: labelSize, fill: labelColor, family, weight: 600 }));
    bottom -= labelSize * 1.6;
  }

  // label space
  const leftLabels = horizontal ? cats : tickLabels;
  const leftW = Math.min((right - left) * 0.35, Math.max(0, ...leftLabels.map((l) => mw(l)))) + labelSize * 0.6;
  left += leftW;
  const bottomLabels = horizontal ? tickLabels : chart.kind === 'scatter' ? xTickLabels : cats;
  const band = (right - left) / Math.max(1, bottomLabels.length);
  const maxBottomW = Math.max(0, ...bottomLabels.map((l) => mw(l)));
  let rotateLabels = false;
  let skip = 1;
  if (!horizontal && chart.kind !== 'scatter' && maxBottomW > band * 0.95) {
    rotateLabels = true;
    const rotatedStep = labelSize * 1.2;
    if (rotatedStep > band) skip = 2;
  }
  const bottomH = rotateLabels ? Math.min((bottom - top) * 0.4, maxBottomW * 0.72 + labelSize) : labelSize * 1.6;
  bottom -= bottomH;
  if (bottom - top < 20 || right - left < 20) return root;

  const plot = { x: left, y: top, w: right - left, h: bottom - top };
  const gGrid = s(dom, 'g', { class: 'pe-chart-grid' });
  const gAxes = s(dom, 'g', { class: 'pe-chart-axes' });
  const gData = s(dom, 'g', { class: 'pe-chart-data' });
  const gLabels = s(dom, 'g', { class: 'pe-chart-labels' });
  root.append(gGrid, gData, gAxes, gLabels);

  const vPos = (v) => {
    const t = (v - vScale.min) / (vScale.max - vScale.min || 1);
    return horizontal ? plot.x + t * plot.w : plot.y + plot.h - t * plot.h;
  };
  const grid = chart.gridlines || { y: true };

  // value axis ticks & gridlines
  vScale.ticks.forEach((t, i) => {
    const p = vPos(t);
    if (horizontal) {
      if (grid.x || grid.y) gGrid.appendChild(s(dom, 'line', { x1: r2(p), y1: r2(plot.y), x2: r2(p), y2: r2(plot.y + plot.h), stroke: gridColor, 'stroke-width': 1 }));
      gLabels.appendChild(textEl(dom, tickLabels[i], p, plot.y + plot.h + labelSize * 0.8, { size: labelSize, fill: labelColor, family }));
    } else {
      if (grid.y !== false) gGrid.appendChild(s(dom, 'line', { x1: r2(plot.x), y1: r2(p), x2: r2(plot.x + plot.w), y2: r2(p), stroke: gridColor, 'stroke-width': 1 }));
      gLabels.appendChild(textEl(dom, tickLabels[i], plot.x - labelSize * 0.4, p, { size: labelSize, fill: labelColor, family, anchor: 'end' }));
    }
  });
  // baseline axis
  const zero = vPos(Math.max(vScale.min, Math.min(vScale.max, 0)));
  if (horizontal) gAxes.appendChild(s(dom, 'line', { x1: r2(zero), y1: r2(plot.y), x2: r2(zero), y2: r2(plot.y + plot.h), stroke: labelColor, 'stroke-width': 1 }));
  else gAxes.appendChild(s(dom, 'line', { x1: r2(plot.x), y1: r2(zero), x2: r2(plot.x + plot.w), y2: r2(zero), stroke: labelColor, 'stroke-width': 1 }));

  if (chart.kind === 'scatter') {
    const xPos = (v) => plot.x + ((v - xScale.min) / (xScale.max - xScale.min || 1)) * plot.w;
    xScale.ticks.forEach((t, i) => {
      const p = xPos(t);
      if (grid.x) gGrid.appendChild(s(dom, 'line', { x1: r2(p), y1: r2(plot.y), x2: r2(p), y2: r2(plot.y + plot.h), stroke: gridColor, 'stroke-width': 1 }));
      gLabels.appendChild(textEl(dom, xTickLabels[i], p, plot.y + plot.h + labelSize * 0.8, { size: labelSize, fill: labelColor, family }));
    });
    const rad = Math.max(3, labelSize * 0.35);
    chart.series.forEach((sr, si) => {
      const c = toCss(colorFor(si, sr.color));
      for (const pt of sr.points || []) {
        gData.appendChild(s(dom, 'circle', { cx: r2(xPos(pt.x)), cy: r2(vPos(pt.y)), r: r2(rad), fill: c }));
        if (chart.labels === 'value') gLabels.appendChild(textEl(dom, formatValue(pt.y, fmt, lang), xPos(pt.x), vPos(pt.y) - rad - labelSize * 0.6, { size: labelSize * 0.9, fill: labelColor, family }));
      }
    });
    return root;
  }

  // category axis labels
  const catBand = (horizontal ? plot.h : plot.w) / Math.max(1, cats.length);
  const catPos = (i) => (horizontal ? plot.y + catBand * (i + 0.5) : plot.x + catBand * (i + 0.5));
  cats.forEach((c, i) => {
    if (horizontal) {
      gLabels.appendChild(textEl(dom, c, plot.x - labelSize * 0.4, catPos(i), { size: labelSize, fill: labelColor, family, anchor: 'end' }));
    } else if (i % skip === 0) {
      if (rotateLabels) gLabels.appendChild(textEl(dom, c, catPos(i), plot.y + plot.h + labelSize * 0.6, { size: labelSize, fill: labelColor, family, anchor: 'end', baseline: 'hanging', rotate: -45 }));
      else gLabels.appendChild(textEl(dom, c, catPos(i), plot.y + plot.h + labelSize * 0.8, { size: labelSize, fill: labelColor, family }));
    }
  });

  if (chart.kind === 'bar') {
    const n = chart.series.length;
    const stacked = chart.grouping === 'stacked' || chart.grouping === 'percent';
    const groupW = catBand * 0.72;
    const barW = stacked ? groupW : groupW / Math.max(1, n);
    cats.forEach((_, ci) => {
      let posAcc = 0;
      let negAcc = 0;
      let total = 0;
      if (chart.grouping === 'percent') for (const sr of chart.series) total += Math.abs(sr.values[ci] || 0);
      chart.series.forEach((sr, si) => {
        let v = sr.values[ci];
        if (v === null || v === undefined) return;
        if (chart.grouping === 'percent') v = total ? v / total : 0;
        let a;
        let b;
        if (stacked) {
          if (v >= 0) { a = posAcc; b = posAcc + v; posAcc = b; }
          else { a = negAcc; b = negAcc + v; negAcc = b; }
        } else { a = 0; b = v; }
        const p1 = vPos(Math.max(vScale.min, Math.min(vScale.max, a)));
        const p2 = vPos(Math.max(vScale.min, Math.min(vScale.max, b)));
        const offset = stacked ? -groupW / 2 : -groupW / 2 + si * barW;
        const c = toCss(colorFor(si, sr.color));
        let rect;
        if (horizontal) {
          const y = catPos(ci) + offset;
          rect = s(dom, 'rect', { x: r2(Math.min(p1, p2)), y: r2(y), width: r2(Math.abs(p2 - p1)), height: r2(barW * 0.94), fill: c });
          if (chart.labels === 'value') gLabels.appendChild(textEl(dom, formatValue(chart.grouping === 'percent' ? v : sr.values[ci], valueFmt, lang), stacked ? (p1 + p2) / 2 : p2 + (v >= 0 ? labelSize * 0.3 : -labelSize * 0.3), y + barW * 0.47, { size: labelSize * 0.9, fill: stacked ? contrastOn(colorFor(si, sr.color)) : labelColor, family, anchor: stacked ? 'middle' : v >= 0 ? 'start' : 'end' }));
        } else {
          const x = catPos(ci) + offset;
          rect = s(dom, 'rect', { x: r2(x + barW * 0.03), y: r2(Math.min(p1, p2)), width: r2(barW * 0.94), height: r2(Math.abs(p2 - p1)), fill: c });
          if (chart.labels === 'value') gLabels.appendChild(textEl(dom, formatValue(chart.grouping === 'percent' ? v : sr.values[ci], valueFmt, lang), x + barW / 2, stacked ? (p1 + p2) / 2 : p2 - (v >= 0 ? labelSize * 0.6 : -labelSize * 0.6), { size: labelSize * 0.9, fill: stacked ? contrastOn(colorFor(si, sr.color)) : labelColor, family }));
        }
        gData.appendChild(rect);
      });
    });
  } else if (chart.kind === 'line') {
    const rad = Math.max(3, labelSize * 0.3);
    chart.series.forEach((sr, si) => {
      const c = toCss(colorFor(si, sr.color));
      let d = '';
      let pen = false;
      sr.values.forEach((v, ci) => {
        if (v === null || v === undefined) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${r2(catPos(ci))} ${r2(vPos(v))}`;
        pen = true;
      });
      gData.appendChild(s(dom, 'path', { d, fill: 'none', stroke: c, 'stroke-width': r2(Math.max(2, labelSize * 0.16)), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      sr.values.forEach((v, ci) => {
        if (v === null || v === undefined) return;
        if (chart.markers !== false) gData.appendChild(s(dom, 'circle', { cx: r2(catPos(ci)), cy: r2(vPos(v)), r: r2(rad), fill: c }));
        if (chart.labels === 'value') gLabels.appendChild(textEl(dom, formatValue(v, fmt, lang), catPos(ci), vPos(v) - rad - labelSize * 0.6, { size: labelSize * 0.9, fill: labelColor, family }));
      });
    });
  }
  return root;
}

function contrastOn(hex) {
  return relativeLuminance(hex) > 0.45 ? '#111827' : '#ffffff';
}

function arcPath(cx, cy, r, ri, a0, a1) {
  const p = (r0, a) => [cx + r0 * Math.sin(a), cy - r0 * Math.cos(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r, a0);
  const [x1, y1] = p(r, a1);
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    // full circle
    const [xm, ym] = p(r, a0 + Math.PI);
    let d = `M${r2(x0)} ${r2(y0)}A${r2(r)} ${r2(r)} 0 1 1 ${r2(xm)} ${r2(ym)}A${r2(r)} ${r2(r)} 0 1 1 ${r2(x0)} ${r2(y0)}Z`;
    if (ri > 0) {
      const [ix0, iy0] = p(ri, a0);
      const [ixm, iym] = p(ri, a0 + Math.PI);
      d += `M${r2(ix0)} ${r2(iy0)}A${r2(ri)} ${r2(ri)} 0 1 0 ${r2(ixm)} ${r2(iym)}A${r2(ri)} ${r2(ri)} 0 1 0 ${r2(ix0)} ${r2(iy0)}Z`;
    }
    return d;
  }
  if (ri > 0) {
    const [ix1, iy1] = p(ri, a1);
    const [ix0, iy0] = p(ri, a0);
    return `M${r2(x0)} ${r2(y0)}A${r2(r)} ${r2(r)} 0 ${large} 1 ${r2(x1)} ${r2(y1)}L${r2(ix1)} ${r2(iy1)}A${r2(ri)} ${r2(ri)} 0 ${large} 0 ${r2(ix0)} ${r2(iy0)}Z`;
  }
  return `M${r2(cx)} ${r2(cy)}L${r2(x0)} ${r2(y0)}A${r2(r)} ${r2(r)} 0 ${large} 1 ${r2(x1)} ${r2(y1)}Z`;
}

function renderPie(dom, root, chart, box, { colorFor, labelSize, family, fmt, lang, theme }) {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const r = Math.max(4, Math.min(box.right - box.left, box.bottom - box.top) / 2 - labelSize * 0.5);
  const ri = chart.kind === 'donut' ? r * 0.55 : 0;
  const values = (chart.series[0]?.values || []).map((v) => (v && v > 0 ? v : 0));
  const total = values.reduce((a, b) => a + b, 0);
  const g = s(dom, 'g', { class: 'pe-chart-data' });
  const gl = s(dom, 'g', { class: 'pe-chart-labels' });
  root.append(g, gl);
  if (!total) {
    g.appendChild(s(dom, 'circle', { cx: r2(cx), cy: r2(cy), r: r2(r), fill: 'none', stroke: toCss(resolveColor({ token: 'color.border' }, theme)) }));
    return;
  }
  let a = 0;
  const bg = toCss(resolveColor({ token: 'color.background' }, theme));
  values.forEach((v, i) => {
    if (!v) return;
    const a1 = a + (v / total) * Math.PI * 2;
    const c = colorFor(i);
    g.appendChild(s(dom, 'path', { d: arcPath(cx, cy, r, ri, a, a1), fill: toCss(c), stroke: bg, 'stroke-width': 1.5 }));
    if (chart.labels && chart.labels !== 'none') {
      const mid = (a + a1) / 2;
      const lr = ri ? (r + ri) / 2 : r * 0.62;
      const label = chart.labels === 'percent' ? formatValue(v / total * 100, { decimals: fmt.decimals ?? 0 }, lang, { percentOfWhole: true }) : formatValue(v, fmt, lang);
      if ((a1 - a) * lr > labelSize * 1.2) gl.appendChild(textEl(dom, label, cx + lr * Math.sin(mid), cy - lr * Math.cos(mid), { size: labelSize * 0.95, fill: contrastOn(c), family, weight: 600 }));
    }
    a = a1;
  });
}

// A visually hidden data table for assistive technology (spec §13.7).
export function chartDataTable(dom, chart, lang) {
  const table = h(dom, 'table', 'pe-sr-only');
  if (chart.title) {
    const cap = h(dom, 'caption');
    cap.textContent = chart.title;
    table.appendChild(cap);
  }
  const fmt = chart.number_format || {};
  const head = h(dom, 'tr');
  if (chart.kind === 'scatter') {
    for (const t of ['Series', 'X', 'Y']) {
      const th = h(dom, 'th');
      th.setAttribute('scope', 'col');
      th.textContent = t;
      head.appendChild(th);
    }
    table.appendChild(head);
    for (const sr of chart.series) for (const p of sr.points || []) {
      const tr = h(dom, 'tr');
      for (const v of [sr.name, formatValue(p.x, fmt, lang), formatValue(p.y, fmt, lang)]) {
        const td = h(dom, 'td');
        td.textContent = v;
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    return table;
  }
  head.appendChild(h(dom, 'td'));
  for (const sr of chart.series) {
    const th = h(dom, 'th');
    th.setAttribute('scope', 'col');
    th.textContent = sr.name;
    head.appendChild(th);
  }
  table.appendChild(head);
  (chart.categories || []).forEach((c, i) => {
    const tr = h(dom, 'tr');
    const th = h(dom, 'th');
    th.setAttribute('scope', 'row');
    th.textContent = c;
    tr.appendChild(th);
    for (const sr of chart.series) {
      const td = h(dom, 'td');
      td.textContent = formatValue(sr.values[i], fmt, lang);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  });
  return table;
}
