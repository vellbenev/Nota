# Days 4–5 — Selections, normalized highlights and local notes

> **Current behavior.** The section below, _Text-anchored highlights, merging and history_, describes how highlighting
> works today. Later sections are the original milestone notes; where they mention a separate **Highlight** button,
> **Undo highlight**, a color drop-down or removal confirmations, the newer behavior replaces them.

## Text-anchored highlights, merging and history

**Why highlighting was unreliable.** Two root causes, both fixed:

1. _Selection jumps._ PDF.js text layers are sparse, absolutely positioned spans. When a drag ended over blank space
   (past a line end, between paragraphs, in a margin or column gutter), browsers resolved the selection focus to an
   arbitrary DOM position, typically the end of the page or the next page. Users saw a huge selection, no highlight
   menu, or the "one PDF page at a time" error. PDF.js's own viewer prevents this by moving the layer's `.endOfContent`
   element beside the selection's moving edge; React-PDF does not. `features/reader/textLayerSelection.ts` ports that
   behavior for every mounted page (it stays inactive in Firefox and Chromium 148+, which handle it natively, exactly as
   PDF.js decides).
2. _Geometry-only records._ A highlight was only a set of rectangles, so highlighting already highlighted text stacked a
   second record on top (muddy blended colors, duplicate cards, ambiguous clicks), and nothing could tell which text a
   highlight covered.

**Data model.** New highlights also store `range`: character offsets into the page's _readable text_ (the text layer
flattened to a string, one `\n` per PDF.js line break; see `features/reader/pageText.ts`). Offsets are independent of
zoom, rotation and window size. Geometry is still stored and rendered as before. No schema migration is needed: `range`
is optional, and older highlights are resolved on demand from their quote plus prefix/suffix context. Backups round-trip
`range`. Selections are trimmed of leading/trailing whitespace, so a highlight never paints a sliver on a neighboring
line.

**Highlighting rules** (`features/highlights/planning.ts`):

- No overlap with a saved highlight: create one.
- Inside a single highlight: change its color (or nothing, if it already has that color). The selection menu shows the
  current color with a check mark and offers **Remove**.
- Overlapping one or more highlights: extend the oldest over the union and fold the others into it, in one transaction.
  Notes of folded highlights move to the survivor; nothing is lost. Touching highlights (one ends where the next begins)
  stay separate.

**History** (`features/highlights/useHighlightHistory.ts`). Creating, combining, recoloring and removing highlights and
deleting notes go through one per-document history. Writes run strictly in order, so Undo waits for a write still in
progress and a refresh never resurrects an undone change. Each change records repository snapshots _before_ and _after_;
undo and redo replay them through `highlights.apply`, which writes nothing and reports a conflict if the records changed
meanwhile (for example, a note was added to a highlight whose creation you are undoing, or the highlight of a deleted
note is gone). Removal therefore needs no confirmation dialog: the notification offers **Undo**, and `⌘Z`/`Ctrl+Z` works
anywhere outside text fields. Successful notifications fade after five seconds (not while hovered or focused); errors
stay until dismissed.

**Selection menu.** One click on a color highlights. `H` highlights with the last color used (remembered locally); `N`
or **Note** highlights and opens the note composer focused. Session-only PDFs show the controls disabled, with the
reason in the tooltip.

**Notes.** Notes are edited inline. `⌘↵`/`Ctrl+Enter` saves; `Escape` cancels an edit without closing the panel. Text
being typed into the composer or an edit survives switching highlights, closing the panel, changing papers and reloading
(it is kept in `localStorage` until saved or discarded). Note writes wait for pending highlight writes, so writing a
note on a just-created highlight cannot fail because the highlight is not stored yet.

**PDF engine compatibility.** PDF.js 6.3's modern build calls very recent built-ins
(`Map.prototype.getOrInsertComputed`, `Math.sumPrecise`, `Uint8Array` base64 helpers, iterator helpers). Browsers
without them could not open any PDF. The app now loads exactly the core-js modules PDF.js's legacy build would add
(`infrastructure/pdf/pdfjs-engine.mjs`, a separate chunk) before the modern engine, and uses the legacy worker build,
keeping every chunk within the 500 kB budget.

Automated coverage: `tests/highlight-anchoring.test.tsx` (text offsets, legacy anchor resolution, planning rules,
selection stabilizer), `tests/highlight-history.test.tsx` (optimistic writes, undo during a pending write, failures,
conflicts, merge/undo round trip) and the updated viewport, selection and notes-panel suites.

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
