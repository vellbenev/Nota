# UI review · October 2026

This pass preserves Nota’s warm green studio design while fixing layout, contrast, overlay placement, and reading
interactions. Fields, settings popovers, and confirmation dialogs now use shared components. The appearance setting
supports System, Light, and Dark and persists locally.

## Verified

- Production-preview smoke test: local PDF/Rive assets, saved highlight, notes panel, theme selection; no browser
  errors.
- Real browser checks at 320 × 640, 375 × 844, and 1280 × 800, plus a 240px assistant panel.
- Light/dark appearances; empty library; bundled English and Persian PDFs; notes search, ordering, and editing.
- PDF zoom at 100% and 200%, horizontal scrolling to both edges, Fit page, focus mode, and fullscreen menus.
- Saving the page-8 regression note preserved page 8 and the exact scroll offset (3914.5px before and after).
- Nested settings dropdowns, confirmation Cancel/focus return, keyboard selection, and Snip controls near a page edge.
- Deterministic response fixture for queued, waiting, streaming, completed, cancelled, and error states; mixed-language
  paragraphs, Markdown tables, long code, equations, and follow-up controls.

Automated checks cover focus restoration, modal busy-state dismissal, fullscreen/top-layer portals, settings draft
preservation, theme selection, crop preparation errors, per-block text direction, and PDF line breaks. Run
`npm run typecheck`, `npm test`, `npm run build`, and `npm run verify:assets`. See
[the runtime fixtures](../tests/runtime/README.md) for reproducible visual checks.

## Release scope

Browser checks used the Codex in-app Chromium browser. Safari/Firefox and touch-device checks remain part of release
validation; no cross-browser certification is implied. Live model quality and network availability were not tested in
this UI pass. Existing assistant tests exercise explicit requests, streaming, cancellation, cached responses, and
conversation context with deterministic model responses. PDFs with malformed Persian text maps still require Snip; Nota
reports that limitation before sending text.
