// Fields (spec §5.11): slide_number, slide_count, presentation_title, section_title, date.
import { slideOrder, sectionOfSlide } from './model.js';

export const FIELD_KINDS = ['slide_number', 'slide_count', 'presentation_title', 'section_title', 'date'];
export const FIELD_LABELS = {
  slide_number: 'Slide number',
  slide_count: 'Slide count',
  presentation_title: 'Presentation title',
  section_title: 'Section title',
  date: 'Date',
};
export const DATE_FORMATS = ['short', 'medium', 'long', 'iso'];

// Numbers include hidden slides and keep their original values in exports
// that leave slides out.
export function fieldContext(doc, slideId, now = new Date()) {
  const order = slideOrder(doc);
  const section = sectionOfSlide(doc, slideId);
  return {
    slideNumber: order.indexOf(slideId) + 1,
    slideCount: order.length,
    presentationTitle: doc.metadata?.title || '',
    sectionTitle: section?.name || '',
    language: doc.metadata?.language || 'en-US',
    now,
  };
}

export function formatDate(date, format = 'medium', language = 'en-US') {
  if (format === 'iso') return date.toISOString().slice(0, 10);
  const style = { short: 'short', medium: 'medium', long: 'long' }[format] || 'medium';
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: style }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function fieldText(field, ctx) {
  if (!ctx) return `‹${FIELD_LABELS[field.field] || field.field}›`;
  switch (field.field) {
    case 'slide_number': return String(ctx.slideNumber);
    case 'slide_count': return String(ctx.slideCount);
    case 'presentation_title': return ctx.presentationTitle;
    case 'section_title': return ctx.sectionTitle;
    case 'date': {
      let d = ctx.now || new Date();
      if (field.value && field.value !== 'auto') {
        const parsed = new Date(field.value + (field.value.length === 10 ? 'T00:00:00' : ''));
        if (!isNaN(parsed)) d = parsed;
      }
      return formatDate(d, field.format, ctx.language);
    }
    default: return '';
  }
}
