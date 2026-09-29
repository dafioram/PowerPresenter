// @vitest-environment jsdom
// Export writers: PPTX DrawingML pieces, charts, animations, HTML data, ranges.
import { describe, it, expect, beforeAll } from 'vitest';
import manifest from '../../src/generated/font-manifest.json';
import { setFontRegistry } from '../../src/render/fonts.js';
import { newPresentation } from '../../src/core/factory.js';
import { chartElement, textElement, slideOrder } from '../../src/core/model.js';
import { createSlideFromLayout } from '../../src/core/layouts.js';
import { colorXml, fillXml, lineXml, paragraphsXml, esc, emu, angle } from '../../src/export/pptx/drawing.js';
import { chartXml, numberFormatCode } from '../../src/export/pptx/chart.js';
import { timingXml } from '../../src/export/pptx/timing.js';
import { themeXml, presentationXml, masterXml } from '../../src/export/pptx/parts.js';
import { inertJson, prepareHtmlDoc } from '../../src/export/html.js';
import { parseRange } from '../../src/core/range.js';
import { slideIdsForRange, danglingSlideLinks, linkTargets } from '../../src/export/common.js';
import { validateDocument } from '../../src/core/validate.js';
import { bodyFromText } from '../../src/core/text.js';

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';

function parseXml(str) {
  const doc = new DOMParser().parseFromString(str.replace(/^<\?xml[^>]*>\s*/, ''), 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error(`XML error: ${err.textContent}\n${str.slice(0, 400)}`);
  return doc;
}
const wrap = (inner) => parseXml(`<root ${A}>${inner}</root>`);

beforeAll(() => setFontRegistry(manifest.families));

describe('DrawingML helpers', () => {
  const doc = newPresentation({ title: 'T' });
  const theme = doc.theme;

  it('maps theme tokens to scheme colors with tints', () => {
    expect(colorXml({ token: 'color.accent.1' }, theme)).toBe('<a:schemeClr val="accent1"></a:schemeClr>');
    const t = colorXml({ token: 'color.text.primary', tint: 0.4 }, theme);
    expect(t).toContain('val="tx1"');
    expect(t).toContain('<a:lumMod val="60000"/>');
    expect(t).toContain('<a:lumOff val="40000"/>');
    expect(colorXml({ token: 'color.border' }, theme)).toMatch(/^<a:srgbClr val="[0-9A-F]{6}">/);
    expect(colorXml('#ff000080', theme)).toContain('<a:alpha val="50196"/>');
  });

  it('converts CSS gradient angles to DrawingML angles', () => {
    const x = fillXml({ type: 'linear', angle: 90, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] }, theme);
    expect(x).toContain(`<a:lin ang="${angle(0)}"`);
    expect(fillXml('none', theme)).toBe('<a:noFill/>');
    wrap(x);
  });

  it('writes strokes with dashes and arrowheads', () => {
    const x = lineXml({ color: '#123456', width: 4, dash: 'dash', cap: 'round' }, theme, { arrowheads: { start: { kind: 'none' }, end: { kind: 'triangle', size: 'large' } } });
    expect(x).toContain(`w="${emu(4)}"`);
    expect(x).toContain('<a:prstDash val="dash"/>');
    expect(x).toContain('<a:tailEnd type="triangle" w="lg" len="lg"/>');
    expect(x).not.toContain('headEnd');
    wrap(x);
  });

  it('writes paragraphs with bullets, numbering, links and escaping', () => {
    const body = bodyFromText('One & two\n<Three>');
    body.paragraphs[0].list = { kind: 'bullet', level: 0 };
    body.paragraphs[1].list = { kind: 'number', level: 1, number_style: 'upper_roman' };
    body.paragraphs[1].inlines[0].marks = { weight: 700, link: { kind: 'url', href: 'https://example.com' } };
    const x = paragraphsXml(doc, { body }, { kind: 'text', lang: 'en-US', linkXml: () => '<a:hlinkClick r:id="rId9"/>' });
    expect(x).toContain('<a:buChar char="•"/>');
    expect(x).toContain('<a:buAutoNum type="romanUcPeriod"/>');
    expect(x).toContain('One &amp; two');
    expect(x).toContain('&lt;Three&gt;');
    expect(x).toContain('b="1"');
    expect(x).toContain('r:id="rId9"');
    const parsed = wrap(x);
    expect(parsed.getElementsByTagName('a:p').length).toBe(2);
  });

  it('escapes control characters', () => {
    expect(esc('a\u0001b"c')).toBe('ab&quot;c');
  });
});

