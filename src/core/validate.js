// Document validation (spec §5.18): structural checks (strict — unknown fields
// are errors) followed by semantic rules. The machine-readable JSON Schema for
// format version 1 lives in schema/pres-format-v1.schema.json; tests check that
// both agree on the fixtures.
import { ID_RE } from './ids.js';
import { HEX_RE } from './color.js';
import { COLOR_TOKENS, FONT_TOKENS, TEXT_ROLES } from './theme.js';
import { SHAPE_MAP, ADJUST_KEYS } from './shapes.js';
import { LIMITS } from './limits.js';
import { FIELD_KINDS, DATE_FORMATS } from './fields.js';
import { BUILD_EFFECTS, ENTRANCE, EXIT, TRANSITIONS } from './builds.js';
import { isEligible } from './reading-order.js';
import { geometryKind, canAttach } from './geometry.js';

export const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,4}$/;
export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DEVICE_FONT_RE = /^[\p{L}\p{N} ._-]{1,64}$/u;
export const BUILTIN_FONT_RE = /^builtin\.[a-z0-9-]{1,48}$/;
export const URL_SCHEMES = ['https:', 'http:', 'mailto:', 'tel:'];
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000A-\u001F\u007F]/;

export function isAllowedUrl(href) {
  if (typeof href !== 'string' || href.length === 0 || href.length > 2048) return false;
  try {
    const u = new URL(href);
    return URL_SCHEMES.includes(u.protocol);
  } catch {
    return false;
  }
}

// ---------- tiny validation DSL ----------

