import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

// The app's Content Security Policy (spec §18.3). Only injected into production
// builds, because the Vite dev server relies on inline scripts for hot reload.
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "font-src 'self' blob: data:",
  // https: is only used for the single, user-started remote image fetch (spec §8.3).
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export function cspPlugin() {
  return {
    name: 'pe-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="utf-8" />',
        `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${APP_CSP}" />`,
      );
    },
  };
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// Writes dist/sw.js with a precache list of the app shell, renderer, viewer
// bundle, core fonts and templates (spec §3.5). Fonts for other scripts are
// left out and cached on first use.
export function serviceWorkerPlugin() {
  let outDir = 'dist';
  return {
    name: 'pe-service-worker',
    apply: 'build',
    configResolved(cfg) {
      outDir = cfg.build.outDir;
    },
    closeBundle() {
      const manifest = JSON.parse(readFileSync('src/generated/font-manifest.json', 'utf8'));
      const onDemand = new Set(
        manifest.families.filter((f) => f.onDemand).flatMap((f) => f.faces.map((x) => x.file)),
      );
      const files = walk(outDir)
        .map((p) => relative(outDir, p).split(sep).join('/'))
        .filter((f) => f !== 'sw.js' && !onDemand.has(f) && !f.endsWith('.map'));
      const hash = createHash('sha256');
      for (const f of files.sort()) {
        hash.update(f);
        hash.update(readFileSync(join(outDir, f)));
      }
      const version = hash.digest('hex').slice(0, 16);
      const template = readFileSync('scripts/sw-template.js', 'utf8');
      const sw = template
        .replace('__VERSION__', JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify(['./', ...files]));
      writeFileSync(join(outDir, 'sw.js'), sw);
      writeFileSync(join(outDir, 'version.json'), JSON.stringify({ version }));
    },
  };
}
