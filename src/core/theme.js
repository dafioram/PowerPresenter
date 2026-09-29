// Themes, tokens, role styles and style resolution (spec §6).
import { resolveColor } from './color.js';
import { roundLen } from './units.js';

export const COLOR_TOKENS = [
  'color.text.primary',
  'color.text.secondary',
  'color.background',
  'color.surface',
  'color.border',
  'color.accent.1',
  'color.accent.2',
  'color.accent.3',
  'color.accent.4',
  'color.accent.5',
  'color.accent.6',
  'color.link',
  'color.highlight',
];

export const COLOR_TOKEN_LABELS = {
  'color.text.primary': 'Text',
  'color.text.secondary': 'Secondary text',
  'color.background': 'Background',
  'color.surface': 'Surface',
  'color.border': 'Border',
  'color.accent.1': 'Accent 1',
  'color.accent.2': 'Accent 2',
  'color.accent.3': 'Accent 3',
  'color.accent.4': 'Accent 4',
  'color.accent.5': 'Accent 5',
  'color.accent.6': 'Accent 6',
  'color.link': 'Link',
  'color.highlight': 'Highlight',
};

export const FONT_TOKENS = ['font.heading', 'font.body', 'font.accent'];

export const TEXT_ROLES = [
  'title',
  'subtitle',
  'heading',
  'body',
  'caption',
  'quote',
  'attribution',
  'big_number',
  'footer',
];

export const ROLE_LABELS = {
  title: 'Title',
  subtitle: 'Subtitle',
  heading: 'Heading',
  body: 'Body',
  caption: 'Caption',
  quote: 'Quote',
  attribution: 'Attribution',
  big_number: 'Large number',
  footer: 'Footer',
  image: 'Image',
};

const pt = (p) => roundLen((p * 4) / 3);

const DEFAULT_BULLETS = ['•', '–', '◦', '▪', '•', '–', '◦', '▪', '•'];

function roleSet(o = {}) {
  const heading = { token: 'font.heading' };
  const body = { token: 'font.body' };
  const accent = { token: 'font.accent' };
  const primary = { token: 'color.text.primary' };
  const secondary = { token: 'color.text.secondary' };
  const base = (extra) => ({
    font: body,
    size: pt(20),
    weight: 400,
    italic: false,
    color: primary,
    align: 'start',
    letter_spacing: 0,
    line: 1.2,
    before: 0,
    after: pt(6),
    ...extra,
  });
  return {
    title: base({ font: heading, size: pt(40), weight: o.titleWeight || 700, line: 1.1, after: 0, letter_spacing: o.titleTracking || 0 }),
    subtitle: base({ size: pt(24), color: secondary, line: 1.2, after: 0 }),
    heading: base({ font: heading, size: pt(28), weight: o.headingWeight || 600, line: 1.15 }),
    body: base({}),
    caption: base({ size: pt(14), color: secondary, after: 0 }),
    quote: base({ font: accent, size: pt(32), italic: o.quoteItalic !== false, line: 1.25, after: 0 }),
    attribution: base({ size: pt(18), color: secondary, align: 'end', after: 0 }),
    big_number: base({ font: heading, size: pt(96), weight: 800, color: { token: 'color.accent.1' }, line: 1, after: 0 }),
    footer: base({ size: pt(12), color: secondary, after: 0, line: 1 }),
  };
}

function makeTheme({ id, name, colors, fonts, roles = {}, shapeText = 'color.background', dark = false }) {
  return {
    id,
    name,
    colors,
    fonts,
    roles: roleSet(roles),
    lists: { indent: 28, bullets: DEFAULT_BULLETS },
    background: { type: 'solid', color: { token: 'color.background' } },
    defaults: {
      shape: {
        fill: { type: 'solid', color: { token: 'color.accent.1' } },
        stroke: 'none',
        text: { color: { token: shapeText }, align: 'center', vertical_align: 'middle' },
      },
      line: {
        stroke: { color: { token: 'color.text.secondary' }, width: pt(2), dash: 'solid', cap: 'round', join: 'round' },
        arrowheads: { start: { kind: 'none', size: 'medium' }, end: { kind: 'none', size: 'medium' } },
      },
      image: { stroke: 'none', shadow: 'none' },
      text_box: { insets: { left: 9.6, right: 9.6, top: 4.8, bottom: 4.8 } },
      link: { color: { token: 'color.link' }, underline: true },
      table: {
        header_fill: { token: 'color.accent.1' },
        header_color: { token: shapeText },
        band_fill: { token: 'color.surface' },
        first_column_bold: true,
        border: { color: { token: 'color.border' }, width: pt(1), dash: 'solid', cap: 'flat', join: 'miter' },
        text_size: pt(16),
        padding: 8,
      },
      chart: {
        gridline: { token: 'color.border' },
        label_color: { token: 'color.text.secondary' },
        label_size: pt(12),
        title_size: pt(18),
        font: { token: 'font.body' },
      },
    },
    dark,
  };
}

