# Contributing to Nota

Thanks for helping make academic reading more accessible and private. Small, focused changes
are easiest to review. For a substantial feature or architectural change, open an issue first
with the problem, proposed behavior, and relevant tradeoffs.

## Development setup

Use Node.js 22.13 or newer, then run:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. Ollama is optional for reader work and automated tests; the
[README](README.md#configure-ollama) explains AI setup. Keep `package-lock.json` in sync when
changing dependencies. Do not commit `node_modules/`, generated builds, local configuration,
logs, or temporary screenshots.

## Design boundaries

- Preserve local storage and explicit AI actions. Opening a paper, selecting text, changing zoom,
  or creating a highlight must not trigger inference.
- Keep fonts, workers, math assets and mascot runtime assets local. Do not introduce telemetry
  or remote assets into reading or model-response rendering.
- Preserve document-scoped cancellation and bounded request context. Keep model routing and
  cloud routing understandable to the reader.
- Store highlight geometry in the normalized page coordinate system. Validate zoom and rotation
  behavior when changing reader geometry.
- Support keyboard navigation, visible focus, reduced motion, and mixed English/Persian text.
- Follow the existing TypeScript, CSS Modules, EditorConfig and Prettier conventions. Prefer the
  shared UI controls over duplicate components.

`docs/ARCHITECTURE.md` is the original proposal, not an exact inventory of current dependencies.
Use the source and feature guides when assessing implementation behavior.

## Before submitting a pull request

```sh
npm run typecheck
npm test
npm run build
npm run verify:assets
```

Add meaningful regression coverage for behavior changes. For visual changes, check the production
preview and include a screenshot using a shareable sample. For reader/storage changes, check
import, reload, document switching, position restoration and zoom. For AI changes, check explicit
submission, cancellation, errors and local/cloud routing. Manual checklists live in the feature guides
linked from the README. The Rive browser harness is documented in [tests/runtime](tests/runtime/README.md).

Explain the problem, resulting behavior, validation performed, and any remaining limitations in
your pull request. Avoid unrelated refactors. Never attach private papers, local browser databases,
authentication tokens, or logs containing selected research text.

## Reporting bugs

Include the Nota version, browser and OS, reproduction steps, expected and actual behavior,
and whether the problem occurs with a bundled sample. For AI issues, include the Ollama version,
model tag, local/cloud route, and a sanitized error. Share only PDFs and Rive assets you have
permission to redistribute.

## Licensing contributions

By submitting a contribution, you agree to license your contribution under the project's
[MIT License](LICENSE). For third-party assets, include their source, copyright attribution,
and redistribution license; record exceptions in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
