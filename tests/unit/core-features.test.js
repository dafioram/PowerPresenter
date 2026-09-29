// Core features: find/replace, tables, charts, builds, reading order,
// accessibility checks and moving elements between groups.
import { describe, it, expect } from 'vitest';
import { produce } from 'immer';
import { newPresentation } from '../../src/core/factory.js';
import { createSlideFromLayout } from '../../src/core/layouts.js';
import { textElement, shapeElement, tableElement, chartElement, slideOrder, locate } from '../../src/core/model.js';
import { findMatches, replaceMatches } from '../../src/core/find.js';
import { insertRow, insertColumn, deleteRow, mergeCells, splitCell, tableGrid, fillFromGrid, parseDelimited } from '../../src/core/tables.js';
import { chartToGrid, gridToChart, convertChartKind, niceScale, formatValue } from '../../src/core/charts.js';
import { buildSteps, visibilityAt } from '../../src/core/builds.js';
import { readingOrder } from '../../src/core/reading-order.js';
import { checkAccessibility } from '../../src/core/a11y.js';
import { groupElements, moveElementTo } from '../../src/core/ops.js';
import { worldMap, apply } from '../../src/core/geometry.js';
import { bodyFromText, plainText } from '../../src/core/text.js';
import { validateDocument } from '../../src/core/validate.js';

function deckWith(elements, layout = 'blank') {
  const doc = newPresentation({ title: 'Test' });
  const s = createSlideFromLayout(doc, layout);
  s.elements.push(...elements);
  doc.slides[s.id] = s;
  doc.sections[0].slide_ids.push(s.id);
  return { doc, slide: s };
}

describe('find and replace', () => {
  it('finds case-insensitively, respects whole words and keeps formatting', () => {
    const t = textElement({ text: 'Cat catalog cat', marks: { weight: 700 } });
    const { doc } = deckWith([t]);
    expect(findMatches(doc, 'cat').length).toBe(3);
    expect(findMatches(doc, 'cat', { wholeWord: true }).length).toBe(2);
    expect(findMatches(doc, 'Cat', { matchCase: true }).length).toBe(1);
    const matches = findMatches(doc, 'cat', { wholeWord: true });
    const next = produce(doc, (d) => { replaceMatches(d, matches, 'dog'); });
    const el = Object.values(next.slides).flatMap((s) => s.elements).find((e) => e.id === t.id);
    expect(plainText(el.text.body)).toBe('dog catalog dog');
    expect(el.text.body.paragraphs[0].inlines.every((i) => i.marks?.weight === 700)).toBe(true);
    expect(validateDocument(next).ok).toBe(true);
  });
});

describe('tables', () => {
  it('insert, merge, split and delete keep a consistent grid', () => {
    let t = tableElement({ rows: 3, cols: 3 }).table;
    t = insertRow(t, 1);
    t = insertColumn(t, 3);
    expect(t.rows.length).toBe(4);
    expect(t.columns.length).toBe(4);
    t = mergeCells(t, 0, 0, 1, 1);
    const g = tableGrid(t);
    expect(g[1][1].covered).toBe(true);
    expect(g[1][1].anchor).toBe(g[0][0].key);
    t = insertRow(t, 1); // inside the merge → merge grows
    expect(t.cells[g[0][0].key].row_span).toBe(3);
    t = deleteRow(t, t.rows[0].id); // anchor row deleted → anchor moves down
    const g2 = tableGrid(t);
    expect(t.cells[g2[0][0].key].row_span).toBe(2);
    t = splitCell(t, g2[0][0].key);
    expect(tableGrid(t).flat().every((c) => !c.covered)).toBe(true);
  });

  it('fills from pasted CSV and grows', () => {
    const rows = parseDelimited('a,"b, c"\n1,2\n3,4\n');
    expect(rows).toEqual([['a', 'b, c'], ['1', '2'], ['3', '4']]);
    const t = fillFromGrid(tableElement({ rows: 2, cols: 2 }).table, rows);
    expect(t.rows.length).toBe(3);
    const k = `${t.rows[2].id}:${t.columns[1].id}`;
    expect(plainText(t.cells[k].body)).toBe('4');
  });
});

