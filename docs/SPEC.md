# Presentation Editor — Specification

**Status:** Revised draft (revision 2)
**Release scope:** Complete — everything in this document ships in the first release
**Product type:** Local-first static web application, installable as a PWA
**Native file format:** `.pres` (format version 1)

## Revision summary

This revision replaces the V1/deferred split with one complete release and resolves the open questions in the previous draft.

- **Scope.** Speaker notes, presenter view, tables, charts, transitions, builds, video, custom fonts, version snapshots, export ranges and one-way PPTX export are now in scope. Collaboration, accounts, sync, PPTX import and audio-only media remain out (§2).
- **Architecture decisions.** Rendering uses DOM/CSS + SVG (§3.2). Text editing uses a structured rich-text engine (§3.3). PDF uses the print pipeline in Chromium and Firefox only (§15.3). PNG export rasterizes the shared renderer (§15.4).
- **Units defined.** 1 unit = 1/96 in, so 16:9 is 1280 × 720 (§4).
- **Contradictions resolved:**
  - Layouts are templates only. The "layout-provided style" level is replaced by theme role styles (§5.12, §6.2).
  - Elements gain `role` and `name`, and every slide has a resolvable title (§5.5, §5.6).
  - Groups are containers with nested children and a defined resize rule. Tables can't be grouped, as in PowerPoint (§13.5).
  - Lines and connectors use endpoint geometry (§5.7, §13.3).
  - Image crop has a model (§13.4).
  - Reading order has a defined default (§5.15).
  - Size changes use fit-and-center (§4.4).
  - ID, paste and import-conflict rules are defined (§5.2, §10.5).
  - Asset cleanup respects undo history and snapshots (§8.5).
  - Remote image fetching is limited to one user-initiated attempt (§8.3).
  - Unknown fields and types are validation errors, and every schema change bumps `format_version` (§5.18, §10.7).
- **Data safety (§9, §3.5).** One editor per presentation across tabs, persistent storage, automatic snapshots, trash, backups and reminders, offline via service worker, storage migrations, and linked files in Chromium.
- **New features:** masters and fields, hidden slides, slide links, text in shapes, connectors, flip, gradient and image fills, per-slide backgrounds, layers panel, rulers and guides, format painter, find and replace, rich paste, theme library and templates, accessibility checker, image export, handouts and notes pages, kiosk mode, deep links.
- **Security and privacy (§18).** User SVG renders only as images, style values are strictly validated, decompressed sizes are enforced, and metadata is stripped from added photos.
- **Numbers.** Performance budgets and limits are now concrete (§20).

## Contents

1. Product definition
2. Release scope
3. Architecture
4. Units, coordinates and presentation size
5. Document model
6. Themes and style resolution
7. Fonts
8. Assets
9. Storage and data safety
10. The `.pres` format
11. Workspace
12. Editor
13. Content types
14. Presenting
15. Export
16. Accessibility
17. Internationalization
18. Privacy and security
19. Error handling
20. Performance budgets and limits
21. Testing and release acceptance
22. Out of scope
23. Future extension points

Appendix A. Illustrative document excerpt

---

## 1. Product definition

Presentation Editor is a browser-based application for creating, editing, presenting and exporting slide presentations without an account or a backend.

It is not a PowerPoint clone. It is a focused authoring environment built around a portable, versioned, declarative presentation document.

### Core principles

- **Local first:** Presentation data lives on the user's device. The static host stores no presentation content.
- **Data safety first:** The browser may hold the only copy of someone's work, so the app actively protects it with one editor per presentation, persistent-storage requests, automatic snapshots, a trash and prominent backups.
- **Portable by design:** `.pres` is the native format for exchange, backup and archiving.
- **One document model:** The editor, the viewer and every exporter consume the same canonical model.
- **One renderer:** The editor, viewer, thumbnails, print view, image export and exported HTML all use the same rendering code.
- **Declarative content:** Documents never contain DOM nodes, HTML, CSS text, scripts, canvas pixels or generated output.
- **Predictable rendering:** Output is deterministic for a given document, app version, set of font files and browser engine.
- **Explicit compatibility:** Imports are validated, older formats migrate deterministically, and newer formats are refused with a clear message.
- **Private by default:** There are no accounts, analytics, telemetry or third-party requests. After the first load, everything works offline.
- **Honest limits:** When a target format or browser can't do something, the app says so before the user commits.
- **Coherent scope:** A coherent model and reliable behavior matter more than matching desktop suites feature for feature.

---

## 2. Release scope

### In scope

- **Workspace:** multiple local presentations, templates, a theme library, trash, storage status, and backup and restore for single presentations or the whole workspace.
- **Structure:** slides, sections, hidden slides, built-in and custom layouts, master elements with fields, themes.
- **Content:** rich text, links, images, SVG, shapes (with text), lines, connectors, groups, tables, charts, and video with captions.
- **Manipulation:** free positioning, resizing, rotation, flipping, snapping, rulers and guides, alignment, distribution, grouping, layer ordering and a layers panel.
- **Authoring tools:** session undo and redo, format painter, find and replace, rich paste, outline mode, slide sorter, speaker notes, transitions, builds and an accessibility checker.
- **Data safety:** autosave, cross-tab locking, persistent storage, snapshots (version history), trash, backup reminders, and linked files in Chromium.
- **Presenting:** presentation mode, presenter view, overview grid, blank screen, laser pointer, kiosk and auto-advance, deep links.
- **Export:**
  - `.pres`
  - PDF (slides, notes pages, handouts) in Chromium and Firefox
  - PNG and JPEG
  - standalone HTML (single file or web folder)
  - PowerPoint `.pptx` (one-way)
  - workspace backup
- **Platform:** an installable PWA that works offline after the first load (§3.5).

### Out of scope

| Item | Reason |
|---|---|
| Collaboration, comments, review workflows | Need shared state; conflict with the local-first premise |
| Accounts, cloud storage, sync | Same |
| Import from PPTX, Keynote or Google Slides | Faithful import would mean approximating unsupported constructs (§22) |
| Audio-only media, music that plays across slides | Low value relative to the complexity of cross-slide playback |
| Motion paths, emphasis effects, morph, 3D | Complex timing model; poor portability |
| Freehand drawing, equations, code highlighting | Candidates for later (§23) |
| Image filters and adjustments | Images get crop, mask, border and shadow only |
| Vertical text | Layout complexity for a rare need |
| Font subsetting | A size optimization, not needed for correctness |
| Direct PDF generation; PDF export in WebKit browsers | The print pipeline was chosen instead (§15.3) |

---

## 3. Architecture

### 3.1 Modules

1. **Document core:** the canonical model, schema validation, migrations and the command system. Pure logic with no UI dependencies; it runs on the main thread and in workers.
2. **Storage service:** IndexedDB access, autosave, cross-tab locks, snapshots, trash, persistent storage and linked files (§9).
3. **Renderer:** turns a document, or part of one, into a DOM slide tree (§3.2).
4. **Editor:** UI, selection, tools and overlays. It changes the document only by sending commands to the document core.
5. **Viewer:** read-only navigation for presentation mode, presenter view and exported HTML. It is built as a small bundle that includes the renderer.
6. **Workspace:** creates, opens, duplicates, renames, trashes, imports and backs up presentations.
7. **Import/export:**
   - `.pres` reader and writer
   - print view (for PDF)
   - image rasterizer
   - HTML exporter
   - PPTX writer
   - workspace backup

The app is served as static files. It needs no server-side storage, server-side rendering or application APIs. Heavy work runs in Web Workers with progress reporting and cancellation: ZIP handling, hashing, probing images and media, and generating PPTX.

### 3.2 Rendering

**Decision:** rendering is DOM-based.

- Each slide renders into a fixed-size container W × H CSS pixels in size, where one logical unit is one CSS pixel (§4.1). A CSS transform scales the container uniformly to fit the viewport.
- Text renders as HTML flow content (paragraphs, lists, spans and links) laid out by the browser.
- The renderer generates inline SVG for shapes, lines, connectors, arrowheads and masks from the shape catalog (§13.2). User-supplied SVG never renders inline (§18.2).
- Other element types render as follows:
  - images and user SVG as `<img>`
  - tables as `<table>`
  - charts as SVG generated by the renderer
  - video as `<video>` with a poster
- DOM order follows reading order (§5.15), while visual stacking uses `z-index` derived from layer order. Screen readers therefore follow reading order, and what you see follows layer order. Elements outside the reading order, such as decorative ones, come after it in the DOM and are hidden from assistive technology.

**Rules:**

- The renderer is a function of the document, the slide and a render context. The context carries the mode (`edit`, `view`, `print`, `raster` or `thumbnail`), the build step, and field values (§5.11). The renderer reads no other state.
- The editor draws selection boxes, handles, guides, prompts and overflow markers in a separate overlay layer and never modifies the rendered slide DOM. The one exception is the text engine, which takes over a text body's DOM while that body is being edited, using the same styling (§3.3).
- Style values are applied with CSSOM property setters, and only values that passed validation are used (§18.2). User strings are never concatenated into markup, stylesheets or class names.
- The renderer signals **ready** only after the fonts and images a slide needs have loaded and decoded. Thumbnails, printing, rasterization and PPTX measurement all wait for this signal.
- Exported HTML bundles the same renderer version as the app that produced it.

**Rationale:** the platform provides native text layout and editing, bidirectional text, complex scripts, accessibility semantics, HTML export and printing. The cost is that line breaks can differ between browser engines, which §3.4 accepts.

### 3.3 Text editing engine

**Decision:** text editing uses a proven structured rich-text engine (reference candidate: ProseMirror). Its schema is generated from the canonical text model (§5.9).

- It is used for text elements, text in shapes, table cells and speaker notes.
- It handles IME composition, selection, native spellcheck, keyboard navigation and the text clipboard.
- Engine transactions become document commands and are coalesced as described in §12.3.
- While a text body is being edited, the engine's editable DOM replaces the rendered body and uses the same styling rules. Editing and rendering therefore match.
- No code outside the engine manipulates `contenteditable` directly.

### 3.4 Determinism

Rendering is deterministic for the same document, app version, font files and browser engine. These rules make that possible:

- All curated fonts are bundled with the app and loaded as web fonts. Device fonts are opt-in and flagged as non-portable (§7.3).
- Font synthesis is disabled, and the UI offers only the weights and styles a family actually has.
- Hyphenation is off. Line breaking uses browser defaults plus `overflow-wrap: break-word`, so a long word never overflows a box horizontally.
- Slide layout never depends on the viewport. Everything inside a slide is in slide units, with no viewport units or media queries.
- The only input from outside the document is the value of auto-updating date fields, which is passed in the render context.

Identical line breaks across different browser engines are a goal, not a guarantee. Each engine has its own set of golden screenshots (§21).

### 3.5 Delivery, offline use and updates

- **Build output:** static files with content-hashed names.
- **PWA:** a web app manifest plus a service worker that precaches the app shell, renderer, viewer bundle, core fonts and built-in templates. Larger optional resources, such as fonts for non-Latin scripts, are fetched from the app's own origin on first use and then cached.
- **Offline:** every feature works offline after the first load. Fonts for other scripts are downloaded the first time they're needed, or all at once with **Download all fonts** in Settings (§11). Until a font is cached, text in that script uses a fallback font.
- **Network use:** the app contacts the network only for its own files and updates, on-demand fonts from its own origin, and remote image fetches the user explicitly starts (§8.3). It makes no third-party requests.
- **Updates:** a new version installs in the background, and the UI then shows **Update ready — Reload**. The app never reloads on its own while an editor is open, and it flushes pending saves before reloading. Rules for tabs running different versions are in §9.9.
- **File handling:** where the browser supports it, the installed app registers as the handler for `.pres` files, and launching the app with a file opens that file (§10.6).

### 3.6 Browser support

The app supports the two latest major versions of each browser at the time of release.

| Capability | Chromium (Chrome, Edge) | Firefox | Safari (macOS) | Tablets | Phones |
|---|---|---|---|---|---|
| Editor | ✓ | ✓ | ✓ | Best effort | — |
| Presentation mode | ✓ | ✓ | ✓ | ✓ | ✓ |
| Presenter view | ✓ | ✓ | ✓ | — | — |
| PDF export | ✓ | ✓ | Disabled, with an explanation | — | — |
| PNG/JPEG export, copy as image | ✓ | ✓ | Only if verified in release testing | — | — |
| Opening exported HTML | ✓ | ✓ | ✓ | ✓ | ✓ |
| Linked files (save back to disk) | ✓ | — | — | — | — |
| Open `.pres` by double-click (installed app) | ✓ | — | — | — | — |
| Put audience window on a chosen screen | ✓ (with permission) | Manual | Manual | — | — |

On phones, the workspace lists presentations and can present them and export `.pres` files, but editing isn't offered. When a capability is unavailable, its control is disabled with an explanation and, where possible, an alternative.

---

## 4. Units, coordinates and presentation size

### 4.1 Logical units

- **1 unit = 1/96 inch.** At 100% zoom, one unit is one CSS pixel.
- Every length in the document is stored in units, including positions, sizes, font sizes, stroke widths, spacing, insets, radii and shadow offsets.
- The UI shows font sizes and stroke widths in points (1 pt = 4/3 units). Positions and sizes are shown in the user's preferred measure — units, inches or centimeters — which is an app preference.
- Stored values are finite numbers with fixed rounding:
  - lengths to 0.01 unit
  - angles to 0.01 degree, in the range [0, 360)
  - opacity to 0.001, in the range 0–1

### 4.2 Slide sizes

Slide size applies to the whole presentation.

| Preset | Units (W × H) | Physical size |
|---|---|---|
| 16:9 (default) | 1280 × 720 | 13.333 × 7.5 in |
| 4:3 | 960 × 720 | 10 × 7.5 in |
| 16:10 | 1280 × 800 | 13.333 × 8.333 in |
| A4 landscape | 1122.52 × 793.7 | 297 × 210 mm |
| Letter landscape | 1056 × 816 | 11 × 8.5 in |
| Custom | 96–5376 per side | 1–56 in per side |

Each preset also has a portrait orientation, with width and height swapped. The physical size sets the PDF page size (§15.3) and the PPTX slide size, where 1 unit = 9,525 EMU (§15.6).

### 4.3 Coordinates and transforms

