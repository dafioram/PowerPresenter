// Presentation viewer (spec §14): shared by presentation mode in the app and by
// exported standalone HTML. Vanilla DOM, no editor code.
import { renderSlide, layoutSlide } from '../render/renderer.js';
import { buildSteps, visibilityAt } from '../core/builds.js';
import { slideOrder } from '../core/model.js';
import { resolveSlideTitle } from '../core/titles.js';
import { runStep, runTransition, prefersReducedMotion } from './animate.js';
import { MediaController } from './media.js';
import { openPresenter } from './presenter.js';
import { fontsReady } from '../render/fonts.js';

const ICONS = {
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  overview: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  blank: 'M3 4h18v14H3z',
  captions: 'M3 5h18v14H3zM7 11a2 2 0 013-1.7M7 13a2 2 0 003 1.7M13 11a2 2 0 013-1.7M13 13a2 2 0 003 1.7',
  mute: 'M11 5L6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  volume: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14',
  presenter: 'M3 4h18v12H3zM8 20h8M7 8h6M7 11h4',
  fullscreen: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  laser: 'M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0M12 2v4M12 18v4M2 12h4M18 12h4',
  screen: 'M2 5h14v10H2zM18 9h4v10h-14v-2',
  exit: 'M6 6l12 12M18 6L6 18',
};

function svgIcon(dom, name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = dom.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = dom.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name]);
  svg.appendChild(p);
  return svg;
}

