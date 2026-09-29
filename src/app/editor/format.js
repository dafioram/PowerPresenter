// Format painter capture/apply and cover-crop helper (spec §12.5, §13.4).

export function coverCrop(record, g) {
  if (!record.width || !record.height) return null;
  const fr = g.width / g.height;
  const ir = record.width / record.height;
  const r = (v) => Math.round(v * 10000) / 10000;
  if (Math.abs(fr - ir) < 0.001) return null;
  if (ir > fr) {
    const keep = fr / ir;
    return { left: r((1 - keep) / 2), top: 0, right: r((1 - keep) / 2), bottom: 0 };
  }
  const keep = ir / fr;
  return { left: 0, top: r((1 - keep) / 2), right: 0, bottom: r((1 - keep) / 2) };
}

// Copies formatting captured by the format painter (spec §12.5).
export function captureFormat(el) {
  const f = { type: el.type };
  if (el.style) f.style = JSON.parse(JSON.stringify(el.style));
  const c = el.text || el.shape?.text;
  if (c) {
    f.defaults = c.defaults ? { ...c.defaults } : undefined;
    const p0 = c.body.paragraphs[0];
    f.para = p0 ? { align: p0.align, spacing: p0.spacing, dir: p0.dir } : undefined;
    const first = p0?.inlines.find((i) => typeof i.text === 'string');
    f.marks = first?.marks ? { ...first.marks } : {};
    delete f.marks.link;
    f.box = c.box ? { ...c.box } : undefined;
  }
  if (el.image?.mask) f.mask = { ...el.image.mask };
  return f;
}

export function applyFormat(x, fp) {
  if (fp.style) {
    const allowed = { text: ['fill', 'stroke', 'shadow'], shape: ['fill', 'stroke', 'shadow'], image: ['stroke', 'shadow'], line: ['stroke', 'shadow', 'arrowheads'], connector: ['stroke', 'shadow', 'arrowheads'], chart: ['fill', 'stroke', 'shadow'], video: ['stroke', 'shadow'] }[x.type] || [];
    const style = {};
    for (const k of allowed) if (fp.style[k] !== undefined) style[k] = fp.style[k];
    if (Object.keys(style).length) x.style = style;
  }
  const c = x.text || x.shape?.text;
  if (c && fp.marks) {
    c.body.paragraphs = c.body.paragraphs.map((p) => ({
      ...p,
      ...(fp.para?.align ? { align: fp.para.align } : {}),
      ...(fp.para?.spacing ? { spacing: fp.para.spacing } : {}),
      inlines: p.inlines.map((i) => (typeof i.text === 'string' || i.field ? { ...i, marks: { ...(i.marks?.link ? { link: i.marks.link } : {}), ...fp.marks } } : i)),
    }));
    for (const p of c.body.paragraphs) for (const i of p.inlines) if (i.marks && !Object.keys(i.marks).length) delete i.marks;
    if (fp.defaults) c.defaults = fp.defaults;
    if (fp.box && x.type === fp.type) c.box = fp.box;
  }
  if (x.type === 'image' && fp.mask) x.image.mask = fp.mask;
}
