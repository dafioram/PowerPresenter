// Workspace (spec §11): local presentations, templates, trash and backups.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Button, IconButton, MenuButton, openDialog, confirmDialog, promptDialog, toast, useSignal } from '../ui/components.jsx';
import { Icon } from '../ui/icons.jsx';
import { listPresentations, loadDocument, listAssetRecords, trashPresentation, restorePresentation, deleteForever, patchMeta, getSetting, setSetting } from '../../storage/repo.js';
import { onChannel, broadcast, withPresentationLock } from '../../storage/session.js';
import { openPresentation } from '../nav.js';
import { importFiles } from '../importer.js';
import { pickFiles, formatBytes, relativeTime } from '../download.js';
import { createBlank, createFromBuiltinTemplate, createFromUserTemplate, duplicatePresentation, exportPresentationFile, backupEverything, requestPersistence } from './actions.js';
import { SettingsDialog, ShortcutsDialog, AboutDialog, StorageDialog, NewPresentationDialog, WelcomeDialog } from '../dialogs/AppDialogs.jsx';
import { ThemeLibraryDialog } from '../dialogs/ThemeLibraryDialog.jsx';
import { SlideThumb } from '../SlideThumb.jsx';
import { slideOrder } from '../../core/model.js';
import { normalizeDocument } from '../../core/canonical.js';
import { presetSize } from '../../core/units.js';
import { settings, updateSettings } from '../settings.js';
import { APP_NAME } from '../../version.js';

function CardThumb({ id, width = 280, onOpen, label }) {
  const [data, setData] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    let urls = [];
    let cancelled = false;
    const io = new IntersectionObserver(async (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const rec = await loadDocument(id);
      if (!rec || cancelled) return;
      const doc = normalizeDocument(rec.doc);
      const first = doc.slides[slideOrder(doc).find((s) => !doc.slides[s].hidden) || slideOrder(doc)[0]];
      const recs = await listAssetRecords(id);
      const map = new Map();
      const needed = JSON.stringify(first) + JSON.stringify(doc.master) + JSON.stringify(doc.theme.background);
      for (const r of recs) {
        if (!needed.includes(r.asset_id)) continue;
        const u = URL.createObjectURL(r.blob);
        urls.push(u);
        map.set(r.asset_id, u);
      }
      if (!cancelled) setData({ doc, slide: first, assetUrl: (aid) => map.get(aid) || null });
    });
    if (ref.current) io.observe(ref.current);
    return () => {
      cancelled = true;
      io.disconnect();
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [id]);
  return (
    <button type="button" class="card-thumb" ref={ref} onClick={onOpen} aria-label={label} style={data ? { aspectRatio: `${data.doc.size.width} / ${data.doc.size.height}` } : undefined}>
      {data && <SlideThumb doc={data.doc} slide={data.slide} assetUrl={data.assetUrl} width={width} lazy={false} />}
    </button>
  );
}

function backupPill(m) {
  if (!m.last_backup_at) return <span class="pill is-warn">Never backed up</span>;
  const stale = Date.parse(m.updated_at) > Date.parse(m.last_backup_at);
  return <span class={`pill ${stale ? 'is-warn' : 'is-ok'}`}>Backed up {relativeTime(m.last_backup_at)}</span>;
}

