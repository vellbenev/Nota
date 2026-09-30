# Days 4–5 — Selections, normalized highlights and local notes

## Implementation

- `src/infrastructure/pdf/geometry.ts` clips DOM range rectangles to the text layer, accounts for its displayed size,
  inverts the PDF.js viewport matrix and normalizes against the unrotated crop box. Stored coordinates have a
  **bottom-left origin**. Rendering applies the forward matrix and uses viewport fractions, independent of canvas device
  pixel ratio. Separate rectangles preserve mixed-direction runs.
- Selection snapshots include page, capture rotation, quote and 64-character prefix/suffix anchors. Cross-page
  selections and selections exceeding 6,000 characters are rejected. Malformed Persian presentation glyph extraction
  retains the existing diagnostic. Anchors are stored for future reattachment; this milestone renders saved geometry and
  does not perform fuzzy text relocation.
- Dexie schema version 2 adds `highlights` and `annotations`, retaining version 1 documents. Both have `docId` and
  `[docId+page]` indexes; annotations additionally index `highlightId`. Highlight deletion and associated note deletion
  share one transaction. Missing documents and failed writes show errors; failed note writes retain the input.
- `HighlightOverlay.tsx` is noninteractive and only mounts on virtualized pages. Yellow, green and blue are available in
  **Highlights & notes**. Notes support mixed script text. Dexie live queries update the panel and marks after
  successful writes.
- `TextSelectionMenu.tsx` captures pointer/keyboard selection changes, preserves the selection on pointer actions and
  closes on scroll, resize, Escape or a document change. Session-only PDFs must be saved before highlighting.
- Highlight and note operations contain no network calls. Startup no longer probes Ollama automatically. **Check**
  explicitly probes it; an explicit assistant submission can also probe before sending.
- **Translate / Clarify** routes English to Persian translation and Persian to Persian clarification. Mixed scripts
  require an explicit choice in the assistant action picker. Cloud requests send on the explicit action without a
  separate confirmation dialog.
- **Ask Nota** immediately sends a default question about the selected passage. The composer supports custom follow-ups.
  Document switching cancels active assistant work.

## Verification

Automated coverage includes:

- Inverse/forward geometry at 50%, 100%, 125%, 200%, all four right-angle rotations, nonzero crop origins, CSS scaling,
  clipping and separate bidi rectangles.
- Version 1 → 2 migration, persistence after closing/reopening IndexedDB, document isolation, colors, notes, deletion
  cascade and invalid/orphan writes.
- Actual virtualized reader UI with mocked PDF drawing: select, save, recolor, append note, switch documents, remount
  and remove. Fetch is stubbed to reject any network access.
- Ask Nota explicit submission, single-page constraints and language routing are tested.
- Existing hashing, document imports, viewport anchors and Ollama stream parsing remain covered.

The live browser check saved a blue highlight and note in the English fixture, changed zoom to 150%, and verified both
after refreshing. Browser rendering uses real PDF.js; jsdom tests replace canvas drawing and supply deterministic text
rectangles.

## Manual verification

1. Run `npm run dev`; use `http://127.0.0.1:5173/` consistently. Import a text PDF or open a saved sample.
2. Open browser Network tools and filter `11434`. Select one passage and click **Highlight**. No request should appear.
3. Expand **Highlights & notes**. Change its color, enter a note, and click **Add note**. Network should remain silent.
4. Change zoom from 50% to 200%, resize the window, and scroll away/back. The marks should follow their original text.
   Test a PDF with intrinsically rotated pages too.
5. Switch to another paper: its own highlights appear. Switch back and refresh: the highlight, color and note remain.
   Reimporting identical PDF bytes reuses the same document and highlights.
6. Use **Remove highlight**: its marks and attached notes disappear, including after refreshing.
7. Select mixed Persian/English text and choose **Translate / Clarify**. Choose translation or clarification in the
   assistant picker; there is no automatic mixed-text submission.
8. Choose **Ask Nota**. Verify that this explicit action sends a default question with the selected quote and page.
   Check the model route first: cloud models send content off the machine without a separate confirmation dialog. Merely
   selecting text must never send a request.
9. Try selecting across two pages: the one-page diagnostic should appear and no highlight should be saved.

Browser storage remains tied to the origin and can be evicted or cleared. Text anchor repair, cross-page highlights and
notes export are later milestones.