describe('charts', () => {
  it('grid round trip and kind conversion', () => {
    const c = chartElement({ kind: 'bar' }).chart;
    const grid = chartToGrid(c);
    grid[1][1] = '1,500';
    grid[2][2] = '25%';
    const r = gridToChart(c, grid);
    expect(r.ok).toBe(true);
    expect(r.chart.series[0].values[0]).toBe(1500);
    expect(r.chart.series[1].values[1]).toBe(0.25);
    expect(gridToChart(c, [['', 'A'], ['x', 'oops']]).ok).toBe(false);
    const pie = convertChartKind(c, 'pie');
    expect(pie.series.length).toBe(1);
    const sc = convertChartKind(c, 'scatter');
    expect(sc.series[0].points.length).toBe(4);
  });

  it('axis scales have no negative zero and format numbers', () => {
    const s = niceScale(0, 27);
    expect(s.ticks[0]).toBe(0);
    expect(Object.is(s.ticks[0], -0)).toBe(false);
    expect(formatValue(-0, {})).toBe('0');
    expect(formatValue(0.256, { style: 'percent', decimals: 1 })).toBe('25.6%');
    expect(formatValue(1234.5, { prefix: '$', decimals: 2, thousands: true }, 'en-US')).toBe('$1,234.50');
  });
});

describe('builds', () => {
  it('groups builds into click steps and computes visibility', () => {
    const a = textElement({ text: 'A' });
    const b = textElement({ text: 'one\ntwo', y: 300 });
    const { slide } = deckWith([a, b]);
    slide.builds = [
      { id: 'b1aaaaaaaaaaaaaaaaaaaa', element_id: a.id, effect: 'fade_in', trigger: 'with_previous' },
      { id: 'b2aaaaaaaaaaaaaaaaaaaa', element_id: b.id, effect: 'appear', trigger: 'on_click', by: 'paragraph' },
    ];
    const { steps, clickSteps } = buildSteps(slide);
    expect(clickSteps).toBe(2);
    expect(steps[0].length).toBe(1);
    const v0 = visibilityAt(slide, 0, { includeAuto: false });
    expect(v0.get(a.id).hidden).toBe(true);
    const v1 = visibilityAt(slide, 1);
    expect(v1.get(a.id).hidden).toBe(false);
  });
});

describe('reading order and accessibility', () => {
  it('puts titles first and reads rows left to right (right to left for RTL)', () => {
    const left = textElement({ text: 'L', x: 100, y: 300 });
    const right = textElement({ text: 'R', x: 700, y: 300 });
    const title = textElement({ text: 'T', x: 100, y: 500, role: 'title' });
    const { slide } = deckWith([right, left, title]);
    expect(readingOrder(slide).map((e) => e.id)).toEqual([title.id, left.id, right.id]);
    expect(readingOrder(slide, { rtl: true }).map((e) => e.id)).toEqual([title.id, right.id, left.id]);
  });

  it('flags missing titles, alt text and low contrast', () => {
    const faint = textElement({ text: 'faint', marks: { color: '#eeeeee' } });
    const chart = chartElement({ kind: 'bar' });
    const { doc, slide } = deckWith([faint, chart]);
    const issues = checkAccessibility(doc);
    const rules = issues.filter((i) => i.slideId === slide.id).map((i) => i.rule);
    expect(rules).toContain('slide-title');
    expect(rules).toContain('alt-text');
    expect(rules).toContain('contrast');
  });
});

describe('layers: moving elements between groups', () => {
  it('keeps the visual position when moving into and out of a group', () => {
    const a = shapeElement({ x: 100, y: 100, width: 100, height: 50 });
    const b = shapeElement({ x: 400, y: 300, width: 100, height: 50 });
    const c = shapeElement({ x: 700, y: 500, width: 80, height: 40 });
    const { doc, slide } = deckWith([a, b, c]);
    const container = { kind: 'slide', slideId: slide.id };
    let gid;
    let d2 = produce(doc, (d) => { gid = groupElements(d, container, [a.id, b.id]); });
    d2 = produce(d2, (d) => {
      const g = locate(d.slides[slide.id].elements, gid).el;
      g.geometry.rotation = 30;
    });
    const worldOf = (docx, id) => {
      const w = worldMap(docx.slides[slide.id].elements);
      const info = w.get(id);
      return apply(info.world, { x: info.width / 2, y: info.height / 2 });
    };
    const before = worldOf(d2, c.id);
    const d3 = produce(d2, (d) => { expect(moveElementTo(d, container, c.id, gid, 0)).toBe(true); });
    const after = worldOf(d3, c.id);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(validateDocument(d3).ok).toBe(true);
    const d4 = produce(d3, (d) => { moveElementTo(d, container, c.id, null, 0); });
    const back = worldOf(d4, c.id);
    expect(back.x).toBeCloseTo(before.x, 0);
    expect(slideOrder(d4).length).toBe(2);
    expect(bodyFromText('x').paragraphs.length).toBe(1);
  });
});
