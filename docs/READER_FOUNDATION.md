# Days 2–3: reader foundation and local persistence

Implemented on 2026-09-29. The architectural plan remains the product roadmap; this document records the shipped scope
and its practical limits.

## Modules

| Module                                                       | Responsibility                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `src/domain/document.ts`                                     | Stored document, summary and normalized reading-position types                          |
| `src/infrastructure/pdf/hashFile.ts`                         | Cancellable worker bridge; terminates its worker on success, failure or abort           |
| `src/infrastructure/pdf/hashFile.worker.ts`, `hashDigest.ts` | SHA-256 over the exact file bytes with Web Crypto                                       |
| `src/infrastructure/pdf/validatePdf.ts`                      | Empty-file, PDF type/extension and header checks before persistence                     |
| `src/infrastructure/db/database.ts`                          | Dexie database `nota`, schema version 1                                                 |
| `src/infrastructure/db/documents.ts`                         | Atomic import/deduplication, metadata listing, reopen and partial view/metadata updates |
| `src/features/library/useDocumentLibrary.ts`                 | Import/reopen lifecycle, save queue, last-document restoration and storage errors       |
| `src/features/reader/ReaderWorkspace.tsx`                    | File input, whole-reader drop target, library selector and storage status               |
| `src/features/reader/PdfViewport.tsx`                        | PDF lifecycle, virtual page window, page jump, zoom and scroll anchor restoration       |
| `src/features/reader/geometry.ts`                            | Pure page layout and page/fraction-to-scroll conversion                                 |
| `src/features/reader/selection.ts`                           | Existing single-page selection capture and extraction warning                           |

## Document identity and storage

The document identity is the lowercase SHA-256 of the complete PDF bytes. Filename, MIME and modified date are not part
of the digest. Web Crypto does not offer an incremental SHA-256 API, so one complete buffer is read and digested in a
dedicated worker. This keeps hashing work off the UI thread but still uses memory proportional to file size.
Independently hashing chunks and joining their hashes would not yield the required SHA-256 identity and is intentionally
not used. See the
[Web Crypto digest documentation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest).

The `documents` store has primary key `docId` and index `lastOpenedAt`. Each record contains `name`, `size`, `mime`,
`pageCount`, `createdAt`, `lastOpenedAt`, `pdfBlob` and `view: { page, offset, zoom }`. `page` is one-based; `offset` is
a normalized vertical page position. Blob, view and full text are not indexes. Day 1 created no database, so version 1
is the initial schema rather than an upgrade of an existing store. Future changes must use a Dexie version migration.

Import hashes before opening a database transaction. Inside a read/write transaction it looks up the digest, inserts
once if absent, or touches `lastOpenedAt` if present. Duplicate imports preserve the original filename, creation
timestamp, Blob, page count and reading position. The transaction makes simultaneous imports of identical bytes safe.
View and page-count writes update only those fields, preserving the stored PDF.

On startup the library loads in descending `lastOpenedAt` order and restores the most recent paper. A new user import
supersedes startup restoration. Reading-position writes are serialized, debounced by 180 ms, and flushed before
switching/reimporting, on visibility loss, and on page hide. The UI distinguishes pending, completed and failed saves.
Page-hide flushing is best effort; **Position saved** is the durable-write confirmation.

Quota, unavailable IndexedDB and write errors are visible. Failed imports offer an explicit session-only option; the
user must choose it. Invalid or empty files do not create records. PDF.js handles full PDF parsing and reports corrupt
files; password-protected PDFs request an unlocked copy. Browser eviction/removal produces a reopen error with an
instruction to reimport the original.

## Rendering and lifecycle

`@tanstack/react-virtual` renders the visible range with one page of overscan on either side. Only this range mounts
React-PDF `<Page>` components, including their canvases/text/link layers. Page dimensions are learned as pages load and
retained for the open document. Unvisited pages use estimates; the scrollbar can adjust as mixed-size pages are
discovered, while the current page anchor is preserved.

The reader uses a fitting page width multiplied by zoom. Canvas, text and annotation layers receive that same width
rather than resizing the canvas alone with CSS. A page index and fraction are captured at the viewport anchor, then
converted to the new layout on zoom, resize and page-size discovery. The page-boundary calculation tolerates one CSS
pixel of browser scroll rounding. Device pixel ratio is bounded by a 12-million-pixel budget per mounted canvas.

Document switches key the PDF subtree by `docId`. Unmounting a React-PDF page/document cancels its render/loading work;
object URLs are revoked and pending animation-frame corrections are cancelled. Asynchronous import results carry
operation tokens. View/page-count callbacks reject an old document ID. Assistant requests and selections are cleared
both when an import starts and when the resulting document activates, so a selection made during hashing cannot carry
into another paper.

## Verification

The test suite combines Node's test runner with `fake-indexeddb` for repository operations and Vitest/jsdom for import
and viewport component integration. It checks known SHA-256 vectors and a multi-megabyte binary payload, renamed
duplicates, concurrent imports, PDF Blob round trips, database close/reopen, reading-position preservation, quota
rollback, invalid files, worker termination, file-input/drop events, immediate document switches, and viewport cleanup.
The viewport integration test uses the real TanStack Virtual implementation with PDF drawing mocked, and exercises 120
pages, a deep initial page, zoom, resizing, page jump and limited canvas mounting.

Live browser checks also use the real worker, IndexedDB, React-PDF and a temporary 120-page PDF with mixed rotations.
Native file-input import, saved-library restoration, page-80 navigation and nearby canvas mounting were exercised. A
reload restored page 80 at 150% zoom. Importing the same 120-page file again showed the duplicate notice and retained
exactly one library entry. OS-level dragging is covered by the component drop-event integration test rather than
automated desktop dragging.

The [README](../README.md#verify-persistence-manually) contains the manual acceptance sequence. No inference is required
for these checks. The bundled Persian fixture remains a visual-rendering sample with damaged shaped-glyph extraction; it
is not a language-quality acceptance fixture.

## Deferred

Persistent annotations/highlights and chats, snips, page rotation controls, full library deletion/export, cross-tab
reading-position conflict resolution, and offline app installation remain later scope. Saved PDFs work without Ollama;
reopening the app itself still requires the Vite/preview host to be available because no service worker is installed.
