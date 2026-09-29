// Units, rounding and slide sizes (spec §4). 1 unit = 1/96 inch = 1 CSS pixel.
export const UNITS_PER_INCH = 96;
export const UNITS_PER_POINT = 4 / 3;
export const UNITS_PER_CM = 96 / 2.54;
export const EMU_PER_UNIT = 9525;
export const MIN_SLIDE_SIDE = 96;
export const MAX_SLIDE_SIDE = 5376;
export const COORD_LIMIT = 100000;

export const SIZE_PRESETS = [
  { id: '16:9', label: '16:9 (default)', width: 1280, height: 720 },
  { id: '4:3', label: '4:3', width: 960, height: 720 },
  { id: '16:10', label: '16:10', width: 1280, height: 800 },
  { id: 'A4', label: 'A4 landscape', width: 1122.52, height: 793.7 },
  { id: 'Letter', label: 'Letter landscape', width: 1056, height: 816 },
];

export function presetSize(id, portrait = false) {
  const p = SIZE_PRESETS.find((s) => s.id === id);
  if (!p) return null;
  return portrait
    ? { width: p.height, height: p.width, preset: `${p.id} portrait` }
    : { width: p.width, height: p.height, preset: p.id };
}

export function roundLen(v) {
  return Math.round(v * 100) / 100;
}

export function roundAngle(v) {
  let a = Math.round((((v % 360) + 360) % 360) * 100) / 100;
  if (a >= 360) a = 0;
  return a;
}

export function roundOpacity(v) {
  return Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export const MEASURES = {
  units: { label: 'units', perUnit: 1, digits: 0 },
  in: { label: 'in', perUnit: 1 / UNITS_PER_INCH, digits: 2 },
  cm: { label: 'cm', perUnit: 1 / UNITS_PER_CM, digits: 2 },
};

export function toMeasure(units, measure = 'units') {
  const m = MEASURES[measure] || MEASURES.units;
  const f = 10 ** m.digits;
  return Math.round(units * m.perUnit * f) / f;
}

export function fromMeasure(value, measure = 'units') {
  const m = MEASURES[measure] || MEASURES.units;
  return roundLen(value / m.perUnit);
}

export function unitsToPt(u) {
  return Math.round((u / UNITS_PER_POINT) * 100) / 100;
}

export function ptToUnits(pt) {
  return roundLen(pt * UNITS_PER_POINT);
}

export function physicalSize(size) {
  return { widthIn: size.width / UNITS_PER_INCH, heightIn: size.height / UNITS_PER_INCH };
}
