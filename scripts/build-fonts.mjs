// Copies the curated, OFL-licensed variable fonts from node_modules into
// public/fonts and writes src/generated/font-manifest.json, the font registry
// the app, the viewer and the exporters read (spec §7.1).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFonts = join(root, 'public', 'fonts');
const outManifest = join(root, 'src', 'generated', 'font-manifest.json');

// Registry entries. IDs are permanent once shipped (spec §7.1).
const FAMILIES = [
  { id: 'builtin.inter', pkg: 'inter', name: 'Inter', category: 'sans', fallback: 'sans-serif' },
  { id: 'builtin.montserrat', pkg: 'montserrat', name: 'Montserrat', category: 'sans', fallback: 'sans-serif' },
  { id: 'builtin.source-serif-4', pkg: 'source-serif-4', name: 'Source Serif 4', category: 'serif', fallback: 'serif' },
  { id: 'builtin.playfair-display', pkg: 'playfair-display', name: 'Playfair Display', category: 'display', fallback: 'serif' },
  { id: 'builtin.jetbrains-mono', pkg: 'jetbrains-mono', name: 'JetBrains Mono', category: 'monospace', fallback: 'monospace' },
  { id: 'builtin.caveat', pkg: 'caveat', name: 'Caveat', category: 'handwriting', fallback: 'cursive' },
  { id: 'builtin.noto-sans-arabic', pkg: 'noto-sans-arabic', name: 'Noto Sans Arabic', category: 'sans', fallback: 'sans-serif', onDemand: true, script: 'arabic' },
  { id: 'builtin.noto-sans-hebrew', pkg: 'noto-sans-hebrew', name: 'Noto Sans Hebrew', category: 'sans', fallback: 'sans-serif', onDemand: true, script: 'hebrew' },
  { id: 'builtin.noto-sans-devanagari', pkg: 'noto-sans-devanagari', name: 'Noto Sans Devanagari', category: 'sans', fallback: 'sans-serif', onDemand: true, script: 'devanagari' },
  { id: 'builtin.noto-sans-thai', pkg: 'noto-sans-thai', name: 'Noto Sans Thai', category: 'sans', fallback: 'sans-serif', onDemand: true, script: 'thai' },
  { id: 'builtin.noto-sans-jp', pkg: 'noto-sans-jp', name: 'Noto Sans JP', category: 'sans', fallback: 'sans-serif', onDemand: true, script: 'japanese' },
  { id: 'builtin.noto-sans-sc', pkg: 'noto-sans-sc', name: 'Noto Sans SC', category: 'sans', fallback: 'sans-serif', onDemand: true, script: 'chinese' },
  { id: 'builtin.noto-sans-kr', pkg: 'noto-sans-kr', name: 'Noto Sans KR', category: 'sans', fallback: 'sans-serif', onDemand: true, script: 'korean' },
];

function parseFaces(cssText) {
  const faces = [];
  const re = /@font-face\s*{([^}]*)}/g;
  let m;
  while ((m = re.exec(cssText))) {
    const block = m[1];
    const get = (prop) => {
      const r = new RegExp(prop + '\\s*:\\s*([^;]+);').exec(block);
      return r ? r[1].trim() : null;
    };
    const src = /url\(\.\/files\/([^)]+)\)/.exec(block);
    faces.push({
      family: get('font-family').replace(/['"]/g, ''),
      style: get('font-style'),
      weight: get('font-weight'),
      unicodeRange: get('unicode-range'),
      file: src[1],
    });
  }
  return faces;
}

if (existsSync(outFonts)) rmSync(outFonts, { recursive: true });
mkdirSync(outFonts, { recursive: true });
mkdirSync(dirname(outManifest), { recursive: true });

const registry = [];
for (const fam of FAMILIES) {
  const dir = join(root, 'node_modules', '@fontsource-variable', fam.pkg);
  const meta = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
  const faces = [];
  for (const cssName of ['wght.css', 'wght-italic.css']) {
    const p = join(dir, cssName);
    if (!existsSync(p)) continue;
    for (const f of parseFaces(readFileSync(p, 'utf8'))) {
      const destDir = join(outFonts, fam.pkg);
      mkdirSync(destDir, { recursive: true });
      copyFileSync(join(dir, 'files', f.file), join(destDir, f.file));
      faces.push({ ...f, file: `fonts/${fam.pkg}/${f.file}` });
    }
  }
  const w = meta.variable?.wght || { min: '400', max: '400' };
  registry.push({
    id: fam.id,
    name: fam.name,
    cssFamily: faces[0].family,
    category: fam.category,
    genericFallback: fam.fallback,
    onDemand: !!fam.onDemand,
    script: fam.script || null,
    weights: [Number(w.min), Number(w.max)],
    italic: faces.some((f) => f.style === 'italic'),
    subsets: meta.subsets,
    license: meta.license.type,
    attribution: meta.license.attribution || '',
    faces,
  });
}

writeFileSync(outManifest, JSON.stringify({ version: 1, families: registry }, null, 1));
console.log(`fonts: ${registry.length} families, ${registry.reduce((n, f) => n + f.faces.length, 0)} faces`);