export function Workspace() {
  const s = useSignal(settings);
  const [metas, setMetas] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [persisted, setPersisted] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const list = await listPresentations();
    setMetas(list);
    try {
      setPersisted(await navigator.storage?.persisted?.());
    } catch {
      setPersisted(null);
    }
    return list;
  };

  useEffect(() => {
    document.title = APP_NAME;
    refresh().then(async (list) => {
      const seen = await getSetting('welcomed', false);
      if (!list.length && !seen) {
        await setSetting('welcomed', true);
        const go = await openDialog(WelcomeDialog);
        if (go) {
          const id = await createFromBuiltinTemplate('getting-started');
          openPresentation(id);
        }
      }
    });
    return onChannel((m) => {
      if (m?.type === 'workspace-changed' || m?.type === 'doc-saved') refresh();
    });
  }, []);

  const visible = useMemo(() => {
    if (!metas) return [];
    let list = metas.filter((m) => (filter === 'trash' ? !!m.trashed_at : !m.trashed_at && (filter === 'templates' ? m.template : !m.template)));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((m) => m.title.toLowerCase().includes(q));
    }
    const key = s.sort;
    list.sort((a, b) => (key === 'name' ? a.title.localeCompare(b.title) : key === 'created' ? b.created_at.localeCompare(a.created_at) : b.updated_at.localeCompare(a.updated_at)));
    return list;
  }, [metas, filter, query, s.sort]);

  const needsBackup = useMemo(() => {
    if (!metas || !s.backupReminders || Date.now() < (s.reminderSnoozedUntil || 0)) return [];
    const week = 7 * 24 * 3600 * 1000;
    return metas.filter((m) => !m.trashed_at && (!m.last_backup_at ? Date.now() - Date.parse(m.created_at) > week : Date.parse(m.updated_at) > Date.parse(m.last_backup_at) && Date.now() - Date.parse(m.last_backup_at) > week));
  }, [metas, s.backupReminders, s.reminderSnoozedUntil]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMsg) toast(okMsg, { kind: 'success' });
      return r;
    } catch (e) {
      toast(e.message || String(e), { kind: 'error', duration: 8000 });
      return null;
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const onNew = async () => {
    const userTemplates = (metas || []).filter((m) => m.template && !m.trashed_at);
    const r = await openDialog(NewPresentationDialog, { userTemplates });
    if (!r) return;
    let id;
    if (r.kind === 'blank') id = await run(() => createBlank({ size: presetSize(r.size), themeId: r.theme }));
    else if (r.kind === 'builtin') id = await run(() => createFromBuiltinTemplate(r.id));
    else id = await run(() => createFromUserTemplate(r.id));
    if (id) openPresentation(id);
  };

  const onImport = async () => {
    const files = await pickFiles({ accept: '.pres,.zip,application/zip', multiple: true });
    if (files.length) {
      await importFiles(files, { openSingle: (id) => openPresentation(id) });
      refresh();
    }
  };

  const onBackupAll = async () => {
    const r = await run(() => backupEverything({ includeTrashed: false }));
    if (r) toast(`Backed up ${r.count} presentation${r.count === 1 ? '' : 's'}${r.parts > 1 ? ` in ${r.parts} parts` : ''}.`, { kind: 'success' });
  };

  const menuFor = (m) => {
    if (m.trashed_at) {
      return [
        { label: 'Restore', icon: 'restore', onSelect: () => run(() => withPresentationLock(m.id, () => restorePresentation(m.id)), 'Restored.') },
        { separator: true },
        {
          label: 'Delete forever',
          icon: 'trash',
          danger: true,
          onSelect: async () => {
            if (await confirmDialog({ title: 'Delete forever?', message: `“${m.title}” and its versions will be permanently deleted. This can’t be undone.`, confirmLabel: 'Delete forever', danger: true })) run(() => withPresentationLock(m.id, () => deleteForever(m.id)));
          },
        },
      ];
    }
    return [
      { label: 'Open', icon: 'file', onSelect: () => openPresentation(m.id) },
      { label: 'Duplicate', icon: 'copy', onSelect: () => run(() => duplicatePresentation(m.id), 'Duplicated.') },
      {
        label: 'Rename…',
        icon: 'text',
        onSelect: async () => {
          const t = await promptDialog({ title: 'Rename presentation', label: 'Title', value: m.title, confirmLabel: 'Rename' });
          if (t && t.trim()) {
            await run(async () => {
              await withPresentationLock(m.id, async () => {
                const rec = await loadDocument(m.id);
                const doc = { ...rec.doc, metadata: { ...rec.doc.metadata, title: t.trim().slice(0, 200), updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') } };
                const { saveDocument } = await import('../../storage/repo.js');
                await saveDocument(doc);
              });
            });
          }
        },
      },
      { label: 'Export backup (.pres)', icon: 'download', onSelect: () => run(() => exportPresentationFile(m.id), 'Exported.') },
      m.template
        ? { label: 'Remove from templates', icon: 'star', onSelect: () => run(() => patchMeta(m.id, { template: false })) }
        : { label: 'Save as template', icon: 'star', onSelect: () => run(() => duplicatePresentation(m.id, { asTemplate: true, title: `${m.title} (template)` }), 'Saved as a template.') },
      { separator: true },
      {
        label: 'Move to Trash',
        icon: 'trash',
        danger: true,
        onSelect: () =>
          run(async () => {
            await withPresentationLock(m.id, () => trashPresentation(m.id));
            broadcast({ type: 'workspace-changed' });
            toast(`Moved “${m.title}” to Trash.`, { action: { label: 'Undo', onClick: () => run(() => restorePresentation(m.id)) } });
          }),
      },
    ];
  };

  const trashCount = (metas || []).filter((m) => m.trashed_at).length;
  const tplCount = (metas || []).filter((m) => m.template && !m.trashed_at).length;

  return (
    <div class="ws">
      <header class="ws-head">
        <div class="ws-brand">
          <img src="./icons/icon.svg" alt="" />
          <h1 style={{ fontSize: '16px' }}>{APP_NAME}</h1>
        </div>
        <span class="spacer" />
        <Button variant="primary" icon="plus" onClick={onNew} disabled={busy}>New</Button>
        <Button icon="upload" onClick={onImport} disabled={busy}>Import</Button>
        <Button icon="download" onClick={onBackupAll} disabled={busy || !(metas || []).length}>Back up everything</Button>
        <MenuButton
          label="More"
          icon="more"
          placement="bottom-end"
          items={[
            { label: 'Storage…', icon: 'box', onSelect: () => openDialog(StorageDialog).then(refresh) },
            { label: 'Theme library…', icon: 'palette', onSelect: () => openDialog(ThemeLibraryDialog) },
            { label: 'Settings…', icon: 'settings', onSelect: () => openDialog(SettingsDialog) },
            { label: 'Keyboard shortcuts', icon: 'keyboard', onSelect: () => openDialog(ShortcutsDialog) },
            { label: 'About', icon: 'info', onSelect: () => openDialog(AboutDialog) },
          ]}
        />
      </header>
      <main class="ws-body">
        {!s.dismissed?.localFirst && (
          <div class="ws-notice is-info" role="note">
            <Icon name="info" />
            <div class="grow">
              <strong>Your presentations live only in this browser on this device.</strong> Clearing site data, private browsing or browser storage cleanup can delete them. Export backups to keep them safe.
              {persisted === false && <> Storage isn’t persistent yet — <button type="button" class="btn btn-ghost btn-sm" onClick={async () => { const ok = await requestPersistence({ force: true }); setPersisted(ok); toast(ok ? 'Storage is now persistent.' : 'The browser didn’t grant persistent storage.'); }}>request persistent storage</button></>}
            </div>
            <IconButton icon="close" label="Dismiss" onClick={() => updateSettings({ dismissed: { ...s.dismissed, localFirst: true } })} />
          </div>
        )}
        {needsBackup.length > 0 && filter !== 'trash' && (
          <div class="ws-notice" role="status">
            <Icon name="alert" />
            <div class="grow">{needsBackup.length === 1 ? `“${needsBackup[0].title}” has changes that haven’t been backed up for over a week.` : `${needsBackup.length} presentations have changes that haven’t been backed up for over a week.`}</div>
            <Button class="btn-sm" onClick={onBackupAll}>Back up everything</Button>
            <Button class="btn-sm" variant="ghost" onClick={() => updateSettings({ reminderSnoozedUntil: Date.now() + 3 * 24 * 3600 * 1000 })}>Snooze</Button>
          </div>
        )}
        <div class="ws-toolbar">
          <div class="segmented" role="tablist" aria-label="Filter">
            {[['all', 'Presentations'], ['templates', `Templates${tplCount ? ` (${tplCount})` : ''}`], ['trash', `Trash${trashCount ? ` (${trashCount})` : ''}`]].map(([v, l]) => (
              <button key={v} type="button" role="tab" aria-selected={filter === v} class={filter === v ? 'is-on' : ''} onClick={() => setFilter(v)}>{l}</button>
            ))}
          </div>
          <input class="input ws-search" type="search" placeholder="Search by title" aria-label="Search by title" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
          <span class="spacer" />
          <label class="row small muted">
            Sort
            <select class="input select" style={{ width: 'auto', height: '30px' }} value={s.sort} onChange={(e) => updateSettings({ sort: e.currentTarget.value })}>
              <option value="modified">Date modified</option>
              <option value="created">Date created</option>
              <option value="name">Name</option>
            </select>
          </label>
          <div class="segmented" aria-label="View">
            <button type="button" class={s.view === 'grid' ? 'is-on' : ''} aria-pressed={s.view === 'grid'} aria-label="Grid view" onClick={() => updateSettings({ view: 'grid' })}><Icon name="sorter" size={16} /></button>
            <button type="button" class={s.view === 'list' ? 'is-on' : ''} aria-pressed={s.view === 'list'} aria-label="List view" onClick={() => updateSettings({ view: 'list' })}><Icon name="menu" size={16} /></button>
          </div>
          {filter === 'trash' && trashCount > 0 && (
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                if (await confirmDialog({ title: 'Empty Trash?', message: 'Everything in Trash will be permanently deleted. This can’t be undone.', confirmLabel: 'Empty Trash', danger: true })) {
                  await run(async () => {
                    for (const m of metas.filter((x) => x.trashed_at)) await deleteForever(m.id);
                  }, 'Trash emptied.');
                }
              }}
            >
              Empty Trash
            </Button>
          )}
        </div>
        {filter === 'trash' && <p class="muted small">Items in Trash are deleted after 30 days.</p>}
        {metas === null ? (
          <p class="muted">Loading…</p>
        ) : visible.length === 0 ? (
          <div class="empty-state">
            {filter === 'trash' ? (
              <p>Trash is empty.</p>
            ) : filter === 'templates' ? (
              <p>No templates yet. Use “Save as template” on a presentation.</p>
            ) : (
              <div class="stack" style={{ alignItems: 'center' }}>
                <p>No presentations yet.</p>
                <div class="row">
                  <Button variant="primary" icon="plus" onClick={onNew}>New presentation</Button>
                  <Button onClick={async () => { const id = await run(() => createFromBuiltinTemplate('getting-started')); if (id) openPresentation(id); }}>Open the Getting started deck</Button>
                </div>
              </div>
            )}
          </div>
        ) : s.view === 'grid' ? (
          <div class="ws-grid" role="list">
            {visible.map((m) => (
              <article class="card" key={m.id} role="listitem" data-testid="pres-card">
                <CardThumb id={m.id} onOpen={() => !m.trashed_at && openPresentation(m.id)} label={`Open ${m.title}`} />
                <div class="card-body">
                  <div class="card-title" title={m.title}>{m.title}</div>
                  <div class="card-meta">
                    <span>{m.trashed_at ? `Deleted ${relativeTime(m.trashed_at)}` : `Edited ${relativeTime(m.updated_at)}`}</span>
                    {m.template && <span class="pill is-accent">Template</span>}
                    {m.linked_file && <span class="pill" title={`Linked to ${m.linked_file}`}><Icon name="link" size={12} /> File</span>}
                  </div>
                  {!m.trashed_at && <div class="card-meta">{backupPill(m)}</div>}
                </div>
                <div class="card-menu">
                  <MenuButton label={`Actions for ${m.title}`} icon="more" placement="bottom-end" items={() => menuFor(m)} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div class="ws-list" role="list">
            {visible.map((m) => (
              <div class="list-row" key={m.id} role="listitem" data-testid="pres-card">
                <CardThumb id={m.id} width={96} onOpen={() => !m.trashed_at && openPresentation(m.id)} label={`Open ${m.title}`} />
                <div>
                  <div class="card-title">{m.title}</div>
                  <div class="card-meta">{m.template && <span class="pill is-accent">Template</span>}</div>
                </div>
                <span class="small muted hide-sm">{m.trashed_at ? `Deleted ${relativeTime(m.trashed_at)}` : `Edited ${relativeTime(m.updated_at)}`}</span>
                <span class="hide-sm">{!m.trashed_at && backupPill(m)}</span>
                <MenuButton label={`Actions for ${m.title}`} icon="more" placement="bottom-end" items={() => menuFor(m)} />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export { formatBytes };