- The origin is the slide's top-left corner. x increases to the right and y increases downward.
- **Box geometry** has these fields:
  - `x`, `y`: the top-left corner of the unrotated box, in parent coordinates
  - `width`, `height`: each at least 1 unit
  - `rotation`: degrees clockwise about the box center, default 0
  - `flip_x`, `flip_y`: mirror within the box, default false
- **Transform order:** mirror, then rotate about the center, then translate. This matches CSS transforms and DrawingML.
- **Endpoint geometry** (lines and connectors) is two points in parent coordinates, with no rotation or flip. The bounding box is derived from the points.
- **Parent coordinates** are slide coordinates for top-level elements and group-local coordinates for group children (§13.5).
- **Layer order** is the order within the parent's element array; later elements render above earlier ones. Master elements render beneath all slide elements.

### 4.4 Changing the slide size

Changing the size opens a dialog with two options. The change is a single undoable command, and an automatic snapshot is taken first (§9.5).

- **Fit content (default):**
  - Let s = min(W₂/W₁, H₂/H₁).
  - Every length is multiplied by s, including geometry, font sizes, strokes, spacing, insets and shadows.
  - Content is then centered by offsetting it by ((W₂ − s·W₁)/2, (H₂ − s·H₁)/2).
  - This applies to slides, master elements, custom layouts, guides and the lengths in the embedded theme (role style sizes, spacing and element defaults).
- **Keep content size:**
  - Lengths don't change.
  - Content is offset by ((W₂ − W₁)/2, (H₂ − H₁)/2) so it stays centered.
  - Afterward, a report lists every element that now falls partly or fully outside the slide, with links that select them.

Background image fills are re-fitted according to their fill mode. Built-in layouts are defined relative to the slide size, so they adapt automatically (§5.12).

---

## 5. Document model

### 5.1 Overview

The canonical model is JSON-serializable and declarative. It never stores derived layout, such as measured line breaks, computed shrink-to-fit scales or rendered heights.

```text
Presentation
├── id
├── metadata            title, author, description, language, timestamps
├── size
├── theme               tokens, role styles, defaults (§6)
├── fonts               custom font families (§7.2)
├── master              elements shown on every slide (§5.11)
├── layouts             custom layouts (§5.12)
├── assets              asset records; binaries stored separately (§8)
├── sections            ordered sections, which define slide order (§5.4)
├── slides              map of slide id → slide
│   └── elements        ordered from bottom to top
├── playback            transition and auto-advance defaults (§5.16)
└── authoring           guides and grid; never rendered (§5.17)
```

Appendix A shows an abbreviated example.

### 5.2 Identifiers

- IDs are opaque strings matching `^[A-Za-z0-9_-]{1,64}$`. Generated IDs are 22-character base64url encodings of 128 random bits.
- Presentation IDs are unique within the workspace. Every other ID is unique within its presentation. That covers sections, slides, elements, builds, assets, layouts, font families, table rows and columns, chart series and guides.
- **Duplicating a presentation** gives it a new presentation ID and keeps all internal IDs.
- **Duplicating or pasting slides or elements** gives every copied object a new ID, whether the paste is into the same presentation or another one.
  - References within the copied set are remapped: group children, connector attachments, builds, reading order, and slide links between copied slides.
  - A connector attached to an element outside the copied set is detached at its current position.
  - A slide link to a slide that isn't in the destination is removed, and a notice lists what was removed.
  - A build that targets an element outside the copied set is dropped.
- **Importing a `.pres`** keeps all IDs. The only exception is an ID conflict resolved by importing a copy (§10.5), which replaces the presentation ID alone.

### 5.3 Presentation

| Field | Notes |
|---|---|
| `id` | See §5.2 |
| `metadata` | `title` (required, 1–200 characters), `author`, `description`, `language` (BCP 47; required, defaults to the browser locale), `created_at`, `updated_at` (ISO 8601 UTC) |
| `size` | `width` and `height` in units, plus an optional `preset` label |
| `theme` | Always embedded, never a reference to the theme library, so files are self-contained (§6) |
| `fonts` | Custom font families (§7.2) |
| `master` | §5.11 |
| `layouts` | Custom layouts (§5.12) |
| `assets` | Asset records (§8.1) |
| `sections` | Defines slide order (§5.4) |
| `slides` | Object mapping each slide ID to its slide (§5.5) |
| `playback` | §5.16 |
| `authoring` | §5.17 |

### 5.4 Sections and slide order

- `sections` is an ordered array of `{ id, name, slide_ids }`. Presentation order is the concatenation of every section's `slide_ids`, and each slide appears exactly once.
- `name` may be `null`, which makes an unnamed group with no header in the sidebar. Normalization merges adjacent unnamed groups and removes empty ones. Empty named sections are allowed.
- Deleting a named section asks whether to delete its slides or keep them. If the user keeps them, the section becomes an unnamed group.
- Sections affect order only. They don't create separate files, but export ranges can select them (§15.1).
- A presentation always has at least one slide; the last slide can't be deleted.
- Whether a section is collapsed is editor state and isn't stored in the document (§9.1).

### 5.5 Slides

| Field | Default | Notes |
|---|---|---|
| `id` | — | |
| `title` | none | Hidden title, used when no visible element has the `title` role |
| `hidden` | false | Skipped during sequential presenting (§14.2) |
| `show_master` | true | Whether master elements appear |
| `background` | theme | Optional fill override (§5.8) |
| `elements` | [] | Ordered from bottom to top |
| `notes` | empty | Speaker notes (§5.13) |
| `transition` | playback default | §5.14 |
| `builds` | [] | §5.14 |
| `reading_order` | automatic | §5.15 |
| `advance_after_ms` | playback default | Auto-advance duration (§5.16) |
| `layout_origin` | none | `{ layout_id, name }`; informational only, and not required to resolve (the layout may have been deleted, or the slide pasted from another presentation) |

**Slide title resolution:**

1. The plain text of the first element in reading order with the `title` role, trimmed and capped at 200 characters, if that text isn't empty.
2. Otherwise, `slide.title`.
3. Otherwise, the slide has no title, which the accessibility checker reports as an error (§16.3).

The resolved title is used by outline mode, the overview grid, navigation announcements, HTML headings and the PPTX title placeholder.

### 5.6 Common element contract

| Field | Required | Default | Notes |
|---|---|---|---|
| `id` | ✓ | | |
| `type` | ✓ | | `text`, `shape`, `image`, `line`, `connector`, `group`, `table`, `chart` or `video` |
| `geometry` | ✓ | | Form depends on type (§5.7) |
| `name` | | derived | User label of up to 100 characters, shown in the layers panel and reading-order editor. Without one, the UI derives a label from the type, role and a text excerpt |
| `role` | | none | Semantic role (see below) |
| `opacity` | | 1 | Multiplied with group opacity |
| `hidden` | | false | Not rendered in any output. Reachable from the layers panel, where it appears as a dashed outline when selected |
| `locked` | | false | Can't be moved, resized, rotated, edited or deleted, and can't be selected on the canvas (§12.2). Locking a group locks its children; a locked child inside an unlocked group still moves with the group |
| `link` | | none | Click action (§5.10) |
| `accessibility` | | `{ decorative: false }` | `alt` (up to 1,000 characters) and `decorative` |
| `style` | | none | Visual overrides — `fill`, `stroke`, `shadow` and, for lines and connectors, `arrowheads` (§5.8) — where the type allows them |
| Type-specific property | per type | | Named after the type (`text`, `shape`, `image`, `connector`, `group`, `table`, `chart` or `video`) and holds that type's data. Lines have none; their data is geometry and style |

In canonical form, fields that equal their default are omitted.

**Roles:**

| Role | Valid on | Drives |
|---|---|---|
| `title`, `subtitle`, `heading`, `body`, `caption`, `quote`, `attribution`, `big_number`, `footer` | text; shapes (for their text) | Theme role style, outline mode, heading semantics, layout remapping, the PPTX title placeholder (`title` only) and the accessibility checker |
| `image` | image, video | Remapping into image slots when changing layouts |

### 5.7 Element types and geometry

| Type | Geometry | Rotation and flip | Notes |
|---|---|---|---|
| `text` | box | ✓ | §13.1 |
| `shape` | box | ✓ | A catalog shape, optionally with text (§13.2) |
| `image` | box | ✓ | Raster or sanitized SVG. `asset_id: null` is an empty image slot (§5.12) |
| `line` | endpoints | — | §13.3 |
| `connector` | endpoints, optionally attached | — | §13.3 |
| `group` | box, derived from its children | ✓, unless it contains a chart | Children use group-local coordinates (§13.5) |
| `table` | `x` and `y` only | — | Size comes from columns and rows (§13.6). Can't be grouped |
| `chart` | box | — | §13.7 |
| `video` | box | ✓ | §13.8 |

Tables and charts can't be rotated or flipped, tables can't be placed in groups, and a group that contains a chart can't be rotated or flipped. PowerPoint can't represent these combinations.

### 5.8 Colors, fills, strokes and effects

- **Color:** either a token reference such as `{ "token": "color.accent.1", "tint": -0.25 }` or a literal `#RRGGBB` or `#RRGGBBAA` string. `tint` is optional and ranges from −1 (black) to 1 (white). Token references follow the theme.
- **None:** fills, strokes and shadows use the string `"none"` to turn the effect off. Leaving the property out means the theme default applies instead (§6.2).
- **Fill** is `"none"` or an object whose `type` is one of:
  - `solid`, with `color`
  - `linear`, with `angle` and `stops`
  - `radial`, with `center_x`, `center_y` and `stops`
  - `image`, with `asset_id`, `mode` (`cover`, `contain`, `stretch` or `tile`) and `scale`

  Gradient stops are 2–8 entries of `{ offset (0–1), color }`.
- **Stroke** is `"none"` or `{ color, width, dash, cap, join }`:
  - `dash`: `solid`, `dash`, `dot`, `dash_dot` or `long_dash`
  - `cap`: `flat`, `round` or `square`
  - `join`: `miter`, `round` or `bevel`
- **Arrowheads** (`style.arrowheads`) apply to lines and connectors. `start` and `end` are each `{ kind, size }`:
  - `kind`: `none`, `arrow`, `triangle`, `stealth`, `oval` or `diamond`
  - `size`: `small`, `medium` or `large`
- **Shadow** is `"none"` or `{ color, offset_x, offset_y, blur }`. On text elements it applies to the glyphs; on shapes, images, charts and video it follows the outline.
- **Slide background** can be any fill and defaults to the theme background.

### 5.9 Text model

The text model is shared by text elements, text in shapes, table cells and speaker notes. Notes use a subset (§5.13).

```text
TextContainer
├── body: TextBody
├── box: { insets, vertical_align, autofit }       (not used by table cells or notes)
├── defaults: Marks                                 (formatting for the whole box)
└── prompt: string                                  (placeholder hint shown only in the editor)

TextBody   = { paragraphs: [Paragraph, …] }                 (at least one paragraph)
Paragraph  = { inlines, align, dir, list, spacing }
Inline     = Run { text, marks } | Field { field, format, value, marks } | LineBreak
Marks      = { font, size, weight, italic, underline, strike, script,
               color, highlight, letter_spacing, link, lang }
```

**Paragraph properties:**

- `align`: `start`, `center`, `end` or `justify`.
- `dir`: `auto`, `ltr` or `rtl`. The default is `auto`, which takes the direction of the first strong character.
- `list`: `{ kind: bullet | number, level: 0–8, number_style, start_at }`. `number_style` is `decimal`, `lower_alpha`, `upper_alpha`, `lower_roman` or `upper_roman`.
- `spacing`: `{ before, after, line }`. `line` is a multiplier from 0.8 to 3.0.

Indentation follows from the list level and the theme.

**Marks:**

- `font` is a font value: a theme font token or a specific font (§7).
- `size` and `letter_spacing` are in units.
- `weight` is 100–900.
- `script` is `normal`, `super` or `sub`.
- `link` is a link target (§5.10).
- `lang` is a BCP 47 tag.

Marks that are absent inherit their value (§6.2). Runs contain no control characters or newlines. A line break the user types inside a paragraph (Shift+Enter) is a `LineBreak` inline; where lines wrap is never stored.

**Box properties:**

- `insets` has four sides. The defaults are 9.6 units left and right, and 4.8 units top and bottom.
- `vertical_align` is `top`, `middle` or `bottom`.
- `autofit` is one of:
  - `none`: a fixed box. Overflowing text renders unclipped in every output and is flagged in the editor.
  - `grow`: the stored height is a minimum, and the rendered height grows downward to fit the content.
  - `shrink`: at render time, font sizes and spacing are scaled by the largest factor that makes the content fit, searched in 1% steps from 100% down to 25%. The factor is never stored.

**Prompt:** placeholder text that appears only in the editor, and only while the body is empty. An empty body with a prompt renders nothing outside the editor.

### 5.10 Links

A link target is one of:

- `{ kind: "url", href }`: only the `https`, `http`, `mailto` and `tel` schemes are allowed, up to 2,048 characters.
- `{ kind: "slide", slide_id }`.
- `{ kind: "nav", target: next | previous | first | last }`.

A link can be set on a text run or on a whole element. A run's link takes precedence over its element's link.

Deleting a slide also removes every link that targets it, within the same undoable command, so a valid document never contains dangling slide links. How the viewer handles links is described in §14.6.

### 5.11 Master and fields

- `master.elements` are drawn beneath every slide whose `show_master` is true. Typical uses are logos, footers, slide numbers and decorative shapes.
  - Every element type is allowed except video.
  - Connectors on the master can attach only to other master elements.
- Master elements are edited in master mode (§12.8) and can't be selected from a slide.
- **Fields** are inline text nodes: `slide_number`, `slide_count`, `presentation_title`, `section_title` and `date`.
  - A date field has a `format` (`short`, `medium`, `long` or `iso`, localized with the presentation language) and a `value`: either a fixed ISO date or `auto`, which is evaluated at render time.
  - Slide numbers and the slide count include hidden slides, as in PowerPoint. When an export leaves slides out, numbers keep their original values.
  - Fields work in any text, but they are most useful on the master.
- In the viewer and in exported HTML, master elements are hidden from assistive technology. The exception is text with the `footer` role, which is read after the slide's content (§5.15).

### 5.12 Layouts

