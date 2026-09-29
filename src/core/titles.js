// Slide title resolution (spec §5.5).
import { readingOrder } from './reading-order.js';
import { plainText } from './text.js';

export function resolveSlideTitle(slide, { rtl = false } = {}) {
  const order = readingOrder(slide, { rtl });
  for (const el of order) {
    if (el.role !== 'title') continue;
    const body = el.text?.body || el.shape?.text?.body;
    const t = plainText(body).replace(/\s+/g, ' ').trim().slice(0, 200);
    if (t) return t;
  }
  const hidden = (slide.title || '').trim();
  return hidden || null;
}

export function titleElement(slide) {
  return readingOrder(slide).find((e) => e.role === 'title' && (e.text || e.shape?.text)) || null;
}
