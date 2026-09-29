// Presenter view (spec §14.4): a second window with the current and next slide,
// notes, a timer and clock. The viewer creates and controls the window itself,
// which also works when exported HTML is opened from a local file.
import { renderSlide, layoutSlide } from '../render/renderer.js';
import { visibilityAt, buildSteps } from '../core/builds.js';
import { resolveSlideTitle } from '../core/titles.js';
import { isRun, isBreak } from '../core/text.js';

function el(d, tag, cls, text) {
  const e = d.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderNotes(d, body) {
  const frag = d.createDocumentFragment();
  if (!body?.paragraphs?.some((p) => p.inlines.length)) {
    frag.appendChild(el(d, 'p', 'pp-notes-empty', 'No speaker notes for this slide.'));
    return frag;
  }
  let list = null;
  for (const p of body.paragraphs) {
    const target = p.list ? el(d, 'li') : el(d, 'p');
    for (const i of p.inlines) {
      if (isBreak(i)) {
        target.appendChild(el(d, 'br'));
        continue;
      }
      if (!isRun(i)) continue;
      let node = d.createTextNode(i.text);
      const m = i.marks || {};
      if (m.weight >= 600) { const b = el(d, 'strong'); b.appendChild(node); node = b; }
      if (m.italic) { const x = el(d, 'em'); x.appendChild(node); node = x; }
      if (m.underline) { const x = el(d, 'u'); x.appendChild(node); node = x; }
      if (m.strike) { const x = el(d, 's'); x.appendChild(node); node = x; }
      if (m.link?.kind === 'url') {
        const a = el(d, 'a');
        a.href = m.link.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.appendChild(node);
        node = a;
      }
      target.appendChild(node);
    }
    if (p.list) {
      if (!list || list.tagName.toLowerCase() !== (p.list.kind === 'number' ? 'ol' : 'ul')) {
        list = el(d, p.list.kind === 'number' ? 'ol' : 'ul');
        frag.appendChild(list);
      }
      target.style.marginLeft = `${(p.list.level || 0) * 18}px`;
      list.appendChild(target);
    } else {
      list = null;
      frag.appendChild(target);
    }
  }
  return frag;
}

export function openPresenter(viewer, { dom, doc, slideIds, assetUrl, assetInfo, notes = true, registerFonts, styleSource }) {
  const win = dom.defaultView.open('', `pe-presenter-${doc.id}`, 'popup=yes,width=1200,height=760');
  if (!win) return { blocked: true };
  const d = win.document;
  d.title = `Presenter view — ${doc.metadata.title}`;
  d.documentElement.lang = doc.metadata.language || 'en';
  // Copy stylesheets from the opener (same origin; same hashes in exported HTML).
  for (const node of styleSource.querySelectorAll('link[rel="stylesheet"], style')) {
    if (node.tagName === 'LINK') {
      const l = d.createElement('link');
      l.rel = 'stylesheet';
      l.href = node.href;
      d.head.appendChild(l);
    } else {
      const s = d.createElement('style');
      s.textContent = node.textContent;
      d.head.appendChild(s);
    }
  }
  registerFonts?.(d);
  d.body.className = 'pp-body';
  d.body.replaceChildren();
  const W = doc.size.width;
  const H = doc.size.height;

  const root = el(d, 'div', 'pp');
  const left = el(d, 'section', 'pp-current');
  left.setAttribute('aria-label', 'Current slide');
  const cur = el(d, 'div', 'pp-slide-box');
  const curLabel = el(d, 'div', 'pp-label', 'Current');
  left.append(curLabel, cur);
  const right = el(d, 'section', 'pp-side');
  const nextLabel = el(d, 'div', 'pp-label', 'Next');
  const nxt = el(d, 'div', 'pp-slide-box is-next');
  const notesHead = el(d, 'div', 'pp-notes-head');
  const notesTitle = el(d, 'span', 'pp-label', 'Notes');
  const smaller = el(d, 'button', 'pp-btn', 'A−');
  const bigger = el(d, 'button', 'pp-btn', 'A+');
  smaller.setAttribute('aria-label', 'Smaller notes text');
  bigger.setAttribute('aria-label', 'Larger notes text');
  notesHead.append(notesTitle, smaller, bigger);
  const notesEl = el(d, 'div', 'pp-notes');
  notesEl.tabIndex = 0;
  right.append(nextLabel, nxt, notesHead, notesEl);
  const bar = el(d, 'div', 'pp-bar');
  const time = el(d, 'span', 'pp-timer', '00:00');
  const pause = el(d, 'button', 'pp-btn', 'Pause');
  const reset = el(d, 'button', 'pp-btn', 'Reset');
  const clock = el(d, 'span', 'pp-clock');
  const counter = el(d, 'span', 'pp-counter');
  const prevB = el(d, 'button', 'pp-btn', '◀ Previous');
  const nextB = el(d, 'button', 'pp-btn is-primary', 'Next ▶');
  const blackB = el(d, 'button', 'pp-btn', 'Black');
  const whiteB = el(d, 'button', 'pp-btn', 'White');
  const jump = el(d, 'select', 'pp-jump');
  jump.setAttribute('aria-label', 'Jump to slide');
  slideIds.forEach((id, i) => {
    const o = el(d, 'option', null, `${i + 1}. ${resolveSlideTitle(doc.slides[id]) || 'Untitled'}${doc.slides[id].hidden ? ' (hidden)' : ''}`);
    o.value = String(i);
    jump.appendChild(o);
  });
  bar.append(time, pause, reset, clock, el(d, 'span', 'pp-spacer'), counter, jump, prevB, nextB, blackB, whiteB);
  root.append(left, right, bar);
  d.body.appendChild(root);
  if (!notes) {
    notesHead.hidden = true;
    notesEl.hidden = true;
  }

  let fontSize = 20;
  const applyFont = () => { notesEl.style.fontSize = `${fontSize}px`; };
  applyFont();
  smaller.onclick = () => { fontSize = Math.max(12, fontSize - 2); applyFont(); };
  bigger.onclick = () => { fontSize = Math.min(48, fontSize + 2); applyFont(); };

  // timer
  let elapsed = 0;
  let running = true;
  let last = Date.now();
  const tick = () => {
    const now = Date.now();
    if (running) elapsed += now - last;
    last = now;
    const s = Math.floor(elapsed / 1000);
    time.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  const interval = win.setInterval(tick, 500);
  tick();
  pause.onclick = () => {
    running = !running;
    pause.textContent = running ? 'Pause' : 'Resume';
  };
  reset.onclick = () => { elapsed = 0; tick(); };
  prevB.onclick = () => viewer.prev();
  nextB.onclick = () => viewer.next();
  blackB.onclick = () => viewer.toggleBlank('black');
  whiteB.onclick = () => viewer.toggleBlank('white');
  jump.onchange = () => viewer.goto(Number(jump.value));

  const renderInto = (box, slideId, step, final) => {
    box.replaceChildren();
    if (!slideId) {
      box.appendChild(el(d, 'div', 'pp-end', 'End of presentation'));
      return null;
    }
    const slide = doc.slides[slideId];
    const r = box.getBoundingClientRect();
    const s = Math.min((r.width || 600) / W, (r.height || 340) / H);
    const holder = el(d, 'div', 'pp-holder');
    holder.style.width = `${W * s}px`;
    holder.style.height = `${H * s}px`;
    const node = renderSlide(doc, slide, { dom: d, mode: 'thumbnail', assetUrl, assetInfo, visibility: final ? undefined : visibilityAt(slide, step) });
    node.style.transform = `scale(${s})`;
    node.style.transformOrigin = '0 0';
    holder.appendChild(node);
    box.appendChild(holder);
    try {
      layoutSlide(node, doc, slide);
    } catch {
      /* ignore */
    }
    return { holder, scale: s };
  };

  let curInfo = null;
  const update = (st) => {
    const slideId = st.ended ? null : st.slideId;
    curInfo = renderInto(cur, slideId, st.step, false);
    // next: next step of this slide, or the next visible slide
    let nextId = null;
    let nextStep = 0;
    let nextFinal = false;
    if (!st.ended) {
      if (st.step < st.steps) {
        nextId = st.slideId;
        nextStep = st.step + 1;
      } else {
        for (let i = st.index + 1; i < slideIds.length; i++) {
          if (!doc.slides[slideIds[i]].hidden) {
            nextId = slideIds[i];
            nextStep = 0;
            break;
          }
        }
      }
    }
    renderInto(nxt, nextId, nextStep, nextFinal);
    nextLabel.textContent = nextId === st.slideId && nextId ? `Next (step ${nextStep} of ${st.steps})` : 'Next';
    counter.textContent = st.ended ? 'End' : `Slide ${st.index + 1} of ${st.total}`;
    jump.value = String(st.index);
    notesEl.replaceChildren(renderNotes(d, st.ended ? null : doc.slides[st.slideId].notes));
    blackB.setAttribute('aria-pressed', String(st.blank === 'black'));
    whiteB.setAttribute('aria-pressed', String(st.blank === 'white'));
  };
  const unsub = viewer.subscribe(update);
  win.setTimeout(() => update(viewer.getState()), 50);
  win.addEventListener('resize', () => update(viewer.getState()));

  // laser pointer: pointing over the current slide shows it to the audience
  cur.addEventListener('pointermove', (e) => {
    if (!curInfo) return;
    const r = curInfo.holder.getBoundingClientRect();
    const x = (e.clientX - r.left) / curInfo.scale;
    const y = (e.clientY - r.top) / curInfo.scale;
    if (x < 0 || y < 0 || x > W || y > H) viewer.setLaserPoint(null);
    else viewer.setLaserPoint({ x, y });
  });
  cur.addEventListener('pointerleave', () => viewer.setLaserPoint(null));

  // navigation keys work in both windows
  d.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('select, input')) return;
    const k = e.key;
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'n', 'N'].includes(k)) viewer.next();
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) viewer.prev();
    else if (k === 'Home') viewer.goto(viewer.firstVisible());
    else if (k === 'b' || k === 'B' || k === '.') viewer.toggleBlank('black');
    else if (k === 'w' || k === 'W' || k === ',') viewer.toggleBlank('white');
    else return;
    e.preventDefault();
  });

  const close = () => {
    unsub();
    win.clearInterval(interval);
    try {
      win.close();
    } catch {
      /* ignore */
    }
  };
  win.addEventListener('pagehide', () => {
    unsub();
    win.clearInterval(interval);
  });
  return {
    close,
    closed: () => win.closed,
    focus: () => win.focus(),
    laserFromAudience() {},
    stepsFor: (id) => buildSteps(doc.slides[id]),
  };
}
