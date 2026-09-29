// Export dialog and export check (spec §15.1).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Dialog, Button, Select, Checkbox, NumberField, Segmented, toast } from '../../ui/components.jsx';
import { Icon } from '../../ui/icons.jsx';
import { slideOrder, nowIso, elementLabel, locate } from '../../../core/model.js';
import { resolveSlideTitle } from '../../../core/titles.js';
import { exportPres, ExportBlocked } from '../../../io/pres.js';
import { registryFontIds } from '../../../render/fonts.js';
import { patchMeta } from '../../../storage/repo.js';
import { broadcast } from '../../../storage/session.js';
import { downloadBlob } from '../../download.js';
import { parseRange } from '../commands.js';
import { slideIdsForRange, isSafari } from '../../../export/common.js';
import { runExportCheck } from '../../../export/check.js';
import { defaultPaper } from '../../../export/pdf.js';
import { settings, updateSettings } from '../../settings.js';

const TARGETS = [
  { id: 'pres', label: '.pres', icon: 'file', hint: 'Full presentation file you can open again or share.' },
  { id: 'pdf', label: 'PDF', icon: 'file', hint: 'Print-quality PDF through the browser’s print dialog.' },
  { id: 'images', label: 'Images', icon: 'image', hint: 'PNG or JPEG per slide (ZIP for several).' },
  { id: 'html', label: 'HTML', icon: 'present', hint: 'A self-contained web page that presents offline.' },
  { id: 'pptx', label: 'PowerPoint', icon: 'slides', hint: 'Editable .pptx for PowerPoint, Keynote and Google Slides.' },
];

function RangePicker({ ctl, range, setRange, includeHidden, setIncludeHidden, allowHidden }) {
  const doc = ctl.doc;
  const order = slideOrder(doc);
  const named = doc.sections.filter((s) => s.name);
  const opts = [
    { value: 'all', label: `All slides (${order.length})` },
    { value: 'current', label: `Current slide (${order.indexOf(ctl.state.slideId) + 1})` },
    ctl.state.slideSelection.length > 1 && { value: 'selected', label: `Selected slides (${ctl.state.slideSelection.length})` },
    named.length > 0 && { value: 'section', label: 'A section' },
    { value: 'custom', label: 'Custom range' },
  ].filter(Boolean);
  return (
    <div class="stack tight">
      <div class="insp-grid">
        <Select label="Slides" value={range.kind} onChange={(k) => setRange({ ...range, kind: k, sectionId: range.sectionId || named[0]?.id })} options={opts} />
        {range.kind === 'section' && <Select label="Section" value={range.sectionId} onChange={(v) => setRange({ ...range, sectionId: v })} options={named.map((s) => ({ value: s.id, label: s.name }))} />}
        {range.kind === 'custom' && (
          <label class="field">
            <span class="field-label">Range</span>
            <input class="input" value={range.custom || ''} placeholder="1–5, 8" onInput={(e) => setRange({ ...range, custom: e.currentTarget.value })} aria-invalid={range.custom && !parseRange(range.custom, order.length)} />
          </label>
        )}
      </div>
      {allowHidden && <Checkbox label="Include hidden slides" checked={includeHidden} onChange={setIncludeHidden} />}
    </div>
  );
}

function CheckList({ ctl, result, close }) {
  if (!result) return <p class="small muted">Checking…</p>;
  const order = slideOrder(ctl.doc);
  const go = (it) => {
    if (!it.slideId) return;
    close();
    ctl.setSlide(it.slideId);
    if (it.elementId && ctl.find(it.elementId)) ctl.select([it.elementId]);
  };
  const where = (it) => {
    if (!it.slideId) return '';
    const n = order.indexOf(it.slideId) + 1;
    const el = it.elementId ? locate(ctl.doc.slides[it.slideId]?.elements || [], it.elementId)?.el : null;
    return `Slide ${n}${el ? ` · ${elementLabel(el)}` : ''}`;
  };
  if (!result.errors.length && !result.warnings.length) return <p class="small ok-text"><Icon name="check" size={14} /> Ready to export.</p>;
  return (
    <div class="check-list" data-testid="export-check">
      {result.errors.map((it, i) => (
        <div key={`e${i}`} class="issue is-error"><Icon name="alert" size={16} /><div class="issue-body"><span>{it.message}</span>{it.slideId && <button type="button" class="link-btn" onClick={() => go(it)}>{where(it)}</button>}</div></div>
      ))}
      {result.warnings.map((it, i) => (
        <div key={`w${i}`} class="issue is-warning"><Icon name="alert" size={16} /><div class="issue-body"><span>{it.message}</span>{it.slideId && <button type="button" class="link-btn" onClick={() => go(it)}>{where(it)}</button>}</div></div>
      ))}
    </div>
  );
}

