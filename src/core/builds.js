// Transitions and builds (spec §5.14).
export const ENTRANCE = new Set(['appear', 'fade_in', 'fly_in']);
export const EXIT = new Set(['disappear', 'fade_out', 'fly_out']);
export const BUILD_EFFECTS = ['appear', 'fade_in', 'fly_in', 'disappear', 'fade_out', 'fly_out', 'play'];
export const EFFECT_LABELS = {
  appear: 'Appear',
  fade_in: 'Fade in',
  fly_in: 'Fly in',
  disappear: 'Disappear',
  fade_out: 'Fade out',
  fly_out: 'Fly out',
  play: 'Play video',
};
export const TRANSITIONS = ['none', 'fade', 'push', 'wipe'];

function topLevelParagraphGroups(el) {
  const body = el.text?.body || el.shape?.text?.body;
  if (!body) return 1;
  let n = 0;
  for (const p of body.paragraphs) if (!p.list || (p.list.level || 0) === 0) n++;
  return Math.max(1, n);
}

// Expands builds into sub-builds (paragraph builds become one sub-build per
// top-level paragraph) and groups them into steps.
// Returns { steps: [[subBuild]], autoCount } where steps[0] are the builds that
// run automatically when the slide is entered.
export function buildSteps(slide) {
  const byId = new Map((slide.elements || []).map((e) => [e.id, e]));
  const subs = [];
  for (const b of slide.builds || []) {
    const el = byId.get(b.element_id);
    if (!el || el.hidden) continue;
    if (b.by === 'paragraph' && b.effect !== 'play') {
      const n = topLevelParagraphGroups(el);
      for (let p = 0; p < n; p++) subs.push({ ...b, paragraph: p, trigger: b.trigger });
    } else subs.push({ ...b, paragraph: null });
  }
  const steps = [[]];
  for (const s of subs) {
    if (s.trigger === 'on_click') steps.push([s]);
    else steps[steps.length - 1].push(s);
  }
  return { steps, clickSteps: steps.length - 1 };
}

export function clickStepCount(slide) {
  return buildSteps(slide).clickSteps;
}

// Visibility after `step` click-steps have run (step 0 includes automatic builds
// when `includeAuto`). Returns Map elementId → { hidden: bool, paragraphs: Set|null }.
// Elements with an entrance build start hidden; exits hide after running.
export function visibilityAt(slide, step, { includeAuto = true } = {}) {
  const { steps } = buildSteps(slide);
  const state = new Map();
  for (const b of slide.builds || []) {
    if (!ENTRANCE.has(b.effect)) continue;
    if (b.by === 'paragraph') state.set(b.element_id, { hidden: false, paragraphsShown: new Set(), paragraphMode: true });
    else state.set(b.element_id, { hidden: true });
  }
  const upto = Math.min(step, steps.length - 1);
  for (let i = 0; i <= upto; i++) {
    if (i === 0 && !includeAuto) continue;
    for (const s of steps[i]) applyBuild(state, s);
  }
  return state;
}

function applyBuild(state, s) {
  const cur = state.get(s.element_id) || { hidden: false };
  if (ENTRANCE.has(s.effect)) {
    if (s.paragraph !== null && s.paragraph !== undefined) {
      const set = cur.paragraphsShown || new Set();
      set.add(s.paragraph);
      state.set(s.element_id, { ...cur, hidden: false, paragraphsShown: set, paragraphMode: true });
    } else state.set(s.element_id, { ...cur, hidden: false, paragraphMode: false });
  } else if (EXIT.has(s.effect)) {
    if (s.paragraph !== null && s.paragraph !== undefined) {
      const hiddenP = cur.paragraphsHidden || new Set();
      hiddenP.add(s.paragraph);
      state.set(s.element_id, { ...cur, paragraphsHidden: hiddenP });
    } else state.set(s.element_id, { ...cur, hidden: true });
  }
}

// Final state: after every step has run (spec §5.14).
export function finalVisibility(slide) {
  return visibilityAt(slide, Infinity);
}

export function isEntrance(effect) {
  return ENTRANCE.has(effect);
}

export function isExit(effect) {
  return EXIT.has(effect);
}
