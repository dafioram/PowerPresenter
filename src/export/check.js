// Export check (spec §15.1): blocking validation errors plus target-specific
// warnings, each linked to a slide or element where possible.
import { validateDocument } from '../core/validate.js';
import { registryFontIds, fontsReady } from '../render/fonts.js';
import { renderSlide, layoutSlide } from '../render/renderer.js';
import { checkAccessibility } from '../core/a11y.js';
import { readingOrder, automaticOrder } from '../core/reading-order.js';
import { walk, slideOrder } from '../core/model.js';
import { danglingSlideLinks, documentFonts, isSafari, assetIdsForSlides } from './common.js';
import { LIMITS } from '../core/limits.js';

// Renders slides off-screen and returns the IDs of text elements that overflow.
export async function measureOverflow(doc, slideIds, assetUrl) {
  const host = document.createElement('div');
  host.className = 'pe-offscreen';
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  const out = [];
  try {
    await fontsReady();
    for (let i = 0; i < slideIds.length; i++) {
      const slide = doc.slides[slideIds[i]];
      const root = renderSlide(doc, slide, { mode: 'print', assetUrl });
      host.replaceChildren(root);
      try {
        const { overflow } = layoutSlide(root, doc, slide);
        for (const id of overflow) out.push({ slideId: slide.id, elementId: id });
      } catch {
        /* ignore */
      }
      if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    host.remove();
  }
  return out;
}

function fontName(doc, id) {
  return doc.fonts?.find((f) => f.id === id)?.family_name || id;
}

// target: 'pres' | 'pdf' | 'images' | 'html' | 'pptx'
export async function runExportCheck(ctl, target, slideIds, opts = {}) {
  const doc = ctl.doc;
  const errors = [];
  const warnings = [];
  const add = (list, message, slideId = null, elementId = null) => list.push({ message, slideId, elementId });
  const v = validateDocument(doc, { fontIds: registryFontIds() });
  if (!v.ok) for (const e of v.errors.slice(0, 30)) add(errors, `${e.path}: ${e.message}`, e.slideId, e.elementId);
  if (target !== 'pres' && !slideIds.length) add(errors, 'No slides are in the chosen range.');

  // fonts
  const fonts = documentFonts(doc);
  for (const d of fonts.device) add(warnings, `“${d}” is a font on this device. Other people see the fallback font${target === 'pres' || target === 'html' ? '' : ' unless they have it installed'}.`);
  for (const id of fonts.custom) {
    const fam = doc.fonts?.find((f) => f.id === id);
    if (!fam) continue;
    if (fam.restricted && (target === 'pres' || target === 'html')) add(warnings, `The font “${fam.family_name}” restricts embedding, so it isn’t included. Recipients see ${fam.fallback || 'the fallback font'}.`);
    if (!fam.faces.length) add(warnings, `The font “${fam.family_name}” has no font files; the fallback is used.`);
  }
  if (target === 'pptx') {
    const names = [...new Set([...fonts.registry.map((f) => f.replace('builtin.', '').replace(/-/g, ' ')), ...fonts.custom.map((f) => fontName(doc, f)), ...fonts.device])];
    if (names.length) add(warnings, `Fonts aren’t embedded in PowerPoint files. Recipients need: ${names.join(', ')}. Text can wrap differently in PowerPoint.`);
  }

  // text overflow (rendered)
  if (target !== 'pres' && slideIds.length && opts.measure !== false) {
    const ov = await measureOverflow(doc, slideIds, (id) => ctl.assets.editUrl(id));
    for (const o of ov.slice(0, 20)) add(warnings, 'Text overflows its box.', o.slideId, o.elementId);
    if (ov.length > 20) add(warnings, `${ov.length - 20} more text boxes overflow.`);
  }

  // accessibility errors (summarized)
  const a11y = checkAccessibility(doc).filter((i) => i.severity === 'error' && (!i.slideId || slideIds.includes(i.slideId) || target === 'pres'));
  if (a11y.length) add(warnings, `${a11y.length} accessibility error${a11y.length === 1 ? '' : 's'} (open the accessibility checker to fix them).`, a11y[0].slideId, a11y[0].elementId);

  // links to slides that aren't exported
  if (target !== 'pres' && target !== 'images') {
    const dangling = target === 'html' ? [] : danglingSlideLinks(doc, slideIds);
    for (const d of dangling.slice(0, 10)) add(warnings, 'This link points to a slide that isn’t in the export, so it becomes inactive.', d.slideId, d.elementId);
  }

  // target-specific
  if (target === 'pdf' && isSafari()) add(errors, 'PDF export needs Chrome, Edge or Firefox. Export HTML or images instead.');
  if ((target === 'images' || target === 'pdf') && isSafari()) add(warnings, 'This browser may render some effects differently.');
  if (target === 'html') {
    const ids = assetIdsForSlides(doc, slideIds);
    const bytes = (doc.assets || []).filter((a) => ids.has(a.id)).reduce((n, a) => n + a.byte_size, 0);
    const est = (bytes * 4) / 3;
    if (est > 50 * 1024 * 1024) add(warnings, `The HTML export will be about ${Math.round(est / 1024 / 1024)} MB.`);
    if (!opts.folder && est > LIMITS.htmlSingleFileBytes) add(errors, 'This is too large for a single HTML file (over 200 MB). Choose “Web folder”.');
  }
  if (target === 'pptx') {
    const ids = new Set(slideIds);
    for (const sid of slideOrder(doc)) {
      if (!ids.has(sid)) continue;
      const s = doc.slides[sid];
      walk(s.elements, (el) => {
        if (el.type === 'group' && el.opacity !== undefined && el.opacity < 1) add(warnings, 'Group opacity is applied to each element in the group; overlapping parts may look different.', sid, el.id);
        if (el.type === 'video') {
          const rec = doc.assets.find((a) => a.id === el.video.asset_id);
          if (rec?.media_type === 'video/webm') add(warnings, 'WebM video is replaced by its poster image in PowerPoint.', sid, el.id);
          if (el.video.captions_asset_id) add(warnings, 'Video captions aren’t embedded in PowerPoint.', sid, el.id);
        }
        if (el.type === 'connector' && el.connector.routing === 'elbow' && (el.geometry.start.element_id || el.geometry.end.element_id)) {
          /* reported once below */
        }
        const shadow = el.style?.shadow;
        if (shadow && shadow !== 'none' && shadow.blur > 0) {
          /* blur approximated; reported once below */
        }
      });
      if (s.reading_order?.length) {
        const explicit = readingOrder(s).map((e) => e.id).join();
        const layer = automaticOrder(s.elements).map((e) => e.id);
        const byLayer = s.elements.filter((e) => layer.includes(e.id)).map((e) => e.id).join();
        if (explicit !== byLayer) add(warnings, 'PowerPoint reads elements in layer order, which differs from this slide’s reading order.', sid);
      }
    }
    const json = JSON.stringify(slideIds.map((id) => doc.slides[id]));
    if (/"routing":"elbow"/.test(json)) add(warnings, 'PowerPoint may re-route elbow connectors when shapes are moved.');
    if (/"blur":[1-9]/.test(json)) add(warnings, 'Shadow blur is approximated.');
    if (/"field":"(slide_count|presentation_title|section_title)"/.test(json + JSON.stringify(doc.master))) add(warnings, 'Slide count, title and section fields become plain text and won’t update in PowerPoint.');
    if (/"locked":true/.test(json)) add(warnings, 'Locks are written as shape locks, which some apps ignore.');
    if (opts.notes !== false && slideIds.some((id) => doc.slides[id].notes)) add(warnings, 'Speaker notes are included. Turn off “Include notes” if they’re private.');
  }
  if (target === 'images') {
    const big = doc.size.width * (opts.scale || 2) > 8192 || doc.size.height * (opts.scale || 2) > 8192;
    if (big) add(warnings, 'Images are capped at 8,192 pixels per side.');
  }
  return { errors, warnings, validation: v };
}