class Ctx {
  constructor() {
    this.errors = [];
    this.path = [];
    this.slideId = null;
    this.elementId = null;
  }
  err(message) {
    this.errors.push({ path: this.path.join('') || '(root)', message, slideId: this.slideId, elementId: this.elementId });
    return false;
  }
  at(seg, fn) {
    this.path.push(typeof seg === 'number' ? `[${seg}]` : this.path.length ? `.${seg}` : seg);
    try {
      return fn();
    } finally {
      this.path.pop();
    }
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const OPT = Symbol('optional');
const opt = (v) => ({ [OPT]: true, v });

const T = {
  any: () => () => true,
  str: ({ min = 0, max = 10000, re, noControl = false } = {}) => (v, c) => {
    if (typeof v !== 'string') return c.err('must be a string');
    if (v.length < min) return c.err(`must be at least ${min} characters`);
    if (v.length > max) return c.err(`must be at most ${max} characters`);
    if (re && !re.test(v)) return c.err('has an invalid format');
    if (noControl && CONTROL_RE.test(v)) return c.err('must not contain control characters');
    return true;
  },
  num: ({ min = -Infinity, max = Infinity, int = false, exclusiveMax = false } = {}) => (v, c) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return c.err('must be a finite number');
    if (int && !Number.isInteger(v)) return c.err('must be an integer');
    if (v < min) return c.err(`must be ≥ ${min}`);
    if (exclusiveMax ? v >= max : v > max) return c.err(`must be ${exclusiveMax ? '<' : '≤'} ${max}`);
    return true;
  },
  bool: () => (v, c) => (typeof v === 'boolean' ? true : c.err('must be true or false')),
  lit: (x) => (v, c) => (v === x ? true : c.err(`must be ${JSON.stringify(x)}`)),
  enum: (vals) => (v, c) => (vals.includes(v) ? true : c.err(`must be one of ${vals.join(', ')}`)),
  id: () => (v, c) => (typeof v === 'string' && ID_RE.test(v) ? true : c.err('must be a valid ID')),
  arr: (item, { min = 0, max = Infinity } = {}) => (v, c) => {
    if (!Array.isArray(v)) return c.err('must be an array');
    if (v.length < min) return c.err(`must have at least ${min} items`);
    if (v.length > max) return c.err(`must have at most ${max} items`);
    let ok = true;
    v.forEach((x, i) => { if (!c.at(i, () => item(x, c))) ok = false; });
    return ok;
  },
  record: (keyRe, item, { max = Infinity } = {}) => (v, c) => {
    if (!isObj(v)) return c.err('must be an object');
    const keys = Object.keys(v);
    if (keys.length > max) return c.err(`must have at most ${max} entries`);
    let ok = true;
    for (const k of keys) {
      if (!keyRe.test(k)) { c.at(k, () => c.err('has an invalid key')); ok = false; continue; }
      if (!c.at(k, () => item(v[k], c, k))) ok = false;
    }
    return ok;
  },
  obj: (fields) => (v, c) => {
    if (!isObj(v)) return c.err('must be an object');
    let ok = true;
    for (const k of Object.keys(v)) {
      if (!(k in fields)) { c.at(k, () => c.err('is not a known field')); ok = false; }
    }
    for (const [k, def] of Object.entries(fields)) {
      const optional = def && def[OPT];
      const fn = optional ? def.v : def;
      if (!(k in v) || v[k] === undefined) {
        if (!optional) { c.at(k, () => c.err('is required')); ok = false; }
        continue;
      }
      if (!c.at(k, () => fn(v[k], c))) ok = false;
    }
    return ok;
  },
  union: (options, message) => (v, c) => {
    for (const fn of options) {
      const scratch = new Ctx();
      scratch.path = c.path.slice();
      if (fn(v, scratch)) return true;
    }
    // Report the errors of the best-matching branch (by discriminator if any).
    return c.err(message || 'has an invalid value');
  },
  nullable: (fn) => (v, c) => (v === null ? true : fn(v, c)),
  custom: (pred, message) => (v, c) => (pred(v) ? true : c.err(message)),
};

// ---------- schema pieces ----------

const coord = T.num({ min: -LIMITS.coord, max: LIMITS.coord });
const len = (min = 0, max = LIMITS.coord) => T.num({ min, max });

const colorV = T.union(
  [
    T.str({ re: HEX_RE }),
    T.obj({ token: T.enum(COLOR_TOKENS), tint: opt(T.num({ min: -1, max: 1 })) }),
  ],
  'must be a #RRGGBB/#RRGGBBAA color or a theme color token',
);

const fontValueV = T.union(
  [
    T.obj({ token: T.enum(FONT_TOKENS) }),
    T.str({ re: BUILTIN_FONT_RE }),
    T.id(),
    T.obj({ device: T.str({ re: DEVICE_FONT_RE }), fallback: T.str({ re: BUILTIN_FONT_RE }) }),
  ],
  'must be a font token, a font ID or a device font',
);

const fontRefV = T.union(
  [
    T.str({ re: BUILTIN_FONT_RE }),
    T.id(),
    T.obj({ device: T.str({ re: DEVICE_FONT_RE }), fallback: T.str({ re: BUILTIN_FONT_RE }) }),
  ],
  'must be a font ID or a device font',
);

const stopV = T.obj({ offset: T.num({ min: 0, max: 1 }), color: colorV });
const fillV = T.union(
  [
    T.lit('none'),
    T.obj({ type: T.lit('solid'), color: colorV }),
    T.obj({ type: T.lit('linear'), angle: T.num({ min: 0, max: 360 }), stops: T.arr(stopV, { min: 2, max: 8 }) }),
    T.obj({ type: T.lit('radial'), center_x: T.num({ min: 0, max: 1 }), center_y: T.num({ min: 0, max: 1 }), stops: T.arr(stopV, { min: 2, max: 8 }) }),
    T.obj({ type: T.lit('image'), asset_id: T.id(), mode: T.enum(['cover', 'contain', 'stretch', 'tile']), scale: opt(T.num({ min: 0.01, max: 100 })) }),
  ],
  'must be "none" or a valid solid, linear, radial or image fill',
);

const strokeObj = T.obj({
  color: colorV,
  width: T.num({ min: 0, max: 200 }),
  dash: opt(T.enum(['solid', 'dash', 'dot', 'dash_dot', 'long_dash'])),
  cap: opt(T.enum(['flat', 'round', 'square'])),
  join: opt(T.enum(['miter', 'round', 'bevel'])),
});
const strokeV = T.union([T.lit('none'), strokeObj], 'must be "none" or a valid stroke');
const shadowV = T.union(
  [T.lit('none'), T.obj({ color: colorV, offset_x: T.num({ min: -500, max: 500 }), offset_y: T.num({ min: -500, max: 500 }), blur: T.num({ min: 0, max: 500 }) })],
  'must be "none" or a valid shadow',
);
const arrowHeadV = T.obj({ kind: T.enum(['none', 'arrow', 'triangle', 'stealth', 'oval', 'diamond']), size: opt(T.enum(['small', 'medium', 'large'])) });
const arrowheadsV = T.obj({ start: opt(arrowHeadV), end: opt(arrowHeadV) });

const linkV = T.union(
  [
    T.obj({ kind: T.lit('url'), href: T.custom(isAllowedUrl, 'must be an http, https, mailto or tel URL of at most 2,048 characters') }),
    T.obj({ kind: T.lit('slide'), slide_id: T.id() }),
    T.obj({ kind: T.lit('nav'), target: T.enum(['next', 'previous', 'first', 'last']) }),
  ],
  'must be a valid URL, slide or navigation link',
);

const langV = T.str({ re: LANG_RE });

const marksV = T.obj({
  font: opt(fontValueV),
  size: opt(T.num({ min: 1, max: 1000 })),
  weight: opt(T.num({ min: 100, max: 900, int: true })),
  italic: opt(T.bool()),
  underline: opt(T.bool()),
  strike: opt(T.bool()),
  script: opt(T.enum(['normal', 'super', 'sub'])),
  color: opt(colorV),
  highlight: opt(colorV),
  letter_spacing: opt(T.num({ min: -100, max: 100 })),
  link: opt(linkV),
  lang: opt(langV),
});

const inlineV = (v, c) => {
  if (isObj(v) && 'text' in v) return T.obj({ text: T.str({ max: LIMITS.textChars, noControl: true }), marks: opt(marksV) })(v, c);
  if (isObj(v) && 'field' in v) {
    return T.obj({
      field: T.enum(FIELD_KINDS),
      format: opt(T.enum(DATE_FORMATS)),
      value: opt(T.union([T.lit('auto'), T.str({ re: DATE_RE })], 'must be "auto" or an ISO date')),
      marks: opt(marksV),
    })(v, c);
  }
  if (isObj(v) && 'break' in v) return T.obj({ break: T.lit(true) })(v, c);
  return c.err('must be a text run, a field or a line break');
};

const paragraphV = T.obj({
  inlines: T.arr(inlineV),
  align: opt(T.enum(['start', 'center', 'end', 'justify'])),
  dir: opt(T.enum(['auto', 'ltr', 'rtl'])),
  list: opt(T.obj({
    kind: T.enum(['bullet', 'number']),
    level: T.num({ min: 0, max: 8, int: true }),
    number_style: opt(T.enum(['decimal', 'lower_alpha', 'upper_alpha', 'lower_roman', 'upper_roman'])),
    start_at: opt(T.num({ min: 1, max: 9999, int: true })),
  })),
  spacing: opt(T.obj({ before: opt(len(0, 1000)), after: opt(len(0, 1000)), line: opt(T.num({ min: 0.8, max: 3 })) })),
});

const bodyV = T.obj({ paragraphs: T.arr(paragraphV, { min: 1, max: 10000 }) });
const insetsV = T.obj({ left: len(0, 1000), right: len(0, 1000), top: len(0, 1000), bottom: len(0, 1000) });
const vAlignV = T.enum(['top', 'middle', 'bottom']);

const textContainerV = T.obj({
  body: bodyV,
  box: opt(T.obj({ insets: opt(insetsV), vertical_align: opt(vAlignV), autofit: opt(T.enum(['none', 'grow', 'shrink'])) })),
  defaults: opt(marksV),
  prompt: opt(T.str({ max: 200, noControl: true })),
});

const cellV = T.obj({
  body: bodyV,
  defaults: opt(marksV),
  fill: opt(fillV),
  borders: opt(T.obj({ top: opt(strokeV), right: opt(strokeV), bottom: opt(strokeV), left: opt(strokeV) })),
  padding: opt(len(0, 200)),
  vertical_align: opt(vAlignV),
  row_span: opt(T.num({ min: 1, max: LIMITS.tableRows, int: true })),
  col_span: opt(T.num({ min: 1, max: LIMITS.tableColumns, int: true })),
});

const pointV = T.obj({ x: coord, y: coord });
const endV = T.union([pointV, T.obj({ element_id: T.id(), site: T.enum(['top', 'right', 'bottom', 'left']) })], 'must be a point or an attachment');

const boxGeomV = (rotatable) =>
  T.obj({
    x: coord,
    y: coord,
    width: len(1),
    height: len(1),
    rotation: opt(rotatable ? T.num({ min: 0, max: 360, exclusiveMax: true }) : T.lit(0)),
    flip_x: opt(rotatable ? T.bool() : T.lit(false)),
    flip_y: opt(rotatable ? T.bool() : T.lit(false)),
  });

const STYLE_BY_TYPE = {
  text: ['fill', 'stroke', 'shadow'],
  shape: ['fill', 'stroke', 'shadow'],
  image: ['stroke', 'shadow'],
  line: ['stroke', 'shadow', 'arrowheads'],
  connector: ['stroke', 'shadow', 'arrowheads'],
  group: [],
  table: [],
  chart: ['fill', 'stroke', 'shadow'],
  video: ['stroke', 'shadow'],
};
const STYLE_V = { fill: fillV, stroke: strokeV, shadow: shadowV, arrowheads: arrowheadsV };
function styleFor(type) {
  const fields = {};
  for (const k of STYLE_BY_TYPE[type] || []) fields[k] = opt(STYLE_V[k]);
  return T.obj(fields);
}

const cropV = T.obj({ left: T.num({ min: 0, max: 1 }), top: T.num({ min: 0, max: 1 }), right: T.num({ min: 0, max: 1 }), bottom: T.num({ min: 0, max: 1 }) });

function adjustV(presetGetter) {
  return (v, c) => {
    if (!isObj(v)) return c.err('must be an object');
    const keys = ADJUST_KEYS.get(presetGetter()) || [];
    let ok = true;
    for (const [k, x] of Object.entries(v)) {
      if (!keys.includes(k)) { c.at(k, () => c.err('is not an adjustment of this shape')); ok = false; }
      else if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > LIMITS.coord) { c.at(k, () => c.err('must be a finite number')); ok = false; }
    }
    return ok;
  };
}

