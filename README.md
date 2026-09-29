# Presentation Editor

A local-first presentation editor that runs entirely in the browser. There is no
server, no account and no upload: presentations live in the browser's IndexedDB,
and the whole app is a static site you can host on GitHub Pages (or any static
host) and use offline once it has loaded.

The full product specification is in [`docs/SPEC.md`](docs/SPEC.md). Section
numbers in code comments (for example `spec §12.4`) refer to it.

## Features

- **Editing** — text with rich formatting, lists and links; 27 catalog shapes with
  adjustment handles; lines and connectors that stay attached; images (PNG, JPEG,
  GIF, WebP, AVIF, sanitized SVG) with crop and shape masks; MP4/WebM video with
  poster, trim and WebVTT captions; tables with merges; bar, line, pie, donut and
  scatter charts with a data grid; groups.
- **Layout tools** — smart guides and snapping, rulers and user guides, grid,
  align/distribute/match size, layers panel (hide, lock, reorder, regroup),
  keyboard nudging and resizing, zoom 10–400 %.
- **Structure** — sections, outline view, slide sorter, built-in and custom
  layouts with **Change layout** preview, master slide with fields (slide number,
  count, title, section, date), themes with a theme editor and a workspace theme
  library, templates.
- **Presenting** — full-window/fullscreen viewer with builds (appear, fade, fly,
  by paragraph, video play), transitions (fade, push, wipe), presenter view in a
  second window (notes, timer, next slide, laser pointer), overview grid, black and
  white screens, auto-advance and kiosk loop, deep links `#slide-n`.
- **Data safety** — autosave after every change, one editing tab per presentation
  (Web Locks) with **Edit here** handover, automatic and named versions with
  preview/restore/open as copy, Trash with undo, workspace backups, linked `.pres`
  files with Cmd/Ctrl+S (Chromium), persistent-storage request, backup reminders.
- **Import / export** — `.pres` (ZIP with a validated JSON manifest), PDF through
  the print dialog (slides, notes pages, handouts; Chromium and Firefox), PNG/JPEG
  images, a standalone offline HTML file (or web-folder ZIP) with a strict CSP, and
  an editable one-way PowerPoint `.pptx` (native shapes, text, tables, charts with
  embedded workbooks, pictures, connectors, groups, notes, sections, transitions
  and animations).
- **Accessibility** — keyboard operation of the editor, alt text and reading order,
  an accessibility checker with fixes, semantic output in the viewer and exported
  HTML, reduced-motion support.

## Getting started

Requirements: Node.js 20 or newer (22 recommended).

```bash
npm ci
npm run dev        # http://localhost:5173 (copies fonts, builds the viewer first)
```

Production build and local preview:

```bash
npm run build      # outputs dist/
npm run preview    # http://localhost:4173
```

`npm run build` runs two steps first: `npm run fonts` copies the bundled
OFL-licensed variable fonts from `node_modules/@fontsource-variable/*` into
`public/fonts` and writes the font registry (`src/generated/font-manifest.json`);
`npm run build:viewer` builds the standalone viewer (`public/viewer/viewer.js`)
that exported HTML files embed. Both outputs are generated and git-ignored.

## Hosting on GitHub Pages

The build uses relative URLs (`base: './'`), so the site works at
`https://<user>.github.io/<repo>/` without configuration.

