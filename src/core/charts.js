// Chart data helpers (spec §13.7): axis scales, number formats, alt text, data grid.
import { newId } from './ids.js';

// Fixed "nice numbers" algorithm for axis ticks.
export function niceNumber(range, round) {
  if (range <= 0 || !isFinite(range)) return 1;
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  let nf;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

export function niceScale(min, max, maxTicks = 6, { fixedMin = null, fixedMax = null } = {}) {
  let lo = fixedMin ?? min;
  let hi = fixedMax ?? max;
  if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
  if (lo === hi) {
    if (lo === 0) hi = 1;
    else if (lo > 0) lo = 0;
    else hi = 0;
  }
  const range = niceNumber(hi - lo, false);
  const step = niceNumber(range / Math.max(1, maxTicks - 1), true);
  const nMin = fixedMin ?? Math.floor(lo / step) * step;
  const nMax = fixedMax ?? Math.ceil(hi / step) * step;
  const ticks = [];
  const start = Math.ceil(nMin / step - 1e-9) * step;
  for (let v = start; v <= nMax + step * 1e-9; v += step) ticks.push(Math.round(v / step) * step || 0);
  if (fixedMin !== null && ticks[0] !== fixedMin) ticks.unshift(fixedMin);
  return { min: nMin, max: nMax, step, ticks };
}

export function formatValue(v, fmt = {}, lang = 'en-US', { percentOfWhole = false } = {}) {
  if (v === null || v === undefined || !isFinite(v)) return '';
  const decimals = fmt.decimals ?? (percentOfWhole ? 0 : Number.isInteger(v) ? 0 : 1);
  let num = Object.is(v, -0) ? 0 : v;
  let suffix = fmt.suffix || '';
  if (fmt.style === 'percent' && !percentOfWhole) num = v * 100;
  if (fmt.style === 'percent' || percentOfWhole) suffix = '%' + suffix;
  let s;
  try {
    s = new Intl.NumberFormat(lang, { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: fmt.thousands !== false }).format(num);
  } catch {
    s = num.toFixed(decimals);
  }
  return (fmt.prefix || '') + s + suffix;
}

export function seriesExtent(chart) {
  let min = Infinity;
  let max = -Infinity;
  if (chart.kind === 'scatter') {
    let xmin = Infinity;
    let xmax = -Infinity;
    for (const s of chart.series) for (const p of s.points || []) {
      min = Math.min(min, p.y); max = Math.max(max, p.y);
      xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x);
    }
    return { min, max, xmin, xmax };
  }
  if (chart.kind === 'bar' && (chart.grouping === 'stacked' || chart.grouping === 'percent')) {
    const n = (chart.categories || []).length;
    for (let i = 0; i < n; i++) {
      let pos = 0;
      let neg = 0;
      for (const s of chart.series) {
        const v = s.values?.[i];
        if (v === null || v === undefined) continue;
        if (v >= 0) pos += v;
        else neg += v;
      }
      if (chart.grouping === 'percent') { min = Math.min(min, neg < 0 ? -1 : 0); max = Math.max(max, pos > 0 ? 1 : 0); }
      else { min = Math.min(min, neg); max = Math.max(max, pos); }
    }
    return { min, max };
  }
  for (const s of chart.series) for (const v of s.values || []) {
    if (v === null || v === undefined) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  if (chart.kind === 'bar') { min = Math.min(0, min); max = Math.max(0, max); }
  return { min, max };
}

const KIND_NAMES = { bar: 'Bar chart', line: 'Line chart', pie: 'Pie chart', donut: 'Donut chart', scatter: 'Scatter chart' };

// Default alt text from kind, title, series names, category count and value range.
export function defaultAltText(chart, lang = 'en-US') {
  let kind = KIND_NAMES[chart.kind] || 'Chart';
  if (chart.kind === 'bar' && chart.orientation === 'horizontal') kind = 'Horizontal bar chart';
  const parts = [chart.title ? `${kind}: ${chart.title}.` : `${kind}.`];
  const names = chart.series.map((s) => s.name).filter(Boolean);
  if (names.length) parts.push(`${names.length === 1 ? 'Series' : `${names.length} series`}: ${names.join(', ')}.`);
  if (chart.kind !== 'scatter' && chart.categories?.length) parts.push(`${chart.categories.length} categories (${chart.categories.slice(0, 6).join(', ')}${chart.categories.length > 6 ? ', …' : ''}).`);
  const ext = seriesExtent(chart);
  if (isFinite(ext.min) && isFinite(ext.max) && chart.grouping !== 'percent') {
    parts.push(`Values range from ${formatValue(ext.min, chart.number_format, lang)} to ${formatValue(ext.max, chart.number_format, lang)}.`);
  }
  return parts.join(' ');
}

// Converts chart data to a 2-D grid for the data editor.
export function chartToGrid(chart) {
  if (chart.kind === 'scatter') {
    const rows = [['Series', 'X', 'Y']];
    for (const s of chart.series) for (const p of s.points || []) rows.push([s.name, String(p.x), String(p.y)]);
    return rows;
  }
  const rows = [['', ...chart.series.map((s) => s.name)]];
  (chart.categories || []).forEach((c, i) => rows.push([c, ...chart.series.map((s) => (s.values[i] === null ? '' : String(s.values[i])))]));
  return rows;
}

function parseNum(s) {
  const t = String(s ?? '').trim().replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t.replace(/%$/, ''));
  if (!isFinite(n)) return NaN;
  return t.endsWith('%') ? n / 100 : n;
}