function el(dom, tag, cls, text) {
  const e = dom.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createViewer(host, opts) {
  const dom = opts.dom || host.ownerDocument || document;
  const win = dom.defaultView || window;
  const doc = opts.doc;
  const W = doc.size.width;
  const H = doc.size.height;
  const slideIds = opts.slideIds || slideOrder(doc);
  const playback = { ...doc.playback, ...(opts.playback || {}) };
  playback.auto_advance = { ...(doc.playback?.auto_advance || {}), ...(opts.playback?.auto_advance || {}) };
  const clickToAdvance = playback.click_to_advance !== false;
  const reduced = prefersReducedMotion();
  const listeners = new Set();
  const media = new MediaController({ getCaptionsText: opts.getCaptionsText || (async () => null), dom });

  const state = { index: 0, step: 0, ended: false, blank: null, overview: false, laser: false, destroyed: false };
  let current = null; // { root, wrap, slide }
  let busy = Promise.resolve();
  let timer = null;
  let digits = '';
  let digitsTimer = null;
  let hideTimer = null;
  let presenter = null;
  let leavingFullscreenViaF = false;
  let startOverlay = null;

  // ---------- DOM ----------
  host.classList.add('pv');
  host.tabIndex = 0;
  host.setAttribute('aria-roledescription', 'presentation');
  host.setAttribute('aria-label', doc.metadata.title);
  const main = el(dom, 'main', 'pv-main');
  const h1 = el(dom, 'h1', 'pe-sr-only', doc.metadata.title);
  const stage = el(dom, 'div', 'pv-stage');
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  main.append(h1, stage);
  const blankEl = el(dom, 'div', 'pv-blank');
  const endEl = el(dom, 'div', 'pv-end');
  endEl.append(el(dom, 'p', 'pv-end-title', 'End of presentation'), el(dom, 'p', 'pv-end-hint', opts.mode === 'app' ? 'Press Esc or click to exit.' : 'Press Home to start again.'));
  const laser = el(dom, 'div', 'pv-laser');
  laser.setAttribute('aria-hidden', 'true');
  const gotoEl = el(dom, 'div', 'pv-goto');
  gotoEl.setAttribute('aria-live', 'polite');
  const live = el(dom, 'div', 'pe-sr-only');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  const overview = el(dom, 'div', 'pv-overview');
  overview.setAttribute('role', 'dialog');
  overview.setAttribute('aria-label', 'All slides');
  const controls = el(dom, 'div', 'pv-controls');
  controls.setAttribute('role', 'toolbar');
  controls.setAttribute('aria-label', 'Presentation controls');
  host.replaceChildren(main, blankEl, endEl, laser, gotoEl, overview, controls, live);

  const btn = (name, label, fn, extraCls = '') => {
    const b = el(dom, 'button', `pv-btn ${extraCls}`);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.appendChild(svgIcon(dom, name));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
      host.focus({ preventScroll: true });
    });
    return b;
  };
  const counter = el(dom, 'span', 'pv-counter');
  const bPrev = btn('prev', 'Previous', () => prev());
  const bNext = btn('next', 'Next', () => next());
  const bOverview = btn('overview', 'All slides (G)', () => toggleOverview());
  const bBlank = btn('blank', 'Black screen (B)', () => toggleBlank('black'));
  const bCaptions = btn('captions', 'Captions', () => {
    media.setCaptions(!media.captionsOn);
    bCaptions.setAttribute('aria-pressed', String(media.captionsOn));
  });
  bCaptions.setAttribute('aria-pressed', 'true');
  const bMute = btn('volume', 'Mute all videos', () => {
    media.setMuted(!media.muted);
    bMute.replaceChildren(svgIcon(dom, media.muted ? 'mute' : 'volume'));
    bMute.setAttribute('aria-label', media.muted ? 'Unmute videos' : 'Mute all videos');
  });
  const bLaser = btn('laser', 'Laser pointer (L)', () => toggleLaser());
  const bPresenter = btn('presenter', 'Presenter view (S)', () => showPresenter());
  const bScreen = btn('screen', 'Show audience view on…', () => chooseScreen());
  const bFull = btn('fullscreen', 'Fullscreen (F)', () => toggleFullscreen());
  const bExit = btn('exit', opts.mode === 'app' ? 'Exit (Esc)' : 'Exit fullscreen', () => exit());
  controls.append(bPrev, counter, bNext, bOverview, bBlank, bCaptions, bMute, bLaser);
  if (opts.presenter !== false) controls.append(bPresenter);
  if ('getScreenDetails' in win) controls.append(bScreen);
  controls.append(bFull);
  if (opts.mode === 'app') controls.append(bExit);

  // ---------- layout ----------
  function fit() {
    const r = host.getBoundingClientRect();
    const s = Math.min(r.width / W, r.height / H) || 1;
    const x = (r.width - W * s) / 2;
    const y = (r.height - H * s) / 2;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    state.scale = s;
    state.offset = { x, y };
  }
  const ro = new win.ResizeObserver(fit);
  ro.observe(host);

  // ---------- helpers ----------
  const slideAt = (i) => doc.slides[slideIds[i]];
  const numberOf = (id) => {
    const i = slideIds.indexOf(id);
    return i >= 0 ? i + 1 : null;
  };
  const stepsOf = (slide) => buildSteps(slide);
  const emit = () => {
    for (const fn of listeners) fn(api.getState());
  };
  function nextVisible(from) {
    for (let i = from + 1; i < slideIds.length; i++) if (!slideAt(i).hidden) return i;
    return -1;
  }
  function prevVisible(from) {
    for (let i = from - 1; i >= 0; i--) if (!slideAt(i).hidden) return i;
    return -1;
  }
  function firstVisible() {
    const i = nextVisible(-1);
    return i < 0 ? 0 : i;
  }

  function announce(text) {
    live.textContent = '';
    win.setTimeout(() => { live.textContent = text; }, 40);
  }

  function updateCounter() {
    counter.textContent = state.ended ? 'End' : `${state.index + 1} / ${slideIds.length}`;
    const hasVideo = !!current?.root.querySelector('video');
    bMute.hidden = !hasVideo;
    bCaptions.hidden = !media.hasCaptions();
  }

  function setHash() {
    if (opts.deepLinks === false) return;
    try {
      const url = new URL(win.location.href);
      url.hash = `slide-${state.index + 1}`;
      win.history.replaceState(win.history.state, '', url);
    } catch {
      /* ignore (e.g. sandboxed) */
    }
  }

  // ---------- rendering ----------
  async function render(index, step, { transition = false, runAuto = false } = {}) {
    const slide = slideAt(index);
    const { steps } = stepsOf(slide);
    const visibility = visibilityAt(slide, step, { includeAuto: !runAuto });
    const root = renderSlide(doc, slide, {
      dom,
      mode: 'view',
      a11y: true,
      interactiveLinks: true,
      assetUrl: opts.assetUrl,
      assetInfo: opts.assetInfo,
      visibility,
      slideNumberOf: numberOf,
      slideTotal: slideIds.length,
      preloadMedia: true,
    });
    const wrap = el(dom, 'div', 'pv-slide');
    wrap.appendChild(root);
    const old = current?.wrap;
    media.detach();
    stage.appendChild(wrap);
    current = { root, wrap, slide };
    state.index = index;
    state.step = step;
    state.ended = false;
    endEl.classList.remove('is-on');
    await fontsReady(dom);
    layoutSlide(root, doc, slide);
    if (old) {
      if (transition) await runTransition(stage, wrap, old, slide.transition || playback.default_transition, { W, H, reduced });
      else old.remove();
    }
    const visibleIds = new Set();
    for (const e of slide.elements) {
      const v = visibility.get(e.id);
      if (!v || !v.hidden) visibleIds.add(e.id);
    }
    media.attach(root, { visibleIds });
    updateCounter();
    setHash();
    const title = resolveSlideTitle(slide);
    announce(`Slide ${index + 1} of ${slideIds.length}${title ? `: ${title}` : ''}`);
    emit();
    if (runAuto && steps[0].length) await runStep(root, steps[0], { W, H, reduced, onPlay: (id) => media.play(id) });
    scheduleAuto();
  }

  function queue(fn) {
    busy = busy.then(fn).catch((e) => console.error(e));
    return busy;
  }

  async function goNext() {
    if (state.ended) {
      if (playback.auto_advance.loop) return render(firstVisible(), 0, { transition: true, runAuto: true });
      if (opts.mode === 'app') exit();
      return undefined;
    }
    const slide = slideAt(state.index);
    const { steps } = stepsOf(slide);
    if (state.step < steps.length - 1) {
      state.step += 1;
      emit();
      await runStep(current.root, steps[state.step], { W, H, reduced, onPlay: (id) => media.play(id) });
      scheduleAuto();
      return undefined;
    }
    const n = nextVisible(state.index);
    if (n < 0) {
      if (playback.auto_advance.enabled && playback.auto_advance.loop) return render(firstVisible(), 0, { transition: true, runAuto: true });
      showEnd();
      return undefined;
    }
    return render(n, 0, { transition: true, runAuto: true });
  }

  async function goPrev() {
    if (state.ended) {
      state.ended = false;
      endEl.classList.remove('is-on');
      updateCounter();
      emit();
      return undefined;
    }
    if (state.step > 0) {
      // back one step, instantly
      for (const b of stepsOf(current.slide).steps[state.step]) if (b.effect === 'play') media.stop(b.element_id);
      return render(state.index, state.step - 1, { transition: false });
    }
    const p = prevVisible(state.index);
    if (p < 0) return undefined;
    const last = stepsOf(slideAt(p)).steps.length - 1;
    return render(p, last, { transition: false });
  }

  function showEnd() {
    state.ended = true;
    media.detach();
    endEl.classList.add('is-on');
    announce('End of presentation');
    updateCounter();
    emit();
  }

  // ---------- auto-advance / kiosk (spec §14.5) ----------
  function scheduleAuto() {
    clearTimeout(timer);
    if (!playback.auto_advance.enabled || state.ended || state.blank || state.overview) return;
    const slide = slideAt(state.index);
    const total = slide.advance_after_ms || playback.auto_advance.default_duration_ms || 5000;
    const clicks = stepsOf(slide).steps.length - 1;
    const interval = total / (clicks + 1);
    timer = win.setTimeout(() => api.next(), interval);
  }

  // ---------- public navigation ----------
  function next() {
    hideGoto();
    return queue(goNext);
  }
  function prev() {
    hideGoto();
    return queue(goPrev);
  }
  function goto(index) {
    if (index < 0 || index >= slideIds.length) return busy;
    return queue(() => render(index, 0, { transition: true, runAuto: true }));
  }
  function gotoSlideId(id) {
    const i = slideIds.indexOf(id);
    if (i >= 0) goto(i);
  }

  function toggleBlank(kind) {
    state.blank = state.blank === kind ? null : kind;
    blankEl.className = `pv-blank ${state.blank ? `is-on is-${state.blank}` : ''}`;
    if (state.blank) clearTimeout(timer);
    else scheduleAuto();
    emit();
  }

  function toggleLaser(on = !state.laser) {
    state.laser = on;
    host.classList.toggle('is-laser', on);
    laser.classList.toggle('is-on', false);
    bLaser.setAttribute('aria-pressed', String(on));
    emit();
  }

  function setLaserPoint(pt) {
    if (!pt) {
      laser.classList.remove('is-on');
      return;
    }
    const s = state.scale || 1;
    laser.style.left = `${state.offset.x + pt.x * s}px`;
    laser.style.top = `${state.offset.y + pt.y * s}px`;
    laser.classList.add('is-on');
  }

  function toggleOverview() {
    state.overview = !state.overview;
    overview.classList.toggle('is-on', state.overview);
    if (state.overview) {
      clearTimeout(timer);
      buildOverview();
    } else {
      overview.replaceChildren();
      host.focus({ preventScroll: true });
      scheduleAuto();
    }
    emit();
  }

  function buildOverview() {
    const grid = el(dom, 'div', 'pv-overview-grid');
    const thumbW = 240;
    const s = thumbW / W;
    slideIds.forEach((id, i) => {
      const slide = doc.slides[id];
      const b = el(dom, 'button', `pv-ov-item ${i === state.index ? 'is-current' : ''} ${slide.hidden ? 'is-hidden' : ''}`);
      b.type = 'button';
      const title = resolveSlideTitle(slide);
      b.setAttribute('aria-label', `Slide ${i + 1}${title ? `: ${title}` : ''}${slide.hidden ? ' (hidden)' : ''}`);
      const box = el(dom, 'div', 'pv-ov-thumb');
      box.style.width = `${thumbW}px`;
      box.style.height = `${H * s}px`;
      const root = renderSlide(doc, slide, { dom, mode: 'thumbnail', assetUrl: opts.assetUrl, assetInfo: opts.assetInfo, slideNumberOf: numberOf });
      root.style.transform = `scale(${s})`;
      root.style.transformOrigin = '0 0';
      box.appendChild(root);
      b.append(box, el(dom, 'span', 'pv-ov-label', `${i + 1}${title ? ` · ${title}` : ''}`));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleOverview();
        goto(i);
      });
      grid.appendChild(b);
    });
    overview.replaceChildren(grid);
    win.setTimeout(() => grid.querySelector('.is-current')?.focus(), 0);
  }

  function hideGoto() {
    digits = '';
    gotoEl.classList.remove('is-on');
  }

  async function toggleFullscreen() {
    try {
      if (dom.fullscreenElement) {
        leavingFullscreenViaF = true;
        await dom.exitFullscreen();
      } else await host.requestFullscreen();
    } catch {
      /* not allowed */
    }
  }

  async function chooseScreen() {
    try {
      const details = await win.getScreenDetails();
      const others = details.screens.filter((s) => s !== details.currentScreen);
      const screen = others[0] || details.screens[0];
      await host.requestFullscreen({ screen });
    } catch {
      /* permission denied */
    }
  }

  function showPresenter() {
    if (opts.presenter === false) return;
    if (presenter && !presenter.closed()) {
      presenter.focus();
      return;
    }
    presenter = openPresenter(api, { dom, doc, slideIds, assetUrl: opts.assetUrl, assetInfo: opts.assetInfo, notes: opts.notes !== false, registerFonts: opts.registerFonts, styleSource: opts.styleSource || dom });
    if (presenter?.blocked) {
      opts.onPopupBlocked?.();
      presenter = null;
    }
  }

  function exit() {
    if (opts.mode !== 'app') {
      if (dom.fullscreenElement) dom.exitFullscreen().catch(() => undefined);
      return;
    }
    api.destroy();
    opts.onExit?.(slideIds[state.index]);
  }

  // ---------- input ----------
  function onKey(e) {
    if (state.destroyed) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if (e.key === 'F5') e.preventDefault();
      return;
    }
    const k = e.key;
    let handled = true;
    if (/^[0-9]$/.test(k)) {
      digits += k;
      gotoEl.textContent = `Go to slide ${digits}`;
      gotoEl.classList.add('is-on');
      clearTimeout(digitsTimer);
      digitsTimer = win.setTimeout(hideGoto, 2500);
    } else if (k === 'Enter' && digits) {
      const n = Number(digits);
      hideGoto();
      goto(n - 1);
    } else if (k === 'Escape') {
      if (digits) hideGoto();
      else if (state.overview) toggleOverview();
      else if (state.blank) toggleBlank(state.blank);
      else if (opts.mode === 'app') exit();
      else handled = false;
    } else if (state.overview) {
      if (k === 'g' || k === 'G') toggleOverview();
      else handled = false;
    } else if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter', 'n', 'N'].includes(k)) {
      if (state.blank) toggleBlank(state.blank);
      else next();
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) {
      if (state.blank) toggleBlank(state.blank);
      else prev();
    } else if (k === 'Home') goto(firstVisible());
    else if (k === 'End') {
      let last = slideIds.length - 1;
      while (last > 0 && slideAt(last).hidden) last--;
      goto(last);
    } else if (k === 'b' || k === 'B' || k === '.') toggleBlank('black');
    else if (k === 'w' || k === 'W' || k === ',') toggleBlank('white');
    else if (k === 'g' || k === 'G') toggleOverview();
    else if (k === 'f' || k === 'F') toggleFullscreen();
    else if (k === 's' || k === 'S') showPresenter();
    else if (k === 'l' || k === 'L') toggleLaser();
    else if (k === 'F5') {
      // clickers sometimes send F5: don't reload the page
      e.preventDefault();
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      poke();
    }
  }

  function isInteractive(target) {
    return !!target.closest('a, button, video, .pv-controls, [data-link-url], [data-link-slide], [data-link-nav], .pv-overview');
  }

  function onClick(e) {
    if (state.destroyed || state.overview) return;
    const link = e.target.closest('[data-link-slide], [data-link-nav], [data-link-url], a[href]');
    if (link && stage.contains(link)) {
      e.preventDefault();
      e.stopPropagation();
      if (link.dataset.linkSlide) gotoSlideId(link.dataset.linkSlide);
      else if (link.dataset.linkNav) {
        const t = link.dataset.linkNav;
        if (t === 'next') next();
        else if (t === 'previous') prev();
        else if (t === 'first') goto(firstVisible());
        else if (t === 'last') goto(slideIds.length - 1);
      } else {
        const href = link.dataset.linkUrl || link.getAttribute('href');
        if (href) win.open(href, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    if (e.pointerType === 'touch') return;
    if (isInteractive(e.target)) return;
    if (state.blank) {
      toggleBlank(state.blank);
      return;
    }
    if (state.ended && opts.mode === 'app') {
      exit();
      return;
    }
    if (clickToAdvance) next();
  }

  let touchStart = null;
  function onPointerDown(e) {
    if (e.pointerType === 'touch') touchStart = { x: e.clientX, y: e.clientY, t: Date.now() };
  }
  function onPointerUp(e) {
    if (e.pointerType !== 'touch' || !touchStart) return;
    const dx = e.clientX - touchStart.x;
    const dy = e.clientY - touchStart.y;
    touchStart = null;
    if (isInteractive(e.target)) return;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next();
      else prev();
      return;
    }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const r = host.getBoundingClientRect();
      if (e.clientX - r.left > r.width / 3) next();
      else prev();
    }
  }

  function onPointerMove(e) {
    poke();
    if (state.laser) {
      const r = host.getBoundingClientRect();
      const s = state.scale || 1;
      setLaserPoint({ x: (e.clientX - r.left - state.offset.x) / s, y: (e.clientY - r.top - state.offset.y) / s });
      presenter?.laserFromAudience?.();
    }
  }

  function poke() {
    host.classList.remove('is-idle');
    clearTimeout(hideTimer);
    hideTimer = win.setTimeout(() => {
      if (!controls.contains(dom.activeElement)) host.classList.add('is-idle');
    }, 3000);
  }

  function onFullscreenChange() {
    if (!dom.fullscreenElement && opts.mode === 'app' && !leavingFullscreenViaF && state.wasFullscreen) {
      // Esc left fullscreen: treat as exiting the presentation (spec §14.3)
      exit();
    }
    state.wasFullscreen = !!dom.fullscreenElement;
    leavingFullscreenViaF = false;
  }

  dom.addEventListener('keydown', onKey, true);
  host.addEventListener('click', onClick);
  host.addEventListener('pointerdown', onPointerDown);
  host.addEventListener('pointerup', onPointerUp);
  host.addEventListener('pointermove', onPointerMove);
  controls.addEventListener('focusin', () => host.classList.remove('is-idle'));
  dom.addEventListener('fullscreenchange', onFullscreenChange);

  const api = {
    next,
    prev,
    goto,
    gotoSlideId,
    toggleBlank,
    toggleLaser,
    setLaserPoint,
    toggleOverview,
    showPresenter,
    exit,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getState() {
      const slide = slideAt(state.index);
      const { steps } = stepsOf(slide);
      return { index: state.index, step: state.step, steps: steps.length - 1, ended: state.ended, blank: state.blank, total: slideIds.length, slideId: slideIds[state.index], laser: state.laser };
    },
    async start(index = firstVisible(), { fullscreen = true, overlay = false } = {}) {
      fit();
      host.focus({ preventScroll: true });
      if (fullscreen && host.requestFullscreen) {
        try {
          await host.requestFullscreen();
          state.wasFullscreen = true;
        } catch {
          /* stays full-window */
        }
      }
      if (overlay) {
        startOverlay = el(dom, 'div', 'pv-start');
        const b = el(dom, 'button', 'pv-start-btn', 'Start presentation');
        b.type = 'button';
        startOverlay.appendChild(b);
        host.appendChild(startOverlay);
        b.focus();
        await new Promise((resolve) => b.addEventListener('click', (e) => { e.stopPropagation(); resolve(); }, { once: true }));
        startOverlay.remove();
        host.focus({ preventScroll: true });
      }
      await queue(() => render(index, 0, { transition: false, runAuto: true }));
      poke();
    },
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      clearTimeout(timer);
      clearTimeout(hideTimer);
      media.detach();
      ro.disconnect();
      dom.removeEventListener('keydown', onKey, true);
      dom.removeEventListener('fullscreenchange', onFullscreenChange);
      if (dom.fullscreenElement) dom.exitFullscreen().catch(() => undefined);
      presenter?.close();
      host.replaceChildren();
      host.classList.remove('pv', 'is-idle', 'is-laser');
    },
    firstVisible,
    slideIds,
    doc,
    get media() {
      return media;
    },
    stageSize: { W, H },
  };
  return api;
}

// Parses "#slide-<n>" (1-based) into an index, or -1.
export function slideIndexFromHash(hash) {
  const m = /^#slide-(\d+)$/.exec(hash || '');
  return m ? Number(m[1]) - 1 : -1;
}

// Whether the first slide autoplays a video with sound (needs a start overlay).
export function needsStartOverlay(doc, slide) {
  if (!slide) return false;
  return slide.elements.some((e) => e.type === 'video' && e.video.start === 'auto' && !e.video.muted);
}
