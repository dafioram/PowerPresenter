// Native PowerPoint charts (spec §15.6): chart parts with cached values and an
// embedded workbook, so the data stays editable.
import { esc, colorXml, solidFill, pt100, fontName } from './drawing.js';
import { seriesColors } from '../../render/chart-svg.js';
import { resolveFontValue } from '../../core/theme.js';
import { writeZip } from '../../io/zip.js';

const col = (i) => {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
const ref = (c, r) => `Sheet1!$${col(c)}$${r + 1}`;
const rng = (c0, r0, c1, r1) => `Sheet1!$${col(c0)}$${r0 + 1}:$${col(c1)}$${r1 + 1}`;

export function numberFormatCode(fmt = {}) {
  const dec = fmt.decimals ?? null;
  let core = fmt.thousands ? '#,##0' : '0';
  if (dec) core += `.${'0'.repeat(dec)}`;
  else if (dec === null && fmt.style !== 'percent') core = fmt.thousands ? '#,##0.##' : 'General';
  if (fmt.style === 'percent') core = `${core === 'General' ? '0' : core}%`;
  const q = (s) => (s ? `"${s.replace(/"/g, '')}"` : '');
  if (core === 'General' && !fmt.prefix && !fmt.suffix) return 'General';
  return `${q(fmt.prefix)}${core === 'General' ? '0.##' : core}${q(fmt.suffix)}`;
}

// Worksheet grid for the chart's data.
function sheetGrid(chart) {
  if (chart.kind === 'scatter') {
    const maxLen = Math.max(...chart.series.map((s) => s.points?.length || 0));
    const header = [];
    chart.series.forEach((s) => header.push(`${s.name} X`, s.name));
    const rows = [header];
    for (let i = 0; i < maxLen; i++) {
      const row = [];
      chart.series.forEach((s) => {
        const p = s.points?.[i];
        row.push(p ? p.x : null, p ? p.y : null);
      });
      rows.push(row);
    }
    return rows;
  }
  const rows = [['', ...chart.series.map((s) => s.name)]];
  (chart.categories || []).forEach((c, i) => rows.push([c, ...chart.series.map((s) => s.values?.[i] ?? null)]));
  return rows;
}

export async function buildWorkbook(chart) {
  const rows = sheetGrid(chart);
  const cell = (v, c, r) => {
    const a = `${col(c)}${r + 1}`;
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number') return `<c r="${a}"><v>${v}</v></c>`;
    return `<c r="${a}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ci, ri)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ];
  return writeZip(files.map((f) => ({ ...f, compress: true })));
}

function strCache(values) {
  return `<c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
}

function numCache(values, code) {
  return `<c:numCache><c:formatCode>${esc(code)}</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => (v === null || v === undefined ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')}</c:numCache>`;
}

function textProps(doc, size, color, bold = false) {
  const theme = doc.theme;
  const tf = esc(fontName(doc, resolveFontValue(theme, theme.defaults.chart.font)));
  return `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${pt100(size)}" b="${bold ? 1 : 0}">${solidFill(color, theme)}<a:latin typeface="${tf}"/><a:cs typeface="${tf}"/></a:defRPr></a:pPr><a:endParaRPr lang="${esc(doc.metadata.language || 'en-US')}"/></a:p></c:txPr>`;
}

function titleXml(doc, text, size, color) {
  const theme = doc.theme;
  const tf = esc(fontName(doc, resolveFontValue(theme, theme.defaults.chart.font)));
  return `<c:title><c:tx><c:rich><a:bodyPr rot="0" vert="horz"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${pt100(size)}" b="0">${solidFill(color, theme)}<a:latin typeface="${tf}"/></a:defRPr></a:pPr><a:r><a:rPr lang="${esc(doc.metadata.language || 'en-US')}" sz="${pt100(size)}" b="0">${solidFill(color, theme)}<a:latin typeface="${tf}"/></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}

function dLblsXml(chart, code, { percent = false } = {}) {
  if (!chart.labels || chart.labels === 'none') return '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>';
  const pct = chart.labels === 'percent' && percent;
  return `<c:dLbls><c:numFmt formatCode="${esc(pct ? '0%' : code)}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:showLegendKey val="0"/><c:showVal val="${pct ? 0 : 1}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${pct ? 1 : 0}"/><c:showBubbleSize val="0"/></c:dLbls>`;
}

// Series color as DrawingML: theme accents stay scheme colors.
function seriesColorXml(chart, theme, i, own) {
  if (own) return colorXml(own, theme);
  const n = i % 18;
  const accent = { token: `color.accent.${(n % 6) + 1}` };
  if (n < 6) return colorXml(accent, theme);
  if (n < 12) return colorXml({ ...accent, tint: 0.45 }, theme);
  return colorXml({ ...accent, tint: -0.35 }, theme);
}

export function chartXml(doc, chart) {
  const theme = doc.theme;
  const cd = theme.defaults.chart;
  const code = numberFormatCode(chart.number_format);
  const cats = chart.categories || [];
  const n = cats.length;
  const colorFor = (i, own) => seriesColorXml(chart, theme, i, own);
  void seriesColors;
  const gridLine = `<c:spPr><a:ln w="9525">${solidFill(cd.gridline, theme)}</a:ln></c:spPr>`;
  const axisLine = `<c:spPr><a:noFill/><a:ln w="9525">${solidFill(cd.gridline, theme)}</a:ln></c:spPr>`;
  const axTitle = (t) => (t ? titleXml(doc, t, cd.label_size, cd.label_color) : '');
  const txPr = textProps(doc, cd.label_size, cd.label_color);
  let plot = '';
  let axes = '';
  const catRef = n ? `<c:cat><c:strRef><c:f>${rng(0, 1, 0, n)}</c:f>${strCache(cats)}</c:strRef></c:cat>` : '';
  const valRef = (s, ci) => `<c:val><c:numRef><c:f>${rng(ci, 1, ci, Math.max(1, n))}</c:f>${numCache(cats.map((_, k) => s.values?.[k] ?? null), code)}</c:numRef></c:val>`;
  const txRef = (s, ci) => `<c:tx><c:strRef><c:f>${ref(ci, 0)}</c:f>${strCache([s.name])}</c:strRef></c:tx>`;
  const catAx = (pos, grid) => `<c:catAx><c:axId val="100"/><c:scaling><c:orientation val="${pos === 'l' ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${grid ? `<c:majorGridlines>${gridLine}</c:majorGridlines>` : ''}${axTitle(pos === 'l' ? chart.y_title : chart.x_title)}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axisLine}${txPr}<c:crossAx val="200"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const scaling = (orient = 'minMax') => `<c:scaling><c:orientation val="${orient}"/>${chart.axis?.max != null ? `<c:max val="${chart.axis.max}"/>` : ''}${chart.axis?.min != null ? `<c:min val="${chart.axis.min}"/>` : ''}</c:scaling>`;
  const valAx = (id, cross, pos, grid, title, fmt = code) => `<c:valAx><c:axId val="${id}"/>${scaling()}<c:delete val="0"/><c:axPos val="${pos}"/>${grid ? `<c:majorGridlines>${gridLine}</c:majorGridlines>` : ''}${axTitle(title)}<c:numFmt formatCode="${esc(fmt)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr}<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="${chart.kind === 'scatter' ? 'midCat' : 'between'}"/></c:valAx>`;

  if (chart.kind === 'bar') {
    const horizontal = chart.orientation === 'horizontal';
    const grouping = chart.grouping === 'stacked' ? 'stacked' : chart.grouping === 'percent' ? 'percentStacked' : 'clustered';
    const sers = chart.series.map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${txRef(s, i + 1)}<c:spPr>${`<a:solidFill>${colorFor(i, s.color)}</a:solidFill>`}<a:ln><a:noFill/></a:ln></c:spPr><c:invertIfNegative val="0"/>${dLblsXml(chart, code)}${catRef}${valRef(s, i + 1)}</c:ser>`).join('');
    plot = `<c:barChart><c:barDir val="${horizontal ? 'bar' : 'col'}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${sers}<c:gapWidth val="80"/>${grouping !== 'clustered' ? '<c:overlap val="100"/>' : ''}<c:axId val="100"/><c:axId val="200"/></c:barChart>`;
    const g = chart.gridlines || {};
    axes = horizontal
      ? catAx('l', !!g.y) + valAx(200, 100, 'b', !!g.x, chart.x_title, grouping === 'percentStacked' ? '0%' : code)
      : catAx('b', !!g.x) + valAx(200, 100, 'l', !!g.y, chart.y_title, grouping === 'percentStacked' ? '0%' : code);
  } else if (chart.kind === 'line') {
    const sers = chart.series.map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${txRef(s, i + 1)}<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill>${colorFor(i, s.color)}</a:solidFill><a:round/></a:ln></c:spPr><c:marker>${chart.markers ? `<c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill>${colorFor(i, s.color)}</a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>` : '<c:symbol val="none"/>'}</c:marker>${dLblsXml(chart, code)}${catRef}${valRef(s, i + 1)}<c:smooth val="0"/></c:ser>`).join('');
    plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}<c:marker val="1"/><c:axId val="100"/><c:axId val="200"/></c:lineChart>`;
    const g = chart.gridlines || {};
    axes = catAx('b', !!g.x) + valAx(200, 100, 'l', !!g.y, chart.y_title);
  } else if (chart.kind === 'pie' || chart.kind === 'donut') {
    const s = chart.series[0];
    const dpts = cats.map((_, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr><a:solidFill>${colorFor(k, null)}</a:solidFill><a:ln w="19050">${solidFill({ token: 'color.background' }, theme)}</a:ln></c:spPr></c:dPt>`).join('');
    const ser = `<c:ser><c:idx val="0"/><c:order val="0"/>${txRef(s, 1)}${dpts}${dLblsXml(chart, code, { percent: true })}${catRef}${valRef(s, 1)}</c:ser>`;
    plot = chart.kind === 'pie'
      ? `<c:pieChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/></c:pieChart>`
      : `<c:doughnutChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
  } else if (chart.kind === 'scatter') {
    const sers = chart.series.map((s, i) => {
      const pts = s.points || [];
      const m = pts.length;
      const xc = i * 2;
      const yc = i * 2 + 1;
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${ref(yc, 0)}</c:f>${strCache([s.name])}</c:strRef></c:tx><c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="7"/><c:spPr><a:solidFill>${colorFor(i, s.color)}</a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:marker>${dLblsXml(chart, code)}<c:xVal><c:numRef><c:f>${rng(xc, 1, xc, Math.max(1, m))}</c:f>${numCache(pts.map((p) => p.x), 'General')}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>${rng(yc, 1, yc, Math.max(1, m))}</c:f>${numCache(pts.map((p) => p.y), code)}</c:numRef></c:yVal><c:smooth val="0"/></c:ser>`;
    }).join('');
    plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${sers}<c:axId val="100"/><c:axId val="200"/></c:scatterChart>`;
    const g = chart.gridlines || {};
    axes = valAx(100, 200, 'b', !!g.x, chart.x_title, 'General') + valAx(200, 100, 'l', !!g.y, chart.y_title);
  }
  const legendPos = { top: 't', bottom: 'b', left: 'l', right: 'r' }[chart.legend];
  const legend = legendPos ? `<c:legend><c:legendPos val="${legendPos}"/><c:overlay val="0"/>${txPr}</c:legend>` : '';
  const title = chart.title ? titleXml(doc, chart.title, cd.title_size, { token: 'color.text.primary' }) : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:date1904 val="0"/><c:lang val="${esc(doc.metadata.language || 'en-US')}"/><c:roundedCorners val="0"/><c:chart>${title}<c:autoTitleDeleted val="${chart.title ? 0 : 1}"/><c:plotArea><c:layout/>${plot}${axes}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr}<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
}