describe('PowerPoint parts', () => {
  const doc = newPresentation({ title: 'Deck & "quotes"' });

  it('theme, master and presentation parts are well-formed', () => {
    parseXml(themeXml(doc));
    parseXml(masterXml(doc, '', ''));
    const pres = presentationXml(doc, { slideRefs: [{ sldId: 256, rid: 'rId2' }], notesRid: 'rId3', sections: [{ name: 'Intro', sldIds: [256] }] });
    const d = parseXml(pres);
    const sz = d.getElementsByTagName('p:sldSz')[0];
    expect(sz.getAttribute('cx')).toBe(String(1280 * 9525));
    expect(pres).toContain('p14:section name="Intro"');
  });

  it('charts of every kind are well-formed and carry cached values', () => {
    for (const kind of ['bar', 'line', 'pie', 'donut', 'scatter']) {
      const el = chartElement({ kind });
      el.chart.title = 'Sales <2026>';
      el.chart.labels = kind === 'pie' ? 'percent' : 'value';
      const x = chartXml(doc, el.chart);
      const d = parseXml(x);
      expect(d.getElementsByTagName('c:ser').length).toBe(el.chart.series.length);
      expect(x).toContain('Sales &lt;2026&gt;');
      expect(x).toContain('<c:externalData r:id="rId1">');
    }
  });

  it('number formats map to Excel codes', () => {
    expect(numberFormatCode({})).toBe('General');
    expect(numberFormatCode({ decimals: 2, thousands: true })).toBe('#,##0.00');
    expect(numberFormatCode({ style: 'percent', decimals: 1 })).toBe('0.0%');
    expect(numberFormatCode({ prefix: '$', decimals: 0 })).toBe('"$"0');
  });

  it('builds become a valid timing tree with unique node ids', () => {
    const slide = createSlideFromLayout(doc, 'title_body');
    const [title, body] = slide.elements;
    body.text.body = bodyFromText('a\nb\nc');
    slide.builds = [
      { id: 'b1', element_id: title.id, effect: 'fade_in', trigger: 'on_click', duration_ms: 400 },
      { id: 'b2', element_id: body.id, effect: 'fly_in', direction: 'left', trigger: 'after_previous', by: 'paragraph', duration_ms: 300 },
      { id: 'b3', element_id: title.id, effect: 'fade_out', trigger: 'on_click', duration_ms: 300 },
    ];
    const ids = new Map([[title.id, 2], [body.id, 3]]);
    const x = timingXml(slide, (id) => ids.get(id) || null);
    const d = parseXml(`<root ${A}>${x}</root>`);
    const ctn = [...d.getElementsByTagName('p:cTn')].map((n) => n.getAttribute('id'));
    expect(new Set(ctn).size).toBe(ctn.length);
    expect(ctn.slice(0, 2)).toEqual(['1', '2']);
    expect(x).toContain('presetClass="entr"');
    expect(x).toContain('presetClass="exit"');
    expect(x).toContain('<p:pRg st="2" end="2"/>');
    expect(x).toContain('build="p"');
    expect(timingXml({ ...slide, builds: [] }, () => 2)).toBe('');
  });
});

describe('HTML export data', () => {
  it('inert JSON cannot close its script block', () => {
    const s = inertJson({ t: '</script><script>alert(1)</script>', u: ' ' });
    expect(s).not.toContain('</script');
    expect(s).not.toContain('<');
    expect(JSON.parse(s).t).toBe('</script><script>alert(1)</script>');
  });

  it('excluded slides become stubs so numbers keep their values; notes are dropped', () => {
    const doc = newPresentation({ title: 'X' });
    const s2 = createSlideFromLayout(doc, 'title_body');
    s2.notes = bodyFromText('secret');
    doc.slides[s2.id] = s2;
    doc.sections[0].slide_ids.push(s2.id);
    const first = slideOrder(doc)[0];
    const out = prepareHtmlDoc(doc, [s2.id], { notes: false });
    expect(slideOrder(out)).toEqual(slideOrder(doc));
    expect(out.slides[first].elements).toEqual([]);
    expect(out.slides[first].hidden).toBe(true);
    expect(out.slides[s2.id].notes).toBeUndefined();
    expect(validateDocument(out).ok).toBe(true);
  });
});

describe('ranges and links', () => {
  it('parses custom ranges', () => {
    expect(parseRange('1-3, 5', 6)).toEqual([0, 1, 2, 4]);
    expect(parseRange('3–1', 6)).toEqual([0, 1, 2]);
    expect(parseRange('7', 6)).toBeNull();
    expect(parseRange('a', 6)).toBeNull();
  });

  it('selects slides, skipping hidden ones unless asked', () => {
    const doc = newPresentation({ title: 'R' });
    const s2 = createSlideFromLayout(doc, 'title_body');
    s2.hidden = true;
    doc.slides[s2.id] = s2;
    doc.sections[0].slide_ids.push(s2.id);
    expect(slideIdsForRange(doc, { kind: 'all' }).length).toBe(1);
    expect(slideIdsForRange(doc, { kind: 'all' }, { includeHidden: true }).length).toBe(2);
    expect(slideIdsForRange(doc, { kind: 'current' }, { currentId: s2.id })).toEqual([s2.id]);
  });

  it('finds links to slides outside the export and hidden link targets', () => {
    const doc = newPresentation({ title: 'L' });
    const s2 = createSlideFromLayout(doc, 'blank');
    s2.hidden = true;
    doc.slides[s2.id] = s2;
    doc.sections[0].slide_ids.push(s2.id);
    const first = slideOrder(doc)[0];
    const t = textElement({ text: 'go' });
    t.link = { kind: 'slide', slide_id: s2.id };
    doc.slides[first].elements.push(t);
    expect(danglingSlideLinks(doc, [first])).toEqual([{ slideId: first, elementId: t.id }]);
    expect(linkTargets(doc, [first])).toEqual([s2.id]);
  });
});