export const BUILTIN_THEMES = [
  makeTheme({
    id: 'harbor',
    name: 'Harbor',
    colors: {
      'color.text.primary': '#0f172a',
      'color.text.secondary': '#475569',
      'color.background': '#ffffff',
      'color.surface': '#f1f5f9',
      'color.border': '#cbd5e1',
      'color.accent.1': '#4f46e5',
      'color.accent.2': '#0284c7',
      'color.accent.3': '#059669',
      'color.accent.4': '#d97706',
      'color.accent.5': '#dc2626',
      'color.accent.6': '#7c3aed',
      'color.link': '#4338ca',
      'color.highlight': '#fde68a',
    },
    fonts: { 'font.heading': 'builtin.inter', 'font.body': 'builtin.inter', 'font.accent': 'builtin.source-serif-4' },
  }),
  makeTheme({
    id: 'paper',
    name: 'Paper',
    colors: {
      'color.text.primary': '#292524',
      'color.text.secondary': '#57534e',
      'color.background': '#fbf8f1',
      'color.surface': '#f3eee3',
      'color.border': '#d6cfc2',
      'color.accent.1': '#9a3412',
      'color.accent.2': '#0f766e',
      'color.accent.3': '#1e3a8a',
      'color.accent.4': '#4d7c0f',
      'color.accent.5': '#9f1239',
      'color.accent.6': '#6b21a8',
      'color.link': '#1e40af',
      'color.highlight': '#fef08a',
    },
    fonts: { 'font.heading': 'builtin.playfair-display', 'font.body': 'builtin.source-serif-4', 'font.accent': 'builtin.playfair-display' },
    roles: { titleWeight: 700, headingWeight: 600 },
  }),
  makeTheme({
    id: 'midnight',
    name: 'Midnight',
    dark: true,
    colors: {
      'color.text.primary': '#f1f5f9',
      'color.text.secondary': '#cbd5e1',
      'color.background': '#0b1120',
      'color.surface': '#1e293b',
      'color.border': '#334155',
      'color.accent.1': '#818cf8',
      'color.accent.2': '#38bdf8',
      'color.accent.3': '#34d399',
      'color.accent.4': '#fbbf24',
      'color.accent.5': '#f87171',
      'color.accent.6': '#c084fc',
      'color.link': '#93c5fd',
      'color.highlight': '#854d0e',
    },
    fonts: { 'font.heading': 'builtin.montserrat', 'font.body': 'builtin.inter', 'font.accent': 'builtin.source-serif-4' },
  }),
  makeTheme({
    id: 'studio',
    name: 'Studio',
    colors: {
      'color.text.primary': '#111827',
      'color.text.secondary': '#4b5563',
      'color.background': '#ffffff',
      'color.surface': '#f3f4f6',
      'color.border': '#d1d5db',
      'color.accent.1': '#e11d48',
      'color.accent.2': '#2563eb',
      'color.accent.3': '#16a34a',
      'color.accent.4': '#ea580c',
      'color.accent.5': '#9333ea',
      'color.accent.6': '#0891b2',
      'color.link': '#1d4ed8',
      'color.highlight': '#fef9c3',
    },
    fonts: { 'font.heading': 'builtin.montserrat', 'font.body': 'builtin.inter', 'font.accent': 'builtin.montserrat' },
    roles: { titleWeight: 800, headingWeight: 700, titleTracking: -0.5, quoteItalic: false },
  }),
  makeTheme({
    id: 'mono',
    name: 'Mono',
    colors: {
      'color.text.primary': '#18181b',
      'color.text.secondary': '#52525b',
      'color.background': '#fafafa',
      'color.surface': '#f4f4f5',
      'color.border': '#d4d4d8',
      'color.accent.1': '#18181b',
      'color.accent.2': '#2563eb',
      'color.accent.3': '#52525b',
      'color.accent.4': '#a1a1aa',
      'color.accent.5': '#dc2626',
      'color.accent.6': '#0d9488',
      'color.link': '#2563eb',
      'color.highlight': '#e4e4e7',
    },
    fonts: { 'font.heading': 'builtin.jetbrains-mono', 'font.body': 'builtin.inter', 'font.accent': 'builtin.jetbrains-mono' },
    roles: { titleWeight: 700, headingWeight: 600, quoteItalic: false },
  }),
];

export function builtinTheme(id = 'harbor') {
  const t = BUILTIN_THEMES.find((x) => x.id === id) || BUILTIN_THEMES[0];
  return structuredClone(t);
}

// ---------- style resolution (spec §6.2) ----------