const chartNumberFormatV = T.obj({
  decimals: opt(T.num({ min: 0, max: 6, int: true })),
  style: opt(T.enum(['number', 'percent'])),
  prefix: opt(T.str({ max: 8, noControl: true })),
  suffix: opt(T.str({ max: 8, noControl: true })),
  thousands: opt(T.bool()),
});

const seriesV = T.obj({
  id: T.id(),
  name: T.str({ max: 100, noControl: true }),
  values: opt(T.arr(T.nullable(T.num({ min: -1e15, max: 1e15 })), { max: LIMITS.chartPoints })),
  points: opt(T.arr(T.obj({ x: T.num({ min: -1e15, max: 1e15 }), y: T.num({ min: -1e15, max: 1e15 }) }), { max: LIMITS.chartPoints })),
  color: opt(colorV),
});

const chartV = T.obj({
  kind: T.enum(['bar', 'line', 'pie', 'donut', 'scatter']),
  orientation: opt(T.enum(['vertical', 'horizontal'])),
  grouping: opt(T.enum(['clustered', 'stacked', 'percent'])),
  markers: opt(T.bool()),
  categories: opt(T.arr(T.str({ max: 100, noControl: true }), { max: LIMITS.chartPoints })),
  series: T.arr(seriesV, { min: 1, max: LIMITS.chartSeries }),
  title: opt(T.str({ max: 200, noControl: true })),
  x_title: opt(T.str({ max: 100, noControl: true })),
  y_title: opt(T.str({ max: 100, noControl: true })),
  legend: opt(T.enum(['none', 'top', 'bottom', 'left', 'right'])),
  gridlines: opt(T.obj({ x: opt(T.bool()), y: opt(T.bool()) })),
  labels: opt(T.enum(['none', 'value', 'percent'])),
  axis: opt(T.obj({ min: opt(T.nullable(T.num())), max: opt(T.nullable(T.num())) })),
  number_format: opt(chartNumberFormatV),
});

