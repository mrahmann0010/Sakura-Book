import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

/* --------------------------------------------------------------------------
   Copies the three pdf.js runtime assets into public/pdfjs/ before a build.

   These are files pdf.js fetches at runtime by URL, not modules it imports, so
   no bundler ever sees them and none of them can be resolved from the client
   chunk that needs them:

     · pdf.worker.min.mjs — parsing and rasterising happen off the main thread.
       The documented alternative is `new URL("…", import.meta.url)`, which asks
       the bundler to emit the worker as an asset. That resolves differently
       under Turbopack (dev) and the production compiler, and differently again
       under Vercel's pipeline vs. the standalone output this repo's Dockerfile
       ships — a class of breakage that only ever shows up in the environment
       you did not test. A fixed path under public/ is the same path in all
       four, and the runner stage already copies public/ wholesale.

     · cmaps/ — character-map tables for CJK text whose encoding is referenced
       rather than embedded. This shop sells Japanese-language books; without
       these a sample can render its kana and kanji as blanks.

     · standard_fonts/ — metrics for the 14 PDFs are allowed to assume rather
       than embed (Helvetica, Times, …). Extremely common in exported samples,
       and missing them costs the reader whole runs of Latin text.

   Copied rather than committed: they belong to the installed pdfjs-dist and
   must move in lockstep with it. A stale worker against a bumped library is a
   silent version mismatch, so public/pdfjs/ is gitignored and rebuilt here.
   -------------------------------------------------------------------------- */

const require = createRequire(import.meta.url);
/* Resolved through the package rather than assembled from a relative path:
   npm may hoist pdfjs-dist to the monorepo root or keep it in apps/web, and
   this script must find it either way. */
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
const destination = path.join(import.meta.dirname, "..", "public", "pdfjs");

/* The legacy build throughout, matching the import in pdf-reader.tsx. */
const assets = [
  ["legacy/build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
  ["cmaps", "cmaps"],
  ["standard_fonts", "standard_fonts"],
];

/* Cleared first so a pdfjs-dist upgrade that drops or renames a file does not
   leave the old one behind to be served next to the new ones. */
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const [from, to] of assets) {
  await cp(path.join(pdfjsRoot, from), path.join(destination, to), { recursive: true });
}

console.log(`pdf.js assets → ${path.relative(process.cwd(), destination)}`);
