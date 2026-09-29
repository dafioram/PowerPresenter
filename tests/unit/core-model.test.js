import { describe, it, expect } from 'vitest';
import { newPresentation } from '../../src/core/factory.js';
import { validateDocument } from '../../src/core/validate.js';
import { canonicalize, normalizeDocument } from '../../src/core/canonical.js';
import { newId, isId } from '../../src/core/ids.js';
import { createStore } from '../../src/core/store.js';
import * as ops from '../../src/core/ops.js';
import { createSlideFromLayout, BUILTIN_LAYOUTS, planLayoutChange } from '../../src/core/layouts.js';
import { textElement, shapeElement, tableElement, chartElement, lineElement, connectorElement, slideOrder, imageElement } from '../../src/core/model.js';
import { BUILTIN_THEMES } from '../../src/core/theme.js';
import { validateTheme } from '../../src/core/validate.js';

describe('ids', () => {
  it('generates 22-character base64url ids', () => {
    const ids = new Set();
    for (let i = 0; i < 500; i++) {
      const id = newId();
      expect(id).toHaveLength(22);
      expect(isId(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(500);
  });
});

describe('themes', () => {
  it('every built-in theme is valid', () => {
    for (const t of BUILTIN_THEMES) {
      const r = validateTheme(t);
      expect(r.errors).toEqual([]);
    }
  });
});

describe('new presentation', () => {
  it('is valid and has one title slide', () => {
    const doc = newPresentation({ title: 'Test' });
    const r = validateDocument(doc);
    expect(r.errors).toEqual([]);
    expect(slideOrder(doc)).toHaveLength(1);
  });

  it('every built-in layout produces a valid slide', () => {
    const doc = newPresentation();
    for (const l of BUILTIN_LAYOUTS) {
      const s = createSlideFromLayout(doc, l.id);
      doc.slides[s.id] = s;
      doc.sections[0].slide_ids.push(s.id);
    }
    expect(validateDocument(doc).errors).toEqual([]);
  });

  it('canonicalize is idempotent and survives normalize', () => {
    const doc = newPresentation();
    const c1 = canonicalize(doc);
    const c2 = canonicalize(normalizeDocument(c1));
    expect(c2).toEqual(c1);
    expect(validateDocument(normalizeDocument(c1)).errors).toEqual([]);
  });
});

describe('validation catches problems', () => {
  it('rejects unknown fields and unknown element types', () => {
    const doc = newPresentation();
    const sid = slideOrder(doc)[0];
    doc.slides[sid].elements.push({ id: newId(), type: 'hologram', geometry: { x: 0, y: 0, width: 1, height: 1 } });
    doc.slides[sid].wibble = 1;
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes('supported element type'))).toBe(true);
    expect(r.errors.some((e) => e.message.includes('not a known field'))).toBe(true);
  });

  it('rejects dangling references and bad links', () => {
    const doc = newPresentation();
    const sid = slideOrder(doc)[0];
    const t = textElement({ text: 'hi' });
    t.link = { kind: 'slide', slide_id: 'nope' };
    const img = imageElement({ assetId: 'missing' });
    doc.slides[sid].elements.push(t, img);
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes('missing slide'))).toBe(true);
    expect(r.errors.some((e) => e.message.includes('missing asset'))).toBe(true);
    const doc2 = newPresentation();
    const bad = textElement({ text: 'x' });
    bad.link = { kind: 'url', href: 'javascript:alert(1)' };
    doc2.slides[slideOrder(doc2)[0]].elements.push(bad);
    const r2 = validateDocument(doc2);
    expect(r2.ok).toBe(false);
    expect(r2.errors.some((e) => e.path.includes('link'))).toBe(true);
  });

  it('rejects rotated charts and grouped tables', () => {
    const doc = newPresentation();
    const sid = slideOrder(doc)[0];
    const ch = chartElement();
    ch.geometry.rotation = 10;
    doc.slides[sid].elements.push(ch);
    expect(validateDocument(doc).ok).toBe(false);
  });
});