- **Built-in layouts:** Title, Title and body, Two column, Title only, Image and text, Large number, Full image, Quote, Section divider and Blank. The app defines them, with geometry relative to the slide size and margins, and they aren't stored in documents.
- **Custom layouts** are `layouts` entries of `{ id, name, elements, background, show_master }`.
  - The user creates them with **Save slide as layout**, which offers to turn text into prompts.
  - Their geometry is stored in units and transforms along with size changes (§4.4).
- **Instantiation:** creating a slide from a layout copies the layout's elements as ordinary elements.
  - Empty text slots become text elements with a `prompt`.
  - Empty image slots become image elements with `asset_id: null`. The editor shows these as drop targets, and no output renders them.
- **No live link:** editing a layout never changes existing slides. `slide.layout_origin` records which layout a slide came from, for information only. This replaces the previous draft's "layout-provided style" level; role styles now come from the theme (§6.2).
- **Change layout** applies a new layout to an existing slide as one undoable command, after a preview:
  1. For each slot in the target layout, in order, take the first unassigned element in the slide's reading order whose role matches the slot. `body` slots also accept text elements without a role. `image` slots accept image and video elements, preferring those with the `image` role.
  2. Matched elements take on the slot's geometry and role, and keep their explicit style overrides.
  3. Slots with no match are created empty, with prompts.
  4. Elements that don't match any slot stay exactly where they are and appear in the preview as **Not placed**.
  5. Nothing is ever deleted.

### 5.13 Speaker notes

- `slide.notes` is a `TextBody` limited to paragraphs, lists, bold, italic, underline, strikethrough and URL links. Notes use a fixed, readable style instead of the theme.
- Notes are edited in the notes pane (§12.1), and optionally in outline mode.

| Output | Notes included |
|---|---|
| `.pres` | Always |
| PPTX | By default, with a toggle |
| HTML | Only when the user opts in |
| PDF | Only in the Notes pages layout |

### 5.14 Transitions and builds

**Transition:** `{ kind, direction, duration_ms }`, where:

- `kind` is `none`, `fade`, `push` or `wipe`.
- `direction` is `left`, `right`, `up` or `down`, and applies to push and wipe.
- `duration_ms` is 100–3000.

The presentation's default transition is in `playback` (§5.16), and each slide can override it.

**Builds:** `slide.builds` is an ordered array of:

| Field | Values |
|---|---|
| `id` | |
| `element_id` | A top-level element on the slide; not a group child or a master element |
| `effect` | `appear`, `fade_in`, `fly_in`, `disappear`, `fade_out`, `fly_out`, or `play` (video only) |
| `direction` | `left`, `right`, `up` or `down` (fly effects only) |
| `trigger` | `on_click`, `with_previous` or `after_previous` |
| `by` | `element`, or `paragraph` (text-bearing elements, entrance and exit effects only) |
| `delay_ms`, `duration_ms` | 0–10000. Duration is ignored for `appear`, `disappear` and `play` |

**Build rules:**

- An element can have at most one entrance build, one exit build and, for video, one `play` build. An exit must come after the entrance.
- With `by: paragraph`, each top-level paragraph becomes its own sub-step with the same trigger. A top-level paragraph means a level-0 list item together with the nested items under it.
- Elements with an entrance build are invisible at step 0. Elements with an exit build stay visible until the exit runs.
- Step 0 is the slide's initial state.
  - Each `on_click` build starts a new step.
  - `with_previous` and `after_previous` builds join the current step.
  - Builds that come before the first `on_click` run automatically when the slide is entered.
- A build that targets a hidden element is ignored and flagged in the builds panel.
- Deleting an element deletes its builds in the same command.
- With reduced motion, fades and flies become instant and transitions become `none`. The sequence of steps stays the same.

**Builds in each output.** A slide's *final state* is how it looks after every step has run: entrance builds have shown their elements, and exit builds have removed theirs.

| Output | Builds |
|---|---|
| Editor canvas | Every non-hidden element is shown, with step badges. The builds panel can preview any step |
| Viewer and HTML | Run in full (§14.2) |
| PDF | Final state by default, or one page per step (§15.3) |
| Thumbnails, overview grid, image export | Final state |
| PPTX | Native animations (§15.6) |

### 5.15 Reading order

- **Automatic order** for a slide:
  1. Elements with the `title` role (normally one), ordered as in step 2.
  2. All other eligible elements, arranged into rows by scanning their axis-aligned bounding boxes from top to bottom. An element joins the current row if its vertical center falls within the row's vertical extent; otherwise it starts a new row.
  3. Within a row, elements are sorted by their left edge, or by their right edge when the presentation language is right-to-left.
- **Not eligible:** decorative elements, hidden elements, empty placeholders, and lines or connectors without alt text.
- A group is ordered as one unit, by its bounding box. Its children are ordered among themselves with the same algorithm.
- **Explicit order:** `slide.reading_order` lists top-level element IDs.
  - Eligible elements missing from the list are appended in automatic order.
  - Delete commands remove the deleted IDs from the list.
  - **Reset to automatic** clears the list.
- Text on the master with the `footer` role is read after the slide's content.
- Reading order is used for:
  - DOM order in the viewer and HTML export (§3.2)
  - outline mode
  - layout remapping
  - a comparison against layer order during PPTX export (§15.6)

### 5.16 Playback settings

`playback` is:

```text
{
  default_transition,
  click_to_advance,            (default true)
  auto_advance: {
    enabled,
    default_duration_ms,       (1,000–600,000)
    loop
  }
}
```

A slide's `advance_after_ms` overrides the default duration. Playback behavior is described in §14.5.

### 5.17 Authoring metadata

`authoring` is `{ guides: [{ id, axis: x | y, position }], grid: { spacing, visible, snap } }`. It is stored in the document and in `.pres` files, but it is never rendered and never included in other exports.

Pure UI state lives outside the document (§9.1). That includes zoom, the selected slide, collapsed sections and panel layout.

### 5.18 Validation

- Each format version has one machine-readable JSON Schema, plus these semantic rules:
  - IDs are unique, and every reference resolves: assets (of a compatible kind), fonts, tokens, slides and elements.
  - Each slide appears in exactly one section.
  - Groups nest at most 8 deep. Tables are never rotated, flipped or grouped, and charts are never rotated or flipped, directly or through a group (§5.7).
  - Connector attachments point to elements on the same slide that accept connectors (§13.3).
  - Videos with a `play` build use `start: manual` (§13.8).
  - Builds follow §5.14, and reading-order IDs are eligible top-level elements.
  - Table merges don't overlap and stay in bounds, and chart data matches the chart kind.
  - Numbers stay within their ranges and limits (§20.3).
- **Strictness:** unknown fields and unknown element types are validation errors, and any schema change increments `format_version` (§10.7). This resolves the previous draft's ambiguity about unknown types.
- Errors report the JSON path, plus the slide and element where relevant.
- Commands preserve these invariants by construction.
  - Development builds validate after every command.
  - Production builds validate before every export and after every import or migration.

---

## 6. Themes and style resolution

### 6.1 Theme contents

| Group | Contents |
|---|---|
| Identity | `id`, `name` |
| Color tokens | `color.text.primary`, `color.text.secondary`, `color.background`, `color.surface`, `color.border`, `color.accent.1`–`color.accent.6`, `color.link`, `color.highlight` |
| Font tokens | `font.heading`, `font.body`, `font.accent` |
| Role styles | For each text role (§5.6): font token, size, weight, italic, color, alignment, letter spacing, line spacing and paragraph spacing, plus the bullet style and indent for each list level |
| Background | Default slide background fill |
| Element defaults | See below |

Element defaults cover:

- **Shapes:** fill, stroke and text.
- **Lines and connectors:** stroke and arrowheads.
- **Images:** border and shadow.
- **Text boxes:** insets, and the `body` role style for text without a role.
- **Links:** color and underline.
- **Tables:** header row, first column, banding and borders.
- **Charts:** series palette (accents 1–6, then tints of them), gridlines and label font.

Every theme must define every token and role style, so references always resolve.

### 6.2 Style resolution

A property's resolved value comes from these sources, lowest priority first:

1. Application default
2. The theme's default for the element type (§6.1)
3. The theme role style, for text in elements that have a role
4. Element-level values: `style` overrides and the text container's `defaults` (§5.9)
5. For text only, paragraph properties, then run marks
6. Temporary editor state, such as hover and drag previews, which is never saved

Token references resolve against the current theme at render time. Literal values are used exactly as stored.

### 6.3 Changing themes

- Applying a different theme, or editing tokens and role styles, updates everything that references a token. Literal overrides stay as they are.
- **Reset to theme** removes the selection's overrides, one property at a time or all at once.
- Applying a theme is a single undoable command. An automatic snapshot is taken first.

### 6.4 Theme library and templates

- **Theme library.** The library belongs to the workspace, not to a presentation.
  - Users can save a presentation's theme to the library and apply library themes to any presentation.
  - Library themes can be renamed, duplicated and deleted.
  - Several built-in themes ship with the app.
  - Library themes carry their custom font files with them. Applying one copies the custom fonts it uses into the presentation.
  - A library theme records the slide height it was saved from. Applying it to a presentation with a different height scales its lengths to match.
- **Templates.** A template is a stored presentation flagged as a template. It keeps its theme, master, custom layouts and sample slides.
  - The workspace offers **Save as template** and **New from template**.
  - **New from template** creates an independent copy with a new ID.
  - Built-in templates, including a "Getting started" deck, ship with the app.
- There is no separate theme file format. Themes travel inside presentations, templates and workspace backups.

---

## 7. Fonts

Wherever the model sets a font, the value is one of:

- a theme font token, `{ "token": "font.heading" }`, which follows the theme
- a registry font ID, such as `builtin.inter` (§7.1)
- a custom family ID from `presentation.fonts` (§7.2)
- a device font, `{ "device": "<family name>", "fallback": "<registry font ID>" }` (§7.3)

### 7.1 Font registry

- The app bundles a curated set of families under open licenses (OFL or equivalent), as WOFF2.
  - The set covers sans, serif, display, monospace and handwriting styles, in Latin, Greek and Cyrillic.
  - Families for Arabic, Hebrew, Devanagari, Thai, Chinese, Japanese and Korean are loaded on demand (§3.5).
- Each registry entry has:
  - a stable ID, using the reserved `builtin.` prefix
  - a display name
  - the weights and styles it provides
  - its script coverage
  - its license
  - a fallback stack
- **Permanence.** Once a registry family ships, later app versions never remove it, though they may hide it from pickers. This is why `.pres` files refer to registry fonts by ID instead of packaging them.

### 7.2 Custom fonts

- Users can upload TTF, OTF, WOFF or WOFF2 files.
  - Each file is one face: a single weight and style.
  - Faces are grouped into families in `presentation.fonts` as `{ id, family_name, faces: [{ asset_id, weight, style }] }`.
- **Validation.** A font that fails to load through the FontFace API is rejected. The app reads each font's embedding permissions from OS/2 `fsType`.
- **Restricted-license fonts** can be used for editing on the device. They are left out of `.pres`, HTML and PPTX packages with a warning, and recipients see the fallback.
- On upload, the user confirms they have the right to use and embed the font.

### 7.3 Device fonts

- Fonts installed on the device are opt-in, through **Use a font installed on this device**.
- The UI marks them **not portable**. They are never packaged, every export check flags them, and each one names a registry font to fall back to.
- Device font names are limited to letters, digits, spaces, `.`, `_` and `-`, up to 64 characters (§18.2).

### 7.4 Loading and fallback

- The renderer waits for every face it uses before signaling ready (§3.2).
- A missing face falls back to the declared stack; for example, a restricted font in an imported file. The affected element shows a warning badge, and the export check lists it.
- Emoji use the platform's emoji font, so their appearance varies by operating system. This is a documented limitation.

### 7.5 Packaging by output

| Output | Fonts |
|---|---|
| `.pres` | Custom fonts whose license permits packaging; registry fonts by ID |
| HTML | Every face used, registry and permitted custom, embedded |
| PDF | Embedded by the browser |
| PPTX | Not embedded. The export check lists the fonts recipients need and offers **Download fonts used**, a ZIP of the redistributable files |

---

## 8. Assets

### 8.1 Asset records

Each asset record has these fields:

```text
{ id, kind, media_type, byte_size, sha256, width, height,
  duration_ms, original_filename, path }
```

- `kind` is `image`, `svg`, `video`, `captions` or `font`.
- `path` is `assets/<id>.<ext>`.
- `width`, `height` and `duration_ms` are present only where they apply.
- Derived data isn't stored in records. For example, editing previews of large images are regenerated locally.
- A video's poster frame is a separate image asset, referenced from the video element (§13.8).

### 8.2 Supported formats

| Kind | Formats | Notes |
|---|---|---|
| Raster image | PNG, JPEG, GIF, WebP, AVIF | GIF animation plays in the viewer and HTML; PDF uses the first frame. HEIC, TIFF and BMP are rejected with a suggestion to convert |
| Vector | SVG | Sanitized (§18.2) |
| Video | MP4 (H.264 + AAC) recommended; WebM (VP9 or AV1, with Opus or Vorbis) accepted | WebM triggers a warning that it may not play everywhere or embed in PPTX |
| Captions | WebVTT | |
| Fonts | TTF, OTF, WOFF, WOFF2 | §7.2 |

The app detects formats from file signatures, not extensions.

### 8.3 Adding assets

- Users add files with the file picker, by drag and drop, by pasting image data from the clipboard, or by dragging from another tab when the drag carries file data.
- **Remote URLs.** If a drop or paste provides only an `http(s)` image URL, the app makes exactly one fetch attempt, started by that user action. There is no proxy.
- If the network or cross-origin rules block that fetch, the app explains how to copy the image instead, or save it and drop the file.

### 8.4 Processing on add and import

- **Images:**
  - The app checks that the image decodes, reads its intrinsic size, and enforces the pixel limit (§20.3).
  - Images over 16 megapixels, or over 4,096 px on the long edge, get a locally generated editing preview. The original is kept and used for presenting and export.
  - **Reduce image size** is an explicit action. It downsamples the chosen images to twice their largest displayed size.
- **Photo metadata:**
  - EXIF, XMP and IPTC data, including GPS location, is removed by stripping the metadata segments, without re-encoding the image.
  - If an image's EXIF orientation isn't the default, the app re-encodes it upright at high quality, because the orientation is stored in the metadata being removed.
  - This is controlled by the **Remove photo metadata** preference, which is on by default. It applies when images are added; imported `.pres` packages keep their assets byte for byte, so a round trip changes nothing.
