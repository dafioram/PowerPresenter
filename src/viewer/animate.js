// Build and transition animations (spec §5.14) with the Web Animations API.
// Uses the individual `translate` property so element rotation is preserved.
import { isEntrance, isExit } from '../core/builds.js';

export function prefersReducedMotion() {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function flyOffset(dir, W, H) {
  switch (dir) {
    case 'right': return `${W}px 0px`;
    case 'up': return `0px ${-H}px`;
    case 'down': return `0px ${H}px`;
    default: return `${-W}px 0px`;
  }
}

function targetsFor(root, b) {
  const el = root.querySelector(`.pe-layer-content [data-el-id="${b.element_id}"]`);
  if (!el) return [];
  if (b.paragraph !== null && b.paragraph !== undefined) return [...el.querySelectorAll(`[data-pgroup="${b.paragraph}"]`)];
  return [el];
}

function finish(anim) {
  return new Promise((resolve) => {
    if (!anim) return resolve();
    anim.onfinish = () => resolve();
    anim.oncancel = () => resolve();
  });
}

// Runs one sub-build. Returns a promise that resolves when done.
export async function runBuild(root, b, { W, H, reduced = prefersReducedMotion(), onPlay } = {}) {
  const targets = targetsFor(root, b);
  if (b.effect === 'play') {
    onPlay?.(b.element_id);
    return;
  }
  const duration = reduced ? 0 : b.duration_ms ?? 500;
  const anims = [];
  for (const t of targets) {
    if (isEntrance(b.effect)) {
      t.style.visibility = 'visible';
      delete t.dataset.buildHidden;
      if (duration === 0 || b.effect === 'appear') continue;
      if (b.effect === 'fade_in') anims.push(t.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-out' }));
      if (b.effect === 'fly_in') anims.push(t.animate([{ translate: flyOffset(b.direction, W, H), opacity: 0.2 }, { translate: '0px 0px', opacity: 1 }], { duration, easing: 'cubic-bezier(.2,.8,.2,1)' }));
    } else if (isExit(b.effect)) {
      if (duration === 0 || b.effect === 'disappear') {
        t.style.visibility = 'hidden';
        continue;
      }
      let a;
      if (b.effect === 'fade_out') a = t.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-in' });
      else a = t.animate([{ translate: '0px 0px', opacity: 1 }, { translate: flyOffset(b.direction, W, H), opacity: 0.2 }], { duration, easing: 'cubic-bezier(.6,0,.8,.2)' });
      anims.push(a);
      a.onfinish = () => {
        t.style.visibility = 'hidden';
      };
    }
  }
  await Promise.all(anims.map(finish));
}

// Runs a step's builds: with_previous starts with the previous build,
// after_previous starts when the previous build ends; delays apply after that.
export async function runStep(root, builds, opts) {
  let prevStart = Promise.resolve();
  let prevEnd = Promise.resolve();
  const all = [];
  for (const b of builds) {
    const gate = b.trigger === 'after_previous' ? prevEnd : prevStart;
    const delay = opts.reduced ? 0 : b.delay_ms || 0;
    let markStarted;
    const started = new Promise((r) => { markStarted = r; });
    const done = gate
      .then(() => (delay ? new Promise((r) => setTimeout(r, delay)) : null))
      .then(() => {
        markStarted();
        return runBuild(root, b, opts);
      });
    prevStart = started;
    prevEnd = done;
    all.push(done);
  }
  await Promise.all(all);
}

// Slide transitions (spec §5.14). `incoming` is already in place; `outgoing`
// is removed after the animation.
export async function runTransition(stage, incoming, outgoing, transition, { W, H, reduced = prefersReducedMotion() } = {}) {
  const kind = transition?.kind || 'none';
  const duration = transition?.duration_ms ?? 400;
  if (!outgoing || kind === 'none' || reduced || duration === 0) {
    outgoing?.remove();
    return;
  }
  const dir = transition.direction || 'left';
  let anims = [];
  if (kind === 'fade') {
    anims = [incoming.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-in-out' })];
  } else if (kind === 'push') {
    const d = { left: [-W, 0], right: [W, 0], up: [0, -H], down: [0, H] }[dir] || [-W, 0];
    anims = [
      outgoing.animate([{ translate: '0px 0px' }, { translate: `${d[0]}px ${d[1]}px` }], { duration, easing: 'ease-in-out' }),
      incoming.animate([{ translate: `${-d[0]}px ${-d[1]}px` }, { translate: '0px 0px' }], { duration, easing: 'ease-in-out' }),
    ];
  } else if (kind === 'wipe') {
    const from = { left: 'inset(0 0 0 100%)', right: 'inset(0 100% 0 0)', up: 'inset(100% 0 0 0)', down: 'inset(0 0 100% 0)' }[dir] || 'inset(0 0 0 100%)';
    anims = [incoming.animate([{ clipPath: from }, { clipPath: 'inset(0 0 0 0)' }], { duration, easing: 'ease-in-out' })];
  }
  await Promise.all(anims.map(finish));
  outgoing.remove();
}