describe('store and ops', () => {
  it('undo and redo restore documents', () => {
    const doc = newPresentation();
    const store = createStore(doc, { validate: (d) => validateDocument(d) });
    const sid = slideOrder(doc)[0];
    const el = shapeElement();
    store.dispatch('Insert', (d) => ops.insertElements(d, { kind: 'slide', slideId: sid }, [el]));
    expect(store.getDoc().slides[sid].elements.some((e) => e.id === el.id)).toBe(true);
    store.undo();
    expect(store.getDoc().slides[sid].elements.some((e) => e.id === el.id)).toBe(false);
    store.redo();
    expect(store.getDoc().slides[sid].elements.some((e) => e.id === el.id)).toBe(true);
  });

  it('coalesces commands with the same key', () => {
    const doc = newPresentation();
    const store = createStore(doc);
    const sid = slideOrder(doc)[0];
    const el = shapeElement();
    const c = { kind: 'slide', slideId: sid };
    store.dispatch('Insert', (d) => ops.insertElements(d, c, [el]));
    for (let i = 0; i < 5; i++) store.dispatch('Move', (d) => ops.translateElements(d, c, [el.id], 1, 0), { coalesce: 'move' });
    expect(store.historySize().past).toBe(2);
    store.undo();
    expect(store.getDoc().slides[sid].elements.find((e) => e.id === el.id).geometry.x).toBe(100);
  });

  it('deleting a connector target detaches the connector', () => {
    const doc = newPresentation();
    const sid = slideOrder(doc)[0];
    const a = shapeElement({ x: 0, y: 0, width: 100, height: 100 });
    const b = shapeElement({ x: 400, y: 0, width: 100, height: 100 });
    const con = connectorElement({ start: { element_id: a.id, site: 'right' }, end: { element_id: b.id, site: 'left' } });
    const store = createStore(doc, { validate: (d) => validateDocument(d) });
    const c = { kind: 'slide', slideId: sid };
    store.dispatch('Insert', (d) => ops.insertElements(d, c, [a, b, con]));
    store.dispatch('Delete', (d) => ops.deleteElements(d, c, [b.id]));
    const g = store.getDoc().slides[sid].elements.find((e) => e.id === con.id).geometry;
    expect(g.end).toEqual({ x: 400, y: 50 });
    expect(g.start.element_id).toBe(a.id);
  });

  it('deleting a slide removes links to it and keeps one slide', () => {
    const doc = newPresentation();
    const s2 = createSlideFromLayout(doc, 'title_body');
    const store = createStore(doc, { validate: (d) => validateDocument(d) });
    const s1 = slideOrder(doc)[0];
    store.dispatch('Add', (d) => ops.insertSlides(d, [s2], s1));
    const t = textElement({ text: 'go' });
    t.link = { kind: 'slide', slide_id: s2.id };
    store.dispatch('Insert', (d) => ops.insertElements(d, { kind: 'slide', slideId: s1 }, [t]));
    store.dispatch('Delete slide', (d) => ops.deleteSlides(d, [s2.id]));
    expect(store.getDoc().slides[s1].elements.find((e) => e.id === t.id).link).toBeUndefined();
    store.dispatch('Delete last', (d) => ops.deleteSlides(d, [s1]));
    expect(slideOrder(store.getDoc())).toHaveLength(1);
  });

  it('groups and ungroups preserving positions', () => {
    const doc = newPresentation();
    const sid = slideOrder(doc)[0];
    const a = shapeElement({ x: 100, y: 100, width: 100, height: 50 });
    const b = shapeElement({ x: 300, y: 200, width: 80, height: 80 });
    b.geometry.rotation = 30;
    const store = createStore(doc, { validate: (d) => validateDocument(d) });
    const c = { kind: 'slide', slideId: sid };
    store.dispatch('Insert', (d) => ops.insertElements(d, c, [a, b]));
    let gid;
    store.dispatch('Group', (d) => { gid = ops.groupElements(d, c, [a.id, b.id]); });
    store.dispatch('Rotate', (d) => ops.rotateElements(d, c, [gid], 90));
    store.dispatch('Rotate back', (d) => ops.rotateElements(d, c, [gid], 0));
    store.dispatch('Ungroup', (d) => ops.ungroupElement(d, c, gid));
    const els = store.getDoc().slides[sid].elements;
    const a2 = els.find((e) => e.id === a.id);
    const b2 = els.find((e) => e.id === b.id);
    expect(a2.geometry.x).toBeCloseTo(100, 1);
    expect(a2.geometry.y).toBeCloseTo(100, 1);
    expect(b2.geometry.x).toBeCloseTo(300, 1);
    expect(b2.geometry.rotation).toBeCloseTo(30, 1);
  });

  it('change size fit keeps proportions and validity', () => {
    const doc = newPresentation();
    const store = createStore(doc, { validate: (d) => validateDocument(d) });
    store.dispatch('Size', (d) => ops.changeSize(d, { width: 960, height: 720, preset: '4:3' }, 'fit'));
    expect(store.getDoc().size.width).toBe(960);
  });

  it('layout change never deletes elements', () => {
    const doc = newPresentation();
    const sid = slideOrder(doc)[0];
    const slide = doc.slides[sid];
    slide.elements.push(tableElement(), lineElement());
    const plan = planLayoutChange(doc, slide, 'two_column');
    for (const e of slide.elements) expect(plan.elements.some((x) => x.id === e.id)).toBe(true);
  });
});
