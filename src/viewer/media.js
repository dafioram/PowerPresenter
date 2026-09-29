// Video playback in the viewer (spec §13.8): trim, loop, controls, captions
// rendered by the viewer itself (works from file://), stop on leave.
import { parseVtt, cueNodes } from '../io/webvtt.js';

export class MediaController {
  constructor({ getCaptionsText, dom = document }) {
    this.getCaptionsText = getCaptionsText;
    this.dom = dom;
    this.muted = false;
    this.captionsOn = true;
    this.active = [];
    this.cueCache = new Map();
  }

  // Wires up all videos on a freshly rendered slide root.
  attach(root, { visibleIds }) {
    this.detach();
    const videos = [...root.querySelectorAll('video.pe-video')];
    for (const v of videos) {
      const wrap = v.closest('[data-el-id]');
      const id = wrap?.dataset.elId;
      const start = Number(v.dataset.trimStart || 0) / 1000;
      const end = v.dataset.trimEnd ? Number(v.dataset.trimEnd) / 1000 : null;
      const rec = { v, id, start, end, wrap, overlay: null, cues: null };
      v.muted = v.muted || this.muted;
      const onMeta = () => {
        try {
          if (v.currentTime < start) v.currentTime = start;
        } catch {
          /* not seekable yet */
        }
      };
      v.addEventListener('loadedmetadata', onMeta);
      v.addEventListener('timeupdate', () => {
        if (end !== null && v.currentTime >= end) {
          if (v.loop) v.currentTime = start;
          else v.pause();
        }
        this.updateCaptions(rec);
      });
      if (v.dataset.controls === 'auto') {
        const show = () => { v.controls = true; };
        const hide = () => { if (!wrap.contains(this.dom.activeElement)) v.controls = false; };
        wrap.addEventListener('pointerenter', show);
        wrap.addEventListener('pointerleave', hide);
        v.addEventListener('focus', show);
        v.tabIndex = 0;
      }
      if (v.dataset.start === 'manual' && v.dataset.controls === 'hide') {
        v.addEventListener('click', (e) => {
          e.stopPropagation();
          if (v.paused) this.play(id);
          else v.pause();
        });
      }
      if (v.dataset.captions) this.loadCaptions(rec, v.dataset.captions);
      this.active.push(rec);
      if (v.dataset.start === 'auto' && visibleIds.has(id)) this.play(id);
    }
  }

  async loadCaptions(rec, assetId) {
    try {
      let cues = this.cueCache.get(assetId);
      if (!cues) {
        const text = await this.getCaptionsText(assetId);
        cues = text ? parseVtt(text) : [];
        this.cueCache.set(assetId, cues);
      }
      rec.cues = cues;
      rec.overlay = this.dom.createElement('div');
      rec.overlay.className = 'pe-captions';
      rec.overlay.setAttribute('aria-live', 'off');
      rec.wrap.appendChild(rec.overlay);
      this.updateCaptions(rec);
    } catch {
      /* captions unavailable */
    }
  }

  updateCaptions(rec) {
    if (!rec.overlay || !rec.cues) return;
    const t = rec.v.currentTime * 1000;
    const cue = this.captionsOn ? rec.cues.find((c) => t >= c.start && t < c.end) : null;
    const key = cue ? `${cue.start}` : '';
    if (rec.overlay.dataset.key === key) return;
    rec.overlay.dataset.key = key;
    rec.overlay.replaceChildren();
    if (cue) {
      const span = this.dom.createElement('span');
      span.appendChild(cueNodes(this.dom, cue.text));
      rec.overlay.appendChild(span);
    }
  }

  play(id) {
    const rec = this.active.find((r) => r.id === id);
    if (!rec) return;
    const v = rec.v;
    try {
      if (v.currentTime < rec.start || (rec.end !== null && v.currentTime >= rec.end)) v.currentTime = rec.start;
    } catch {
      /* ignore */
    }
    v.muted = v.muted || this.muted;
    const p = v.play();
    if (p?.catch) p.catch(() => undefined);
  }

  stop(id) {
    const rec = this.active.find((r) => r.id === id);
    if (!rec) return;
    rec.v.pause();
    try {
      rec.v.currentTime = rec.start;
    } catch {
      /* ignore */
    }
  }

  setMuted(m) {
    this.muted = m;
    for (const r of this.active) r.v.muted = m || r.v.defaultMuted;
  }

  setCaptions(on) {
    this.captionsOn = on;
    for (const r of this.active) this.updateCaptions(r);
  }

  hasCaptions() {
    return this.active.some((r) => r.v.dataset.captions);
  }

  detach() {
    for (const r of this.active) {
      try {
        r.v.pause();
        r.v.removeAttribute('src');
        r.v.load();
      } catch {
        /* ignore */
      }
    }
    this.active = [];
  }
}
