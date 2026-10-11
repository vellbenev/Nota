/**
 * PDF.js entry used by the app (vite.config.ts aliases `pdfjs-dist` here).
 *
 * The modern PDF.js build calls very recent built-ins (Map.prototype.getOrInsertComputed,
 * Math.sumPrecise, Uint8Array base64 helpers, iterator helpers, ...). Browsers without
 * them fail to open any PDF. These are the exact core-js modules PDF.js's own legacy
 * build bundles for the display layer and viewer utilities; each one is a no-op where
 * the browser already supports the feature. Importing them first guarantees they are
 * installed before PDF.js evaluates. The worker uses PDF.js's legacy worker build.
 */
import 'core-js/modules/es.array.includes.js';
import 'core-js/modules/es.iterator.constructor.js';
import 'core-js/modules/es.iterator.drop.js';
import 'core-js/modules/es.iterator.every.js';
import 'core-js/modules/es.iterator.filter.js';
import 'core-js/modules/es.iterator.find.js';
import 'core-js/modules/es.iterator.flat-map.js';
import 'core-js/modules/es.iterator.for-each.js';
import 'core-js/modules/es.iterator.map.js';
import 'core-js/modules/es.iterator.some.js';
import 'core-js/modules/es.iterator.take.js';
import 'core-js/modules/es.iterator.to-array.js';
import 'core-js/modules/es.json.parse.js';
import 'core-js/modules/es.json.stringify.js';
import 'core-js/modules/es.map.get-or-insert-computed.js';
import 'core-js/modules/es.map.get-or-insert.js';
import 'core-js/modules/es.math.sum-precise.js';
import 'core-js/modules/es.promise.try.js';
import 'core-js/modules/es.regexp.escape.js';
import 'core-js/modules/es.set.difference.v2.js';
import 'core-js/modules/es.set.intersection.v2.js';
import 'core-js/modules/es.set.is-disjoint-from.v2.js';
import 'core-js/modules/es.set.is-subset-of.v2.js';
import 'core-js/modules/es.set.is-superset-of.v2.js';
import 'core-js/modules/es.set.symmetric-difference.v2.js';
import 'core-js/modules/es.set.union.v2.js';
import 'core-js/modules/es.typed-array.with.js';
import 'core-js/modules/es.uint8-array.from-base64.js';
import 'core-js/modules/es.uint8-array.set-from-base64.js';
import 'core-js/modules/es.uint8-array.set-from-hex.js';
import 'core-js/modules/es.uint8-array.to-base64.js';
import 'core-js/modules/es.uint8-array.to-hex.js';
import 'core-js/modules/es.weak-map.get-or-insert-computed.js';
import 'core-js/modules/es.weak-map.get-or-insert.js';
import 'core-js/modules/web.dom-exception.stack.js';
import 'core-js/modules/web.url.parse.js';

export * from 'pdfjs-dist/build/pdf.min.mjs';