// Parses a grid back into chart data. Returns { ok, chart | error }.
export function gridToChart(chart, rows) {
  const out = JSON.parse(JSON.stringify(chart));
  const cleanRows = rows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (chart.kind === 'scatter') {
    const byName = new Map();
    for (const r of cleanRows.slice(1)) {
      const name = String(r[0] || 'Series 1').slice(0, 100);
      const x = parseNum(r[1]);
      const y = parseNum(r[2]);
      if (x === null || y === null || Number.isNaN(x) || Number.isNaN(y)) return { ok: false, error: `Row "${r.join(', ')}" needs numeric X and Y.` };
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ x, y });
    }
    if (!byName.size) return { ok: false, error: 'Add at least one point.' };
    const old = new Map(chart.series.map((s) => [s.name, s]));
    out.series = [...byName].map(([name, points]) => ({ id: old.get(name)?.id || newId(), name, points, ...(old.get(name)?.color ? { color: old.get(name).color } : {}) }));
    return { ok: true, chart: out };
  }
  if (!cleanRows.length) return { ok: false, error: 'Add some data.' };
  const header = cleanRows[0];
  const names = header.slice(1).map((n, i) => String(n || `Series ${i + 1}`).slice(0, 100));
  if (!names.length) return { ok: false, error: 'Add at least one series column.' };
  if ((chart.kind === 'pie' || chart.kind === 'donut') && names.length !== 1) return { ok: false, error: 'Pie and donut charts take exactly one series.' };
  const cats = [];
  const values = names.map(() => []);
  for (const r of cleanRows.slice(1)) {
    cats.push(String(r[0] ?? '').slice(0, 100));
    for (let i = 0; i < names.length; i++) {
      const v = parseNum(r[i + 1]);
      if (Number.isNaN(v)) return { ok: false, error: `"${r[i + 1]}" isn't a number.` };
      if ((chart.kind === 'pie' || chart.kind === 'donut') && v !== null && v < 0) return { ok: false, error: 'Pie and donut values can’t be negative.' };
      values[i].push(v);
    }
  }
  if (!cats.length) return { ok: false, error: 'Add at least one category row.' };
  out.categories = cats;
  out.series = names.map((name, i) => {
    const prev = chart.series[i];
    return { id: prev?.id || newId(), name, values: values[i], ...(prev?.color ? { color: prev.color } : {}) };
  });
  return { ok: true, chart: out };
}

// Converts a chart between kinds, keeping data where possible.
export function convertChartKind(chart, kind) {
  const out = { ...JSON.parse(JSON.stringify(chart)), kind };
  if (kind === 'scatter' && chart.kind !== 'scatter') {
    out.series = chart.series.map((s) => ({ id: s.id, name: s.name, points: (s.values || []).map((v, i) => ({ x: i + 1, y: v ?? 0 })) }));
    delete out.categories;
  } else if (kind !== 'scatter' && chart.kind === 'scatter') {
    const n = Math.max(...chart.series.map((s) => s.points.length));
    out.categories = Array.from({ length: n }, (_, i) => String(i + 1));
    out.series = chart.series.map((s) => ({ id: s.id, name: s.name, values: Array.from({ length: n }, (_, i) => s.points[i]?.y ?? null) }));
  }
  if (kind === 'pie' || kind === 'donut') {
    out.series = [out.series[0]];
    out.series[0].values = out.series[0].values.map((v) => (v === null ? null : Math.abs(v)));
    if (out.labels === 'none') out.labels = 'percent';
  }
  if (kind !== 'bar') { delete out.orientation; delete out.grouping; }
  else { out.orientation ||= 'vertical'; out.grouping ||= 'clustered'; }
  if (kind !== 'line') delete out.markers;
  if (kind !== 'pie' && kind !== 'donut' && out.labels === 'percent') out.labels = 'value';
  return out;
}
