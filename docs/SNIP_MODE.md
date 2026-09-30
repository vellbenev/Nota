# Days 8–9 — Visual explanation and snip mode

## Reader interaction

**Snip mode** is an explicit toolbar toggle. While active, PDF text selection and links are covered by a
pointer-capturing overlay. Drag in either direction on one rendered page; coordinates clamp to that page. Crops smaller
than 8 CSS pixels in either dimension are rejected. A bounding box and floating **Explain snip / Cancel** toolbar
appear, with an optional question. The controls float outside the clipped PDF page and are clamped to the visible
reading area, including fullscreen; crop-preparation errors appear beside those controls. Drawing, editing the question and cancelling make no network requests.

Escape exits snip mode. For keyboard access, focus a page's snip region and press Enter to select its central area, then
use keyboard navigation to reach the question/actions. Only one page's crop is active at a time. Zoom resets an unfinished box. Leaving the
virtual page, cancelling, switching documents or unmounting cancels crop preparation.

## Geometry, rendering and limits

`src/infrastructure/pdf/snip.ts` stores ephemeral rectangles as `[x, y, width, height]` fractions of the **displayed,
rotated page**, with a top-left origin. This differs deliberately from the persistent highlight geometry's unrotated PDF
coordinates: snips are never persisted or reattached.

The crop plan targets at least PDF scale 2, or twice the displayed scale when larger. An adequately resolved page canvas
can be copied directly. Otherwise PDF.js renders the page through a translated viewport into a detached, crop-sized
canvas. No full-page high-resolution bitmap is allocated. Intrinsic rotation and crop boxes follow PDF.js's viewport.

Limits:

- Longest output side: **1024 pixels**.
- Encoded image file: **384 KiB** maximum, resulting in at most **512 KiB of base64**.
- PNG is preferred; oversized images try JPEG at decreasing quality, then progressively smaller dimensions.
  Oversized/invalid results are rejected.
- Canvas memory is released after encoding or cancellation. The preview uses an in-memory data URL. Images are never
  written to IndexedDB, localStorage or files. Snip requests bypass response caching, including completed answers.
  Refreshing or switching documents discards the preview.

## Multimodal request and capability gate

`src/prompts/explainImage.ts` adds `explain_image-v1`. It grounds the explanation in visible symbols, axes, labels,
legends and equations and explicitly requires reporting unreadable or clipped areas instead of reconstructing missing
information. The bounded structured envelope includes document/page, crop dimensions, normalized rectangle and optional
question; it excludes the base64 string.

The image is attached as raw base64 in the user message's `images` array, following
[Ollama's vision API format](https://github.com/ollama/ollama/blob/main/docs/capabilities/vision.mdx). The current model
is checked using `POST /api/show` and must explicitly report `vision` in `capabilities`, as defined in
[Ollama's API schema](https://github.com/ollama/ollama/blob/main/docs/openapi.yaml). The capability request contains
only the model name. Unknown capabilities fail closed; no model-name guessing or silent fallback occurs. The error
banner directs the reader to select an installed vision model or update/check Ollama and retry.

**Explain snip** checks capabilities and submits the crop immediately on the explicit action. There is no separate cloud
consent checkbox or confirmation dialog. Select a local vision model and a loopback endpoint before explaining a snip if
the image must stay on your machine.

`TutorExecution` owns the capability request and chat request under the same AbortController and request/document
identities. **Stop response** and document switching abort either stage. Snips reuse
queued/waiting/streaming/complete/error/cancelled states, TTFT measurement, display throttling, Markdown/math and
Regenerate. Capability checks have a 10-second timeout. No image enters conversation history.

## Verification

The final automated check passed **45 tests**, typecheck and the production build. Vite retains its existing bundle-size
warning. Added tests cover:

- Reverse drags, out-of-bounds clamping, minimum area and invalid geometry.
- Scale-2 rendering, rotation-oriented page dimensions, 1024-pixel clamping and bounded compression.
- Direct canvas copying versus translated PDF rendering; render cancellation and bitmap cleanup.
- Page/question metadata and actual `/api/chat` user-message image formatting.
- Supported, unsupported, missing and unavailable model capabilities, and network failure.
- Cancellation during capability checking and streaming, stale-response protection and cache bypass.
- Dragging/question editing produces neither network requests nor submission callbacks; only Explain triggers crop
  preparation.

An earlier browser check on the bundled English fixture produced a **1016 × 190** preview. That historical check used a
consent flow that is no longer present; current submissions follow the behavior described above. The live
`gemma4:31b-cloud` vision request then completed, described the visible English text and explicitly flagged its
truncated sentence instead of inventing the missing figure. No crop file was saved during verification.

## Manual verification

1. Run `npm run dev`; open `http://127.0.0.1:5173/` and import a PDF containing a diagram or equation.
2. Open Network inspection filtered to `11434`. Toggle **Snip mode** and drag around the figure, including its
   axes/legend or the whole equation. Try reverse dragging and dragging beyond the page edges. Expect a bounded box and
   zero Ollama requests.
3. Enter an optional question. Click **Cancel**, or press Escape: the box should disappear and text selection should
   work again.
4. Repeat at 50% zoom and click **Explain snip**. Inspect the sharp preview and dimensions; the longest side must not
   exceed 1024. Check the model route first: cloud models send the crop off the machine.
5. Expect `/api/show` followed by `/api/chat` only when vision is reported. Inspect the chat payload: one user-message
   `images` entry containing raw base64, plus page and question in the JSON envelope.
6. Use a text-only model. Expect an actionable vision banner and **no `/api/chat` image submission**. Select a
   vision-capable installed model and retry; no automatic fallback is selected.
7. During checking or streaming, click **Stop response**, or switch documents. The request must abort and no old answer
   may appear on the new paper.
8. Test a rotated page and a clipped or unreadable equation. The crop should match the displayed area; the explanation
   should flag missing or unreadable content.
9. Stop Ollama and retry to check the network error path. Refresh to confirm the crop preview disappears while saved
   PDFs, highlights and notes remain.

No guarantees are made about a vision model's interpretation accuracy; the prompt explicitly requests visible evidence
and uncertainty. Crops exceeding the image limits are compressed or downscaled, so a smaller crop is preferable for very
dense equations.

