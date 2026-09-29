// Builds → native PowerPoint animations (spec §15.6): appear, fade and fly
// entrances and exits, by-paragraph builds, and video play steps.
import { buildSteps, ENTRANCE } from '../../core/builds.js';

const FLY_SUB = { left: 8, right: 2, up: 4, down: 1 }; // "from" direction
const PRESET = { appear: 1, disappear: 1, fade_in: 10, fade_out: 10, fly_in: 2, fly_out: 2 };

// Paragraph ranges (top-level paragraphs with their sub-items) for by-paragraph builds.
function paragraphRanges(el) {
  const body = el.text?.body || el.shape?.text?.body;
  const out = [];
  if (!body) return out;
  body.paragraphs.forEach((p, i) => {
    if (!p.list || (p.list.level || 0) === 0 || !out.length) out.push({ st: i, end: i });
    else out[out.length - 1].end = i;
  });
  return out;
}

// slide: model slide; spid(elementId) → shape id or null; durations from builds.
export function timingXml(slide, spid, { videoIds = [] } = {}) {
  const builds = (slide.builds || []).filter((b) => spid(b.element_id));
  const autoVideos = videoIds.filter((v) => v.auto);
  if (!builds.length && !autoVideos.length && !videoIds.length) return '';
  let id = 2; // 1 = tmRoot, 2 = mainSeq
  const next = () => ++id;
  const byId = new Map(slide.elements.map((e) => [e.id, e]));
  const grp = new Map();
  let grpSeq = 0;
  const grpOf = (elId) => {
    if (!grp.has(elId)) grp.set(elId, grpSeq++);
    return grp.get(elId);
  };
  const tgt = (sp, para) => `<p:tgtEl><p:spTgt spid="${sp}">${para ? `<p:txEl><p:pRg st="${para.st}" end="${para.end}"/></p:txEl>` : ''}</p:spTgt></p:tgtEl>`;

  const setVis = (sp, para, val, delay = 0) => `<p:set><p:cBhvr><p:cTn id="${next()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn>${tgt(sp, para)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${val}"/></p:to></p:set>`;
  const fade = (sp, para, dir, dur) => `<p:animEffect transition="${dir}" filter="fade"><p:cBhvr><p:cTn id="${next()}" dur="${dur}"/>${tgt(sp, para)}</p:cBhvr></p:animEffect>`;
  const flyAnim = (sp, para, attr, from, to, dur) => `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${next()}" dur="${dur}" fill="hold"/>${tgt(sp, para)}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;

  const effectXml = (b, sp, para, nodeType, delay) => {
    const dur = Math.max(1, b.duration_ms ?? 500);
    const entr = ENTRANCE.has(b.effect);
    if (b.effect === 'play') {
      return `<p:par><p:cTn id="${next()}" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="${nodeType}"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst><p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="${next()}" dur="1" fill="hold"/>${tgt(sp)}</p:cBhvr></p:cmd></p:childTnLst></p:cTn></p:par>`;
    }
    const cls = entr ? 'entr' : 'exit';
    const dir = b.direction || 'left';
    const sub = b.effect.startsWith('fly') ? FLY_SUB[dir] : 0;
    let inner = '';
    if (b.effect === 'appear') inner = setVis(sp, para, 'visible');
    else if (b.effect === 'disappear') inner = setVis(sp, para, 'hidden');
    else if (b.effect === 'fade_in') inner = setVis(sp, para, 'visible') + fade(sp, para, 'in', dur);
    else if (b.effect === 'fade_out') inner = fade(sp, para, 'out', dur) + setVis(sp, para, 'hidden', dur - 1);
    else if (b.effect === 'fly_in' || b.effect === 'fly_out') {
      const off = { left: ['0-#ppt_w/2', '#ppt_y'], right: ['1+#ppt_w/2', '#ppt_y'], up: ['#ppt_x', '0-#ppt_h/2'], down: ['#ppt_x', '1+#ppt_h/2'] }[dir];
      // "from" for entrances; exits leave toward the same side
      const [ox, oy] = off;
      const x = b.effect === 'fly_in' ? flyAnim(sp, para, 'ppt_x', ox, '#ppt_x', dur) : flyAnim(sp, para, 'ppt_x', '#ppt_x', ox, dur);
      const y = b.effect === 'fly_in' ? flyAnim(sp, para, 'ppt_y', oy, '#ppt_y', dur) : flyAnim(sp, para, 'ppt_y', '#ppt_y', oy, dur);
      inner = (b.effect === 'fly_in' ? setVis(sp, para, 'visible') : '') + x + y + (b.effect === 'fly_out' ? setVis(sp, para, 'hidden', dur - 1) : '');
    }
    return `<p:par><p:cTn id="${next()}" presetID="${PRESET[b.effect]}" presetClass="${cls}" presetSubtype="${sub}" fill="hold" grpId="${grpOf(b.element_id)}" nodeType="${nodeType}"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par>`;
  };

  // Expand paragraph builds and group into click steps / time groups.
  const { steps } = buildSteps({ ...slide, builds });
  const clickGroups = [];
  steps.forEach((subs, si) => {
    if (!subs.length) return;
    const timeGroups = [];
    let t = 0;
    let groupEnd = 0;
    subs.forEach((b, k) => {
      const el = byId.get(b.element_id);
      const dur = b.effect === 'play' ? 0 : b.effect === 'appear' || b.effect === 'disappear' ? 1 : b.duration_ms ?? 500;
      const para = b.paragraph !== null && b.paragraph !== undefined ? paragraphRanges(el)[b.paragraph] : null;
      const trig = k === 0 && si > 0 ? 'on_click' : b.trigger;
      if (k === 0 || trig === 'after_previous') {
        if (k > 0) t = groupEnd;
        timeGroups.push({ delay: t, items: [] });
      }
      const nodeType = k === 0 ? (si === 0 ? (trig === 'after_previous' ? 'afterEffect' : 'withEffect') : 'clickEffect') : trig === 'after_previous' ? 'afterEffect' : 'withEffect';
      timeGroups[timeGroups.length - 1].items.push({ b, sp: spid(b.element_id), para, nodeType, delay: b.delay_ms || 0 });
      groupEnd = Math.max(groupEnd, t + (b.delay_ms || 0) + dur);
    });
    clickGroups.push({ auto: si === 0, timeGroups });
  });

  const clickPars = clickGroups.map((cg) => {
    const tgs = cg.timeGroups.map((tg) => `<p:par><p:cTn id="${next()}" fill="hold"><p:stCondLst><p:cond delay="${tg.delay}"/></p:stCondLst><p:childTnLst>${tg.items.map((it) => effectXml(it.b, it.sp, it.para, it.nodeType, it.delay)).join('')}</p:childTnLst></p:cTn></p:par>`).join('');
    const cond = cg.auto ? '<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>' : '<p:cond delay="indefinite"/>';
    return `<p:par><p:cTn id="${next()}" fill="hold"><p:stCondLst>${cond}</p:stCondLst><p:childTnLst>${tgs}</p:childTnLst></p:cTn></p:par>`;
  }).join('');

  // media nodes for videos (needed for play commands and autoplay)
  const media = videoIds.map((v) => `<p:video><p:cMediaNode vol="80000"${v.muted ? ' mute="1"' : ''}><p:cTn id="${next()}" repeatCount="${v.loop ? 'indefinite' : '1000'}" fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn>${tgt(v.spid)}</p:cMediaNode></p:video>`).join('');

  const mainSeq = clickPars
    ? `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${clickPars}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>`
    : '';
  const bld = [...grp.keys()]
    .map((elId) => {
      const el = byId.get(elId);
      if (!el || !(el.type === 'text' || (el.type === 'shape' && el.shape.text))) return '';
      const byPara = builds.some((b) => b.element_id === elId && b.by === 'paragraph');
      return `<p:bldP spid="${spid(elId)}" grpId="${grp.get(elId)}"${byPara ? ' build="p"' : ' animBg="1"'}/>`;
    })
    .join('');
  if (!mainSeq && !media) return '';
  // number time nodes in document order (tmRoot = 1, mainSeq = 2)
  let seq = 0;
  const body = `${mainSeq}${media}`.replace(/<p:cTn id="\d+"/g, () => `<p:cTn id="${seq++ + 2}"`);
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>${body}</p:childTnLst></p:cTn></p:par></p:tnLst>${bld ? `<p:bldLst>${bld}</p:bldLst>` : ''}</p:timing>`;
}
