// Built-in templates, including the "Getting started" deck (spec §6.4, §11).
import { newPresentation, fillRole } from '../core/factory.js';
import { createSlideFromLayout } from '../core/layouts.js';
import { textElement, shapeElement, connectorElement, tableElement, chartElement, imageElement, slideOrder } from '../core/model.js';
import { bodyFromText } from '../core/text.js';
import { newId } from '../core/ids.js';
import { builtinTheme } from '../core/theme.js';
import { sha256 } from '../io/hash.js';

function addSlide(doc, layoutId, fill = {}) {
  const s = createSlideFromLayout(doc, layoutId);
  for (const [role, text] of Object.entries(fill)) fillRole(s, role, text);
  doc.slides[s.id] = s;
  doc.sections[doc.sections.length - 1].slide_ids.push(s.id);
  return s;
}

function bullets(lines) {
  // lines: string or [level, text]
  return {
    paragraphs: lines.map((l) => {
      const [level, text] = Array.isArray(l) ? l : [0, l];
      return { inlines: [{ text }], list: { kind: 'bullet', level } };
    }),
  };
}

function setBody(slide, body, index = 0) {
  const el = slide.elements.filter((e) => e.role === 'body')[index];
  if (el) el.text.body = body;
  return el;
}

const ILLUSTRATION = `<svg xmlns="http://www.w3.org/2000/svg" height="600" viewBox="0 0 800 600" width="800"><rect fill="#eef2ff" height="600" width="800"/><circle cx="620" cy="140" fill="#fde68a" r="70"/><path d="M0 460L180 300L330 420L470 260L800 520V600H0Z" fill="#818cf8"/><path d="M0 520L220 400L400 500L560 380L800 560V600H0Z" fill="#4f46e5"/><rect fill="#ffffff" height="120" opacity="0.85" rx="16" width="220" x="80" y="80"/><rect fill="#6366f1" height="18" rx="9" width="150" x="110" y="110"/><rect fill="#c7d2fe" height="12" rx="6" width="170" x="110" y="146"/><rect fill="#c7d2fe" height="12" rx="6" width="120" x="110" y="170"/></svg>`;

async function svgAsset(svg) {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const id = newId();
  return {
    record: { id, kind: 'svg', media_type: 'image/svg+xml', byte_size: blob.size, sha256: await sha256(blob), width: 800, height: 600, original_filename: 'illustration.svg', path: `assets/${id}.svg` },
    blob,
  };
}

