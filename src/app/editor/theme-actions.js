// Theme library actions from the editor (spec §6.4).
import { putLibraryTheme } from '../../storage/repo.js';
import { scaleThemeLengths, FONT_TOKENS } from '../../core/theme.js';
import { prepareAsset } from '../../io/assets.js';
import { registerCustomFonts } from '../../render/fonts.js';
import { newId } from '../../core/ids.js';
import { nowIso } from '../../core/model.js';
import { toast, promptDialog } from '../ui/components.jsx';

const BUILTIN_SOURCE_HEIGHT = 720;

function fitTheme(theme, fromHeight, toHeight) {
  const t = structuredClone(theme);
  const from = t.source_height || fromHeight || BUILTIN_SOURCE_HEIGHT;
  const out = Math.abs(from - toHeight) > 0.5 ? scaleThemeLengths(t, toHeight / from) : t;
  delete out.source_height;
  return out;
}

// choice: { kind: 'builtin', theme } | { kind: 'library', entry }
export async function applyLibraryTheme(ctl, choice) {
  if (ctl.state.readOnly) return;
  const H = ctl.doc.size.height;
  if (choice.kind === 'builtin') {
    await ctl.applyTheme(fitTheme(choice.theme, BUILTIN_SOURCE_HEIGHT, H), { label: `Apply theme “${choice.theme.name}”` });
    toast(`Applied “${choice.theme.name}”.`, { kind: 'success' });
    return;
  }
  const entry = choice.entry;
  const theme = fitTheme(entry.theme, entry.source_height, H);
  // copy the custom fonts the theme uses into the presentation
  const families = [];
  const records = [];
  for (const fam of entry.fonts || []) {
    if ((ctl.doc.fonts || []).some((f) => f.id === fam.id)) continue;
    const faces = [];
    for (const face of fam.faces || []) {
      if (!face.blob) continue;
      try {
        const p = await prepareAsset(new File([face.blob], `${fam.family_name}.${(face.media_type || 'font/woff2').split('/')[1]}`, { type: face.media_type || face.blob.type }), { stripMetadata: false });
        await ctl.assets.add(p.record, p.blob);
        records.push(p.record);
        faces.push({ asset_id: p.record.id, weight: face.weight || 400, style: face.style || 'normal' });
      } catch {
        /* a broken font file falls back */
      }
    }
    families.push({ id: fam.id, family_name: fam.family_name, faces, ...(fam.fallback ? { fallback: fam.fallback } : {}), ...(fam.restricted ? { restricted: true } : {}) });
  }
  await ctl.session?.snapshot(`Before: Apply theme “${entry.name}”`);
  ctl.dispatch(`Apply theme “${entry.name}”`, (d) => {
    for (const r of records) if (!d.assets.some((a) => a.id === r.id)) d.assets.push(r);
    d.fonts ||= [];
    for (const f of families) d.fonts.push(f);
    // font references the presentation can't resolve fall back to the body font
    for (const k of FONT_TOKENS) {
      const v = theme.fonts[k];
      if (typeof v === 'string' && !v.startsWith('builtin.') && !d.fonts.some((f) => f.id === v)) theme.fonts[k] = 'builtin.inter';
    }
    d.theme = theme;
  });
  if (families.length) await registerCustomFonts(ctl.doc, async (id) => (await ctl.assets.blobAsync(id))?.arrayBuffer());
  toast(`Applied “${entry.name}”.`, { kind: 'success' });
}

export async function saveThemeToLibrary(ctl) {
  const name = await promptDialog({ title: 'Save theme to library', label: 'Theme name', value: ctl.doc.theme.name, maxLength: 100 });
  if (!name || !name.trim()) return;
  const theme = structuredClone(ctl.doc.theme);
  theme.id = newId();
  theme.name = name.trim().slice(0, 100);
  const famIds = new Set(Object.values(theme.fonts).filter((v) => typeof v === 'string' && !v.startsWith('builtin.')));
  const fonts = [];
  for (const fam of ctl.doc.fonts || []) {
    if (!famIds.has(fam.id)) continue;
    const faces = [];
    for (const f of fam.faces) {
      const blob = await ctl.assets.blobAsync(f.asset_id);
      const rec = ctl.doc.assets.find((a) => a.id === f.asset_id);
      if (blob) faces.push({ asset_id: f.asset_id, weight: f.weight, style: f.style, media_type: rec?.media_type || blob.type, blob });
    }
    fonts.push({ id: fam.id, family_name: fam.family_name, fallback: fam.fallback, restricted: fam.restricted, faces });
  }
  await putLibraryTheme({ id: newId(), name: theme.name, theme, source_height: ctl.doc.size.height, created_at: nowIso(), fonts });
  toast(`Saved “${theme.name}” to the theme library.`, { kind: 'success' });
}
