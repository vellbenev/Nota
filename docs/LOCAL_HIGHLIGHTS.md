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
- `HighlightOverlay.tsx` only mounts on virtualized pages. Pointer clicks are hit-tested beneath the text layer, so
  saved highlights are interactive without blocking native text selection. Keyboard targets open the same editor.
  Yellow, green and blue are available in **Highlights & notes**. Notes support mixed script text. Dexie live queries
  update the panel and marks after successful writes.
- `TextSelectionMenu.tsx` captures pointer/keyboard selection changes, preserves the selection on pointer actions and
  closes on scroll, resize, Escape or a document change. Session-only PDFs must be saved before highlighting.
- Highlight and note operations contain no network calls. Startup no longer probes Ollama automatically. **Check**
  explicitly probes it; an explicit assistant submission can also probe before sending.
- **Translate / Clarify** routes English to Persian translation and Persian to Persian clarification. Mixed scripts
  require an explicit choice in the assistant action picker. Cloud requests send on the explicit action without a
  separate confirmation dialog.
- **Explain** sends a quick explanation; **Ask** opens a question composer without inference. Every response offers a
  follow-up composer tied to its original passage or image. Document switching cancels active assistant work.

## Selection and creation improvements

The floating menu appears after pointer selection finishes, or after keyboard selection settles. Choosing yellow, green
or blue keeps the captured passage intact; the chosen color applies before saving. Visible selections retain their menu
during scrolling; leaving the viewport, Escape, zoom changes and reader resizing dismiss it to avoid acting on stale
geometry.

New marks appear immediately while IndexedDB saves them. The status distinguishes saving from saved. A failed write
removes the optimistic mark and reports the error. **Undo highlight** reverses the most recent creation in this open
document, including a write still in progress. It waits for that write before deleting the record, so refresh cannot
bring an undone mark back. Dismissing the notification or creating another highlight ends the previous Undo opportunity.
No schema migration is needed, and existing highlights remain unchanged.

Repeated and overlapping selection rectangles are merged only on the same visual line. Separate lines, columns and gaps
in bidirectional text remain separate. Cross-page selection and PDFs with broken Persian text mappings retain their
existing limitations.

Quick manual check: select a multiline passage, choose a color, save, and immediately Undo. Save again, zoom to 150%,
then reload to check alignment and persistence. Try backward dragging and Shift+arrow selection, and verify that merely
highlighting never sends an Ollama request.

## Saved highlights and notes panel

Click a saved mark (or focus its keyboard target and press Enter) to open its editor. Change color, add or edit a note,
delete an individual note, or use **Explain** / **Ask** for that exact quote and page. Opening a highlight and editing
notes never starts inference; **Ask** only opens a draft; **Send question** performs the explicit assistant submission.
Highlight removal confirms that its attached notes will also be removed. Individual note deletion keeps the highlight
and all other notes.

The toolbar's **Notes** button toggles a separate panel with its own scroll area. Search matches both passages and
notes, including mixed Persian/English text. Sort by page order or newest first. **Page N ↗** loads the destination
geometry and jumps to the highlight's position even when that page has not yet been mounted by the virtualized reader.
The active mark is outlined. The panel becomes an overlay drawer in narrow windows. Failed writes retain note text and
show an error; adding-note drafts survive closing and reopening the panel. Existing records need no schema migration.
Cross-page selection remains a separate future phase.

Manual check for this phase: click an existing highlight, change its color, add then edit a note, refresh, search for
the edited text, and jump to a distant page. Delete only the note and verify that its mark remains; then remove a
highlight and confirm its notes disappear too. Close Notes and drag a new selection across an existing mark to check
that text selection still works.

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
3. Click a saved highlight or open **Notes** in the toolbar. Change its color, enter a note, and click **Add note**.
   Network should remain silent.
4. Change zoom from 50% to 200%, resize the window, and scroll away/back. The marks should follow their original text.
   Test a PDF with intrinsically rotated pages too.
5. Switch to another paper: its own highlights appear. Switch back and refresh: the highlight, color and note remain.
   Reimporting identical PDF bytes reuses the same document and highlights.
6. Use **Remove highlight** and confirm removal: its marks and attached notes disappear, including after refreshing.
7. Select mixed Persian/English text and choose **Translate / Clarify**. Choose translation or clarification in the
   assistant picker; there is no automatic mixed-text submission.
8. Choose **Ask**: no request should occur until **Send question**. Choose **Explain** to submit a quick explanation.
   After receiving an answer, use its follow-up composer without selecting text again. Check the model route first:
   cloud models send content off the machine without a separate confirmation dialog. Merely selecting text must never
   send a request.
9. Try selecting across two pages: the one-page diagnostic should appear and no highlight should be saved.

Browser storage remains tied to the origin and can be evicted or cleared. Text anchor repair, cross-page highlights and
notes export are later milestones.

## Reading position when editing notes

The virtual page spacer never shrinks to fit the reader's height. PDF anchor restoration runs on page-layout or zoom
changes, while note updates and callback changes leave the scroll position alone. Page geometry updates trigger a render
only when the geometry changes. Notes-panel focus navigation scrolls only its own list. Automated regression covers
adding, editing and deleting a note on page 115; a separate real PDF.js browser check verifies unchanged page and scroll
offset when adding a note on page 8 of a disposable 12-page PDF.