- **SVG:** sanitized and re-serialized (§18.2). Sanitizing is idempotent, so SVG the app has already sanitized passes through unchanged. The intrinsic size comes from `viewBox`, or from `width` and `height`. An SVG with neither is rejected.
- **Video:** the app checks the file signature, then probes the metadata for duration, dimensions and whether the current browser can play it. It captures a poster frame (§13.8).
- **Captions:** parsed as WebVTT. Cue text is kept as plain text, except for the `b`, `i` and `u` cue tags.
- **Deduplication:** adding a file whose SHA-256 matches an asset already in the presentation reuses that asset.

### 8.5 Lifecycle and cleanup

- Each asset belongs to a single presentation. Pasting across presentations copies the blobs (§12.4).
- An asset is **live** if it is referenced by any of:
  - the current document: elements, fills, the master, layouts, custom fonts, video posters and captions
  - any stored snapshot
  - the session's undo or redo history
- Cleanup deletes only assets that aren't live. It runs when a presentation is opened, before any undo history exists, and when the user chooses **Clean up unused media**.
- Exports include only the assets that the exported content references.

---

## 9. Storage and data safety

### 9.1 Local stores

A single IndexedDB database holds:

| Store | Contents |
|---|---|
| `presentations` | Metadata: ID, title, timestamps, `format_version`, template flag, `trashed_at`, `last_backup_at`, linked-file info |
| `documents` | The current document for each presentation. It may be split internally (for example, per slide), but each save is atomic |
| `assets` | Blobs, keyed by (presentation ID, asset ID) |
| `snapshots` | Compressed document JSON, with time, reason, optional name, app version and format version |
| `library` | Theme library entries and their font blobs |
| `file_handles` | Linked-file handles (Chromium only) |
| `editor_state` | Per-presentation UI state: last slide, zoom, collapsed sections |
| `meta` | Storage schema version and app settings |

`localStorage` holds only small preferences, such as measurement units, dismissed notices and the UI color scheme.

The storage schema version is separate from the `.pres` `format_version` (§9.9).

### 9.2 Autosave and save status

- Every command marks the document dirty.
- The app saves in any of these cases:
  - 1 second after the last change
  - at least every 5 seconds during continuous editing
  - when `visibilitychange` reports the page hidden
  - on `pagehide`
  - before leaving the editor
- Each save writes the complete post-command state in one transaction.
- Assets are written as soon as they are added, before the command that references them commits. A saved document therefore never references a missing blob.
- The save status shows one of:
  - **Saving…**
  - **Saved locally**
  - **Save failed — [reason]**, with **Retry** and **Export backup** actions
  - **Read-only — open in another tab**, with an **Edit here** action
  - **Saved to file** or **Changes not saved to file**, for linked files
- **Saved** appears only after the transaction's `complete` event fires.
- When a save fails:
  - The failure stays visible until a later save succeeds or the user dismisses it.
  - The app retries with backoff.
  - A quota error opens the storage panel, which offers cleanup options.
- **Cmd/Ctrl+S** saves immediately and writes the linked file, if there is one (§9.8).

### 9.3 One editor per presentation

- The tab editing a presentation holds an exclusive Web Lock named `presentation:<id>`.
- Opening a presentation that another tab is editing opens it read-only, with the banner **Open for editing in another tab — Edit here**.
- Choosing **Edit here** moves editing to that tab:
  1. The requesting tab asks the holder, over a BroadcastChannel, to hand over.
  2. The holder flushes any pending saves, switches to read-only and releases the lock.
  3. The requesting tab acquires the lock and reloads the document from storage.
- If the holder doesn't respond within 3 seconds (for example, because the tab is frozen), the requesting tab steals the lock. When the former holder notices it has lost the lock, it stops writing to the live document. It saves any unsaved changes as a recovery snapshot named "Unsaved changes from another tab" (§9.5).
- Workspace actions that change a presentation need its lock. These are rename, trash, restore and replace-on-import. If another tab holds the lock, the user is told.
- Workspace changes are broadcast, so every open tab stays current.

### 9.4 Persistent storage and eviction

- The app requests persistent storage (`navigator.storage.persist()`) when the first presentation is created. The user can request it again from the storage panel.
- The storage panel shows:
  - estimated usage and quota
  - the size of each presentation, the trash and snapshots
  - whether storage is persistent
  - the last backup date for each presentation
  - cleanup actions
- The workspace explains the risks:
  - Presentations exist only in this browser on this device.
  - Clearing site data, private browsing, uninstalling the app or browser eviction deletes them.
  - Some browsers remove data from sites that haven't been used for a while.
  - Regular backups are the only protection.

### 9.5 Snapshots (version history)

- **Automatic snapshots** are taken in these cases:
  - When a presentation opens, if it changed since the last snapshot.
  - Every 10 minutes of active editing, if there were changes.
  - Before these operations:
    - applying a theme
    - changing the slide size
    - replace all
    - deleting a section together with its slides
    - restoring a snapshot
    - replacing a presentation on import
    - migrating a document's format
    - recovering after losing the lock
- **Named snapshots** are created with **Save version…**.
- **Retention:**
  - Named snapshots are kept until the user deletes them.
  - Automatic snapshots are kept if they are among the 20 most recent, or the newest from each of the previous 14 days.
- Snapshots store compressed document JSON and share asset blobs with the live presentation. Asset cleanup respects them (§8.5).
- The version history panel:
  - lists snapshots by time and reason
  - previews any snapshot in a read-only viewer
  - offers **Restore**, which snapshots the current state, replaces the document and clears undo history
  - offers **Open as copy**, which creates a new presentation, with a new ID, from the snapshot
- A snapshot saved in an older format version is migrated (§10.7) before it's previewed, restored or opened.
- Snapshots stay local and aren't included in `.pres` files or backups.

### 9.6 Trash

- Deleting a presentation moves it to Trash and shows an **Undo** toast. It can be restored for 30 days.
- **Delete forever** and **Empty trash** ask for confirmation.
- When the app starts, it purges trashed items older than 30 days.
- Trash counts toward storage use.

### 9.7 Backups and reminders

- **Export backup** saves a `.pres` file and is available from both the workspace and the editor (§10.3).
- **Back up everything** creates a ZIP containing:
  - a `.pres` file for each presentation (including trashed ones is optional)
  - templates
  - the theme library
  - a `backup.json` index recording the app version, the date and the contents

  A backup larger than 4 GB is split into numbered parts. Each part is under 4 GB, so none needs ZIP64, and each is a valid backup with its own index. Parts can be imported together or one at a time.
- Importing a backup shows a checklist and handles conflicts per item (§10.5).
- Each presentation tracks `last_backup_at`. Any `.pres` export, linked-file save or workspace backup updates it.
- If a presentation has changes that haven't been backed up for 7 days, the workspace shows a non-modal reminder. Reminders can be snoozed or turned off.

### 9.8 Linked files (Chromium)

- Where the browser supports file save pickers, **Save to file…** links a presentation to a `.pres` file on disk. Opening a `.pres` from the file picker, or by double-clicking it, also links it.
- Cmd/Ctrl+S writes the whole package to the linked file. The browser may ask for permission again after a reload.
- IndexedDB remains the working copy. The linked file is written only when the user saves.
- If the file changed on disk since the last save, the app asks before writing: **Overwrite**, **Save as copy** or **Cancel**.
- Opening a linked file again opens the existing presentation. If the file changed since the last save, the app offers to load the file's version, after taking a snapshot, or to keep the local one.
- In other browsers, Cmd/Ctrl+S saves locally and suggests using **Export backup**.

### 9.9 Storage migrations and app updates

- Storage schema upgrades run inside the IndexedDB upgrade transaction.
- When an upgrade happens, tabs running an older app version receive `versionchange`. Each such tab flushes its saves if it can, closes its database connection and switches to read-only, showing **The app was updated — Reload**.
- Every stored document records its `format_version`. When an older document is opened, a snapshot of it is taken, then it is migrated with the same migrations used for import (§10.7).
- If an app opens a stored document with a newer `format_version` than it supports, it shows the document read-only with **Reload to update** and never writes it.

---

## 10. The `.pres` format

### 10.1 Package layout

A `.pres` file is a ZIP archive:

```text
presentation.pres
├── manifest.json
└── assets/
    ├── <asset-id>.<ext>
    └── …
```

- **Compression:**
  - `manifest.json` is the first entry and uses DEFLATE.
  - Assets that are already compressed are STORED: JPEG, PNG, GIF, WebP, AVIF, MP4, WebM, WOFF and WOFF2.
  - Other assets use DEFLATE: SVG, WebVTT, TTF and OTF.
- **Allowed entries:** only `manifest.json` and files directly under `assets/`.
- **Rejected entries:**
  - directories other than `assets/`
  - duplicate names
  - absolute paths or `..` segments
  - backslashes or drive letters
  - symlinks
- Binary content is never Base64-encoded in the manifest.
- ZIP64 isn't used. The package limits keep archives within ZIP32 (§20.3).

### 10.2 Envelope

```json
{
  "format": "pres",
  "format_version": 1,
  "created_with": "1.0.0",
  "exported_at": "2026-09-28T14:03:11Z",
  "document": {}
}
```

- `format` identifies the file family.
- `format_version` identifies the document schema and its migration path. This specification defines version 1; the previous draft's format never shipped.
- `created_with` records the app release that wrote the file. It has no effect on compatibility.
- `document` holds the canonical model (§5), including asset records but no binary data.

### 10.3 Export

1. Validate the document. Blocking issues stop the export and are reported.
2. Include only referenced assets (§8.5).
3. Stream the ZIP in a worker, showing progress with a cancel option.
4. Derive the filename from the title and append `.pres`:
   - remove reserved characters
   - trim whitespace
   - cap the length at 100 characters
   - fall back to "Untitled" if nothing remains
5. Update `last_backup_at`.

### 10.4 Import pipeline

Import runs in a worker, showing progress with a cancel option. The steps run in this order. If any step fails, nothing is stored and the workspace stays unchanged.

1. Confirm the input is a readable ZIP. Check the central directory's entry count, declared sizes and path rules.
2. Find `manifest.json`, check it against its size limit, and parse it.
3. Verify `format` and `format_version`. A newer version is rejected with "Update the app to open this file."
4. Validate package paths and asset references.
   - Every referenced asset must be present.
   - Extra files under `assets/` are ignored, with a warning.
   - Any other unexpected path causes rejection.
5. Decompress the assets.
   - Count the bytes actually decompressed; never trust the headers.
   - Enforce per-asset limits, total limits and compression-ratio limits (§20.3).
   - Verify each asset's SHA-256 against its record.
6. Migrate older versions to the current model (§10.7).
7. Validate the migrated document against both the schema and the semantic rules (§5.18).
8. Clean and check the content:
   - sanitize SVG
   - validate links and captions
   - check font permissions and media signatures
   - if sanitizing changed an SVG, update its hash (§8.4)
9. Resolve ID conflicts (§10.5).
10. Commit atomically. Assets are written first under a pending-import marker, then a single final transaction stores the document and makes the presentation visible. If anything fails, the pending assets are deleted, or cleaned up on the next start, so a partial presentation never appears.
11. Open the presentation in the editor. For multi-file or backup imports, return to the workspace instead.

### 10.5 ID conflicts on import

- If no local presentation has the imported ID, the file is imported as is.
- If a presentation with that ID exists, live or in Trash, the user chooses:
  - **Replace existing:** a snapshot of the existing presentation is taken, then its content is replaced by the import, keeping the ID. The old version stays available in version history (§9.5). Replacing a trashed presentation also restores it. This requires the existing presentation's lock (§9.3).
  - **Import as copy:** the import gets a new presentation ID, and " (imported)" is added to its title.
- Batch and backup imports offer **Apply to all**.

### 10.6 Opening files

Files can be opened in three ways:

- with the Import button
- by dropping a `.pres` file or backup ZIP onto any app window
- by launching the installed app with a file (Chromium only)

The app recognizes backup ZIPs by their `backup.json` file.

### 10.7 Compatibility and migration policy

- Each package declares one integer `format_version`.
- Any schema change increments `format_version`, whether it adds fields, adds types or changes meaning. There is no optional-feature negotiation.
- Readers accept the current version and every older version.
- Migrations are pure, deterministic functions between adjacent versions. Each has fixtures and expected-output tests.
- A migration must preserve all meaning. If it can't, the import stops and names the incompatible feature.
- Newer versions are rejected before anything is stored.
- Export always writes the current version.
- App versions and format versions evolve independently.

---

## 11. Workspace

- **Presentation cards.** Presentations appear as a grid or a list. Each card shows:
  - a thumbnail of the first slide, rendered lazily by the shared renderer
  - title, date modified and size
  - backup status, such as "Backed up 3 days ago" or "Never backed up"
  - a linked-file badge, if the presentation is linked to a file
- **Sort, search and filter:**
  - sort by date modified, date created or name
  - search by title
  - filter by all, templates or trash
- **Actions:**
  - New (blank, or from a template)
  - Open
  - Duplicate
  - Rename
  - Move to Trash
  - Export backup
  - Save as template
  - Import
  - Back up everything
- **Also available:**
  - the storage panel (§9.4)
  - the theme library (§6.4)
  - settings
  - keyboard shortcuts
  - About, which shows the version, limits and browser support
- **First run:**
  1. Explains that storage is local-first.
  2. Requests persistent storage once a presentation exists.
  3. Suggests installing the app.
  4. Opens the "Getting started" template.
