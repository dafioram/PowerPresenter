// Static and document-level PPTX parts: theme, master, layouts, notes master,
// presentation, properties and content types.
import { esc, emu, NS, fontName, fillXml, guid } from './drawing.js';
import { COLOR_TOKENS } from '../../core/theme.js';

export const REL = {
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  extended: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
  slideMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  slideLayout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  notesMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster',
  notesSlide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  chart: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
  package: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package',
  presProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps',
  viewProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps',
  tableStyles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles',
  video: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/video',
  media: 'http://schemas.microsoft.com/office/2007/relationships/media',
};

export const CT = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  slideLayout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  slideMaster: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  notesMaster: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml',
  notesSlide: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  presProps: 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml',
  viewProps: 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml',
  tableStyles: 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml',
  chart: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
};

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
export const NSDECL = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;

export function relsXml(rels) {
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
}

export function contentTypesXml(overrides, defaults) {
  const d = { rels: 'application/vnd.openxmlformats-package.relationships+xml', xml: 'application/xml', ...defaults };
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${Object.entries(d).map(([ext, ct]) => `<Default Extension="${ext}" ContentType="${ct}"/>`).join('')}${overrides.map(([part, ct]) => `<Override PartName="${part}" ContentType="${ct}"/>`).join('')}</Types>`;
}

const hex6 = (h) => h.slice(1, 7).toUpperCase();

export function themeXml(doc, name = null) {
  const t = doc.theme;
  const c = t.colors;
  const slot = (tag, token) => `<a:${tag}><a:srgbClr val="${hex6(c[token])}"/></a:${tag}>`;
  void COLOR_TOKENS;
  const major = esc(fontName(doc, t.fonts['font.heading']));
  const minor = esc(fontName(doc, t.fonts['font.body']));
  const font = (tf) => `<a:latin typeface="${tf}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  return `${XML_HEAD}<a:theme xmlns:a="${NS.a}" name="${esc(name || t.name)}"><a:themeElements><a:clrScheme name="${esc(t.name)}">${slot('dk1', 'color.text.primary')}${slot('lt1', 'color.background')}${slot('dk2', 'color.text.secondary')}${slot('lt2', 'color.surface')}${[1, 2, 3, 4, 5, 6].map((i) => slot(`accent${i}`, `color.accent.${i}`)).join('')}${slot('hlink', 'color.link')}${slot('folHlink', 'color.link')}</a:clrScheme><a:fontScheme name="${esc(t.name)}"><a:majorFont>${font(major)}</a:majorFont><a:minorFont>${font(minor)}</a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:shade val="80000"/></a:schemeClr></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:shade val="90000"/></a:schemeClr></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

export const CLR_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

export const EMPTY_GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

const LVL = (n, extra = '') => `<a:lvl${n}pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"${extra}><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${n}pPr>`;

export function masterXml(doc, spTreeInner, bgFill) {
  return `${XML_HEAD}<p:sldMaster ${NSDECL}><p:cSld><p:bg><p:bgPr>${bgFill || '<a:solidFill><a:schemeClr val="bg1"/></a:solidFill>'}<a:effectLst/></p:bgPr></p:bg><p:spTree>${EMPTY_GRP}${spTreeInner}</p:spTree></p:cSld>${CLR_MAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle>${LVL(1)}</p:bodyStyle><p:otherStyle>${LVL(1)}</p:otherStyle></p:txStyles></p:sldMaster>`;
}

export function layoutXml(kind, W, H) {
  if (kind === 'blank') {
    return `${XML_HEAD}<p:sldLayout ${NSDECL} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${EMPTY_GRP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  }
  const x = emu(W * 0.0625);
  const y = emu(H * 0.0833);
  return `${XML_HEAD}<p:sldLayout ${NSDECL} type="titleOnly" preserve="1"><p:cSld name="Title Only"><p:spTree>${EMPTY_GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${emu(W) - 2 * x}" cy="${emu(H * 0.14)}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

export function notesMasterXml() {
  return `${XML_HEAD}<p:notesMaster ${NSDECL}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${EMPTY_GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Notes</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>${CLR_MAP}<p:notesStyle>${LVL(1)}</p:notesStyle></p:notesMaster>`;
}

export function notesSlideXml(bodyParas) {
  return `${XML_HEAD}<p:notes ${NSDECL}><p:cSld><p:spTree>${EMPTY_GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${bodyParas}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

// sections: [{ name, sldIds: [number] }]
export function presentationXml(doc, { slideRefs, notesRid, sections }) {
  const W = emu(doc.size.width);
  const H = emu(doc.size.height);
  const secXml = sections?.length
    ? `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="${NS.p14}">${sections.map((s) => `<p14:section name="${esc(s.name)}" id="${guid()}"><p14:sldIdLst>${s.sldIds.map((id) => `<p14:sldId id="${id}"/>`).join('')}</p14:sldIdLst></p14:section>`).join('')}</p14:sectionLst></p:ext></p:extLst>`
    : '';
  return `${XML_HEAD}<p:presentation ${NSDECL} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${notesRid ? `<p:notesMasterIdLst><p:notesMasterId r:id="${notesRid}"/></p:notesMasterIdLst>` : ''}<p:sldIdLst>${slideRefs.map((s) => `<p:sldId id="${s.sldId}" r:id="${s.rid}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle>${LVL(1)}</p:defaultTextStyle>${secXml}</p:presentation>`;
}

export function presPropsXml(doc) {
  const aa = doc.playback?.auto_advance || {};
  const show = aa.loop ? `<p:showPr loop="1" showNarration="1"><p:present/><p:sldAll/><p:penClr><a:prstClr val="red"/></p:penClr></p:showPr>` : '';
  return `${XML_HEAD}<p:presentationPr ${NSDECL}>${show}</p:presentationPr>`;
}

export function viewPropsXml() {
  return `${XML_HEAD}<p:viewPr ${NSDECL}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`;
}

export function tableStylesXml() {
  return `${XML_HEAD}<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;
}

export function coreXml(doc) {
  const m = doc.metadata;
  return `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(m.title)}</dc:title>${m.author ? `<dc:creator>${esc(m.author)}</dc:creator>` : ''}${m.description ? `<dc:description>${esc(m.description)}</dc:description>` : ''}<dc:language>${esc(m.language)}</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${esc(m.created_at)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${esc(m.updated_at)}</dcterms:modified></cp:coreProperties>`;
}

export function appXml({ slides, notes, hidden }) {
  return `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Presentation Editor</Application><PresentationFormat>Custom</PresentationFormat><Slides>${slides}</Slides><Notes>${notes}</Notes><HiddenSlides>${hidden}</HiddenSlides><AppVersion>16.0000</AppVersion></Properties>`;
}

export { fillXml };
