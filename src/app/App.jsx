import { useEffect, useState } from 'preact/hooks';
import { Workspace } from './workspace/Workspace.jsx';
import { Editor } from './editor/Editor.jsx';
import { DialogHost, ToastHost, ContextMenuHost, LiveRegion, toast, Button } from './ui/components.jsx';
import { importFiles } from './importer.js';
import { purgeTrash, cleanupPendingAssets } from '../storage/repo.js';
import { setVersionChangeHandler } from '../storage/db.js';
import { broadcast, onChannel } from '../storage/session.js';
import { currentRoute, openPresentation } from './nav.js';

function isPresFile(f) {
  return /\.(pres|zip)$/i.test(f.name || '') || f.type === 'application/zip' || f.type === 'application/x-presentation-editor';
}

function UpdateBanner({ onReload }) {
  return (
    <div class="update-banner" role="status">
      <span>Update ready.</span>
      <Button variant="primary" class="btn-sm" onClick={onReload}>Reload</Button>
    </div>
  );
}

export function App() {
  const [route, setRoute] = useState(currentRoute());
  const [dragging, setDragging] = useState(false);
  const [update, setUpdate] = useState(null);
  const [storageBlocked, setStorageBlocked] = useState(false);

  useEffect(() => {
    const on = () => setRoute(currentRoute());
    window.addEventListener('popstate', on);
    window.addEventListener('pe-route', on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('pe-route', on);
    };
  }, []);

  // startup maintenance
  useEffect(() => {
    purgeTrash().catch(() => undefined);
    cleanupPendingAssets().catch(() => undefined);
    setVersionChangeHandler(() => {
      setStorageBlocked(true);
      broadcast({ type: 'app-updated' });
    });
    const off = onChannel((m) => {
      if (m?.type === 'app-updated') setStorageBlocked(true);
    });
    return off;
  }, []);

  // service worker and updates (spec §3.5)
  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((reg) => {
        const check = (w) => {
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) setUpdate(reg);
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) setUpdate(reg);
        reg.addEventListener('updatefound', () => check(reg.installing));
        setInterval(() => reg.update().catch(() => undefined), 60 * 60 * 1000);
      })
      .catch(() => undefined);
    let reloading = false;
    // The first install claims this page too; only an update (a previous
    // controller existed) should reload it.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return;
      reloading = true;
      location.reload();
    });
  }, []);

  // file handling: launching the installed app with a .pres file (spec §10.6)
  useEffect(() => {
    if (!('launchQueue' in window)) return;
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const files = [];
      for (const h of params.files) files.push(await h.getFile());
      const ids = await importFiles(files, { openSingle: (id) => openPresentation(id) });
      if (ids.length === 1 && params.files.length === 1) {
        try {
          const { setFileHandle, patchMeta } = await import('../storage/repo.js');
          await setFileHandle(ids[0], params.files[0]);
          await patchMeta(ids[0], { linked_file: params.files[0].name });
        } catch {
          /* linking is optional */
        }
      }
    });
  }, []);

  // drop .pres / backup files onto any window (spec §10.6)
  useEffect(() => {
    let depth = 0;
    const hasPres = (e) => [...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file' && (/zip|presentation/.test(i.type) || i.type === ''));
    const enter = (e) => {
      if (!hasPres(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = async (e) => {
      depth = 0;
      setDragging(false);
      const files = [...(e.dataTransfer?.files || [])].filter(isPresFile);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      await importFiles(files, { openSingle: (id) => openPresentation(id) });
    };
    const over = (e) => {
      if (hasPres(e)) e.preventDefault();
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop, true);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop, true);
    };
  }, []);

  const reloadForUpdate = async () => {
    window.dispatchEvent(new Event('pe-flush'));
    await new Promise((r) => setTimeout(r, 300));
    if (update?.waiting) update.waiting.postMessage({ type: 'skip-waiting' });
    else location.reload();
  };

  return (
    <>
      {storageBlocked && (
        <div class="banner is-error" role="alert">
          The app was updated in another tab. <Button variant="primary" class="btn-sm" onClick={() => location.reload()}>Reload</Button>
        </div>
      )}
      {route.name === 'editor' ? <Editor key={route.id} id={route.id} readOnlyForced={storageBlocked} /> : <Workspace />}
      {update && <UpdateBanner onReload={reloadForUpdate} />}
      {dragging && <div class="drop-overlay">Drop .pres files or a backup to import</div>}
      <DialogHost />
      <ContextMenuHost />
      <ToastHost />
      <LiveRegion />
    </>
  );
}

