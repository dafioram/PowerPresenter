// Renders a slide thumbnail with the shared renderer (spec §3.2), lazily.
import { useEffect, useRef, useState } from 'preact/hooks';
import { renderSlide, layoutSlide } from '../render/renderer.js';

export function SlideThumb({ doc, slide, assetUrl, width = 200, class: cls = '', lazy = true, final = true }) {
  const box = useRef(null);
  const [visible, setVisible] = useState(!lazy);
  const W = doc.size.width;
  const H = doc.size.height;
  const s = width / W;
  useEffect(() => {
    if (!lazy || visible || !box.current) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '300px' });
    io.observe(box.current);
    return () => io.disconnect();
  }, [lazy, visible]);
  useEffect(() => {
    if (!visible || !box.current || !slide) return undefined;
    const host = box.current;
    let cancelled = false;
    const handle = requestAnimationFrame(() => {
      if (cancelled) return;
      const root = renderSlide(doc, slide, { mode: 'thumbnail', assetUrl, visibility: final ? undefined : null });
      root.style.transform = `scale(${s})`;
      root.style.transformOrigin = '0 0';
      root.classList.add('thumb-inner');
      host.replaceChildren(root);
      try {
        layoutSlide(root, doc, slide);
      } catch {
        /* ignore layout errors in thumbnails */
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(handle);
    };
  }, [visible, doc.theme, doc.master, doc.size, doc.fonts, slide, s, assetUrl]);
  return <div ref={box} class={`slide-thumb ${cls}`} style={{ width: `${width}px`, height: `${H * s}px`, position: 'relative', overflow: 'hidden' }} aria-hidden="true" />;
}