export const APP_TEXT_DEFAULT = {
  font: { token: 'font.body' },
  size: pt(18),
  weight: 400,
  italic: false,
  underline: false,
  strike: false,
  script: 'normal',
  color: { token: 'color.text.primary' },
  highlight: null,
  letter_spacing: 0,
  lang: null,
  link: null,
};

export const APP_PARAGRAPH_DEFAULT = { align: 'start', line: 1.2, before: 0, after: 0 };

const MARK_KEYS = ['font', 'size', 'weight', 'italic', 'underline', 'strike', 'script', 'color', 'highlight', 'letter_spacing', 'lang', 'link'];

function pickMarks(src) {
  const out = {};
  if (!src) return out;
  for (const k of MARK_KEYS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

function pickPara(src) {
  const out = {};
  if (!src) return out;
  for (const k of ['align', 'line', 'before', 'after']) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

// Returns the base run style and paragraph style for a text container, before
// paragraph properties and run marks are applied.
// kind: 'text' | 'shape' | 'cell' | 'notes' | 'chart'
export function containerBaseStyle(theme, { kind = 'text', role = null, defaults = null, header = false, bodyFallback = true } = {}) {
  let run = { ...APP_TEXT_DEFAULT };
  let para = { ...APP_PARAGRAPH_DEFAULT };
  let vertical = 'top';
  if (kind === 'notes') {
    return {
      run: { ...run, font: 'builtin.inter', size: pt(14), color: '#1f2937' },
      para: { ...para, after: pt(6) },
      vertical,
    };
  }
  const bodyRole = theme.roles?.body;
  if ((kind === 'text' || kind === 'shape' || kind === 'cell') && bodyFallback && bodyRole) {
    run = { ...run, ...pickMarks(bodyRole) };
    para = { ...para, ...pickPara(bodyRole) };
  }
  if (kind === 'shape') {
    const st = theme.defaults?.shape?.text || {};
    if (st.color) run.color = st.color;
    if (st.align) para.align = st.align;
    if (st.vertical_align) vertical = st.vertical_align;
    para.after = 0;
  }
  if (kind === 'cell') {
    const tb = theme.defaults?.table || {};
    if (tb.text_size) run.size = tb.text_size;
    para.after = 0;
    if (header) {
      run.weight = 700;
      if (tb.header_color) run.color = tb.header_color;
    }
  }
  if (role && theme.roles?.[role]) {
    const rs = theme.roles[role];
    run = { ...run, ...pickMarks(rs) };
    para = { ...para, ...pickPara(rs) };
  }
  if (defaults) run = { ...run, ...pickMarks(defaults) };
  return { run, para, vertical };
}

export function resolveRun(base, marks) {
  return marks ? { ...base, ...pickMarks(marks) } : base;
}

export function resolveParagraph(base, paragraph) {
  const out = { ...base };
  if (paragraph?.align) out.align = paragraph.align;
  if (paragraph?.spacing) {
    for (const k of ['line', 'before', 'after']) if (paragraph.spacing[k] !== undefined) out[k] = paragraph.spacing[k];
  }
  return out;
}

export function themeColor(theme, color, fallback) {
  return resolveColor(color, theme, fallback);
}

// Resolves a font value (token or font id or device font) to a concrete font value.
export function resolveFontValue(theme, font) {
  if (font && typeof font === 'object' && font.token) return theme.fonts?.[font.token] || 'builtin.inter';
  return font || 'builtin.inter';
}

// Multiplies every length in a theme (used by "Fit content" size changes, §4.4,
// and when applying a library theme saved at a different slide height, §6.4).
export function scaleThemeLengths(theme, s) {
  const t = structuredClone(theme);
  for (const r of Object.values(t.roles || {})) {
    for (const k of ['size', 'letter_spacing', 'before', 'after']) if (typeof r[k] === 'number') r[k] = roundLen(r[k] * s);
  }
  if (t.lists) t.lists.indent = roundLen(t.lists.indent * s);
  const d = t.defaults || {};
  if (d.line?.stroke?.width) d.line.stroke.width = roundLen(d.line.stroke.width * s);
  if (d.text_box?.insets) for (const k of Object.keys(d.text_box.insets)) d.text_box.insets[k] = roundLen(d.text_box.insets[k] * s);
  if (d.table) {
    if (d.table.border?.width) d.table.border.width = roundLen(d.table.border.width * s);
    if (d.table.text_size) d.table.text_size = roundLen(d.table.text_size * s);
    if (d.table.padding) d.table.padding = roundLen(d.table.padding * s);
  }
  if (d.chart) {
    if (d.chart.label_size) d.chart.label_size = roundLen(d.chart.label_size * s);
    if (d.chart.title_size) d.chart.title_size = roundLen(d.chart.title_size * s);
  }
  if (d.shape?.stroke && typeof d.shape.stroke === 'object') d.shape.stroke.width = roundLen(d.shape.stroke.width * s);
  return t;
}