1. Push this repository to GitHub (default branch `main`).
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` runs the unit tests, builds and
   publishes `dist/` on every push to `main` (or run it manually from the Actions
   tab).

Any other static host works too: upload the contents of `dist/`. Serve it over
HTTPS (or `localhost`) so the service worker, Web Locks and the clipboard APIs are
available.

## Tests

| Command | What it runs |
|---|---|
| `npm test` / `npm run test:unit` | Vitest unit tests (model, validation, JSON Schema, storage formats, ZIP, SVG sanitizer, find/replace, tables, charts, builds, PPTX/HTML writers) |
| `npm run test:e2e` | Playwright end-to-end tests, **headless** |
| `npm run test:e2e:headed` | The same tests in visible browser windows |
| `npm run test:e2e:xvfb` | Headed tests on a Linux machine without a display (uses `xvfb-run`) |
| `npm run test:all` | Unit tests, production build, then headless end-to-end tests |

The end-to-end tests run against the production build (`npm run preview` is
started automatically), so run `npm run build` first. Chromium is used by default;
choose engines with `PW_BROWSERS`, for example:

```bash
npx playwright install chromium firefox
PW_BROWSERS=chromium,firefox npm run test:e2e
```

The CI workflow (`.github/workflows/ci.yml`) runs the unit tests, builds, runs the
browser tests headless in Chromium and Firefox, and runs them again headed under
a virtual display. When a run fails, download the `playwright-report` artifact
from the run's summary page: it contains the HTML report and a trace for each
failed test (open one with `npx playwright show-trace path/to/trace.zip`).

The `.pres` manifest has a machine-readable JSON Schema in
[`schema/pres-format-v1.schema.json`](schema/pres-format-v1.schema.json). Check a
manifest with `npm run lint:schema -- path/to/manifest.json`.

## Project structure

```
src/
  core/        document model, validation, commands/undo, themes, layouts, text,
               geometry, tables, charts, builds, find/replace, accessibility
  render/      the shared slide renderer (editor, viewer, thumbnails, print,
               image export and exported HTML all use it)
  viewer/      presentation mode, presenter view, standalone HTML entry point
  storage/     IndexedDB repository, autosave session, locks and snapshots
  io/          .pres import/export, ZIP, hashing, SVG sanitizer, media checks
  export/      PDF print view, image export, standalone HTML, PPTX writer
  app/         Preact UI: workspace, editor (canvas, inspector, panels, dialogs)
  samples/     built-in templates, including the Getting started deck
schema/        JSON Schema for the .pres manifest
scripts/       font registry build, CSP and service-worker Vite plugins
tests/unit     Vitest
tests/e2e      Playwright
docs/SPEC.md   the product specification
```

## Architecture notes

- **One renderer.** `src/render/renderer.js` turns (document, slide, context) into
  DOM. The editor draws its overlay on top; the viewer, thumbnails, print view,
  image export and exported HTML use the same function, so output matches the
  editor.
- **Commands.** Every change is an immer recipe dispatched through
  `src/core/store.js`, which keeps structurally shared before/after documents for
  undo, coalesces continuous gestures, and validates in development builds.
- **Text editing** uses ProseMirror with a schema generated from the text model;
  the editable DOM uses the same styling code as the renderer.
- **Content Security Policy.** Production builds set a strict CSP (no inline
  scripts or style attributes; styles are applied through the CSSOM). Exported HTML
  allows only its own script and stylesheet by hash and blocks all network access.
- **Offline.** A service worker precaches the app shell, the viewer and the fonts.
  A new version installs in the background and the app offers **Reload** when it's
  ready.
- **Storage.** IndexedDB holds documents, assets (by SHA-256), snapshots, the
  theme library and editor state. The format version of stored documents is
  separate from the storage schema version.

## Browser support

Current Chrome, Edge and Firefox are fully supported. Safari can edit and present;
PDF export is disabled there (use HTML or image export), and linked `.pres` files
need the File System Access API (Chromium only).

## Known limitations

- PowerPoint export was checked with python-pptx and LibreOffice, not with
  Microsoft PowerPoint itself. Image fills other than *tile* are written as
  stretched fills, shadow blur is approximated, and fonts are not embedded (the
  export check lists the fonts recipients need).
- Exports run on the main thread (with progress; image export can be cancelled)
  rather than in workers.
- Copy puts the internal payload, HTML and plain text on the clipboard, but not a
  PNG of the selection. **Copy slide as image** in the slide list does copy a PNG.
- Choosing **Keep source formatting** after a cross-presentation paste is offered
  in the paste notification rather than a separate popover.
- Performance budgets from the specification have not been measured on the
  reference hardware.

## License

MIT for the application code (see `LICENSE`). The bundled fonts are licensed
under the SIL Open Font License 1.1; their attributions are shown in the app's
**About** dialog and ship in each `@fontsource-variable` package.