// Returns { doc, assets: Map<id, Blob> }.
export async function gettingStarted() {
  const doc = newPresentation({ title: 'Getting started', withTitleSlide: true });
  const assets = new Map();
  const first = doc.slides[slideOrder(doc)[0]];
  fillRole(first, 'title', 'Welcome to Presentation Editor');
  fillRole(first, 'subtitle', 'Everything you make stays in this browser. Press Present to see this deck, or start editing.');
  first.notes = bodyFromText('Speaker notes live here. Open presenter view with S while presenting to see them.');

  const s2 = addSlide(doc, 'title_body', { title: 'What you can do' });
  setBody(s2, {
    paragraphs: [
      { inlines: [{ text: 'Write with ' }, { text: 'rich text', marks: { weight: 700 } }, { text: ', lists and ' }, { text: 'links', marks: { link: { kind: 'url', href: 'https://example.com/' } } }], list: { kind: 'bullet', level: 0 } },
      { inlines: [{ text: 'Add shapes, connectors, tables, charts, images and video' }], list: { kind: 'bullet', level: 0 } },
      { inlines: [{ text: 'Group, align, distribute and snap to guides' }], list: { kind: 'bullet', level: 1 } },
      { inlines: [{ text: 'Present with builds, transitions and presenter view' }], list: { kind: 'bullet', level: 0 } },
      { inlines: [{ text: 'Export to .pres, PDF, images, HTML or PowerPoint' }], list: { kind: 'bullet', level: 0 } },
    ],
  });
  s2.builds = [{ id: newId(), element_id: s2.elements.find((e) => e.role === 'body').id, effect: 'fade_in', trigger: 'on_click', by: 'paragraph', duration_ms: 400 }];
  s2.transition = { kind: 'fade', duration_ms: 400 };
  s2.notes = bodyFromText('This slide builds one bullet at a time. Press → or Space to reveal each point.');

  const s3 = addSlide(doc, 'title_only', { title: 'Shapes and connectors' });
  const W = doc.size.width;
  const a = shapeElement({ preset: 'round_rect', x: 110, y: 290, width: 260, height: 140 });
  a.shape.text = { body: bodyFromText('Idea') };
  const b = shapeElement({ preset: 'ellipse', x: 510, y: 290, width: 260, height: 140 });
  b.shape.text = { body: bodyFromText('Draft') };
  b.style = { fill: { type: 'solid', color: { token: 'color.accent.2' } } };
  const c = shapeElement({ preset: 'diamond', x: 910, y: 270, width: 260, height: 180 });
  c.shape.text = { body: bodyFromText('Present') };
  c.style = { fill: { type: 'solid', color: { token: 'color.accent.3' } } };
  const c1 = connectorElement({ start: { element_id: a.id, site: 'right' }, end: { element_id: b.id, site: 'left' } });
  const c2 = connectorElement({ start: { element_id: b.id, site: 'right' }, end: { element_id: c.id, site: 'left' } });
  const note = textElement({ x: 110, y: 520, width: W - 220, height: 60, text: 'Connectors stay attached when you move the shapes. Drag a shape to try it.', role: 'caption' });
  s3.elements.push(a, b, c, c1, c2, note);

  const s4 = addSlide(doc, 'title_only', { title: 'Tables and charts' });
  const t = tableElement({ x: 80, y: 190, rows: 4, cols: 3, width: 520, rowHeight: 44 });
  const data = [['Quarter', 'Revenue', 'Growth'], ['Q1', '$1.2M', '8%'], ['Q2', '$1.5M', '12%'], ['Q3', '$1.9M', '18%']];
  t.table.rows.forEach((r, ri) => t.table.columns.forEach((col, ci) => {
    t.table.cells[`${r.id}:${col.id}`] = { body: bodyFromText(data[ri][ci]) };
  }));
  const ch = chartElement({ kind: 'bar', x: 660, y: 170, width: 540, height: 400 });
  ch.chart.title = 'Revenue by quarter';
  ch.chart.labels = 'value';
  ch.accessibility = { alt: 'Bar chart of revenue by quarter for 2025 and 2026. Revenue grows every quarter, from 12 to 22 in 2025 and from 16 to 27 in 2026.' };
  s4.elements.push(t, ch);

  const s5 = addSlide(doc, 'image_text', { title: 'Images and SVG', body: 'Drop images onto a slide, crop them, mask them to shapes and add alt text. SVG stays sharp at any size.' });
  const ill = await svgAsset(ILLUSTRATION);
  doc.assets.push(ill.record);
  assets.set(ill.record.id, ill.blob);
  const slot = s5.elements.find((e) => e.type === 'image');
  slot.image.asset_id = ill.record.id;
  slot.accessibility = { alt: 'Illustration of mountains under a sun with a floating card' };
  const r = ill.record;
  const g = slot.geometry;
  const frameRatio = g.width / g.height;
  const imgRatio = r.width / r.height;
  if (imgRatio > frameRatio) {
    const keep = frameRatio / imgRatio;
    slot.image.crop = { left: Math.round(((1 - keep) / 2) * 1000) / 1000, top: 0, right: Math.round(((1 - keep) / 2) * 1000) / 1000, bottom: 0 };
  } else {
    const keep = imgRatio / frameRatio;
    slot.image.crop = { left: 0, top: Math.round(((1 - keep) / 2) * 1000) / 1000, right: 0, bottom: Math.round(((1 - keep) / 2) * 1000) / 1000 };
  }

  addSlide(doc, 'large_number', { big_number: '100%', title: 'Local and private', caption: 'No accounts, no uploads, works offline once loaded.' });

  const s7 = addSlide(doc, 'quote', { quote: '“The best way to predict the future is to invent it.”', attribution: '— Alan Kay' });
  s7.transition = { kind: 'push', direction: 'left', duration_ms: 500 };
  s7.title = 'A quote from Alan Kay';

  doc.sections.push({ id: newId(), name: 'Keep your work safe', slide_ids: [] });
  addSlide(doc, 'section', { title: 'Keep your work safe', subtitle: 'Your presentations live only in this browser.' });
  const s9 = addSlide(doc, 'title_body', { title: 'Backups and versions' });
  setBody(s9, bullets([
    'Export a .pres file to back up or move a presentation',
    'Use Back up everything in the workspace regularly',
    'Version history keeps automatic snapshots',
    'Deleted presentations stay in Trash for 30 days',
  ]));
  doc.sections[0].name = 'Tour';

  // master footer with slide numbers
  const footer = textElement({ x: W - 180, y: doc.size.height - 44, width: 140, height: 28, role: 'footer', autofit: 'none' });
  footer.text.body = { paragraphs: [{ align: 'end', inlines: [{ field: 'slide_number' }] }] };
  doc.master.elements.push(footer);
  first.show_master = false;
  return { doc, assets };
}

