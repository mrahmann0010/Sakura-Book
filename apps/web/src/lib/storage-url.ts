import { siteUrl } from "@/lib/site";

/* --------------------------------------------------------------------------
   Storage URLs, moved onto this app's own origin.

   Covers and sample PDFs are uploaded to Supabase Storage, and what the API
   stores and returns is the *absolute* public URL of the object:

     https://<project-ref>.supabase.co/storage/v1/object/public/book-assets/pdfs/<uuid>.pdf

   Handed to an <img>, to the sample reader, or to an "open in a new tab" link
   unchanged, that string is in the page source, in the network tab and in the
   href — so every visitor is told which storage provider and which project
   holds the shop's files, and is handed a URL they can hammer directly, on a
   host this app cannot rate-limit, cache, swap or revoke.

   `fileUrl` rewrites it to `/api/files/<bucket>/<key>`, served by the route
   handler in app/api/files/[...path]/route.ts. Two things come with that
   beyond the hiding, and they are the reason this is worth a hop:

     · the fetch is same-origin, so the reader no longer depends on the bucket
       answering with `Access-Control-Allow-Origin` — the exact fragility
       pdf-reader.tsx warns about in its `getDocument` comment;
     · moving off Supabase later is an edit to one route handler, not a
       migration over every `cover_image_url` and `pdf_url` already stored.

   Rewriting happens on the way *out* to the browser rather than on the way in
   to the database. The stored value stays the real, complete, resolvable URL,
   which is what makes this reversible and what keeps the admin form's URL
   field honest — see the note at its <img> preview.
   -------------------------------------------------------------------------- */

/** Where the route handler lives. One definition, so the two ends cannot drift. */
export const FILE_ROUTE = "/api/files";

/**
 * Supabase's public-object path: the bucket, and the key inside it.
 *
 * Matched on the *path shape* rather than against a configured project host,
 * deliberately: this module is imported by client components (the admin form
 * previews) as well as by server ones, and a host comparison would mean
 * shipping `NEXT_PUBLIC_SUPABASE_URL` into the browser bundle — putting back
 * in the JavaScript exactly the string this file exists to keep out of the
 * HTML.
 *
 * Only the `public/` form is rewritten, which is the only form
 * StorageService.publicUrl produces. A `sign/` URL carries its authorisation
 * in a `?token=` query the proxy path would drop, so those pass through
 * untouched and keep working rather than being silently broken.
 */
const PUBLIC_OBJECT_PATH = /^\/storage\/v1\/object\/public\/([^/]+\/.+)$/;

/**
 * The URL to actually render for a stored cover or sample.
 *
 * Anything that is not a Supabase public-object URL is returned exactly as it
 * came: a relative path, a `data:` URI, and in particular a cover hosted on a
 * publisher's own site (which book-cover.tsx notes is a real case) are all
 * left alone. This function hides one provider; it is not a general proxy for
 * the whole web, and quietly routing an arbitrary third-party host through
 * this app's origin would be the wrong favour.
 *
 * The bucket is kept in the rewritten path (`/api/files/<bucket>/<key>`)
 * rather than stripped and re-supplied from the route handler's own config.
 * Stripping it read better and was wrong in a quiet way: an object in any
 * other bucket — a URL an admin pasted by hand, a second bucket a later
 * feature adds — was rewritten to a path the handler then resolved against
 * the *configured* bucket, so it served the wrong object or a 404 with
 * nothing anywhere naming the cause. Carrying it also means the web app needs
 * no bucket setting of its own to keep in step with the API's.
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

  const object = PUBLIC_OBJECT_PATH.exec(pathname)?.[1];
  return object ? `${FILE_ROUTE}/${object}` : url;
}

/**
 * The same thing, absolute, for the places that cannot use a relative URL.
 *
 * `og:image` and the JSON-LD `image` are read by crawlers and by scrapers
 * building a link preview off the raw HTML, with no document base to resolve
 * against — a relative path there is a missing image in every share card. A
 * pass-through URL is already absolute and is returned unchanged; only the
 * rewritten form gets the origin prefixed.
 */
export function absoluteFileUrl(url: string | null | undefined): string | null {
  const resolved = fileUrl(url);
  if (!resolved) return null;
  return resolved.startsWith("/") ? `${siteUrl()}${resolved}` : resolved;
}
