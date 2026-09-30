# Days 6–7 — Tutor pipeline and rich streaming

## Prompts and bounded context

`src/prompts/` contains versioned base, `translate_en_fa`, `clarify_fa`, and `ask` templates. The base establishes
Nota's academic mentor voice, evidence limits, language behavior and the boundary between instructions and untrusted PDF
data. JSON serialization keeps source strings structurally separate even if they contain delimiter-like text. This
reduces prompt-injection exposure; it is not a guarantee that a model will follow every instruction.

The request carries:

- Verbatim selected text, up to 6,000 characters, with document ID/name and one-based page.
- At most one adjacent paragraph fragment on either side, 750 characters each (1,500 total). The reader infers paragraph
  breaks from rendered text-line gaps because PDF text layers often have no semantic paragraph structure. Complex
  columns and rotated layouts can yield imperfect context. No other page is loaded for the prompt.
- An optional question of up to 2,000 characters.
- For Q&A, up to six recent document-specific conversation entries, at most 4,000 characters total and 1,500 per entry.
  History is session-only, bounded to ten documents, and never mixes papers.

Translation and clarification exclude conversational history to keep passage transformations stable and cacheable. Q&A
uses the question's language by default, with a manual Persian/English choice. The **Request context** disclosure shows
the exact envelope and prompt version; cached responses are identified as local replays.

Generation options are version-controlled with the envelope: temperature 0.2, context window 16,384 and maximum output
4,096 tokens. Character limits bound the payload; they are not exact model-specific token counts.

## Request lifecycle

`machine.ts` defines `idle → queued → ttft → streaming → complete`, with error and cancelled exits. The UI names `ttft`
“Waiting for first token.” TTFT starts immediately before sending and stops at the first nonempty visible content chunk,
not a network byte or model thinking.

`TutorExecution` owns the AbortController, immutable request input, request ID, document ID, cache access, stream and
display buffer. Identical concurrent submissions share one promise. A different submission cancels its predecessor. The
reducer rejects updates with mismatched identities and ignores chunks after terminal states. Document switching resets
the state and aborts the request immediately. **Regenerate** uses the original request snapshot and bypasses cache, even
if the reader has subsequently selected another passage.

The fetch receives the controller signal directly. **Stop response** aborts that fetch, cancels its response reader,
flushes visible partial text and marks the request cancelled. Late chunks cannot change a new document. Partial, failed
and empty answers never enter cache. The adapter handles split UTF-8/NDJSON frames, terminal events, malformed frames,
HTTP failures, missing completion and cancellation. Frames and answer text are bounded at 1,000,000 and 100,000
characters respectively.

`createDisplayBuffer` accumulates all chunks and coalesces updates onto animation frames, with at least 50 ms between
intermediate renders (at most 20 Markdown renders per second). Completion and cancellation flush immediately. This
reduces Markdown work during token bursts; no universal 60 fps guarantee is made for every document/device.

## Cache

Dexie version 3 adds `responseCache`, preserving v1/v2 documents, highlights and notes. Only completed
translation/clarification answers for persisted documents are cached. Q&A and session-only PDFs bypass persistent
caching.

The SHA-256 key hashes a structured tuple of document ID, action, normalized selected text, bounded context, model
identity and prompt version. Context includes page, document name and output language; generation options are also
included. Model identity includes the Ollama endpoint to avoid replaying a response from a different configured server.
Selected text normalization is NFC, CRLF-to-LF and outer trim; internal whitespace and paragraph boundaries remain
significant.

Cache lookup happens before any model request or connection probe. A hit displays **Complete · cached** and needs no
network access because nothing is sent. A miss or **Regenerate** sends on the explicit action, without a separate cloud
confirmation dialog. Select a local model first for local inference. Entries expire after seven days; writes prune
expired and oldest entries to approximately 50 MiB. Storage failures show a warning but do not discard a successful
answer. Cache replay does not call `/api/tags` or `/api/chat`.

## Markdown, equations and direction

`ResponseMarkdown.tsx` uses react-markdown, remark-gfm, remark-math and rehype-katex. KaTeX CSS and fonts are emitted as
local build assets. Inline `$...$`, display `$$...$$`, and model-style `\(...\)` / `\[...\]` delimiters are supported.
Code spans/fences are excluded from delimiter conversion. Incomplete streamed equations remain text until their
delimiters close.

Persian prose uses RTL; equations and code use LTR isolation so variable order stays intact. Display equations and
tables can scroll horizontally. Raw HTML is disabled, KaTeX trust is off, and generated images are rendered as text
placeholders so they cannot silently fetch external resources.

## Automated verification

Run:

```sh
npm test
npm run typecheck
npm run build
```

Tests cover prompt versions and verbatim quoting, nearby/history limits, language routing, cache-key sensitivity, cache
expiry/reopen, v2-to-v3 migration, in-flight deduplication, cache replay/regeneration, cache failures, stale identities,
cancellation, burst coalescing, and rich Markdown/math. UI tests click **Stop response** and verify the signal attached
to fetch is aborted and its reader cancelled. Existing reader persistence/highlighting tests remain in place.

Live browser checks also exercised the bundled English sample through `gemma4:31b-cloud`: translation completed and a
repeated submission displayed a cache hit. A Persian Q&A request about the sample rendered `E = mc^2` through KaTeX
inside RTL prose and correctly stated that the excerpt did not establish the equation. No private paper was used. The
final verification run passed 36 tests, typecheck and the production build (with the existing bundle-size warning).

## Manual verification

1. Run `npm run dev` and open `http://127.0.0.1:5173/`. Open a bundled or local text PDF. Start Network inspection
   filtered to `11434`.
2. Select an English passage and choose **Translate / Clarify**. Check the model route before submitting: a cloud model
   sends the context off the machine immediately on the explicit action. Observe waiting, streamed Persian text,
   first-token timing, and completion. Expand **Request context** to inspect the bounded excerpt.
3. Repeat that passage/action: expect **Complete · cached** and no network request. Refresh, reselect the same passage
   and repeat to verify persistent caching. Click **Regenerate**: expect a new `/api/chat` request.
4. Select Persian text, choose **Clarify in Persian**, and submit. Check that the simplified response preserves claims,
   quantities and equations. A repeated clarification should also replay from cache.
5. Choose **Ask Nota**: this immediately submits a default question about the passage. Use the composer for a custom
   follow-up and select an answer language if desired. Inspect the bounded same-document history. Q&A always makes a new
   request.
6. Ask about `E = mc^2` in Persian and request an equation display. Verify its superscript and left-to-right
   mathematical order in RTL prose. An excerpt that does not establish the equation should receive an explicit evidence
   limitation.
7. Click **Stop response** while waiting or streaming. The fetch should be aborted, status should become cancelled
   immediately, and partial text should stop growing. Regenerate to retry.
8. Switch documents during a response: the old fetch should abort and its text must not appear in the new paper.
   Highlighting, notes and ordinary reading must still produce zero Ollama requests.
9. Stop Ollama or enter an unavailable model and regenerate: expect an actionable error while the reader remains usable.