function simpleDeck({ title, themeId, slides }) {
  const doc = newPresentation({ title, themeId, withTitleSlide: true });
  const first = doc.slides[slideOrder(doc)[0]];
  fillRole(first, 'title', slides[0].title);
  fillRole(first, 'subtitle', slides[0].subtitle);
  for (const s of slides.slice(1)) {
    const sl = addSlide(doc, s.layout, { title: s.title, ...(s.fill || {}) });
    if (s.bullets) setBody(sl, bullets(s.bullets));
  }
  return { doc, assets: new Map() };
}

export const BUILTIN_TEMPLATES = [
  { id: 'getting-started', name: 'Getting started', description: 'A short tour of what the app can do', themeId: 'harbor', make: gettingStarted },
  {
    id: 'pitch',
    name: 'Pitch deck',
    description: 'Problem, solution, traction and ask',
    themeId: 'studio',
    make: async () => simpleDeck({
      title: 'Pitch deck',
      themeId: 'studio',
      slides: [
        { title: 'Company name', subtitle: 'One line that explains what you do' },
        { layout: 'title_body', title: 'The problem', bullets: ['Who has it', 'How they solve it today', 'Why that falls short'] },
        { layout: 'title_body', title: 'Our solution', bullets: ['What it is', 'Why it works', 'Why now'] },
        { layout: 'large_number', title: 'Traction', fill: { big_number: '3×', caption: 'Growth over the last year' } },
        { layout: 'two_column', title: 'Business model' },
        { layout: 'title_body', title: 'The ask', bullets: ['Amount', 'Use of funds', 'Milestones'] },
      ],
    }),
  },
  {
    id: 'lecture',
    name: 'Lecture',
    description: 'Readable serif theme for teaching',
    themeId: 'paper',
    make: async () => simpleDeck({
      title: 'Lecture',
      themeId: 'paper',
      slides: [
        { title: 'Lecture title', subtitle: 'Course · Week 1' },
        { layout: 'title_body', title: 'Learning goals', bullets: ['Goal one', 'Goal two', 'Goal three'] },
        { layout: 'section', title: 'Part 1', fill: { subtitle: 'Background' } },
        { layout: 'title_body', title: 'Key ideas', bullets: ['Idea', ['1', 'Detail'].length ? [1, 'Detail'] : 'Detail', 'Another idea'] },
        { layout: 'quote', title: '', fill: { quote: '“A memorable quotation.”', attribution: '— Author' } },
        { layout: 'title_body', title: 'Summary', bullets: ['Takeaway one', 'Takeaway two'] },
      ],
    }),
  },
  {
    id: 'keynote',
    name: 'Dark keynote',
    description: 'High-contrast dark theme for big rooms',
    themeId: 'midnight',
    make: async () => simpleDeck({
      title: 'Keynote',
      themeId: 'midnight',
      slides: [
        { title: 'Big idea', subtitle: 'Event name · Date' },
        { layout: 'large_number', title: 'One number that matters', fill: { big_number: '42', caption: 'What it means' } },
        { layout: 'title_body', title: 'Three points', bullets: ['First', 'Second', 'Third'] },
        { layout: 'section', title: 'Thank you', fill: { subtitle: 'name@example.com' } },
      ],
    }),
  },
];

export function builtinThemeFor(id) {
  return builtinTheme(id);
}
