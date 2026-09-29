// Copying slides and elements with fresh IDs (spec §5.2): references inside the
// copied set are remapped; references that leave the set are cut.
import { newId } from './ids.js';
import { walk } from './model.js';
import { worldMap, resolveEndWorld, IDENTITY, invert, apply } from './geometry.js';

function remapBody(body, slideMap, dropped) {
  if (!body) return body;
  return {
    ...body,
    paragraphs: body.paragraphs.map((p) => ({
      ...p,
      inlines: p.inlines.map((i) => {
        if (!i.marks?.link || i.marks.link.kind !== 'slide') return i;
        const to = slideMap.get(i.marks.link.slide_id);
        if (to) return { ...i, marks: { ...i.marks, link: { kind: 'slide', slide_id: to } } };
        if (slideMap.keepExternal) return i;
        dropped.push(i.marks.link.slide_id);
        const { link, ...rest } = i.marks;
        return Object.keys(rest).length ? { ...i, marks: rest } : { ...i, marks: undefined };
      }).map((i) => {
        if (i.marks === undefined) {
          const { marks, ...r } = i;
          return r;
        }
        return i;
      }),
    })),
  };
}

function remapLink(link, slideMap, dropped) {
  if (!link || link.kind !== 'slide') return link;
  const to = slideMap.get(link.slide_id);
  if (to) return { kind: 'slide', slide_id: to };
  if (slideMap.keepExternal) return link;
  dropped.push(link.slide_id);
  return undefined;
}

// Copies elements (and their descendants) with new IDs.
// options.slideMap: Map oldSlideId → newSlideId (keepExternal = links to slides
// outside the copy stay valid, e.g. pasting in the same presentation).
export function copyElements(elements, { slideMap = new Map(), keepExternalSlideLinks = true } = {}) {
  const idMap = new Map();
  walk(elements, (el) => { idMap.set(el.id, newId()); });
  slideMap.keepExternal = keepExternalSlideLinks;
  const dropped = [];
  const world = worldMap(elements);
  const copy = (el) => {
    const out = JSON.parse(JSON.stringify(el));
    out.id = idMap.get(el.id);
    const l = remapLink(out.link, slideMap, dropped);
    if (l) out.link = l;
    else delete out.link;
    if (out.text) out.text.body = remapBody(out.text.body, slideMap, dropped);
    if (out.shape?.text) out.shape.text.body = remapBody(out.shape.text.body, slideMap, dropped);
    if (out.type === 'connector') {
      for (const key of ['start', 'end']) {
        const end = out.geometry[key];
        if (end.element_id) {
          if (idMap.has(end.element_id)) end.element_id = idMap.get(end.element_id);
          else {
            // detach at current position (in parent coordinates)
            const info = world.get(el.id);
            const r = resolveEndWorld(el.geometry[key], world, info?.parentWorld || IDENTITY);
            const p = r ? apply(invert(info?.parentWorld || IDENTITY), r.point) : { x: 0, y: 0 };
            out.geometry[key] = { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
          }
        }
      }
    }
    if (out.type === 'group') out.group.children = el.group.children.map(copy);
    if (out.type === 'table') {
      const colMap = new Map(out.table.columns.map((c) => [c.id, newId()]));
      const rowMap = new Map(out.table.rows.map((r) => [r.id, newId()]));
      const cells = {};
      for (const [k, v] of Object.entries(out.table.cells)) {
        const [rid, cid] = k.split(':');
        cells[`${rowMap.get(rid)}:${colMap.get(cid)}`] = v;
      }
      out.table.columns = out.table.columns.map((c) => ({ ...c, id: colMap.get(c.id) }));
      out.table.rows = out.table.rows.map((r) => ({ ...r, id: rowMap.get(r.id) }));
      out.table.cells = cells;
    }
    if (out.type === 'chart') out.chart.series = out.chart.series.map((s) => ({ ...s, id: newId() }));
    return out;
  };
  return { elements: elements.map(copy), idMap, droppedLinks: dropped };
}

// Copies slides with new IDs. `inDestination` says whether slide links to
// slides outside the copied set are still valid in the destination.
export function copySlides(slides, { inDestination = () => false } = {}) {
  const slideMap = new Map(slides.map((s) => [s.id, newId()]));
  const dropped = [];
  const out = slides.map((s) => {
    const sm = new Map(slideMap);
    sm.keepExternal = false;
    const extMap = {
      get: (id) => sm.get(id) || (inDestination(id) ? id : undefined),
    };
    extMap.keepExternal = false;
    const { elements, idMap, droppedLinks } = copyElements(s.elements, { slideMap: extMap, keepExternalSlideLinks: false });
    dropped.push(...droppedLinks);
    const copy = JSON.parse(JSON.stringify({ ...s, elements: [] }));
    copy.id = slideMap.get(s.id);
    copy.elements = elements;
    if (copy.notes) copy.notes = remapBody(copy.notes, extMap, dropped);
    copy.builds = (s.builds || [])
      .filter((b) => idMap.has(b.element_id))
      .map((b) => ({ ...b, id: newId(), element_id: idMap.get(b.element_id) }));
    if (!copy.builds.length) delete copy.builds;
    if (s.reading_order) {
      copy.reading_order = s.reading_order.filter((id) => idMap.has(id)).map((id) => idMap.get(id));
      if (!copy.reading_order.length) delete copy.reading_order;
    }
    return copy;
  });
  return { slides: out, slideMap, droppedLinks: dropped };
}