- **Settings:**
  - measurement units
  - default snapping
  - **Remove photo metadata**
  - backup reminders
  - **Download all fonts** for offline use (§3.5)
  - UI color scheme: light, dark or system (this doesn't affect slides)

---

## 12. Editor

### 12.1 Layout

- **Top bar:**
  - editable title and save status
  - undo and redo
  - Insert menu: text, shape, line, connector, image, video, table, chart
  - Present: from current slide, from beginning, or with presenter view
  - Export
  - version history, accessibility checker and find
- **Left sidebar:** slide thumbnails grouped by section, with markers for hidden slides, builds, transitions and notes. It can switch to outline view or slide sorter (grid) view.
- **Canvas:**
  - Shows the rendered slide under an editor overlay.
  - The overlay draws selection, handles, smart guides, rulers, the grid, placeholder prompts, overflow markers and build step badges.
  - Zoom ranges from 10% to 400%, with fit and zoom-to-selection.
- **Inspector (right):**
  - Shows properties for the selection.
  - With nothing selected, it shows slide properties: background, master visibility, hidden, auto-advance, transition and **Change layout…**.
  - Separate tabs cover builds and accessibility (alt text and reading order).
- **Notes pane (bottom):** resizable and collapsible.
- **Status bar:** zoom, slide position, units, and toggles for snapping and the grid.
- **Panels:** layers, version history, find and replace, accessibility checker, and theme editor.
- **Presentation settings:** metadata and language, size, theme, master and playback.

### 12.2 Selection and manipulation

**Selecting**

- Click selects the topmost element under the pointer that isn't locked or hidden.
- Shift-click or Cmd/Ctrl-click adds an element to the selection or removes it.
- A marquee selects elements that are fully enclosed.
- Tab and Shift+Tab cycle through elements in layer order.
- Clicking a group selects the whole group. Double-click or Enter selects a child inside it; Esc returns to the group.

**Layers panel**

- A tree of every element in layer order. In master mode, it shows master elements.
- Supports rename, show and hide, lock and unlock, and drag to reorder or regroup.
- It is the only way to select hidden or locked elements. On the canvas, right-click offers **Unlock "name"** for locked elements under the pointer.

**Moving and resizing**

- Drag to move. Arrow keys move 1 unit; Shift+arrow moves 10.
- Eight resize handles. Rotated elements resize along their own axes, with the opposite handle anchored.
- Images, video and groups keep their aspect ratio by default. Shift toggles the aspect lock, and Alt/Option resizes from the center.
- Cmd/Ctrl+Alt+arrow resizes by 1 unit from the keyboard.

**Rotating and flipping**

- A rotation handle rotates the element; Shift snaps to 15° steps.
- Flip horizontal and flip vertical are commands.
- The inspector has numeric fields for x, y, width, height and rotation.

**Snapping, rulers and guides**

- Snap targets:
  - slide edges and center lines
  - other elements' edges and centers (smart guides)
  - equal spacing between elements
  - user guides
  - the grid, when grid snapping is on
- The snap threshold is 6 screen pixels. Holding Cmd/Ctrl turns snapping off temporarily.
- Snapping, alignment and distribution use rendered bounds, so text that has grown past its stored height lines up by what's visible.
- Rulers use the chosen measurement unit. Drag from a ruler to create a guide; drag a guide off the canvas to delete it. Guides are stored in `authoring` (§5.17).

**Arranging**

- Align left, center, right, top, middle or bottom. Alignment is relative to the selection, or to the slide when a single element is selected.
- Distribute horizontally or vertically (needs three or more elements).
- Match width or match height.
- Bring to front, bring forward, send backward and send to back reorder the element within its parent.
- Group needs two or more elements with the same parent, none of them tables. Ungroup keeps every child's visual position exactly (§13.5).
- Cmd/Ctrl+D duplicates, offset by 10 units, or by the previous duplicate's offset when you repeat. Alt/Option-drag also duplicates.

### 12.3 Commands, undo and redo

- **Commands.** Every document change is a command. Examples include `InsertElement`, `DeleteElements`, `TransformElements`, `EditText`, `ReorderSlides`, `ApplyTheme`, `EditTableCells`, `EditChartData`, `EditBuilds` and `EditMaster`.
  - Each command stores what it needs to invert itself.
  - Each command is validated (§5.18) and triggers autosave.
- **Coalescing.** Continuous interactions become single commands:
  - one per completed drag, resize or rotation
  - one per slider or color-picker interaction, from pointer down to pointer up
  - one per text-editing span; a span ends after 1 second idle, a selection jump or a formatting change
- **Undo and redo** restore the document state, the selection where practical, and the visible slide.
- A new command after an undo clears the redo branch.
- **History limits.** History holds up to 1,000 commands or 200 MB of inverse data, whichever comes first. The oldest entries are dropped first.
- **History lifetime.** History lasts for the session only. It is cleared on reload, on snapshot restore, on lock loss and on document migration.
- Workspace actions such as rename and trash aren't part of document history. Trash has its own **Undo** toast.

### 12.4 Clipboard

**Copy and cut** put these on the clipboard:

- An internal payload: the elements or slides, the source presentation ID, asset hashes and resolved style values. It travels as a web custom clipboard format where supported, and otherwise is embedded in the HTML version. Payloads are validated like imports (§18.2).
- Sanitized semantic HTML for text and tables.
- Plain text.
- A PNG of the selection, where supported.

**Pasting within the same presentation**

- Pasted objects get new IDs (§5.2).
- If the paste lands at the same position on the same slide, it is offset.

**Pasting into another presentation**

- Assets are copied from local storage by hash. A missing asset becomes an empty slot, with a notice.
- By default, pasted content takes the destination theme: token references are kept, and so are literal overrides.
- **Keep source formatting** resolves the source tokens to literal values.
- In both modes, custom fonts the pasted content uses are copied along with it, so no font reference dangles.
- A paste-options popover switches between the two, replacing the paste command.

**Pasting from outside the app**

- Images become image elements. SVG files or SVG markup become sanitized SVG.
- HTML is mapped into the text model, keeping only:
  - paragraphs and nested lists
  - bold, italic, underline and strikethrough
  - superscript and subscript
  - allowlisted links
  - line breaks
- Simple HTML tables become table elements.
- Plain text becomes one paragraph per line.
- Cmd/Ctrl+Shift+V pastes as plain text.
- CSV or TSV pasted into a table or a chart's data grid fills cells. If the table needs to grow, the app asks first.

### 12.5 Format painter

- Copies the formatting that fits the source:
  - text marks and paragraph properties
  - a shape's fill, stroke, shadow and text-box settings
  - an image's border, shadow and mask
  - cell styles
- Click to apply once; double-click to keep it active until Esc.
- Cmd/Ctrl+Alt+C copies the formatting and Cmd/Ctrl+Alt+V applies it.

### 12.6 Find and replace

- **Searched:** text elements, shape text, table cells and chart titles. Toggles add speaker notes and master text.
- **Options:** match case and whole words.
- **Results:** grouped by slide, with navigation between matches.
- **Replace all** is a single command, and an automatic snapshot is taken first.
- A replacement takes the formatting of the first character it replaces.

### 12.7 Slides, sections and outline

- **Sidebar actions:**
  - new slide, with a layout picker
  - duplicate, delete, hide and unhide
  - multi-select and drag to reorder
  - move slides to a section, or create a new section from the selection
  - rename, collapse, move and delete sections (with the choice described in §5.4)
- **Slide sorter:** a full-width thumbnail grid for large reorganizations, with the same actions.
- **Outline mode:** lists each slide's title (§5.5) and body (the first element in reading order with the `body` role) in presentation order.
  - Titles and bodies can be edited in place.
  - Slides can be added, deleted, reordered and moved between sections; sections can be collapsed.
  - A toggle shows the notes.
  - New slides use the Title and body layout.
  - Typing body text on a slide with no body element creates one in the Title and body layout's body slot.
  - Decorative text and exact geometry aren't shown.

### 12.8 Master mode

- Opened from the Slide menu. The canvas shows the master elements over the current slide's background, with the slide content dimmed.
- Every editing tool works, except that video can't be inserted (§5.11). The Insert menu adds fields.
- Master edits are ordinary commands in the same history.

### 12.9 Theme editor

- Edits:
  - color tokens, with a preview of their tints
  - font tokens
  - role styles, shown as a table with a live sample
  - the background
  - element defaults
- Actions: save the theme to the theme library, and **Reset to theme** for the current selection.
- Color pickers offer theme colors and their tints, recent colors, hex input, and an eyedropper where the browser supports one.

### 12.10 Keyboard shortcuts

Cmd means Cmd on macOS and Ctrl elsewhere. The app avoids shortcuts that browsers reserve. Cmd+/ opens a reference sheet.

| Action | Shortcut |
|---|---|
| Undo / redo | Cmd+Z / Cmd+Shift+Z |
| Copy / cut / paste / paste as plain text | Cmd+C / Cmd+X / Cmd+V / Cmd+Shift+V |
| Duplicate | Cmd+D |
| Group / ungroup | Cmd+G / Cmd+Shift+G |
| Bring forward / bring to front | Cmd+] / Cmd+Shift+] |
| Send backward / send to back | Cmd+[ / Cmd+Shift+[ |
| Bold / italic / underline | Cmd+B / Cmd+I / Cmd+U |
| Insert or edit link | Cmd+K |
| New slide | Ctrl+M on all platforms (Cmd+M minimizes the window on macOS) |
| Find / replace | Cmd+F / Cmd+Shift+H |
| Save now (and to the linked file) | Cmd+S |
| Export PDF | Cmd+P (opens the export dialog, not browser printing) |
| Present from current slide / from beginning | Cmd+Enter / Cmd+Shift+Enter |
| Present from beginning / from current slide (PowerPoint keys) | F5 / Shift+F5, where the browser lets the app intercept them |
| Copy / apply formatting | Cmd+Alt+C / Cmd+Alt+V |

---

## 13. Content types

### 13.1 Text

- **Features:** everything in the text model (§5.9):
  - roles
  - lists with nine levels (Tab and Shift+Tab change the level) and restartable numbering
  - links and fields
  - bidirectional text
  - autofit modes, vertical alignment and insets
- **New text boxes:** use `autofit: grow` and no role, so they take the theme's body style (§6.1), until the user picks a role.
- **Links:** Cmd/Ctrl+K opens the link editor, which has:
  - a URL field, validated against the scheme allowlist
  - a slide picker
  - navigation actions

  In the editor, a link opens only with Cmd/Ctrl+click while the text is being edited, or from the link editor's **Open** button. Outside text editing, Cmd/Ctrl+click toggles selection (§12.2).
- **Overflow:** when content overflows a fixed box, the editor shows an overflow marker. Every output renders the content unclipped, and both the checker and the export check flag it.
- **Font picker:** lists registry and custom families with previews, and offers only the weights and styles each family actually has (§3.4). Device fonts sit behind an explicit option (§7.3).

### 13.2 Shapes

- **Catalog:**
  - basic: rectangle, rounded rectangle, ellipse, triangle, right triangle, diamond, parallelogram, trapezoid
  - polygons: pentagon, hexagon, octagon
  - stars: 5- and 6-point
  - symbols: plus, heart, cloud, donut
  - block arrows: right, left, up, down, left-right, plus chevron and pentagon arrow
  - speech callouts: rectangular, rounded, oval

  Every catalog shape has an equivalent DrawingML preset, so PPTX export keeps shapes editable (§15.6).
- **Each catalog entry defines:**
  - normalized geometry with adjustable parameters (for example corner radius, arrowhead proportions or callout tail position)
  - a text rectangle: the full box for rectangular shapes, the inscribed rectangle for ellipses, and a defined inset area for everything else
  - four connection sites (§13.3)
- **Data:** `shape` = `{ preset, adjust, text }`.
  - `adjust` maps parameter names to values.
  - `text` is an optional text container (§5.9). For shape text, `autofit: grow` grows the shape itself.
- **Styling:** fill, stroke, opacity and shadow. Adjustment handles appear on the canvas.

### 13.3 Lines and connectors

- **Line:**
  - Geometry is `{ start: { x, y }, end: { x, y } }` in parent coordinates.
  - Stroke and arrowheads live in `style` (§5.8).
  - It has two endpoint handles; Shift constrains the angle to 45° steps.
  - Dragging the body moves both ends.
- **Connector:**
  - Geometry is `{ start, end }`. Each end is either a free point `{ x, y }` or attached, as `{ element_id, site: top | right | bottom | left }`.
  - The type-specific property is `connector` = `{ routing: straight | elbow }`.
  - Stroke and arrowheads live in `style`.
- **Sites:** every box-geometry element exposes four sites, at the midpoints of its edges, transformed by the element's rotation and flip. Connectors can't attach to lines, connectors or tables.
- **Following targets:** attached ends are computed at render time from the target's rendered box, so connectors follow their targets, including shapes that grow with their text.
- **Elbow routing** is deterministic:
  - Each attached end leaves its site perpendicular to the edge, as a 20-unit stub.
  - The stubs are joined by at most three orthogonal segments.
  - A free end's exit direction comes from where the other end is.
  - The algorithm is pinned down with fixtures in the renderer tests.
- **Attachment rules:**
  - Ends can attach to any element on the same slide, including elements inside groups.
  - Master connectors attach only to master elements.
  - Deleting a target detaches the end at its last computed position, in the same command.
  - While an end is being dragged, nearby shapes show their sites.

### 13.4 Images and SVG

- **Insertion:** images come in at their intrinsic size, scaled down to fit within 80% of the slide, and centered.
- **Crop model:** `crop` = `{ left, top, right, bottom }`.
  - Each value is the fraction of the source removed from that edge; left + right < 1 and top + bottom < 1.
  - The remaining source rectangle fills the element box exactly.
  - This maps directly to PPTX `srcRect`.
- **Crop tool:**
  - Drag edges to crop; drag the image to pan it within the frame.
  - The frame's aspect ratio tracks the crop, so images don't distort unless the user unlocks aspect ratio.
  - Presets: free, 1:1, 4:3, 16:9 and original.
- **Fill frame** computes a centered cover crop for the current frame. **Fit frame** resizes the frame to the cropped image's aspect ratio, within its current bounds.
- **Replace image:**
  - Keeps the frame, mask, border and shadow.
  - Computes a centered cover crop for the new image.
  - Clears the alt text and prompts for new alt text.
- **Mask:** `mask` is absent (no mask) or `{ preset, adjust }`, using any catalog shape (§13.2). The image is clipped to that shape, and the border follows the mask outline. In PPTX it maps to the picture's preset geometry.
- **Other properties:** border (stroke), shadow, opacity, rotation, flip, and alt text with a **Decorative** checkbox.
- **SVG:**
  - Supports the same controls.
  - Stays vector in the editor, viewer, HTML and PDF.
  - Always renders through `<img>` (§18.2).
- **Image fills:** shape and background fills use the same assets, with `cover`, `contain`, `stretch` or `tile`.

### 13.5 Groups

- `group.children` is an ordered array of elements, bottom to top, in group-local coordinates. The origin (0, 0) is the top-left of the group box.
- **Normalization** runs after every command:
  - The group box becomes the union of the children's axis-aligned bounding boxes in group-local space. These use stored geometry, never rendered size, so text that grows doesn't change its group's box.
  - Children are re-based so that union starts at (0, 0).
  - The group's `x` and `y` shift so nothing moves visually.
- **Group properties:**
  - Rotation and flip apply around the group center.
  - Group opacity multiplies with each child's opacity.
  - Groups nest at most 8 deep.
- **Resize rule.** When a group is resized from w × h to w′ × h′, with sx = w′/w and sy = h′/h, each child changes in group-local space as follows.

  Box children, with center (cx, cy), size (wc, hc) and rotation θ, get:

  ```text
  center   = (sx·cx, sy·cy)
  width    = wc · √((sx·cos θ)² + (sy·sin θ)²)
  height   = hc · √((sx·sin θ)² + (sy·cos θ)²)
  rotation = θ   (unchanged)
  ```

  This is exact for uniform scaling and for rotations that are multiples of 90°. Otherwise it is the closest result a box with rotation can represent, since skew can't be expressed.

  - Endpoint children scale their points: (sx·x, sy·y).
  - A child group applies the same rule recursively, using its own new size.
  - Font sizes, stroke widths and other non-geometric lengths don't change.
- **Ungroup** converts each child into the parent's coordinate space exactly, composing position, rotation and flip. A group flipped on exactly one axis negates each child's rotation, and each group flip toggles the matching child flip.
- **Restrictions:**
  - Tables can't be grouped, and groups that contain a chart can't be rotated or flipped (§5.7).
  - Builds can target a group only as a whole, not its children (§5.14).

### 13.6 Tables

- **Model:**
  - `columns`: `[{ id, width }]`
  - `rows`: `[{ id, min_height }]`
  - `cells`: an object keyed by `"<row_id>:<column_id>"`
  - options: `header_rows` (0–3), `first_column`, `banded_rows`, `banded_columns`
- **Cell** fields:
  - a text container without the box (§5.9)
  - `fill`
  - `borders`: `top`, `right`, `bottom` and `left`, each a stroke (§5.8)
  - `padding` and `vertical_align`
  - `row_span` and `col_span`, set only on the anchor cell of a merge; cells covered by a merge must be empty
- **Geometry:**
  - Only `x` and `y` are stored.
  - Width is the sum of the column widths.
  - Each row's rendered height is the larger of its minimum height and its content; the table's height is the sum of its rows.
  - Resizing the frame scales column widths or row minimum heights proportionally. Dragging internal borders resizes individual columns and rows.
- **Editing:**
  - Clicking a cell edits its text.
  - Tab and Shift+Tab move between cells; Tab in the last cell adds a row.
  - Arrow keys cross into the next cell at the edge of a cell's text.
  - Drag or Shift+click selects a range.
  - Rows and columns can be inserted, deleted and distributed evenly; cells can be merged and split.
  - Cell fill, border presets, padding, vertical alignment and text formatting are all editable.
- **Styling:** the theme's table style, with toggles for header row, first column and banding.
- **Rendering:** semantic HTML `<table>` with fixed layout.
  - Header cells are `<th scope="col">`.
  - First-column cells are `<th scope="row">` when that option is on.
- **Overflow:** a table that extends past the bottom of the slide is flagged.
- **Builds:** apply to the whole table only.
- **Grouping:** tables can't be grouped, as in PowerPoint (§5.7).

### 13.7 Charts

- **Kinds:**
  - bar: vertical or horizontal; clustered, stacked or 100% stacked
  - line, with or without markers
  - pie and donut
  - scatter
- **Data:**
  - Category charts (bar, line, pie, donut): `categories` (strings) and `series` `[{ id, name, values: [number | null], color }]`. Pie and donut take exactly one series, with non-negative values.
  - Scatter: `series` `[{ id, name, points: [{ x, y }], color }]`.
- **Options:**
  - chart title (plain text) and axis titles
  - legend: none, top, bottom, left or right
  - major gridlines, per axis
  - data labels: none or value; pie and donut can also show percentages
  - axis bounds: automatic, or a fixed minimum and maximum
  - number format: decimals, number or percent, prefix, suffix and thousands separator, with locale formatting from the presentation language
- **Styling:**
  - Series colors default to theme accents 1–6, then tints of them.
  - Text uses the theme's chart style.
  - Any series color can be overridden.
- **Data editor:**
  - A spreadsheet-style grid with a live preview.
  - Rows and columns can be added and removed.
  - CSV or TSV can be pasted, and CSV files imported.
  - Invalid data (non-finite numbers, negative pie values, mismatched lengths) can't be committed.
- **Rendering:** deterministic SVG from the app's own chart renderer.
  - Axis ticks come from a fixed "nice numbers" algorithm.
  - Labels are measured with the chart fonts.
  - Overlapping labels are resolved by fixed rules: first rotate category labels 45°, then show every other label.
- **Accessibility:**
  - The default alt text is generated from the chart kind, title, series names, category count and value range, and can be edited.
  - The viewer and HTML export include the data as a visually hidden table linked to the chart.
- **Builds:** apply to the whole chart only.
- **PPTX:** exported as native, editable charts (§15.6).

### 13.8 Video

- **Formats:**
  - MP4 (H.264 + AAC) is the portable choice.
  - WebM is accepted with a warning.
  - Other formats are rejected, with a suggestion to convert to MP4.
- **Element:** `video` = `{ asset_id, poster_asset_id, trim_start_ms, trim_end_ms, start, loop, muted, controls, captions_asset_id, fit }`:
  - `start`: `auto` plays when the video first becomes visible, either on entering the slide or when its entrance build runs; `manual` plays only when the viewer clicks the video or a `play` build runs.
  - `controls`: `auto`, `show` or `hide`.
  - `fit`: `cover` or `contain`.
  - To make playback a click step in the build sequence, add a `play` build (§5.14). A video with a `play` build must use `start: manual`.
- **Poster frame:**
  - Captured from the frame at the trim start when the video is inserted.
  - **Set poster frame** changes it during preview; an image can be used instead.
- **Editor:** shows the poster with a play button. Inline preview, trim sliders and settings are in the inspector.
- **Playback:**
  - Leaving a slide stops its videos; returning restarts them from the trim start.
  - Stepping back past a `play` build stops that video and returns it to the trim start.
  - `controls: auto` shows controls on hover or focus.
  - Clicks on video controls never advance the slide.
  - The viewer has **Mute all videos**.
- **Captions:**
  - The viewer renders WebVTT cues itself, in an overlay synced to playback, instead of using native text tracks. This keeps captions working when exported HTML is opened from a local file.
  - A captions toggle appears in the controls.
- **Autoplay with sound:**
  - Presentation mode always starts from a user gesture, so sound is allowed.
  - Exported HTML shows a **Start presentation** overlay when its first slide autoplays a video with sound.
- **By output:**

  | Output | Video |
  |---|---|
  | Thumbnails, overview, PDF, image export | Poster frame |
  | HTML, single file | Embedded, within the size caps in §15.5 |
  | HTML, web folder | Separate files next to `index.html` |
  | PPTX | MP4 embedded with poster and trim; WebM becomes the poster image, with a warning |

- **Performance:**
  - The editor doesn't load video data until preview.
  - The viewer preloads metadata for the current and next slide only.

---

## 14. Presenting

### 14.1 Presentation mode

- **Entering:** presentation mode opens as a full-window viewer in the same tab and requests fullscreen. If fullscreen is denied, it stays full-window.
- **Starting slide:** the current slide, even if it's hidden. **Present from beginning** starts at the first visible slide instead.
- **Scaling:** the slide scales uniformly to fit, with black letterboxing.
- **Read-only:** the viewer works from a copy of the document taken when it opens. It never modifies the document, and edits made in other tabs don't affect a running show.
- **Exiting:** returns the editor to the last slide shown.
- **End screen:** after the last slide, an end screen reads "End of presentation". Next from the end screen exits. In loop mode, the show wraps around instead (§14.5).
- **Controls bar:**
  - contains previous, next, "slide x of y", overview, blank, captions, mute, presenter view, fullscreen and exit
  - hides after 3 seconds without pointer movement, and reappears on pointer movement or keyboard focus
  - the cursor also hides when idle
- **Announcements:** a polite live region announces "Slide n of m: title" on each slide change.

### 14.2 Navigation and builds

- **Next:**
  - If the slide has a build step left, runs it.
  - Otherwise, moves to the next non-hidden slide with its transition. That slide starts at step 0, and any automatic builds run.
- **Previous:**
  - If the current step is above 0, returns to the previous step instantly, without animation.
  - Otherwise, goes to the previous non-hidden slide and shows it in its final state.
- **Jumps** land on step 0. Jumps are slide number entry, the overview grid, links, Home and End.
- **Hidden slides** can be reached through slide links and jumps. Next from a hidden slide goes to the next non-hidden slide after it.
- **Numbering:** "Slide x of y", typed slide numbers and deep links count every slide in the output, hidden ones included. In presentation mode the output is the whole presentation; in exported HTML it's the slides the export includes.

### 14.3 Controls

| Action | Keys | Pointer and touch |
|---|---|---|
| Next | Right, Down, Space, PageDown, Enter, N | Click the slide (not on a link or media control), swipe left, or tap the right two-thirds |
| Previous | Left, Up, PageUp, Backspace, P | Swipe right or tap the left third |
| First / last slide | Home / End | — |
| Go to slide | Type the number, then Enter (Enter without digits means Next) | Overview grid |
| Overview grid | G (G again or Esc closes it) | Controls bar |
| Black / white screen | B or . / W or , (press again to return) | Controls bar |
| Toggle fullscreen | F | Controls bar |
| Presenter view | S | Controls bar |
| Laser pointer | L | Controls bar |
| Exit | Esc | Controls bar |

- **Clickers:**
  - PageUp and PageDown cover most presentation clickers, and B or . covers their blank-screen buttons.
  - Clicker buttons that send F5 or Shift+F5 are intercepted where the browser allows, so they don't reload the page. Autosave makes an accidental reload harmless anyway.
- **Esc:**
  - If the overview or a blank screen is open, Esc closes it.
  - Otherwise, Esc exits presentation mode.
  - If the browser uses Esc to leave fullscreen, the app treats that as exiting the presentation.
  - Leaving fullscreen with F keeps the presentation running in the window.

### 14.4 Presenter view

- **Opening:** press S, use the controls bar, or choose **Present with presenter view**. A second window opens as a popup from that user gesture, and the two windows sync over a BroadcastChannel.
- **Audience window:** the fullscreen viewer.
- **Presenter window:**
  - the current slide at its current step, with a preview of the next step or slide
  - scrollable notes with adjustable text size
  - an elapsed timer with pause and reset
  - a clock and "slide x of y"
  - navigation buttons, a jump-to-slide list and blank-screen toggles
  - a laser pointer: pointing over the current-slide preview shows the pointer on the audience window
  - navigation keys work in both windows
- **Screen placement:** where the browser can place windows on specific screens (with permission), the app offers "Show audience view on…". Otherwise, the user drags the audience window to the projector and presses F.
- **Blocked popups:** the app explains how to allow them.
- **Exported HTML:** presenter view is available only when the export includes notes (§15.5). There, the viewer creates and controls the presenter window itself, which also works when the file is opened locally.

### 14.5 Kiosk and auto-advance

- With auto-advance on (§5.16), each slide advances after its duration. Its click steps fire at equal intervals within that duration.
- With `loop` on, the last slide wraps to the first, and there's no end screen.
- Manual navigation restarts the current slide's timer.
- In kiosk use, controls stay hidden until the pointer moves.
- An HTML export can force kiosk settings for that export (§15.5).

### 14.6 Links and interaction

- Clicking a link, or an element that has a link, activates it and never advances the slide.
- External URLs open in a new tab with `noopener` and `noreferrer`, and the presentation keeps its place.
- Slide links jump to their target (§14.2). Navigation links act like the matching keys.
- When `click_to_advance` is off, only keys, controls, links and swipes navigate. This suits interactive decks.

### 14.7 Deep links

- Presentation mode and exported HTML keep the current position in the URL fragment as `#slide-<n>`, numbered as in §14.2.
- The fragment is updated with `replaceState`, so the back button isn't filled with slide history.
- Opening a URL with this fragment starts on that slide.

---

## 15. Export

### 15.1 Export dialog and export check

- **Targets:** `.pres` (the default), PDF, Images, HTML and PowerPoint (`.pptx`). Workspace backup is started from the workspace instead (§9.7).
- **Range options:**
  - Range: all slides, the current slide, selected slides, a section, or a custom range such as `1–5, 8`.
  - Include hidden slides: off by default.
  - PDF, images and HTML offer both options. PPTX offers the range and always includes hidden slides, marked hidden. `.pres` always contains the whole presentation.
  - Slide links whose target isn't in the output become inactive, and the export check lists them.
- **Export check:** runs before every export.
  - It lists blocking validation errors, plus warnings specific to the target, each linked to the affected slide or element.
  - Warnings cover:
    - fonts that are missing, device-only or not packageable
    - text overflow
    - accessibility checker errors
    - HTML size
    - PPTX degradations
    - browser limits
  - Warnings never block the export.
- **Progress:** exports run in workers where possible, with progress and cancel.
- **Success:** the UI reports success only after the file has been handed to the browser's download or save mechanism. For PDF, that means once the print dialog has opened.

### 15.2 `.pres`

As specified in §10.3.

### 15.3 PDF (Chromium and Firefox)

- **Availability:** Chromium-based browsers and Firefox. In other engines, the PDF option is disabled. The explanation suggests Chrome, Edge or Firefox, or an HTML or image export instead.
- **Mechanism:** the app builds a print view with the shared renderer in `print` mode and opens the browser's print dialog. First, a short note tells the user to:
  - choose **Save as PDF**
  - keep margins at Default and scale at 100%
  - turn off **Headers and footers** if they appear
- **Print CSS:**
  - `@page` size is the slide's physical size (§4.2) for the Slides layout.
  - Notes pages and handouts use Letter or A4. The default depends on locale and can be changed.
  - The Slides layout uses `@page` margin 0, which also suppresses browser headers and footers in Chromium.
  - `print-color-adjust: exact` keeps backgrounds.
  - Each page is one page-sized container with `break-after: page`. Containers are sized so rounding never adds blank pages.
  - No editor or viewer UI is printed.
- **Layouts:**
  - Slides: one slide per page.
  - Notes pages: portrait, slide above, notes below.
  - Handouts: 2, 3 (with note lines), 4, 6 or 9 slides per page.
- **Builds:** each slide in its final state (the default), or one page per build step.
- **Content:**
  - Text is vector and selectable.
  - SVG and charts stay vector.
  - Images print at full resolution.
  - Video prints as its poster.
  - External links stay clickable. Slide links become in-document links where the engine supports them.
- **Metadata:** the document title is set to the presentation title, which the browser uses as the PDF title and suggested filename.

### 15.4 Images (PNG, JPEG) and copy as image

- **Formats:** PNG, or JPEG at quality 60–100 (default 90).
- **Scale:** 1×, 2× (default), 3× or 4× the logical size, capped at 8,192 px per side. At 2×, a 16:9 slide is 2560 × 1440.
- **Multiple slides:** downloaded as a ZIP, with files named `NN-slide-title.png`.
- **Content:** each slide appears in its final build state, with posters in place of video.
- **Copy slide as image:** available from the sidebar menu. It puts a PNG on the clipboard.
- **Mechanism:** the renderer's DOM for the slide goes into an SVG `foreignObject`, with every font and asset inlined. That SVG is drawn to a canvas at the chosen scale and encoded.
- **Support:** Chromium and Firefox. WebKit is enabled only if release testing verifies it (§3.6).

### 15.5 Standalone HTML

- **Modes:**
  - Single file (the default): everything is embedded, including presentation data, CSS, viewer code, assets and fonts.
  - Web folder (a ZIP): `index.html` plus a `media/` folder of images and video, for hosting or large media. Fonts, captions and presentation data stay embedded in `index.html`, since browsers block loading fonts and fetching files from pages opened from disk. The folder therefore works both hosted and opened locally.
- **Contents:**
  - The viewer bundle, which contains the shared renderer at the same version as the app (§3.2).
  - Presentation data as JSON in a non-executable `<script type="application/json">` block, escaped so the data can't close the block.
- **Options:**
  - Include speaker notes and presenter view (off by default).
  - Include hidden slides (off by default). Hidden slides that are link targets are always included.
  - Start slide.
  - Kiosk and loop settings, defaulting to the presentation's playback settings.
- **Offline:** the file works from `file://` with no network access.
- **Content Security Policy** (set by a meta tag):
  - Only the viewer's own script and style run, allowed by hash.
  - `data:` and `blob:` sources are allowed for images, media and fonts.
  - All network fetches are blocked.
  - The web-folder variant also allows its own `media/` files, whether hosted or opened from disk.
- **Size limits:**
  - A warning appears above 50 MB total.
  - Single-file export is capped at 200 MB, because embedding adds about a third to media size. Larger exports must use the web folder.
- **No active content from the document:** only the viewer script executes. Presentation data is inert and passes through the renderer; it's never interpreted as markup.
- **Page metadata:** `<title>` is the presentation title, `<html lang>` is the presentation language, and the meta description is the presentation description.
- **Also included:**
  - accessibility structure (§16.2)
  - deep links (§14.7)
  - keyboard and touch navigation
  - reduced-motion support
  - the autoplay start overlay (§13.8)
  - a print stylesheet, so printing the HTML file gives one slide per page

### 15.6 PowerPoint (`.pptx`), one-way

PPTX export lets people hand presentations to PowerPoint, Keynote and Google Slides users. The output is editable, not pixel-identical. There is no PPTX import (§22).

**Approach**

- A dedicated OOXML writer runs in a worker.
- Where DrawingML needs measured values, the writer asks the shared renderer. Examples are shrink-to-fit font scale and grown text box heights.
- Every catalog shape (§13.2) and every chart kind (§13.7) has a native counterpart, so most content stays editable.

**Mapping**

| Model | PPTX |
|---|---|
| Size | `sldSz` in EMU (1 unit = 9,525 EMU) |
| Theme tokens | Theme part: `dk1` = text primary, `lt1` = background, `dk2` = text secondary, `lt2` = surface, `accent1–6`, `hlink` = link. Tokens with no scheme slot are written as literal colors |
| Token colors in content | `schemeClr`, with `lumMod`/`lumOff` for tints, so recoloring the theme in PowerPoint still works |
| Theme fonts | Major font = heading, minor font = body. The accent font is written as a literal |
| Master elements | Shapes on the slide master. `show_master: false` becomes `showMasterSp="0"`. A master element containing a section title field is written onto each slide instead, with its value filled in |
| Fields | Slide number and auto-updating date become native fields. Slide count, presentation title and fixed dates become plain text |
| Layouts | One Blank and one Title Only layout. Slides don't use body placeholders |
| `title` role | The first title in reading order becomes a title placeholder with explicit geometry and formatting, so PowerPoint recognizes slide titles; other title-role text becomes ordinary text boxes. Hidden titles become title placeholders positioned off-slide |
| Text and shape text | `txBody` with paragraph and run properties, bullets (`buChar`, `buAutoNum`, `lvl`), spacing, insets, anchoring and `rtl`. Autofit maps to none, `spAutoFit` or `normAutofit` with the measured `fontScale` |
| Links | `hlinkClick` for URLs. Slide links use `ppaction://hlinksldjump`; navigation links use `ppaction://hlinkshowjump` |
| Shapes | `prstGeom` with adjust values. Fills map to solid, `gradFill` or `blipFill`; strokes to `ln`; shadows to `outerShdw` |
| Lines | Line shapes with `headEnd`/`tailEnd` |
| Connectors | `cxnSp`. When an end is attached, `stCxn`/`endCxn` point to the preset's nearest matching connection site. If no site matches, the end is written unattached |
| Images | `pic` with `srcRect` from the crop, `prstGeom` for the mask, `ln` for the border |
| SVG | `pic` with a PNG fallback plus an SVG blip extension |
| Groups | `grpSp` with `chOff`/`chExt`; nesting is preserved |
| Tables | `graphicFrame` with `a:tbl`: merges, cell fills, borders and a header-row flag |
| Charts | Native chart parts (bar, line, pie, doughnut, scatter) with cached values and an embedded workbook, so the data stays editable in PowerPoint |
| Video (MP4) | Embedded media with its poster and trim |
| Notes | A notes slide for each slide (toggle, on by default) |
| Sections | PowerPoint sections. When any section is named, unnamed groups become sections named "Untitled Section" |
| Hidden slides | `show="0"` |
| Hidden elements | `hidden="1"` on the shape |
| Slide backgrounds | `p:bg` with the matching fill |
| Transitions | Fade, push and wipe, with duration. Auto-advance maps to `advTm`, `click_to_advance: false` to `advClick="0"`, and loop to show properties |
| Builds | Native entrance and exit animations (appear, fade, fly), including by-paragraph builds, plus video play steps |
| Alt text and decorative | `descr` on each shape, plus the decorative extension |
| Metadata | Core properties: title, author, description |

**Degradations reported by the export check**

- Text can wrap differently, because PowerPoint's layout engine differs and fonts aren't embedded.
  - The check lists the fonts recipients need.
  - **Download fonts used** gives a ZIP of the redistributable files.
- Group opacity is applied to each child instead of the group. Overlapping children can look different.
- PowerPoint's reading order follows layer order. When a slide's explicit reading order differs, the export warns and names the slide.
- WebM video is replaced by its poster image.
- Blur radii for shadows are approximated.
- PowerPoint may re-route elbow connectors when shapes are moved.
- Auto-updating date formats map to PowerPoint's nearest date field format. Slide count and presentation title fields become plain text, so they don't update if the deck is edited in PowerPoint.
- Video captions aren't embedded. The check lists the affected videos.
- Element locks are written as DrawingML shape locks, which some apps ignore.
- Speaker notes are included by default. The notes toggle is shown in the export dialog so private notes aren't sent by accident.

### 15.7 Workspace backup

See §9.7. The backup ZIP contains ordinary `.pres` files, so single presentations can also be extracted and imported on their own.

---

## 16. Accessibility

Accessibility covers both authoring and viewing, including exported files.

### 16.1 Editor

- **Keyboard and focus:**
  - Every core action works from the keyboard.
  - Controls have accessible names, visible focus states and a predictable tab order.
  - The UI supports forced-colors mode and browser zoom up to 400% without losing function.
- **Selection:**
  - Selection is never shown by color alone. Handles and a patterned outline mark it.
  - Canvas objects can be selected and manipulated without a pointer, using Tab cycling, arrow keys and the numeric fields in the inspector.
  - The layers panel is a fully keyboard-operable tree.
- **Announcements:** selection changes and command results are announced in a polite live region.
- **Alt text:** there is an alt-text field with a **Decorative** option for images, SVG, video, charts, shapes without text and, optionally, groups.
- **Reading order:** it can be reviewed and edited separately from layer order (§5.15).

### 16.2 Viewer and exported HTML

- **Structure:**
  - The presentation lives in a `<main>` container, with one `<section>` per slide.
  - Each slide section has `aria-roledescription="slide"` and a label: "Slide n of m: title".
  - Only the active slide is exposed; the others are `inert`.
- **Order:** DOM order follows reading order, and visual stacking uses `z-index`.
- **Headings:**
  - The presentation title is an `<h1>`, visually hidden.
  - Each slide title is an `<h2>`.
  - The `heading` role renders as `<h3>`.
  - Other text renders as paragraphs and lists (`<ul>`/`<ol>`).
- **Content:**
  - Tables have `<th>` scopes.
  - Charts include a hidden data table.
  - Images have meaningful `alt` text, or an empty `alt` when decorative.
  - Master elements are hidden from assistive technology, except footer text (§5.11).
- **Links:**
  - Links are keyboard reachable and show visible focus.
  - Links are underlined by default. Removing the underline in a theme triggers a checker warning.
- **Controls and status:**
  - All controls have labels.
  - Slide changes are announced.
  - Focus stays on the controls or the slide container after navigation.
- **Motion and media:**
  - Reduced-motion preferences turn off transitions and animated builds (§5.14).
  - Video captions are shown (§13.8).

### 16.3 Accessibility checker

The checker runs on demand from the top bar and is summarized in every export check. Each issue links to its slide and element and offers a fix action where possible, such as adding alt text, marking as decorative, adding a hidden title or opening the reading order editor.

| Severity | Rule |
|---|---|
| Error | Image, SVG, video or chart that isn't decorative and has no alt text |
| Error | Slide with no title, neither visible nor hidden (§5.5) |
| Warning | Text contrast below WCAG 2.2 AA: 4.5:1 for normal text, 3:1 for large text (at least 24 units regular or 18.67 units bold) against a solid background |
| Warning | Duplicate slide titles |
| Warning | Table with no header row |
| Warning | Video with sound and no captions (skipped when the video is muted) |
| Warning | Link text such as "click here", or a bare URL longer than 40 characters |
| Warning | Text overflowing its box |
| Warning | Theme link style without underline |
| Tip | Text over an image or gradient, where contrast can't be verified |
| Tip | Text smaller than 16 units (12 pt) |
| Tip | Empty placeholders |

### 16.4 Language

- The presentation language is required and defaults to the browser locale (§5.3).
- It is used for the HTML `lang` attribute, PPTX language tags, locale formatting in charts and date fields, spellcheck, and the direction of the automatic reading order.
- A text run can override it with the `lang` mark.

---

## 17. Internationalization

- **Text content:**
  - Unicode throughout.
  - Paragraph direction is `auto`, `ltr` or `rtl`, with bidirectional text handled by the browser.
  - Complex-script shaping comes from the browser.
- **Fonts:**
  - The core fonts cover Latin, Greek and Cyrillic.
  - Families for Arabic, Hebrew, Devanagari, Thai, Chinese, Japanese and Korean load on demand from the app's origin (§7.1).
  - Once used, they are cached for offline use and embedded in HTML exports.
- **Input:** IME composition is handled by the text engine (§3.3).
- **UI language:** the UI ships in English. Every UI string is externalized, so the app can be localized later.
- **Formatting:** numbers and dates in content follow the presentation language.
- **Out of scope:** vertical text and mirroring the editor UI for right-to-left languages.

---

## 18. Privacy and security

### 18.1 Privacy

- **No tracking:** no accounts, analytics, telemetry, ads or third-party requests. Network access is limited to the cases in §3.5.
- **Content stays on the device:** content leaves only through exports, clipboard copies or linked-file saves that the user starts.
- **Photo metadata:** stripped from added photos by default (§8.4).
- **Original filenames:** kept in `.pres` so backups are faithful. They are never written into HTML, PDF, image or PPTX exports.
- **Speaker notes:**
  - Left out of HTML exports by default.
  - Included in PPTX by default, with the toggle shown in the export dialog (§15.6).
- **Diagnostics:** messages never include presentation content. An optional diagnostic export records structure and errors without text or media, and the user reviews it before saving.

### 18.2 Untrusted input

All imported packages, pasted content, dropped files, fonts, media and clipboard payloads are untrusted.

- **ZIP:**
  - path rules and entry limits (§10.1)
  - decompressed bytes are counted as they're produced
  - compression-ratio limits
  - no symlinks
- **SVG:**
  - Parsed with DTDs and entity expansion disabled.
  - Sanitized against an allowlist of elements and attributes:
    - shapes, paths, text, gradients, patterns, clip paths and masks
    - basic filters
    - `use` with internal references only
    - `style` attributes, limited to allowlisted properties
  - `<style>` elements: simple rules (type, class and ID selectors) are inlined as allowlisted presentation attributes, then the element is removed. `@import` rules and external `url()` references are dropped.
  - Removed:
    - `script`, `foreignObject`, event-handler attributes
    - animation elements, processing instructions
    - external references
    - `data:` URLs other than PNG and JPEG images
  - Re-serialized after sanitizing.
- **Render isolation:**
  - User SVG is only ever rendered through `<img>` using `blob:` or `data:` URLs, never inlined into the DOM.
  - Even if sanitizing missed something, scripts and external loads can't run in that context.
- **Style values:**
  - Every value is validated against a strict grammar, both at import and when a command runs:
    - colors: hex or a token
    - lengths: finite and in range
    - enumerations
    - font values (§7): registry or presentation IDs, or device font names limited to letters, digits, spaces, `.`, `_` and `-`
  - The renderer applies values through CSSOM setters, and only values that passed this grammar reach them.
  - Free-form user text, such as content, names, alt text and URLs, never enters CSS, class names or markup. DOM IDs come only from validated element IDs.
- **Text:** always rendered as text nodes, never as HTML.
- **Links:**
  - Scheme allowlist (§5.10). `javascript:`, `data:`, `file:` and all other schemes are rejected.
  - External links open with `noopener noreferrer`.
- **Fonts:** loaded through FontFace, so the browser's font sanitizer applies. Size limits apply (§20.3).
- **Media:** file signatures are checked, and decoding is left to the browser.

### 18.3 Application hardening

- **The app's CSP:** no inline scripts unless allowed by hash, no `eval`, and no third-party origins.
- **Trusted Types:** enabled where supported.
- **Dependencies:** pinned and reviewed. Nothing is loaded from a CDN at runtime.
- **Standalone HTML:** has its own restrictive CSP (§15.5).

---

## 19. Error handling

**Principles**

- Errors are actionable.
- An error never implies that data was saved or exported when it wasn't.
- Where possible, an error names the presentation, slide and element involved.
- Failed imports and migrations leave the workspace unchanged.
- Messages are non-modal unless a decision is required.
- Storage failures stay visible until resolved or dismissed.

**Categories**

| Category | Examples |
|---|---|
| Validation | Schema or semantic errors that block import or export |
| Compatibility | Newer `format_version`; a migration that would lose meaning |
| Asset | Missing, corrupt, oversized or unsupported files; unplayable codec; hash mismatch; restricted font |
| Storage | Quota exceeded, transaction failure, persistence denied |
| Concurrency | Open in another tab, lock lost, newer app version elsewhere |
| Environment | Export unsupported in this browser, popup blocked, file permission denied, file changed on disk |
| Network | Remote image fetch blocked |
| Rendering (warning) | Font substitution, text overflow, empty placeholder in an export |

---

## 20. Performance budgets and limits

### 20.1 Reference hardware and fixtures

- **Reference machine:** a laptop with a 4-core CPU of roughly 2020 mid-range class, 8 GB RAM, integrated graphics and a 1920 × 1080 display, running current Chromium, Firefox and Safari.
- **Small fixture:** 10 slides of text, shapes and images, about 5 MB.
- **Medium fixture:**
  - 150 slides
  - 200 images (100 MB)
  - 20 tables and 20 charts
  - 3 videos (150 MB)
  - 2 custom font families
- **Limit fixture:** 1,000 slides, with element and asset counts near the §20.3 limits.

### 20.2 Budgets

All budgets are for the medium fixture on the reference machine unless the table says otherwise.

| Metric | Budget |
|---|---|
| App start from cache to interactive workspace | ≤ 1.5 s |
| Open presentation to first slide editable | ≤ 1.5 s (≤ 5 s for the limit fixture) |
| Switch slides in the editor | ≤ 100 ms |
| Drag, resize, rotate | 60 fps; 95th-percentile frame ≤ 16.7 ms |
| Typing, from key press to paint | 95th percentile ≤ 50 ms |
| Autosave, serialize and commit | 95th percentile ≤ 100 ms, with serialization kept off the critical input path |
| Undo or redo | ≤ 100 ms |
| Advance a slide in presentation mode | ≤ 50 ms to the first transition frame |
| `.pres` export / import | ≤ 10 s / ≤ 15 s |
| PPTX export | ≤ 20 s |
| PNG export of one slide at 2× | ≤ 1 s |
| Editor tab memory | ≤ 1.5 GB |

**General rules**

- Thumbnails render lazily: only visible slides and their near neighbors.
- Full-resolution assets are never decoded at startup. Large images use their previews.
- Heavy work runs in workers.
- The main thread never blocks for more than 200 ms without visible progress.
- Any operation longer than 500 ms shows progress.

### 20.3 Limits (defaults, configurable at build time)

| Item | Limit |
|---|---|
| Package size (compressed and uncompressed) | 2 GB |
| `manifest.json` | 50 MB uncompressed |
| ZIP entries | 10,000 |
| Compression ratio for any entry over 10 MB | 200:1 |
| Image file | 50 MB; 100 megapixels decoded |
| SVG file | 5 MB; 50,000 nodes; nesting depth 64 |
| Video file | 1 GB. Total per presentation: 2 GB |
| Font file | 30 MB |
| Captions file | 2 MB |
| Slides per presentation | 1,000 |
| Elements per slide / per presentation | 1,000 / 100,000 |
| Group nesting depth | 8 |
| Table | 200 rows × 50 columns; 5,000 cells |
| Chart | 50 series; 5,000 points per series |
| Text per element | 50,000 characters |
| Builds per slide | 200 |
| Coordinates / sizes | Within ±100,000 units / ≤ 100,000 units; finite numbers only |
| Single-file HTML export | 200 MB, with a warning above 50 MB |
| Workspace backup part | Under 4 GB; larger backups are split (§9.7) |

The About screen and the release documentation list the limits and the supported browser matrix. The app never implies unlimited capacity.

---

## 21. Testing and release acceptance

The release is acceptable when automated and manual tests show everything below.

### Document integrity

- **Round trip:** save, reload, export to `.pres` and re-import. The result is deeply equal to the original after canonicalization, and the assets are byte-identical.
- **References:** IDs and references stay valid after duplicating, pasting (within a presentation and across presentations), deleting, undo and redo, and importing as a copy.
- **Rejected inputs:** each of these fails with nothing imported:
  - invalid, corrupt, oversized or newer-version packages
  - zip bombs
  - path-traversal entries
  - hash mismatches
- **Migrations:** each migration has fixtures and expected outputs. Version 1 has none yet, but the test harness exists.
- **Fuzzing:** the ZIP, manifest, SVG, WebVTT and clipboard-payload parsers are fuzzed.

### Data safety

- **Tab locking:** handover never loses committed changes, including a forced takeover from a frozen tab. Unsaved changes from the tab that lost the lock become a recovery snapshot.
- **Save failures:** injected failures (quota, aborted transactions) produce the correct status, and the app never shows "Saved" falsely.
- **Snapshots:** they're created at every listed trigger and pruned by the retention rules. Restore and open-as-copy work.
- **Asset cleanup:** never removes an asset that a snapshot or the undo history still uses.
- **Workspace storage:** trash restore and purge, workspace backup and restore, and the import conflict choices all behave as specified.
- **Linked files (Chromium):** saving works, and the conflict prompt appears when the file changed on disk.
- **App updates:** a tab running an older version never writes storage or documents that a newer version has migrated.
- **Offline:** the installed app launches and every feature that doesn't need the network works with the network disabled.

### Editing

- **Content types:** every type can be created, edited, styled, arranged, grouped and deleted.
- **Undo:** each meaningful gesture or coalesced text edit is one undo step.
- **Groups:** resizing matches the §13.5 formulas, and ungrouping preserves visual positions (pixel comparison).
- **Connectors:** follow their targets and detach when a target is deleted.
- **Change layout:** the preview matches the result, and nothing is ever deleted.
- **Themes:** changing the theme updates only token-linked properties, and **Reset to theme** works.
- **Tools:** find and replace, format painter, and every paste path (internal, cross-presentation, external rich and plain text) behave as specified.

### Rendering and presenting

- **Visual regression:**
  - Golden screenshots cover each fixture in each engine: the editor canvas without overlays, the viewer and thumbnails.
  - Within an engine, differences must stay within an antialiasing tolerance.
  - Differences between engines are reviewed but don't fail the build.
- **Shared renderer:** the editor, viewer, print view and HTML export produce the same rendered DOM for the same slide and step.
- **Presentation mode:**
  - the full key map, including clicker keys and F5 interception
  - build navigation semantics
  - hidden slides
  - links that don't advance
  - kiosk timing and looping
  - presenter view sync and the laser pointer

### Export

- **PDF (Chromium and Firefox):**
  - Page count equals slides, or build steps when that option is on.
  - Page size equals slide size within 0.5 pt.
  - Backgrounds are present, text is extractable, and no browser headers or footers appear.
  - Notes and handout layouts are correct.
- **Images:** exact dimensions, and a visual match with a viewer screenshot within tolerance.
- **HTML (single file and web folder):**
  - Opens from `file://` offline, with zero network requests and zero CSP violations.
  - Notes and presenter view are present only when opted in.
  - Automated accessibility checks pass.
- **PPTX:**
  - Passes OOXML schema validation.
  - Opens without repair prompts in PowerPoint (Windows and macOS), Keynote, Google Slides and LibreOffice.
  - Every row of the §15.6 mapping is spot-checked.
  - Charts can be edited and videos play in PowerPoint.

### Accessibility

- **Automated checks** on the editor, viewer and exported HTML.
- **Manual screen-reader passes:** NVDA with Firefox and Chrome, and VoiceOver with Safari, for both the viewer and exported HTML.
- **Keyboard-only authoring:** a walkthrough of the core tasks.
- **Checker rules:** each has fixture-based tests.
- **Reading order:** can be verified separately from stacking order.

### Performance

- Every budget in §20.2 is measured on the reference hardware for each fixture.
- A regression of more than 10% blocks the release.

---

## 22. Out of scope

The product does not attempt to:

- reproduce every feature of PowerPoint, Keynote or Google Slides
- import PPTX or other presentation formats, or round-trip PPTX
- provide collaboration, comments, cloud storage, accounts, sync or a publishing platform
- guarantee pixel-identical text layout across browsers and operating systems
- turn unsupported content into approximations, or flatten structured content, just to make an import look successful
- provide audio-only media, motion paths, emphasis effects, morph transitions, 3D, freehand drawing, equations, code highlighting, image filters, vertical text or font subsetting
- generate PDFs directly, or export PDF from WebKit browsers

Export is different. PPTX export necessarily approximates some features (§15.6), and it discloses every approximation in the export check rather than hiding it.

---

## 23. Future extension points

The model and renderer should allow these to be added later:

- area and combination charts
- equations and code blocks
- audio
- local comments
- sync through storage the user provides
- direct PDF generation, which would enable PDF export in WebKit
- font subsetting
- more transitions and effects
- persistent undo history
- PPTX import through a separate compatibility layer with explicit loss reporting

Rules for extensions:

- Every future object type must be declarative, editable, versioned and renderable on its own.
- Every addition increments `format_version` and ships with a migration.
- No exporter ever becomes the canonical storage model.

---

## Appendix A. Illustrative document excerpt

This excerpt is abbreviated. Fields equal to their defaults are omitted, as in canonical form (§5.6), and `…` marks content that has been cut.

```json
{
  "format": "pres",
  "format_version": 1,
  "created_with": "1.0.0",
  "exported_at": "2026-09-28T14:03:11Z",
  "document": {
    "id": "p8fK2mQx7RzT0aLc9vYb1w",
    "metadata": {
      "title": "Q3 Review",
      "language": "en-US",
      "created_at": "2026-09-20T09:12:00Z",
      "updated_at": "2026-09-28T14:02:57Z"
    },
    "size": { "width": 1280, "height": 720, "preset": "16:9" },
    "theme": { "id": "t1", "name": "Harbor", "…": "tokens, role styles, defaults (§6.1)" },
    "fonts": [],
    "master": { "elements": [] },
    "layouts": [],
    "assets": [
      {
        "id": "a_photo01", "kind": "image", "media_type": "image/jpeg",
        "byte_size": 482113, "sha256": "…", "width": 3000, "height": 2000,
        "path": "assets/a_photo01.jpg"
      }
    ],
    "sections": [
      { "id": "sec_main", "name": null, "slide_ids": ["s_intro"] }
    ],
    "slides": {
      "s_intro": {
        "id": "s_intro",
        "elements": [
          {
            "id": "e_title", "type": "text", "role": "title",
            "geometry": { "x": 80, "y": 60, "width": 1120, "height": 100 },
            "text": {
              "box": { "vertical_align": "bottom", "autofit": "none" },
              "body": { "paragraphs": [ { "inlines": [ { "text": "Q3 Review" } ] } ] }
            }
          },
          {
            "id": "e_photo", "type": "image", "role": "image",
            "geometry": { "x": 660, "y": 200, "width": 540, "height": 480 },
            "accessibility": { "alt": "Team at the product launch" },
            "image": {
              "asset_id": "a_photo01",
              "crop": { "left": 0.125, "top": 0, "right": 0.125, "bottom": 0 },
              "mask": { "preset": "round_rect", "adjust": { "radius": 24 } }
            },
            "style": { "stroke": { "color": { "token": "color.border" }, "width": 2 } }
          },
          {
            "id": "e_callout", "type": "shape",
            "geometry": { "x": 80, "y": 260, "width": 420, "height": 120 },
            "shape": {
              "preset": "round_rect",
              "text": {
                "body": { "paragraphs": [ { "inlines": [
                  { "text": "Revenue up " },
                  { "text": "18%", "marks": { "weight": 700 } }
                ] } ] }
              }
            },
            "style": { "fill": { "type": "solid", "color": { "token": "color.accent.1", "tint": 0.6 } } }
          },
          {
            "id": "e_link", "type": "connector",
            "geometry": {
              "start": { "element_id": "e_callout", "site": "right" },
              "end": { "element_id": "e_photo", "site": "left" }
            },
            "connector": { "routing": "elbow" },
            "style": { "stroke": { "color": { "token": "color.text.secondary" }, "width": 2 } }
          }
        ],
        "notes": { "paragraphs": [ { "inlines": [ { "text": "Open with the launch photo." } ] } ] },
        "builds": [
          { "id": "b1", "element_id": "e_photo", "effect": "fade_in", "trigger": "on_click", "duration_ms": 400 }
        ]
      }
    },
    "playback": {
      "default_transition": { "kind": "fade", "duration_ms": 300 }
    },
    "authoring": { "guides": [], "grid": { "spacing": 20 } }
  }
}
```

Notes on the excerpt:

- **Crop:** the photo's crop leaves 75% of its width. That gives a 2250 × 2000 visible source area, whose 9:8 ratio matches the 540 × 480 frame (§13.4).
- **Connector geometry:** the connector's two ends live in `geometry`, not in the `connector` object. Its ends follow `e_callout` and `e_photo` wherever they move (§13.3).
- **Wrapping:** nothing records where the text wraps. The renderer computes wrapping and never stores it (§5.1). A `LineBreak` inline appears only where the user typed a line break.

