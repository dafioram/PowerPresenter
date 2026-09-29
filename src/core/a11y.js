// Accessibility checker (spec §16.3).
import { slideOrder, walk } from './model.js';
import { containerBaseStyle, resolveRun } from './theme.js';
import { resolveColor, contrastRatio, composite, isHex } from './color.js';
import { isRun, plainText, isBodyEmpty } from './text.js';
import { isPlaceholder } from './reading-order.js';
import { elementAABB, rectsIntersect, worldMap, resolveEndWorld, IDENTITY } from './geometry.js';
import { resolveSlideTitle } from './titles.js';

const CLICK_HERE = /^(click here|here|read more|more|link|this link|click)$/i;

export function checkAccessibility(doc, { overflowIds = new Set() } = {}) {
  const issues = [];
  const add = (severity, rule, message, slideId, elementId = null, fix = null) => issues.push({ severity, rule, message, slideId, elementId, fix });
  const theme = doc.theme;
  const titles = new Map();

  if (!theme.defaults?.link?.underline) add('warning', 'link-underline', 'The theme’s link style has no underline, so links are hard to tell apart.', null, null, 'theme');

  for (const sid of slideOrder(doc)) {
    const slide = doc.slides[sid];
    const title = resolveSlideTitle(slide);
    if (!title) add('error', 'slide-title', 'Slide has no title. Add a visible title or a hidden one.', sid, null, 'add-title');
    else {
      const key = title.toLowerCase();
      if (!titles.has(key)) titles.set(key, []);
      titles.get(key).push(sid);
    }
    const bg = slideBackgroundColor(slide, doc);
    const world = worldMap(slide.elements);
    const resolve = (end) => resolveEndWorld(end, world, IDENTITY)?.point || null;
    const boxes = new Map(slide.elements.map((e) => [e.id, elementAABB(e, resolve)]));

    walk(slide.elements, (el, list, index, parent) => {
      if (el.hidden) return;
      const decorative = !!el.accessibility?.decorative;
      const alt = el.accessibility?.alt?.trim();
      if (['image', 'video', 'chart'].includes(el.type) && !decorative && !alt) {
        if (!(el.type === 'image' && !el.image.asset_id)) {
          const kind = el.type === 'image' ? 'Image' : el.type === 'video' ? 'Video' : 'Chart';
          add('error', 'alt-text', `${kind} has no alt text.`, sid, el.id, 'alt');
        }
      }
      if (isPlaceholder(el)) add('tip', 'empty-placeholder', 'Empty placeholder. It won’t appear in any output.', sid, el.id, 'delete');
      if (el.type === 'table' && !(el.table.header_rows > 0)) add('warning', 'table-header', 'Table has no header row.', sid, el.id, 'table-header');
      if (el.type === 'video' && !el.video.muted && !el.video.captions_asset_id) add('warning', 'captions', 'Video with sound has no captions.', sid, el.id, 'captions');
      if (overflowIds.has(el.id)) add('warning', 'overflow', 'Text overflows its box.', sid, el.id);

      const bodies = [];
      if (el.text) bodies.push({ body: el.text.body, kind: 'text', defaults: el.text.defaults });
      if (el.shape?.text) bodies.push({ body: el.shape.text.body, kind: 'shape', defaults: el.shape.text.defaults });
      for (const { body, kind, defaults } of bodies) {
        if (isBodyEmpty(body)) continue;
        const base = containerBaseStyle(theme, { kind, role: el.role, defaults }).run;
        // background behind the text
        let back = null;
        let uncertain = false;
        const ownFill = kind === 'shape' ? (el.style?.fill ?? theme.defaults.shape.fill) : el.style?.fill;
        if (ownFill && ownFill !== 'none') {
          if (ownFill.type === 'solid') back = composite(resolveColor(ownFill.color, theme), bg || '#ffffff');
          else uncertain = true;
        }
        if (!back && !uncertain) {
          const myBox = boxes.get(parent ? findTop(slide, el) : el.id);
          const beneath = slide.elements.slice(0, Math.max(0, slide.elements.findIndex((e) => e.id === (parent ? findTop(slide, el) : el.id))));
          for (const other of beneath) {
            if (other.hidden) continue;
            if (!myBox || !rectsIntersect(myBox, boxes.get(other.id))) continue;
            if (other.type === 'image' || other.type === 'video' || other.type === 'chart') uncertain = true;
            else if (other.type === 'shape') {
              const f = other.style?.fill ?? theme.defaults.shape.fill;
              if (f && f !== 'none') {
                if (f.type === 'solid') back = composite(resolveColor(f.color, theme), bg || '#ffffff');
                else uncertain = true;
              }
            }
          }
          if (!back && !uncertain) {
            if (bg) back = bg;
            else uncertain = true;
          }
        }
        if (uncertain) {
          add('tip', 'contrast-unknown', 'Text sits over an image or gradient, so contrast can’t be verified.', sid, el.id);
        }
        let reported = false;
        let small = false;
        for (const p of body.paragraphs) {
          for (const i of p.inlines) {
            if (!isRun(i) || !i.text.trim()) continue;
            const st = resolveRun(base, i.marks);
            if (st.size < 16) small = true;
            if (st.link && (CLICK_HERE.test(i.text.trim()) || (/^https?:\/\//.test(i.text.trim()) && i.text.trim().length > 40))) {
              add('warning', 'link-text', `Link text “${i.text.trim().slice(0, 40)}” doesn’t say where it goes.`, sid, el.id);
            }
            if (back && !reported) {
              const fg = composite(resolveColor(st.color, theme), back);
              const ratio = contrastRatio(fg, back);
              const large = st.size >= 24 || (st.weight >= 700 && st.size >= 18.67);
              const need = large ? 3 : 4.5;
              if (ratio < need) {
                add('warning', 'contrast', `Text contrast is ${ratio.toFixed(2)}:1; WCAG AA needs ${need}:1.`, sid, el.id);
                reported = true;
              }
            }
          }
        }
        if (small) add('tip', 'small-text', 'Text is smaller than 12 pt.', sid, el.id);
      }
      return true;
    });
  }
  for (const [, ids] of titles) {
    if (ids.length > 1) for (const sid of ids) add('warning', 'duplicate-title', 'Another slide has the same title.', sid);
  }
  const order = { error: 0, warning: 1, tip: 2 };
  const slideIdx = new Map(slideOrder(doc).map((s, i) => [s, i]));
  issues.sort((a, b) => (slideIdx.get(a.slideId) ?? -1) - (slideIdx.get(b.slideId) ?? -1) || order[a.severity] - order[b.severity]);
  return issues;
}

function findTop(slide, el) {
  for (const top of slide.elements) {
    let found = false;
    walk([top], (x) => { if (x.id === el.id) found = true; });
    if (found) return top.id;
  }
  return el.id;
}

export function slideBackgroundColor(slide, doc) {
  const fill = slide.background ?? doc.theme.background;
  if (!fill || fill === 'none') return '#ffffff';
  if (fill.type === 'solid') {
    const c = resolveColor(fill.color, doc.theme);
    return isHex(c) ? composite(c, '#ffffff') : '#ffffff';
  }
  return null;
}

export function summarize(issues) {
  const s = { error: 0, warning: 0, tip: 0 };
  for (const i of issues) s[i.severity]++;
  return s;
}

export { plainText };
