# Nota 0.1.0-rc.1 — Release verification

## Implemented

- Assistant state directly drives the mentor mascot: idle, pondering, explaining, and error. The bundled Rive asset is
  the default; reduced motion uses a neutral placeholder with a live text badge. Rive support is lazy loaded, uses local
  WASM, disables CDN assets, and falls back on failure. See `public/mascot/README.md` for the asset contract.
- PDF reader and rich response rendering load on demand. Vite separates the PDF engine/viewer, markdown, math, storage,
  virtualizer, Rive, and core UI. The PDF viewer explicitly depends on engine initialization. Application JS chunks
  remain below 500 kB; the PDF worker and optional Rive WASM are separate larger assets.
- Data & privacy offers confirmed deletion of a single document and full database reset. Single deletion atomically
  removes its PDF, view state, highlights, annotations and cached responses. Full reset deletes and reopens the Dexie
  database. Assistant requests are cancelled and relevant session history is forgotten. Pending imports and view writes
  are drained before deletion.
- Model badge distinguishes `-cloud`, loopback local models, and local models reached through a remote endpoint. This is
  a routing indicator based on the configured tag/URL, not an attestation of a custom server's behavior.
- Visible keyboard focus, native confirmation dialogs with Cancel initially focused, Escape dismissal, bidirectional
  isolation for filenames/quotes/code, and reduced-motion styling.

- Shared input/textarea, settings popover, and styled native modal components. Overlays respect fullscreen and modal top
  layers; closing settings preserves drafts and in-progress transfer state.
- System/Light/Dark appearance, with a locally persisted preference; pane-aware responsive controls and improved
  secondary-text contrast. PDF highlights remain visible against the white page in either theme.
- Notes search, page/newest sorting, color editing, note editing/deletion, anchored navigation, and Markdown export.
  Library backup/import validates and previews before merging.
- Reading focus, fullscreen, persisted pane sizes, Fit width/Fit page, and horizontal scrolling at enlarged zoom. Saving
  notes preserves the current PDF position.
- Per-paragraph Markdown direction, scrollable tables/code/equations, and readable multiline PDF selections. Snip
  actions stay within the visible reading area and expose preparation errors beside the controls.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run verify:assets
npm run preview -- --port 4173
```

Automated coverage includes state projection, reduced motion, Rive loading/retry, confirmation cancellation,
transactional deletion rollback and document isolation, full reset/reimport, session-history reset, and model labels,
alongside the existing reader/tutor/snip suite. The asset audit checks CSS/font references, entry assets, local PDF
worker and Rive WASM, and application chunk sizes.

The October 2026 UI pass passed 45 unit tests and 65 UI tests, TypeScript, the production build, and the asset audit.
See [UI review](UI_REVIEW.md) for viewport sizes, browser coverage, and test limitations. The development-only
[UI fixture](../tests/runtime/README.md) exercises response states without live inference.

Production browser smoke checks: sample PDF rendering with split bundles, console warnings/errors, keyboard snip
activation/Escape, delete-dialog cancellation, library restoration after reload, and the cloud/local badge.

## Manual release checklist

1. Open a sample or your own PDF. Tab through the library, reader and assistant: focus must remain visible. Toggle Snip
   mode with Space and press Escape to exit. Select text and press Escape to clear the selection/menu.
2. Send an explicit translation, clarification or question. Observe Pondering while waiting, Explaining during
   streaming, and Ready to help on completion or cancellation. Stop must abort the request. A failed request shows Needs
   attention. Existing tutor and snip guides detail these flows.
3. Enable the operating system's reduced-motion preference: the animation should be replaced by a neutral placeholder
   while its text badge updates. With no `.riv` installed, there should be no Rive runtime request.
4. Change the model tag between a `-cloud` tag and an installed local tag. The badge must update immediately. A remote
   Ollama URL must not be labelled Local-only. Checking or sending remains explicit.
5. Using disposable PDFs, create highlights/notes and a cached translation. In Data & privacy choose one PDF, open
   Delete document data, and cancel with Escape: nothing should disappear. Confirm deletion when ready; that PDF and its
   data must disappear while other library entries remain. Reimporting must start without its old notes/cache/history.
6. With only disposable data in this origin, confirm Reset all Nota data. Reload: the library must be empty. Import
   again to verify storage remains usable.
7. In DevTools Network, reload and open a PDF/Markdown response: fonts, worker, scripts and styles should come from the
   app origin. Ollama requests occur only on explicit model actions. Test mixed Persian/English prose and inline/block
   equations for direction isolation.

8. In Settings, select System, Light, and Dark. Reload to verify persistence. In fullscreen, open settings and a nested
   dropdown; Escape should dismiss the dropdown before settings. Cancel a deletion dialog and verify focus returns.
9. At narrow widths, open notes, search a quote or note, change sort order, edit a note, and jump to its highlight.
   Confirm saving a note does not move the PDF.
10. At 200% zoom, scroll to both horizontal edges. Switch to Fit page, resize the panes, and toggle focus mode. Select a
    crop near a page edge; the question and actions must remain visible.
11. Export Markdown and a library backup. On a disposable origin, preview and restore the backup twice: existing
    PDFs/highlights/notes must not duplicate.

## Scope and limitations

Assets have no CDN dependency; this does not add a service worker or guarantee a cold start without the app server.
Model execution still requires the configured Ollama service. A modern ES2022 browser is required. Storage is scoped to
browser/origin. Close other Nota tabs before destructive data management so another tab cannot re-save in-memory work;
session conversations are memory-only. Snip image previews remain memory-only. The bundled Rive animation is Character
poses by avocadenko under CC BY 4.0; see THIRD_PARTY_NOTICES.md for attribution. A neutral loading indicator and retry
control replace the retired static character.
