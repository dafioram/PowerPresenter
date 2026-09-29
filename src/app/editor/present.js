// Presentation mode in the app (spec §14.1): a full-window viewer in the same
// tab, working from a snapshot of the document taken when it opens.
import { createViewer, needsStartOverlay } from '../../viewer/viewer.js';
import { slideOrder } from '../../core/model.js';
import { registerRegistryFaces, registerCustomFonts } from '../../render/fonts.js';
import { toast } from '../ui/components.jsx';

let active = null;

export function isPresenting() {
  return !!active;
}

export function startPresenting(ctl, { fromBeginning = false, presenter = false } = {}) {
  if (active || !ctl.doc) return null;
  ctl.endTextEditing();
  const doc = ctl.doc; // immutable snapshot
  const slideIds = slideOrder(doc);
  const host = document.createElement('div');
  host.className = 'present-root';
  host.dataset.testid = 'present-root';
  document.body.appendChild(host);
  const inner = document.createElement('div');
  host.appendChild(inner);
  const assets = ctl.assets;
  const fontGetter = async (id) => (await assets.blobAsync(id))?.arrayBuffer();
  const prevHash = location.hash;
  const viewer = createViewer(inner, {
    doc,
    slideIds,
    assetUrl: (id) => assets.url(id),
    assetInfo: (id) => (doc.assets || []).find((a) => a.id === id) || null,
    mode: 'app',
    presenter: true,
    notes: true,
    deepLinks: true,
    getCaptionsText: async (id) => {
      const b = await assets.blobAsync(id);
      return b ? b.text() : null;
    },
    registerFonts: (d) => {
      registerRegistryFaces(d);
      registerCustomFonts(doc, fontGetter, d);
    },
    onPopupBlocked: () => toast('Your browser blocked the presenter window. Allow pop-ups for this site (see the icon in the address bar), then press S.', { kind: 'info', duration: 10000 }),
    onExit: (slideId) => stop(slideId),
  });
  active = { viewer, host };
  ctl.set({ presenting: true });

  function stop(slideId) {
    if (!active) return;
    active = null;
    host.remove();
    try {
      history.replaceState(history.state, '', `${location.pathname}${location.search}${prevHash && !/^#slide-/.test(prevHash) ? prevHash : ''}`);
    } catch {
      /* ignore */
    }
    ctl.set({ presenting: false });
    if (slideId && ctl.doc.slides[slideId]) ctl.setSlide(slideId);
    document.querySelector('[data-testid="canvas"]')?.focus();
  }

  let index = fromBeginning ? viewer.firstVisible() : Math.max(0, slideIds.indexOf(ctl.state.slideId));
  if (ctl.state.mode !== 'slide' && !fromBeginning) index = Math.max(0, slideIds.indexOf(ctl.state.slideId));
  // The presenter popup must open from the user's gesture, before anything async.
  if (presenter) viewer.showPresenter();
  viewer.start(index, { fullscreen: true, overlay: needsStartOverlay(doc, doc.slides[slideIds[index]]) });
  return viewer;
}
