# Local HTML Slide Editor

[![CI](https://github.com/yucheng-chang-yc/local-html-slide-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/yucheng-chang-yc/local-html-slide-editor/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D20-blue)

*[繁體中文版](README_zh-TW.md)*

**Turn AI-generated HTML slide decks into editable working files.**

Local HTML Slide Editor opens an existing HTML or ZIP deck, lets you edit the rendered elements with presentation-style controls, and exports the result back to HTML or ZIP for continued editing.

### Try it now

**[Open the browser preview](https://staging.local-html-slide-editor.pages.dev/)**

The hosted staging build is available for quick evaluation without installation. Files and workspace data stay in the current browser; export HTML or ZIP when you want a portable copy.

![Local HTML Slide Editor workspace](docs/assets/editor-overview.png)

## Why it exists

Small presentation edits become awkward once a generated deck is delivered as HTML. Moving a card, correcting a title, replacing an image, or realigning a group can require source-code edits or full regeneration.

A useful editor has to preserve several things at once:

- **Rendered identity:** the element selected on the canvas remains the element being edited.
- **Layout stability:** moving one object should not unexpectedly reflow nearby content.
- **Source integrity:** unrelated scripts, assets, and markup should remain untouched.
- **Round-trip continuity:** edits survive export, reload, and re-import.

## How it works

```text
HTML / ZIP
   ↓
compatibility classification
   ↓
visual editing workspace
   ↓
source-aware patches / bounded deck serialization
   ↓
HTML / ZIP export
   ↓
reopen and continue editing
```

Two local-first runtime modes are supported:

- **Local server mode:** Node/Express stores workspaces and snapshots in a local project data directory.
- **Static browser mode:** IndexedDB stores workspace state, with OPFS mirroring when available.

The imported source is preserved separately from the current working version in both modes.

## Core design

### Compatibility is explicit

HTML slide generators produce fixed canvases, flow/flex/grid layouts, nested transforms, framework-controlled DOM, Shadow DOM, and canvas-only rendering. The editor classifies each document before exposing editing operations:

```ts
type CompatibilityLevel = 'SUPPORTED' | 'MIXED' | 'READ_ONLY';
```

- **SUPPORTED:** ordinary static slide structures can be edited directly.
- **MIXED:** risky subtrees are restricted while the rest of the document remains usable.
- **READ_ONLY:** structures without a reliable editing mapping remain read-only with an explicit reason.

### Ordinary edits preserve untouched source

The original HTML remains the canonical source. Text, style, geometry, and attribute changes are represented as typed patch operations against source-mapped elements. Structural slide changes may rebuild the identified deck container while leaving source outside that boundary unchanged.

### Free movement respects layout flow

The first drag or resize of a flow element is handled as one reversible transaction:

1. preserve the original flow footprint with an invisible same-size placeholder;
2. detach the real element into free positioning;
3. retain its identity and visual geometry;
4. commit the conversion and movement together so Undo/Redo restores the prior state coherently.

## Editing capabilities

- **Canvas:** select, multi-select, marquee-select, drag, eight-way resize, rotate, keyboard nudge, grid/guides, align, distribute, group, ungroup, and layer ordering.
- **Content:** rich text, fonts, size, weight, alignment, line height, color, shape text, basic shapes, tables, images, crop/fit modes, aspect-ratio lock, and format painter.
- **Deck:** live thumbnails, add/duplicate/reorder/delete slides, slide sizing/backgrounds, notes, presenter view, print view, zoom, and contextual inspector controls.
- **Portability:** open HTML or ZIP, autosave locally, restore snapshots, export HTML or ZIP, then reopen the exported result.

The interface is desktop-first and presentation-oriented.

## Architecture

```text
source HTML / ZIP
       ↓
workspace adapter
(Node filesystem or browser IndexedDB/OPFS)
       ↓
compatibility classifier + editable source mapping
       ↓
sandboxed editing iframe
       ↓
selection / commands / history / inspector
       ↓
typed source patches + bounded deck serialization
       ↓
HTML / ZIP export
```

Key boundaries include source-script disabling in edit mode, sandboxed execution preview, statically analyzable speaker notes, ZIP path validation, and fail-closed handling when reliable element mapping cannot be established.

See [`docs/EDITABLE_DECK_CONTRACT.md`](docs/EDITABLE_DECK_CONTRACT.md) for the source/edit/export contract.

## Verification

The repository keeps automated coverage at several levels:

- [`tests/unit/`](tests/unit/) — core parsing, source mapping, history, and safety behavior.
- [`tests/integration/`](tests/integration/) — cross-module workspace and export behavior.
- [`tests/e2e/`](tests/e2e/) — local editor interaction workflows.
- [`tests/web-e2e/`](tests/web-e2e/) — browser storage and static-web workflows.
- [`fixtures/`](fixtures/) — bounded technical compatibility cases used by the test suite.

Run the broader local verification path with:

```bash
corepack pnpm@11.9.0 run verify:all
```

GitHub CI runs lint, typecheck, unit/integration tests, the static browser build, Chromium browser-mode E2E, and license verification on pushes and pull requests.

## Run locally

Requires Node.js 20+ and `pnpm@11.9.0` through Corepack.

```bash
git clone https://github.com/yucheng-chang-yc/local-html-slide-editor.git
cd local-html-slide-editor
corepack pnpm@11.9.0 install --frozen-lockfile
```

### Local server mode

```bash
corepack pnpm@11.9.0 run dev
# http://127.0.0.1:4173
```

Windows users can also run `start-local-editor.cmd`.

### Static browser mode

```bash
corepack pnpm@11.9.0 run dev:web
corepack pnpm@11.9.0 run build:web
```

The static build is written to `dist/web`.

## Current boundaries

- Compatibility is intentionally bounded; arbitrary runtime-controlled DOM, Shadow DOM, and canvas-only decks may remain read-only.
- Browser-mode workspaces live in the current browser profile. Exported HTML/ZIP is the portable copy.
- Structural slide changes may normalize comments, whitespace, or attribute ordering inside the identified deck container.
- Sandboxing and import-path protections are implemented; the project does not claim full untrusted-content security certification.
- Real-time collaboration and concurrent external-edit merging are not implemented.

## Repository map

- [`apps/`](apps/) — client and local-server applications.
- [`packages/`](packages/) — editor-core and workspace modules.
- [`tests/`](tests/) — automated verification.
- [`fixtures/`](fixtures/) — technical compatibility fixtures.
- [`docs/`](docs/) — editing contract, limitations, and third-party notices.

No license file is currently included; repository contents remain all-rights-reserved by default.