const videoV = T.obj({
  asset_id: T.id(),
  poster_asset_id: opt(T.id()),
  trim_start_ms: opt(T.num({ min: 0, max: 1e9, int: true })),
  trim_end_ms: opt(T.num({ min: 0, max: 1e9, int: true })),
  start: opt(T.enum(['auto', 'manual'])),
  loop: opt(T.bool()),
  muted: opt(T.bool()),
  controls: opt(T.enum(['auto', 'show', 'hide'])),
  captions_asset_id: opt(T.id()),
  fit: opt(T.enum(['cover', 'contain'])),
});

const ROLE_VALUES = [...TEXT_ROLES, 'image'];

function elementV(depth = 0) {
  return (v, c) => {
    if (!isObj(v)) return c.err('must be an object');
    const prevEl = c.elementId;
    if (typeof v.id === 'string') c.elementId = v.id;
    try {
      const type = v.type;
      if (!['text', 'shape', 'image', 'line', 'connector', 'group', 'table', 'chart', 'video'].includes(type)) {
        return c.at('type', () => c.err('is not a supported element type'));
      }
      const fields = {
        id: T.id(),
        type: T.lit(type),
        name: opt(T.str({ max: 100, noControl: true })),
        role: opt(T.enum(ROLE_VALUES)),
        opacity: opt(T.num({ min: 0, max: 1 })),
        hidden: opt(T.bool()),
        locked: opt(T.bool()),
        link: opt(linkV),
        accessibility: opt(T.obj({ alt: opt(T.str({ max: 1000 })), decorative: opt(T.bool()) })),
        style: opt(styleFor(type)),
      };
      switch (type) {
        case 'text':
          fields.geometry = boxGeomV(true);
          fields.text = textContainerV;
          break;
        case 'shape':
          fields.geometry = boxGeomV(true);
          fields.shape = T.obj({ preset: T.custom((p) => SHAPE_MAP.has(p), 'must be a catalog shape'), adjust: opt(adjustV(() => v.shape?.preset)), text: opt(textContainerV) });
          break;
        case 'image':
          fields.geometry = boxGeomV(true);
          fields.image = T.obj({
            asset_id: T.nullable(T.id()),
            crop: opt(cropV),
            mask: opt(T.obj({ preset: T.custom((p) => SHAPE_MAP.has(p), 'must be a catalog shape'), adjust: opt(adjustV(() => v.image?.mask?.preset)) })),
          });
          break;
        case 'line':
          fields.geometry = T.obj({ start: pointV, end: pointV });
          break;
        case 'connector':
          fields.geometry = T.obj({ start: endV, end: endV });
          fields.connector = T.obj({ routing: T.enum(['straight', 'elbow']) });
          break;
        case 'group':
          fields.geometry = boxGeomV(true);
          if (depth >= LIMITS.groupDepth) return c.err(`groups nest at most ${LIMITS.groupDepth} deep`);
          fields.group = T.obj({ children: T.arr(elementV(depth + 1), { min: 1, max: LIMITS.elementsPerSlide }) });
          break;
        case 'table':
          fields.geometry = T.obj({ x: coord, y: coord });
          fields.table = T.obj({
            columns: T.arr(T.obj({ id: T.id(), width: len(8) }), { min: 1, max: LIMITS.tableColumns }),
            rows: T.arr(T.obj({ id: T.id(), min_height: len(8) }), { min: 1, max: LIMITS.tableRows }),
            cells: T.record(/^[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$/, cellV, { max: LIMITS.tableCells }),
            header_rows: opt(T.num({ min: 0, max: 3, int: true })),
            first_column: opt(T.bool()),
            banded_rows: opt(T.bool()),
            banded_columns: opt(T.bool()),
          });
          break;
        case 'chart':
          fields.geometry = boxGeomV(false);
          fields.chart = chartV;
          break;
        case 'video':
          fields.geometry = boxGeomV(true);
          fields.video = videoV;
          break;
        default:
          break;
      }
      return T.obj(fields)(v, c);
    } finally {
      c.elementId = prevEl;
    }
  };
}

const transitionV = T.obj({
  kind: T.enum(TRANSITIONS),
  direction: opt(T.enum(['left', 'right', 'up', 'down'])),
  duration_ms: opt(T.num({ min: 100, max: 3000, int: true })),
});

const buildV = T.obj({
  id: T.id(),
  element_id: T.id(),
  effect: T.enum(BUILD_EFFECTS),
  direction: opt(T.enum(['left', 'right', 'up', 'down'])),
  trigger: T.enum(['on_click', 'with_previous', 'after_previous']),
  by: opt(T.enum(['element', 'paragraph'])),
  delay_ms: opt(T.num({ min: 0, max: 10000, int: true })),
  duration_ms: opt(T.num({ min: 0, max: 10000, int: true })),
});

const slideV = (v, c) => {
  const prev = c.slideId;
  if (isObj(v) && typeof v.id === 'string') c.slideId = v.id;
  try {
    return T.obj({
      id: T.id(),
      elements: T.arr(elementV(0), { max: LIMITS.elementsPerSlide }),
      title: opt(T.str({ max: 200, noControl: true })),
      hidden: opt(T.bool()),
      show_master: opt(T.bool()),
      background: opt(fillV),
      notes: opt(bodyV),
      transition: opt(transitionV),
      builds: opt(T.arr(buildV, { max: LIMITS.buildsPerSlide })),
      reading_order: opt(T.arr(T.id())),
      advance_after_ms: opt(T.num({ min: 1000, max: 600000, int: true })),
      layout_origin: opt(T.obj({ layout_id: T.str({ min: 1, max: 64 }), name: T.str({ max: 100 }) })),
    })(v, c);
  } finally {
    c.slideId = prev;
  }
};

const roleStyleV = T.obj({
  font: fontValueV,
  size: T.num({ min: 1, max: 1000 }),
  weight: T.num({ min: 100, max: 900, int: true }),
  italic: T.bool(),
  color: colorV,
  align: T.enum(['start', 'center', 'end', 'justify']),
  letter_spacing: T.num({ min: -100, max: 100 }),
  line: T.num({ min: 0.8, max: 3 }),
  before: len(0, 1000),
  after: len(0, 1000),
});

const fixedKeys = (keys, item) => (v, c) => {
  if (!isObj(v)) return c.err('must be an object');
  let ok = true;
  for (const k of Object.keys(v)) if (!keys.includes(k)) { c.at(k, () => c.err('is not a known key')); ok = false; }
  for (const k of keys) {
    if (!(k in v)) { c.at(k, () => c.err('is required')); ok = false; continue; }
    if (!c.at(k, () => item(v[k], c))) ok = false;
  }
  return ok;
};

export const themeV = T.obj({
  id: T.id(),
  name: T.str({ min: 1, max: 100, noControl: true }),
  colors: fixedKeys(COLOR_TOKENS, T.str({ re: HEX_RE })),
  fonts: fixedKeys(FONT_TOKENS, fontRefV),
  roles: fixedKeys(TEXT_ROLES, roleStyleV),
  lists: T.obj({ indent: len(0, 400), bullets: T.arr(T.str({ min: 1, max: 4, noControl: true }), { min: 1, max: 9 }) }),
  background: fillV,
  defaults: T.obj({
    shape: T.obj({ fill: fillV, stroke: strokeV, text: T.obj({ color: colorV, align: T.enum(['start', 'center', 'end', 'justify']), vertical_align: vAlignV }) }),
    line: T.obj({ stroke: strokeV, arrowheads: arrowheadsV }),
    image: T.obj({ stroke: strokeV, shadow: shadowV }),
    text_box: T.obj({ insets: insetsV }),
    link: T.obj({ color: colorV, underline: T.bool() }),
    table: T.obj({ header_fill: colorV, header_color: colorV, band_fill: colorV, first_column_bold: T.bool(), border: strokeV, text_size: T.num({ min: 1, max: 1000 }), padding: len(0, 200) }),
    chart: T.obj({ gridline: colorV, label_color: colorV, label_size: T.num({ min: 1, max: 1000 }), title_size: T.num({ min: 1, max: 1000 }), font: fontValueV }),
  }),
  dark: opt(T.bool()),
  source_height: opt(T.num({ min: 96, max: 5376 })),
});

const assetV = T.obj({
  id: T.id(),
  kind: T.enum(['image', 'svg', 'video', 'captions', 'font']),
  media_type: T.str({ min: 3, max: 100, re: /^[a-z]+\/[a-z0-9.+-]+$/ }),
  byte_size: T.num({ min: 0, max: LIMITS.packageBytes, int: true }),
  sha256: T.str({ re: /^[0-9a-f]{64}$/ }),
  width: opt(T.num({ min: 0, max: 1e6 })),
  height: opt(T.num({ min: 0, max: 1e6 })),
  duration_ms: opt(T.num({ min: 0, max: 1e10 })),
  original_filename: opt(T.str({ max: 255, noControl: true })),
  path: T.str({ re: /^assets\/[A-Za-z0-9_-]{1,64}\.[a-z0-9]{1,5}$/ }),
});

const fontFamilyV = T.obj({
  id: T.id(),
  family_name: T.str({ min: 1, max: 100, noControl: true }),
  faces: T.arr(T.obj({ asset_id: T.id(), weight: T.num({ min: 100, max: 900, int: true }), style: T.enum(['normal', 'italic']) }), { max: 32 }),
  restricted: opt(T.bool()),
  fallback: opt(T.str({ re: BUILTIN_FONT_RE })),
});

const documentV = T.obj({
  id: T.id(),
  metadata: T.obj({
    title: T.str({ min: 1, max: 200, noControl: true }),
    author: opt(T.str({ max: 200, noControl: true })),
    description: opt(T.str({ max: 2000 })),
    language: langV,
    created_at: T.str({ re: ISO_RE }),
    updated_at: T.str({ re: ISO_RE }),
  }),
  size: T.obj({ width: T.num({ min: 96, max: 5376 }), height: T.num({ min: 96, max: 5376 }), preset: opt(T.str({ max: 40 })) }),
  theme: themeV,
  fonts: opt(T.arr(fontFamilyV, { max: 100 })),
  master: opt(T.obj({ elements: T.arr(elementV(0), { max: LIMITS.elementsPerSlide }) })),
  layouts: opt(T.arr(T.obj({
    id: T.id(),
    name: T.str({ min: 1, max: 100, noControl: true }),
    elements: T.arr(elementV(0), { max: LIMITS.elementsPerSlide }),
    background: opt(fillV),
    show_master: opt(T.bool()),
  }), { max: 200 })),
  assets: opt(T.arr(assetV, { max: LIMITS.zipEntries })),
  sections: T.arr(T.obj({ id: T.id(), name: T.nullable(T.str({ min: 1, max: 100, noControl: true })), slide_ids: T.arr(T.id(), { max: LIMITS.slides }) }), { min: 1, max: LIMITS.slides }),
  slides: T.record(ID_RE, slideV, { max: LIMITS.slides }),
  playback: opt(T.obj({
    default_transition: opt(transitionV),
    click_to_advance: opt(T.bool()),
    auto_advance: opt(T.obj({ enabled: opt(T.bool()), default_duration_ms: opt(T.num({ min: 1000, max: 600000, int: true })), loop: opt(T.bool()) })),
  })),
  authoring: opt(T.obj({
    guides: opt(T.arr(T.obj({ id: T.id(), axis: T.enum(['x', 'y']), position: coord }), { max: 200 })),
    grid: opt(T.obj({ spacing: opt(T.num({ min: 4, max: 400 })), visible: opt(T.bool()), snap: opt(T.bool()) })),
  })),
});

export const envelopeV = T.obj({
  format: T.lit('pres'),
  format_version: T.num({ min: 1, int: true }),
  created_with: T.str({ min: 1, max: 40 }),
  exported_at: opt(T.str({ re: ISO_RE })),
  document: T.any(),
});

// ---------- semantic rules ----------

function semantic(doc, c, { fontIds }) {
  const ids = new Map(); // id → kind
  const dup = (id, kind) => {
    if (ids.has(id)) c.err(`ID "${id}" is used more than once`);
    else ids.set(id, kind);
  };
  const assetKinds = new Map((doc.assets || []).map((a) => [a.id, a.kind]));
  const assetIds = new Set();
  for (const a of doc.assets || []) {
    if (assetIds.has(a.id)) c.at('assets', () => c.err(`asset ID "${a.id}" is used more than once`));
    assetIds.add(a.id);
  }
  const customFontIds = new Set((doc.fonts || []).map((f) => f.id));
  const slideIds = new Set(Object.keys(doc.slides));
  for (const [k, s] of Object.entries(doc.slides)) if (s.id !== k) c.at(`slides.${k}`, () => c.err('key must equal the slide id'));

  const checkFont = (f, where) => {
    if (!f) return;
    if (typeof f === 'string') {
      if (f.startsWith('builtin.')) {
        if (fontIds && !fontIds.has(f)) c.at(where, () => c.err(`unknown font "${f}"`));
      } else if (!customFontIds.has(f)) c.at(where, () => c.err(`unknown custom font "${f}"`));
    } else if (f.fallback && fontIds && !fontIds.has(f.fallback)) c.at(where, () => c.err(`unknown fallback font "${f.fallback}"`));
  };
  const checkAsset = (id, kinds, where) => {
    if (!id) return;
    const k = assetKinds.get(id);
    if (!k) c.at(where, () => c.err(`references missing asset "${id}"`));
    else if (!kinds.includes(k)) c.at(where, () => c.err(`asset "${id}" has kind ${k}, expected ${kinds.join(' or ')}`));
  };
  const checkFill = (f, where) => { if (f && f.type === 'image') checkAsset(f.asset_id, ['image', 'svg'], where); };
  const checkLink = (l, where) => { if (l && l.kind === 'slide' && !slideIds.has(l.slide_id)) c.at(where, () => c.err(`links to missing slide "${l.slide_id}"`)); };
  const checkMarks = (m, where) => {
    if (!m) return;
    checkFont(m.font, where);
    checkLink(m.link, where);
  };
  const checkBody = (b, where) => {
    (b?.paragraphs || []).forEach((p) => (p.inlines || []).forEach((i) => checkMarks(i.marks, where)));
  };
  const checkContainer = (t, where) => {
    if (!t) return;
    checkBody(t.body, where);
    checkMarks(t.defaults, where);
  };

  // theme fonts
  for (const k of FONT_TOKENS) checkFont(doc.theme.fonts[k], `theme.fonts.${k}`);
  checkFill(doc.theme.background, 'theme.background');
  for (const fam of doc.fonts || []) {
    dup(fam.id, 'font');
    for (const face of fam.faces) checkAsset(face.asset_id, ['font'], `fonts.${fam.id}`);
  }

  let totalElements = 0;
  const checkList = (elements, where, { isMaster = false, slide = null } = {}) => {
    const all = new Map();
    const collect = (els, depth, parentRotated, inGroup) => {
      for (const el of els) {
        totalElements++;
        all.set(el.id, { el, inGroup });
        const loc = `${where}:${el.id}`;
        c.elementId = el.id;
        dup(el.id, 'element');
        if (isMaster && el.type === 'video') c.at(loc, () => c.err('video is not allowed on the master'));
        if (el.role === 'image' && !['image', 'video'].includes(el.type)) c.at(loc, () => c.err('the image role is only valid on images and video'));
        if (el.role && el.role !== 'image' && !['text', 'shape'].includes(el.type)) c.at(loc, () => c.err(`role "${el.role}" is only valid on text and shapes`));
        if (el.type === 'table' && inGroup) c.at(loc, () => c.err('tables can’t be grouped'));
        if (el.type === 'chart' && parentRotated) c.at(loc, () => c.err('charts can’t be rotated or flipped through a group'));
        checkLink(el.link, loc);
        checkFill(el.style?.fill, loc);
        if (el.text) checkContainer(el.text, loc);
        if (el.shape?.text) checkContainer(el.shape.text, loc);
        if (el.type === 'image') {
          checkAsset(el.image.asset_id, ['image', 'svg'], loc);
          const cr = el.image.crop;
          if (cr && (cr.left + cr.right >= 1 || cr.top + cr.bottom >= 1)) c.at(loc, () => c.err('crop must leave part of the image'));
        }
        if (el.type === 'video') {
          checkAsset(el.video.asset_id, ['video'], loc);
          checkAsset(el.video.poster_asset_id, ['image'], loc);
          checkAsset(el.video.captions_asset_id, ['captions'], loc);
          if (el.video.trim_end_ms !== undefined && el.video.trim_start_ms !== undefined && el.video.trim_end_ms <= el.video.trim_start_ms) c.at(loc, () => c.err('trim end must be after trim start'));
        }
        if (el.type === 'table') checkTable(el, loc);
        if (el.type === 'chart') checkChart(el.chart, loc);
        if (el.type === 'group') {
          const g = el.geometry;
          const rotated = parentRotated || !!g.rotation || !!g.flip_x || !!g.flip_y;
          collect(el.group.children, depth + 1, rotated, true);
        }
        c.elementId = null;
      }
    };
    const checkTable = (el, loc) => {
      const t = el.table;
      const cols = t.columns.map((x) => x.id);
      const rows = t.rows.map((x) => x.id);
      if (new Set(cols).size !== cols.length || new Set(rows).size !== rows.length) c.at(loc, () => c.err('table row and column IDs must be unique'));
      for (const x of [...cols, ...rows]) dup(x, 'table-part');
      if (cols.length * rows.length > LIMITS.tableCells) c.at(loc, () => c.err('too many table cells'));
      const covered = new Set();
      for (const [key, cell] of Object.entries(t.cells)) {
        const [r, col] = key.split(':');
        const ri = rows.indexOf(r);
        const ci = cols.indexOf(col);
        if (ri < 0 || ci < 0) { c.at(loc, () => c.err(`cell "${key}" doesn't match a row and column`)); continue; }
        checkContainer(cell, loc);
        checkFill(cell.fill, loc);
        const rs = cell.row_span || 1;
        const cs = cell.col_span || 1;
        if (ri + rs > rows.length || ci + cs > cols.length) c.at(loc, () => c.err(`merged cell "${key}" extends past the table`));
        for (let a = ri; a < ri + rs; a++) {
          for (let b = ci; b < ci + cs; b++) {
            if (a === ri && b === ci) continue;
            const k2 = `${rows[a]}:${cols[b]}`;
            if (covered.has(k2)) c.at(loc, () => c.err('merged cells overlap'));
            covered.add(k2);
          }
        }
      }
      for (const k2 of covered) {
        const cell = t.cells[k2];
        if (cell && ((cell.row_span || 1) > 1 || (cell.col_span || 1) > 1)) c.at(loc, () => c.err('merged cells overlap'));
        if (cell && cell.body.paragraphs.some((p) => p.inlines.length)) c.at(loc, () => c.err(`cell "${k2}" is covered by a merge and must be empty`));
      }
    };
    const checkChart = (ch, loc) => {
      for (const s of ch.series) dup(s.id, 'series');
      if (ch.kind === 'scatter') {
        if (ch.series.some((s) => !s.points || s.values)) c.at(loc, () => c.err('scatter series use points'));
      } else {
        const n = (ch.categories || []).length;
        if (!ch.categories) c.at(loc, () => c.err('category charts need categories'));
        for (const s of ch.series) {
          if (!s.values || s.points) c.at(loc, () => c.err('category chart series use values'));
          else if (s.values.length !== n) c.at(loc, () => c.err(`series "${s.name}" must have one value per category`));
        }
        if (ch.kind === 'pie' || ch.kind === 'donut') {
          if (ch.series.length !== 1) c.at(loc, () => c.err('pie and donut charts take exactly one series'));
          if (ch.series.some((s) => (s.values || []).some((x) => x !== null && x < 0))) c.at(loc, () => c.err('pie and donut values must not be negative'));
        }
      }
      if (ch.axis && typeof ch.axis.min === 'number' && typeof ch.axis.max === 'number' && ch.axis.min >= ch.axis.max) c.at(loc, () => c.err('axis minimum must be below the maximum'));
    };
    collect(elements, 0, false, false);
    // connectors
    for (const { el } of all.values()) {
      if (el.type !== 'connector') continue;
      for (const end of [el.geometry.start, el.geometry.end]) {
        if (end.element_id) {
          const target = all.get(end.element_id);
          if (!target) c.at(`${where}:${el.id}`, () => c.err(`connector attaches to "${end.element_id}", which isn't on the same ${isMaster ? 'master' : 'slide'}`));
          else if (!canAttach(target.el)) c.at(`${where}:${el.id}`, () => c.err('connectors can’t attach to lines, connectors or tables'));
        }
      }
    }
    if (slide) {
      const top = new Map(slide.elements.map((e) => [e.id, e]));
      const entries = new Set();
      const exits = new Set();
      const plays = new Set();
      const buildIds = new Set();
      for (const b of slide.builds || []) {
        dup(b.id, 'build');
        if (buildIds.has(b.id)) continue;
        buildIds.add(b.id);
        const el = top.get(b.element_id);
        if (!el) { c.at(`${where}.builds`, () => c.err(`build "${b.id}" targets "${b.element_id}", which isn't a top-level element of this slide`)); continue; }
        if (b.effect === 'play') {
          if (el.type !== 'video') c.at(`${where}.builds`, () => c.err('play builds are only for video'));
          else if ((el.video.start || 'manual') !== 'manual') c.at(`${where}.builds`, () => c.err('a video with a play build must use start: manual'));
          if (plays.has(el.id)) c.at(`${where}.builds`, () => c.err('an element can have only one play build'));
          plays.add(el.id);
        } else if (ENTRANCE.has(b.effect)) {
          if (entries.has(el.id)) c.at(`${where}.builds`, () => c.err('an element can have only one entrance build'));
          if (exits.has(el.id)) c.at(`${where}.builds`, () => c.err('an exit must come after the entrance'));
          entries.add(el.id);
        } else if (EXIT.has(b.effect)) {
          if (exits.has(el.id)) c.at(`${where}.builds`, () => c.err('an element can have only one exit build'));
          exits.add(el.id);
        }
        if (b.by === 'paragraph' && !(el.text || el.shape?.text)) c.at(`${where}.builds`, () => c.err('paragraph builds need text'));
        if (b.by === 'paragraph' && b.effect === 'play') c.at(`${where}.builds`, () => c.err('play builds can’t be by paragraph'));
      }
      for (const id of slide.reading_order || []) {
        const el = top.get(id);
        if (!el) c.at(`${where}.reading_order`, () => c.err(`"${id}" isn't a top-level element of this slide`));
        else if (!isEligible(el, { includeEmpty: true })) c.at(`${where}.reading_order`, () => c.err(`"${id}" isn't eligible for reading order`));
      }
      if (slide.elements.length > LIMITS.elementsPerSlide) c.err('too many elements on a slide');
    }
    return all;
  };

  const seenSlides = new Set();
  doc.sections.forEach((sec, i) => {
    dup(sec.id, 'section');
    for (const sid of sec.slide_ids) {
      if (!slideIds.has(sid)) c.at(`sections[${i}]`, () => c.err(`lists missing slide "${sid}"`));
      if (seenSlides.has(sid)) c.at(`sections[${i}]`, () => c.err(`slide "${sid}" appears more than once`));
      seenSlides.add(sid);
    }
  });
  for (const sid of slideIds) if (!seenSlides.has(sid)) c.at(`slides.${sid}`, () => c.err('slide isn’t in any section'));
  if (slideIds.size === 0) c.err('a presentation needs at least one slide');
  if (slideIds.size > LIMITS.slides) c.err(`at most ${LIMITS.slides} slides`);

  for (const s of Object.values(doc.slides)) {
    c.slideId = s.id;
    dup(s.id, 'slide');
    checkFill(s.background, `slides.${s.id}.background`);
    checkBody(s.notes, `slides.${s.id}.notes`);
    checkList(s.elements, `slides.${s.id}`, { slide: s });
    c.slideId = null;
  }
  checkList(doc.master?.elements || [], 'master', { isMaster: true });
  for (const l of doc.layouts || []) {
    dup(l.id, 'layout');
    checkFill(l.background, `layouts.${l.id}`);
    checkList(l.elements, `layouts.${l.id}`);
  }
  for (const g of doc.authoring?.guides || []) dup(g.id, 'guide');
  if (totalElements > LIMITS.elements) c.err(`at most ${LIMITS.elements} elements`);
}

// Validates a document. Options: fontIds — Set of registry font IDs to check against.
export function validateDocument(doc, { fontIds = null } = {}) {
  const c = new Ctx();
  if (!documentV(doc, c)) return { ok: false, errors: c.errors };
  semantic(doc, c, { fontIds });
  return { ok: c.errors.length === 0, errors: c.errors };
}

export function validateEnvelope(env) {
  const c = new Ctx();
  envelopeV(env, c);
  return { ok: c.errors.length === 0, errors: c.errors };
}

export function validateTheme(theme) {
  const c = new Ctx();
  themeV(theme, c);
  return { ok: c.errors.length === 0, errors: c.errors };
}

export function formatErrors(errors, max = 8) {
  const lines = errors.slice(0, max).map((e) => `${e.path}: ${e.message}`);
  if (errors.length > max) lines.push(`…and ${errors.length - max} more`);
  return lines.join('\n');
}

export { geometryKind };
