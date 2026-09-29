// WebVTT captions (spec §8.4, §13.8). Parsed, validated and re-serialized with
// cue text reduced to plain text plus <b>, <i> and <u>. Idempotent.
export class VttError extends Error {}

function parseTime(s) {
  const m = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(s.trim());
  if (!m) return null;
  return (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

function fmtTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const x = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(x, 3)}`;
}

function sanitizeCueText(text) {
  const decoded = text.replace(/&lt;/g, '\u0001').replace(/&gt;/g, '\u0002').replace(/&amp;/g, '\u0003');
  const cleaned = decoded.replace(/<\/?([a-z]+)(?:\.[^>\s]*)?(?:\s[^>]*)?>/gi, (tag, name) => {
    const n = name.toLowerCase();
    if (n === 'b' || n === 'i' || n === 'u') return tag.startsWith('</') ? `\u0004/${n}\u0005` : `\u0004${n}\u0005`;
    return '';
  }).replace(/<[^>]*>/g, '').replace(/</g, '').replace(/\u0004/g, '<').replace(/\u0005/g, '>');
  return cleaned.replace(/\u0001/g, '&lt;').replace(/\u0002/g, '&gt;').replace(/\u0003/g, '&amp;').replace(/&(?!(lt|gt|amp);)/g, '&amp;');
}

export function parseVtt(text) {
  const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!/^WEBVTT(\s|$)/.test(src)) throw new VttError('Caption files must be WebVTT (start with "WEBVTT").');
  const blocks = src.split(/\n{2,}/).slice(1);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length);
    if (!lines.length) continue;
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
    let i = 0;
    if (!lines[0].includes('-->')) i = 1;
    const timing = lines[i];
    if (!timing || !timing.includes('-->')) continue;
    const [a, rest] = timing.split('-->');
    const start = parseTime(a);
    const end = parseTime(rest.trim().split(/\s+/)[0]);
    if (start === null || end === null || end < start) throw new VttError(`Caption timing "${timing}" isn't valid.`);
    const body = sanitizeCueText(lines.slice(i + 1).join('\n')).slice(0, 2000);
    cues.push({ start, end, text: body });
  }
  if (!cues.length) throw new VttError('The caption file has no cues.');
  return cues;
}

export function serializeVtt(cues) {
  return 'WEBVTT\n\n' + cues.map((c) => `${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${c.text}`).join('\n\n') + '\n';
}

export function normalizeVtt(text) {
  return serializeVtt(parseVtt(text));
}

// Builds DOM nodes for a cue without using HTML parsing.
export function cueNodes(dom, text) {
  const frag = dom.createDocumentFragment();
  const stack = [frag];
  const re = /<(\/?)(b|i|u)>|&(lt|gt|amp);|([^<&]+)|[<&]/g;
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[2]) {
      if (m[1]) {
        if (stack.length > 1) stack.pop();
      } else {
        const el = dom.createElement(m[2]);
        top.appendChild(el);
        stack.push(el);
      }
    } else if (m[3]) top.appendChild(dom.createTextNode({ lt: '<', gt: '>', amp: '&' }[m[3]]));
    else top.appendChild(dom.createTextNode(m[0]));
  }
  return frag;
}
