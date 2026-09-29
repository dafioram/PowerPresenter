// The machine-readable JSON Schema (spec §5.18) agrees with the validator.
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../schema/pres-format-v1.schema.json';
import { newPresentation } from '../../src/core/factory.js';
import { BUILTIN_LAYOUTS, createSlideFromLayout } from '../../src/core/layouts.js';
import { textElement, shapeElement, lineElement, connectorElement, tableElement, chartElement } from '../../src/core/model.js';
import { groupElements } from '../../src/core/ops.js';
import { canonicalize } from '../../src/core/canonical.js';
import { validateDocument } from '../../src/core/validate.js';
import { BUILTIN_THEMES } from '../../src/core/theme.js';
import { bodyFromText } from '../../src/core/text.js';
import { produce } from 'immer';

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
const check = ajv.compile(schema);

function envelope(doc) {
  return { format: 'pres', format_version: 1, created_with: 'test', exported_at: '2026-01-01T00:00:00Z', document: canonicalize(doc) };
}

function richDocument() {
  let doc = newPresentation({ title: 'Schema test' });
  for (const l of BUILTIN_LAYOUTS) {
    const s = createSlideFromLayout(doc, l.id);
    doc.slides[s.id] = s;
    doc.sections[0].slide_ids.push(s.id);
  }
  const s = createSlideFromLayout(doc, 'blank');
  const t = textElement({ text: 'Hello', role: 'body' });
  t.text.body.paragraphs[0].list = { kind: 'number', level: 1, number_style: 'lower_roman' };
  t.text.body.paragraphs.push({ inlines: [{ field: 'date', format: 'long', value: 'auto' }, { break: true }, { text: 'x', marks: { weight: 700, link: { kind: 'url', href: 'https://example.com' } } }] });
  const a = shapeElement({ preset: 'round_rect' });
  a.style = { fill: { type: 'linear', angle: 45, stops: [{ offset: 0, color: { token: 'color.accent.1', tint: 0.4 } }, { offset: 1, color: '#11223344' }] }, stroke: { color: '#000000', width: 2, dash: 'dash' }, shadow: { color: '#00000055', offset_x: 2, offset_y: 3, blur: 8 } };
  a.shape.text = { body: bodyFromText('In a shape') };
  const b = shapeElement({ preset: 'ellipse', x: 500 });
  const c = connectorElement({ start: { element_id: a.id, site: 'right' }, end: { element_id: b.id, site: 'left' } });
  const ln = lineElement({});
  ln.style = { arrowheads: { end: { kind: 'stealth', size: 'large' } } };
  const tb = tableElement({ rows: 2, cols: 2 });
  const ch = chartElement({ kind: 'scatter' });
  ch.chart.number_format = { decimals: 1, prefix: '$' };
  s.elements.push(t, a, b, c, ln, tb, ch);
  s.builds = [{ id: 'bld00000000000000000001', element_id: t.id, effect: 'fly_in', direction: 'up', trigger: 'on_click', by: 'paragraph', duration_ms: 300 }];
  s.transition = { kind: 'push', direction: 'left', duration_ms: 500 };
  s.notes = bodyFromText('Notes');
  doc.slides[s.id] = s;
  doc.sections.push({ id: 'sec00000000000000000001', name: 'Second', slide_ids: [s.id] });
  const extra = shapeElement({ preset: 'rect', x: 900 });
  doc.slides[s.id].elements.push(extra);
  doc.authoring = { guides: [{ id: 'gd000000000000000000001', axis: 'x', position: 100 }], grid: { spacing: 40, visible: true, snap: false } };
  doc = produce(doc, (d) => { groupElements(d, { kind: 'slide', slideId: s.id }, [b.id, extra.id]); });
  return doc;
}

describe('JSON Schema', () => {
  it('accepts every built-in theme and layout', () => {
    for (const t of BUILTIN_THEMES) {
      const doc = newPresentation({ title: t.name, themeId: t.id });
      const ok = check(envelope(doc));
      expect(ok, JSON.stringify(check.errors?.slice(0, 3))).toBe(true);
    }
  });

  it('accepts a document using every element type', () => {
    const doc = richDocument();
    expect(validateDocument(doc).ok, JSON.stringify(validateDocument(doc).errors?.slice(0, 3))).toBe(true);
    const ok = check(envelope(doc));
    expect(ok, JSON.stringify(check.errors?.slice(0, 5), null, 1)).toBe(true);
  });

  it('rejects unknown fields, unknown element types and wrong versions like the validator', () => {
    const doc = newPresentation({ title: 'Bad' });
    const env = envelope(doc);
    env.document.metadata.extra = 1;
    expect(check(env)).toBe(false);
    const env2 = envelope(doc);
    const sid = Object.keys(env2.document.slides)[0];
    env2.document.slides[sid].elements.push({ id: 'x0000000000000000000001', type: 'sticker', geometry: { x: 0, y: 0, width: 1, height: 1 } });
    expect(check(env2)).toBe(false);
    expect(check({ ...envelope(doc), format_version: 2 })).toBe(false);
  });
});
