import { siteUrl } from "@/lib/site";

/* --------------------------------------------------------------------------
   Storage URLs.

   Covers and sample PDFs live in the shop's Garage bucket, published through a
   Cloudflare-fronted domain, and what the API stores and returns is the
   absolute public URL of the object on that domain:

     https://cdn.example.com/sakura-book/pdfs/<uuid>.pdf

   Those are rendered as they stand. The point of the CDN is that a visitor's
   browser fetches from Cloudflare's edge and the origin is touched only on a
   MISS — routing the bytes through this app first would put a Next container
   sized for rendering HTML in front of every cover and every 40MB sample, and
   would move the delivery back onto a single box in one region. The academy
   app links its public media straight to the same CDN for the same reason.

   Two things follow from that, both deliberate:

     · the CDN host appears in the page source. It is a public bucket behind a
       cache, holding marketing assets — covers and sample chapters shown to
       anyone browsing the shop — so what it discloses is a hostname, not a
       secret, and the trade buys every visitor an edge-served image;
     · the sample reader's fetch is cross-origin again, so it depends on the
       bucket answering with `Access-Control-Allow-Origin`. See the note in
       pdf-reader.tsx: that is a bucket setting to keep set, not an accident.

   What is still rewritten is the *legacy* Supabase URL, below. Rows written
   before storage moved to Garage still carry those, and they keep being
   proxied through this app exactly as they were.
   -------------------------------------------------------------------------- */

/** Where the legacy file proxy lives. One definition, so the two ends cannot drift. */
export const FILE_ROUTE = "/api/files";

/**
 * Supabase's public-object path: the bucket, and the key inside it.
 *
 * Legacy — nothing has written one of these since storage moved — and kept
 * because the books carrying them are still on sale. Matched on the path shape
 * rather than against a configured project host, deliberately: this module is
 * imported by client components (the admin form previews) as well as by server
 * ones, and a host comparison would mean shipping the storage host into the
 * browser bundle.
 *
 * Only the `public/` form is rewritten, which is the only form the old
 * StorageService.publicUrl produced. A `sign/` URL carries its authorisation
 * in a `?token=` query the proxy path would drop, so those pass through
 * untouched and keep working rather than being silently broken.
 */
const LEGACY_PUBLIC_OBJECT_PATH = /^\/storage\/v1\/object\/public\/([^/]+\/.+)$/;

/**
 * The URL to actually render for a stored cover or sample.
 *
 * Everything except a legacy Supabase URL is returned exactly as it came: the
 * CDN URL of a current upload, a relative path, a `data:` URI, and a cover
 * hosted on a publisher's own site (which book-cover.tsx notes is a real case)
 * are all left alone.
 *
 * The bucket is kept in the rewritten path (`/api/files/<bucket>/<key>`)
 * rather than stripped and re-supplied from the route handler's own config.
 * Stripping it read better and was wrong in a quiet way: an object in any
 * other bucket was rewritten to a path the handler then resolved against the
 * *configured* bucket, so it served the wrong object or a 404 with nothing
 * anywhere naming the cause.
 *
 * Returns null for a null/empty input so callers can keep branching on
 * falsiness the way they already do.
 */
export function fileUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  let pathname: string;
  try {
    /* A base, so a stored *relative* path parses instead of throwing — those
       are then left alone by the pattern below, which wants the full object
       path. `pathname` keeps its percent-encoding, so a key with a space or a
       `#` in it is re-emitted exactly as the storage API spelled it. */
    pathname = new URL(url, "http://n").pathname;
  } catch {
    return url;
  }

  const object = LEGACY_PUBLIC_OBJECT_PATH.exec(pathname)?.[1];
  return object ? `${FILE_ROUTE}/${object}` : url;
}

/**
 * The same thing, absolute, for the places that cannot use a relative URL.
 *
 * `og:image` and the JSON-LD `image` are read by crawlers and by scrapers
 * building a link preview off the raw HTML, with no document base to resolve
 * against — a relative path there is a missing image in every share card. A
 * CDN URL is already absolute and is returned unchanged; only the rewritten
 * legacy form gets the origin prefixed.
 */
export function absoluteFileUrl(url: string | null | undefined): string | null {
  const resolved = fileUrl(url);
  if (!resolved) return null;
  return resolved.startsWith("/") ? `${siteUrl()}${resolved}` : resolved;
}
