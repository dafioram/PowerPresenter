// Convenience constructors that combine the model and layouts.
import { createPresentation } from './model.js';
import { createSlideFromLayout } from './layouts.js';
import { bodyFromText } from './text.js';

export function newPresentation(opts = {}) {
  return createPresentation({ ...opts, layoutFactory: (doc, id) => createSlideFromLayout(doc, id) });
}

// Fills the first text element with a given role on a slide.
export function fillRole(slide, role, text) {
  const el = slide.elements.find((e) => e.role === role && e.type === 'text');
  if (!el) return;
  const para = el.text.body.paragraphs[0] || { inlines: [] };
  const body = bodyFromText(text);
  body.paragraphs = body.paragraphs.map((p) => ({ ...para, inlines: p.inlines }));
  el.text.body = body;
}