export function ExportDialog({ close, ctl, target: initial = 'pres' }) {
  const doc = ctl.doc;
  const order = slideOrder(doc);
  const [target, setTarget] = useState(initial);
  const [range, setRange] = useState({ kind: 'all' });
  const [includeHidden, setIncludeHidden] = useState(false);
  const [pdf, setPdf] = useState({ layout: 'slides', perPage: 6, paper: settings.get().pdfPaper || defaultPaper(), steps: 'final' });
  const [img, setImg] = useState({ format: 'png', quality: 90, scale: 2 });
  const [html, setHtml] = useState({ folder: false, notes: false, startSlideId: '', kiosk: 'default' });
  const [pptx, setPptx] = useState({ notes: true });
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(null); // progress 0..1
  const abortRef = useRef(null);
  const safari = isSafari();

  const customIndices = range.kind === 'custom' ? parseRange(range.custom, order.length) : null;
  const slideIds = useMemo(() => {
    if (target === 'pres') return order;
    return slideIdsForRange(doc, { ...range, indices: customIndices || [] }, { currentId: ctl.state.slideId, selectedIds: ctl.state.slideSelection, includeHidden: target === 'pptx' ? true : includeHidden });
  }, [doc, target, range.kind, range.sectionId, range.custom, includeHidden]);

  useEffect(() => {
    let cancelled = false;
    setCheck(null);
    const t = setTimeout(async () => {
      const r = await runExportCheck(ctl, target, slideIds, { folder: html.folder, notes: pptx.notes, scale: img.scale });
      if (range.kind === 'custom' && !customIndices) r.errors.unshift({ message: `Enter a range like “1–5, 8” (1 to ${order.length}).` });
      if (!cancelled) setCheck(r);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [target, slideIds, html.folder, pptx.notes, img.scale]);

  const getBlob = (id) => ctl.assets.blobAsync(id);
  const blocked = !check || check.errors.length > 0;

  const doExport = async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(0);
    try {
      await ctl.session?.flush();
      if (target === 'pres') {
        const { blob, filename, warnings } = await exportPres(ctl.doc, getBlob, { fontIds: registryFontIds(), onProgress: setBusy });
        downloadBlob(blob, filename);
        await patchMeta(ctl.id, { last_backup_at: nowIso() });
        broadcast({ type: 'workspace-changed' });
        for (const w of warnings) toast(w, { kind: 'info', duration: 8000 });
        toast(`Exported ${filename}.`, { kind: 'success' });
      } else if (target === 'pdf') {
        updateSettings({ pdfPaper: pdf.paper });
        const { printPdf } = await import('../../../export/pdf.js');
        close(true);
        await printPdf(ctl.doc, slideIds, (id) => ctl.assets.url(id), pdf);
        return;
      } else if (target === 'images') {
        const { exportImages } = await import('../../../export/image.js');
        const { blob, filename } = await exportImages(ctl.doc, slideIds, getBlob, { format: img.format, quality: img.quality / 100, scale: img.scale, onProgress: setBusy, signal: ac.signal });
        downloadBlob(blob, filename);
        toast(`Exported ${filename}.`, { kind: 'success' });
      } else if (target === 'html') {
        const { exportHtml } = await import('../../../export/html.js');
        const pb = html.kiosk === 'default' ? null : html.kiosk === 'kiosk' ? { auto_advance: { enabled: true, loop: true }, click_to_advance: false } : { auto_advance: { enabled: false } };
        const { blob, filename } = await exportHtml(ctl.doc, getBlob, { slideIds, notes: html.notes, startSlideId: html.startSlideId || null, playback: pb, folder: html.folder, onProgress: setBusy });
        downloadBlob(blob, filename);
        toast(`Exported ${filename}.`, { kind: 'success' });
      } else if (target === 'pptx') {
        const { exportPptx } = await import('../../../export/pptx/index.js');
        const { blob, filename } = await exportPptx(ctl.doc, getBlob, { slideIds, notes: pptx.notes, onProgress: setBusy, assetUrl: (id) => ctl.assets.url(id) });
        downloadBlob(blob, filename);
        toast(`Exported ${filename}.`, { kind: 'success' });
      }
      close(true);
    } catch (e) {
      if (e?.name === 'AbortError') toast('Export cancelled.', { kind: 'info' });
      else if (e instanceof ExportBlocked) toast(`Export blocked: ${e.message}`, { kind: 'error', duration: 10000 });
      else {
        console.error(e);
        toast(`Export failed: ${e.message || e}`, { kind: 'error', duration: 10000 });
      }
      setBusy(null);
    }
  };

  const t = TARGETS.find((x) => x.id === target);
  return (
    <Dialog
      title="Export"
      onClose={() => { abortRef.current?.abort(); close(false); }}
      width={640}
      footer={
        <>
          {busy !== null && <div class="progress grow" role="progressbar" aria-valuenow={Math.round(busy * 100)} aria-valuemin="0" aria-valuemax="100"><div style={{ width: `${Math.round(busy * 100)}%` }} /></div>}
          <Button onClick={() => { abortRef.current?.abort(); close(false); }}>{busy !== null ? 'Cancel' : 'Close'}</Button>
          <Button variant="primary" icon="download" disabled={blocked || busy !== null} onClick={doExport} data-testid="export-run">
            {target === 'pdf' ? 'Open print dialog' : `Export ${t.label}`}
          </Button>
        </>
      }
    >
      <div class="export-targets" role="radiogroup" aria-label="Format">
        {TARGETS.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={target === x.id} class={`export-target ${target === x.id ? 'is-on' : ''}`} disabled={x.id === 'pdf' && safari} onClick={() => setTarget(x.id)} title={x.id === 'pdf' && safari ? 'PDF export needs Chrome, Edge or Firefox' : x.hint} data-testid={`export-target-${x.id}`}>
            <Icon name={x.icon} size={20} />
            {x.label}
          </button>
        ))}
      </div>
      <p class="small muted">{t.hint}</p>
      <div class="stack">
        {target === 'pres' && <p class="small">The .pres file always contains the whole presentation, including hidden slides, notes and media.</p>}
        {target !== 'pres' && <RangePicker ctl={ctl} range={range} setRange={setRange} includeHidden={includeHidden} setIncludeHidden={setIncludeHidden} allowHidden={target !== 'pptx'} />}
        {target === 'pptx' && <p class="small muted">Hidden slides in the range are included and stay hidden.</p>}
        {target === 'pdf' && (
          <>
            <div class="insp-grid">
              <Select label="Layout" value={pdf.layout} onChange={(v) => setPdf({ ...pdf, layout: v })} options={[{ value: 'slides', label: 'Slides (one per page)' }, { value: 'notes', label: 'Notes pages' }, { value: 'handout', label: 'Handouts' }]} />
              {pdf.layout === 'handout' && <Select label="Slides per page" value={String(pdf.perPage)} onChange={(v) => setPdf({ ...pdf, perPage: Number(v) })} options={[2, 3, 4, 6, 9].map((n) => ({ value: String(n), label: n === 3 ? '3 (with note lines)' : String(n) }))} />}
              {pdf.layout !== 'slides' && <Select label="Paper" value={pdf.paper} onChange={(v) => setPdf({ ...pdf, paper: v })} options={[{ value: 'letter', label: 'Letter' }, { value: 'a4', label: 'A4' }]} />}
              <Select label="Builds" value={pdf.steps} onChange={(v) => setPdf({ ...pdf, steps: v })} options={[{ value: 'final', label: 'Final state of each slide' }, { value: 'each', label: 'One page per build step' }]} />
            </div>
            <div class="ws-notice is-info small">
              <Icon name="info" size={16} />
              <span>In the print dialog, choose <strong>Save as PDF</strong>, keep margins at <strong>Default</strong> and scale at <strong>100%</strong>, and turn off <strong>Headers and footers</strong> if you see them.</span>
            </div>
          </>
        )}
        {target === 'images' && (
          <div class="insp-grid">
            <Segmented label="Image format" value={img.format} onChange={(v) => setImg({ ...img, format: v })} options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }]} />
            <Select label="Size" value={String(img.scale)} onChange={(v) => setImg({ ...img, scale: Number(v) })} options={[1, 2, 3, 4].map((s) => ({ value: String(s), label: `${s}× (${Math.round(Math.min(8192, doc.size.width * s))} × ${Math.round(Math.min(8192, doc.size.height * s))})` }))} />
            {img.format === 'jpeg' && <NumberField label="JPEG quality" value={img.quality} min={60} max={100} step={5} precision={0} unit="%" onChange={(v) => setImg({ ...img, quality: v })} />}
          </div>
        )}
        {target === 'html' && (
          <div class="stack tight">
            <Segmented label="HTML packaging" value={html.folder ? 'folder' : 'single'} onChange={(v) => setHtml({ ...html, folder: v === 'folder' })} options={[{ value: 'single', label: 'Single file' }, { value: 'folder', label: 'Web folder (ZIP)' }]} />
            <Checkbox label="Include speaker notes and presenter view" checked={html.notes} onChange={(v) => setHtml({ ...html, notes: v })} />
            <div class="insp-grid">
              <Select label="Start on" value={html.startSlideId} onChange={(v) => setHtml({ ...html, startSlideId: v })} options={[{ value: '', label: 'First slide' }, ...slideIds.map((id) => ({ value: id, label: `${order.indexOf(id) + 1}. ${resolveSlideTitle(doc.slides[id]) || 'Untitled'}` }))]} />
              <Select label="Playback" value={html.kiosk} onChange={(v) => setHtml({ ...html, kiosk: v })} options={[{ value: 'default', label: 'Presentation settings' }, { value: 'kiosk', label: 'Kiosk: auto-advance and loop' }, { value: 'manual', label: 'Manual only' }]} />
            </div>
          </div>
        )}
        {target === 'pptx' && <Checkbox label="Include speaker notes" checked={pptx.notes} onChange={(v) => setPptx({ notes: v })} />}
        <div class="stack tight">
          <h3 class="small muted">Export check</h3>
          <CheckList ctl={ctl} result={check} close={() => close(false)} />
        </div>
      </div>
    </Dialog>
  );
}
