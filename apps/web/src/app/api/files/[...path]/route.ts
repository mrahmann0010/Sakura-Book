import type { NextRequest } from "next/server";

/* --------------------------------------------------------------------------
   Legacy covers and sample PDFs, served from this app's origin.

   Legacy, and only that: current uploads live in the shop's Garage bucket and
   are fetched straight from the Cloudflare domain in front of it, so that the
   bytes come off an edge rather than out of this container — see the header of
   lib/storage-url.ts. What still arrives here is a book whose cover or sample
   was uploaded before that move and whose row therefore still holds a Supabase
   Storage URL.

   The claim this route was built on held, which is why it can shrink to this
   rather than being ripped out: storage moved, this file and storage-url.ts
   changed, and not one stored row did.

   Streamed, not buffered. `response.body` is piped straight through, so a 40MB
   sample PDF is never held in this process's memory — which matters more here
   than it looks: the container is sized for rendering HTML, and buffering
   whole PDFs per concurrent reader is how a small instance dies.
   -------------------------------------------------------------------------- */

/**
 * Never prerendered, and never cached by Next's data cache.
 *
 * `force-dynamic` for the same reason analytics-config uses it: the upstream
 * origin is read from the *running* container's environment, so a value set on
 * a hosting panel takes effect on restart rather than needing a rebuild. The
 * caching that matters happens in the browser and in any CDN in front, via the
 * immutable `Cache-Control` below — not in a build artefact.
 */
export const dynamic = "force-dynamic";

/**
 * Object-key prefixes this route will serve.
 *
 * An allowlist, not a traversal check, because the traversal check is the
 * weaker statement. These are the only two prefixes the admin uploads ever
 * wrote, so anything else is either a mistake or somebody probing — and
 * without this the route is a general-purpose reader for every object in every
 * public bucket on the project.
 */
const SERVED_PREFIXES = ["covers/", "pdfs/"];

/**
 * How long a client may keep the bytes.
 *
 * A year, immutable, which is safe rather than optimistic: every key is a
 * freshly generated UUID (admin-uploads.controller.ts), so replacing a cover
 * produces a *new* key and a new URL. The bytes at a given key never change,
 * so there is nothing for a stale cache to be wrong about — and this is what
 * keeps the extra hop a once-per-client cost instead of a per-view one.
 */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Response headers copied from upstream.
 *
 * `content-range` / `accept-ranges` are here for the sample reader
 * specifically: pdf.js asks for byte ranges so it can paint page one without
 * pulling the whole file, and a proxy that swallows those headers turns every
 * open into a full download before the first page appears. `etag` and
 * `last-modified` let a revalidating client get a 304 instead of a body.
 */
const FORWARDED_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

/**
 * One object, streamed from storage.
 *
 * `object` is `<bucket>/<key>` exactly as it appeared in the URL, still
 * percent-encoded — it is pasted into the upstream URL rather than re-encoded,
 * so a key the storage API spelled with an escape reaches it unchanged.
 */
async function serve(request: NextRequest, object: string, method: "GET" | "HEAD") {
  /* Decoded before the checks, so `covers%2F..%2F..%2Fsomething` is judged as
     the path it resolves to rather than as the harmless-looking string it
     arrived as. A malformed escape throws here and is a 400, not a crash. */
  let decoded: string;
  try {
    decoded = decodeURIComponent(object);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  /* The bucket is the first segment and the key is the rest — see the note in
     storage-url.ts for why the bucket travels in the path instead of coming
     from config here. */
  const separator = decoded.indexOf("/");
  const key = separator === -1 ? "" : decoded.slice(separator + 1);

  if (decoded.includes("..") || !SERVED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return new Response("Not found", { status: 404 });
  }

  const origin = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!origin) {
    /* No SUPABASE_URL on this container. A 404 rather than a 500: from the
       browser's side the file genuinely is not here, and an <img> or the
       reader will show its own missing-asset state, which is a better page
       than a server error. The misconfiguration belongs in the log.

       Once no row points at Supabase any more, this is the whole route's
       obituary: unset the variable, watch for these lines, delete the file. */
    console.error("SUPABASE_URL is not set — /api/files cannot serve legacy files.");
    return new Response("Not found", { status: 404 });
  }

  const range = request.headers.get("range");
  const ifNoneMatch = request.headers.get("if-none-match");

  let upstream: Response;
  try {
    upstream = await fetch(`${origin}/storage/v1/object/public/${object}`, {
      method,
      headers: {
        ...(range ? { range } : {}),
        ...(ifNoneMatch ? { "if-none-match": ifNoneMatch } : {}),
      },
      /* This route is the caching layer, via Cache-Control on the way out.
         Letting Next's data cache also hold the body would put a 40MB PDF in
         the incremental cache, which it is not for. */
      cache: "no-store",
    });
  } catch (error) {
    console.error(`Failed to reach storage for ${decoded}:`, error);
    return new Response("Bad gateway", { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 304) {
    /* Upstream's status, but never its body — a storage error page would
       otherwise be rendered inside an <img> or handed to pdf.js as if it were
       a file, and its wording is the provider's, which is the thing being
       hidden here. */
    const missing = upstream.status === 404;
    return new Response(missing ? "Not found" : "Storage error", {
      status: missing ? 404 : 502,
    });
  }

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", CACHE_CONTROL);
  /* Covers and samples are images and PDFs and are rendered as such. Without
     this, a file whose stored content-type is wrong or absent can be sniffed
     into something scriptable and run on this app's own origin — a risk the
     cross-origin URL did not have, and so the one thing worth adding back when
     moving these files onto the shop's own domain. */
  headers.set("X-Content-Type-Options", "nosniff");
  /* Nothing here varies by visitor, but the response does vary by Range, and a
     shared cache holding a 206 as if it were the whole file is a corrupt PDF
     for everyone behind it. */
  headers.set("Vary", "Range");

  if (method === "HEAD" || upstream.status === 304) {
    return new Response(null, { status: upstream.status, headers });
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/files/[...path]">) {
  const { path } = await ctx.params;
  return serve(request, path.join("/"), "GET");
}

/**
 * Exported explicitly, because Next does not derive HEAD from GET.
 *
 * Worth having rather than letting it 405: pdf.js probes for the file's length
 * before deciding it can fetch pages individually, and a 405 there sends it
 * down the download-the-whole-thing path before showing page one.
 */
export async function HEAD(request: NextRequest, ctx: RouteContext<"/api/files/[...path]">) {
  const { path } = await ctx.params;
  return serve(request, path.join("/"), "HEAD");
}
