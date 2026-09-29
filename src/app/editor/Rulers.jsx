// Rulers (spec §12.2): measurement-unit ticks aligned with the slide; drag from
// a ruler to create a guide, drag it off the slide to delete it.
import { useEffect, useState } from 'preact/hooks';
import { useSignal } from '../ui/components.jsx';
import { settings } from '../settings.js';
import { MEASURES } from '../../core/units.js';
import { unionBoxes } from '../../core/geometry.js';
import { newId } from '../../core/ids.js';

const RULER = 20;

// Picks a tick step (in units) so labels are at least ~50px apart.
function tickStep(scale, measure) {
  const per = 1 / (MEASURES[measure] || MEASURES.units).perUnit; // units per measure-unit
  const candidates = measure === 'units' ? [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000] : measure === 'in' ? [0.125, 0.25, 0.5, 1, 2, 5, 10] : [0.25, 0.5, 1, 2, 5, 10, 20, 50];
  for (const c of candidates) if (c * per * scale >= 50) return { major: c * per, label: c, minorDiv: measure === 'in' ? 4 : measure === 'cm' ? 2 : 5 };
  const c = candidates[candidates.length - 1];
  return { major: c * per, label: c, minorDiv: 5 };
}

function fmt(v) {
  return String(Math.round(v * 1000) / 1000);
}

export function Rulers({ ctl, scale, scrollRef, stageLeft, stageTop, layoutTick }) {
  const s = useSignal(settings);
  const [, setTick] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const on = () => setTick((n) => n + 1);
    el.addEventListener('scroll', on, { passive: true });
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', on);
      ro.disconnect();
    };
  }, [scrollRef.current]);
  const sc = scrollRef.current;
  const sl = sc?.scrollLeft || 0;
  const stp = sc?.scrollTop || 0;
  const vw = sc?.clientWidth || 1000;
  const vh = sc?.clientHeight || 800;
  const ox = stageLeft - sl;
  const oy = stageTop - stp;
  const measure = s.measure || 'units';
  const { major, label, minorDiv } = tickStep(scale, measure);
  const W = ctl.doc.size.width;
  const H = ctl.doc.size.height;

  const ticks = (origin, length, horizontal) => {
    const out = [];
    const startU = Math.floor(-origin / scale / major) * major;
    const endU = (length - origin) / scale;
    let i = 0;
    for (let u = startU; u <= endU && i < 2000; u += major / minorDiv, i++) {
      const pos = origin + u * scale;
      const k = Math.round(u / (major / minorDiv));
      const isMajor = k % minorDiv === 0;
      const len = isMajor ? 10 : 5;
      if (horizontal) {
        out.push(<line key={`t${k}`} x1={pos} x2={pos} y1={RULER - len} y2={RULER} class="ruler-tick" />);
        if (isMajor) out.push(<text key={`l${k}`} x={pos + 3} y={9} class="ruler-label">{fmt((u / major) * label)}</text>);
      } else {
        out.push(<line key={`t${k}`} y1={pos} y2={pos} x1={RULER - len} x2={RULER} class="ruler-tick" />);
        if (isMajor) out.push(<text key={`l${k}`} x={9} y={pos + 3} class="ruler-label" transform={`rotate(-90 9 ${pos + 3})`}>{fmt((u / major) * label)}</text>);
      }
    }
    return out;
  };

  // selection extent band
  let band = null;
  const items = ctl.state.selection.length ? ctl.boxesFor(ctl.state.selection) : [];
  if (items.length) band = unionBoxes(items.map((i) => i.box));

  const startGuide = (axis) => (e) => {
    if (ctl.state.readOnly || e.button !== 0) return;
    e.preventDefault();
    const stage = scrollRef.current.querySelector('.stage').getBoundingClientRect();
    const id = newId();
    const key = `guide-new:${id}`;
    const posOf = (ev) => Math.round(axis === 'x' ? (ev.clientX - stage.left) / scale : (ev.clientY - stage.top) / scale);
    let created = false;
    let last = null;
    const move = (ev) => {
      const pos = posOf(ev);
      last = pos;
      ctl.dispatch('Add guide', (d) => {
        d.authoring ||= { guides: [], grid: { spacing: 40 } };
        d.authoring.guides ||= [];
        const g = d.authoring.guides.find((x) => x.id === id);
        if (g) g.position = pos;
        else d.authoring.guides.push({ id, axis, position: pos });
      }, { coalesce: key, window: Infinity });
      created = true;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (created && last !== null && (last < -40 / scale || last > (axis === 'x' ? W : H) + 40 / scale)) {
        ctl.dispatch('Add guide', (d) => { d.authoring.guides = d.authoring.guides.filter((x) => x.id !== id); }, { coalesce: key, window: Infinity });
      }
      ctl.store?.breakCoalescing();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  void layoutTick;
  return (
    <>
      <div class="ruler-corner" aria-hidden="true" title={`Rulers in ${MEASURES[measure].label}`} />
      <div class="ruler ruler-h" onPointerDown={startGuide('y')} title="Drag down to add a horizontal guide" aria-hidden="true">
        <svg width={vw} height={RULER}>
          <rect class="ruler-slide" x={ox} y={0} width={W * scale} height={RULER} />
          {band && <rect class="ruler-band" x={ox + band.x * scale} y={0} width={Math.max(1, band.width * scale)} height={RULER} />}
          {ticks(ox, vw, true)}
        </svg>
      </div>
      <div class="ruler ruler-v" onPointerDown={startGuide('x')} title="Drag right to add a vertical guide" aria-hidden="true">
        <svg width={RULER} height={vh}>
          <rect class="ruler-slide" x={0} y={oy} width={RULER} height={H * scale} />
          {band && <rect class="ruler-band" x={0} y={oy + band.y * scale} width={RULER} height={Math.max(1, band.height * scale)} />}
          {ticks(oy, vh, false)}
        </svg>
      </div>
    </>
  );
}
