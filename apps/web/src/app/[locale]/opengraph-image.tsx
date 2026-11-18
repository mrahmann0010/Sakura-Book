import { ImageResponse } from "next/og";

import type { Locale } from "@/i18n/settings";

/* --------------------------------------------------------------------------
   The default share card.

   Every page under `[locale]` inherits this one, which is the point: the shop
   had no og:image at all outside the book pages, so a shared link to the home
   page or to any level shelf rendered as a bare grey rectangle — on Facebook
   and Messenger above all, which is where a Bangladeshi learner is handed a
   link by a classmate. That is the shop's largest referral surface and it was
   showing nothing.

   The book pages keep their own card: `generateMetadata` there sets
   `openGraph.images` to the cover, and an explicit value wins over this file
   convention. A cover is a better card than any generated panel, and it is the
   one image a buyer recognises.
   -------------------------------------------------------------------------- */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The palette, from DESIGN_SYSTEM.md §2 — `page` cream, `ink`, `clay`.
    Literals rather than CSS custom properties: Satori resolves no variables
    and has no stylesheet to read them from. */
const CREAM = "#FAF9F5";
const INK = "#1C1B18";
const CLAY = "#B85838";
const MUTED = "#6B6862";

/**
 * Latin-script copy only, in all three locales.
 *
 * Satori ships no font that covers Bengali, so Bangla text renders as tofu
 * boxes unless a Noto Sans Bengali binary is fetched and handed to
 * `ImageResponse` on every request. That is a network dependency on the path
 * that renders a share card, with a blank card as its failure mode — worse
 * than the thing it fixes. "Nihonova Books / JLPT preparation books, written
 * in Bangla" is legible to the Bangladeshi audience either way: the shop's
 * name is Latin, "JLPT" is Latin in Bangla too, and the card is a recognition
 * cue next to a title and a description that *are* localised.
 *
 * Shipping a real Bangla card is a worthwhile follow-up; it wants the font
 * bundled as a build asset, not fetched. See apps/web/SEO/seo-roadmap.md.
 */
const SUBLINE = "JLPT preparation books, written in Bangla";

export default async function Image({ params }: { params: Promise<{ locale: Locale }> }) {
  /* Awaited but unused in the copy above — the locale is still read so this
     stays a per-locale route rather than one shared image, which is what lets
     a localised card be added later without moving the file. */
  await params;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: CREAM,
          padding: "0 96px",
        }}
      >
        {/* The clay rule, which is the one accent this card spends — principle
            02, the same rule the pages follow. */}
        <div style={{ width: 72, height: 6, background: CLAY, marginBottom: 48 }} />

        <div style={{ fontSize: 84, color: INK, letterSpacing: "-0.02em", lineHeight: 1.05 }}>
          Nihonova Books
        </div>

        <div style={{ fontSize: 36, color: MUTED, marginTop: 28, lineHeight: 1.3 }}>{SUBLINE}</div>

        <div style={{ fontSize: 26, color: MUTED, marginTop: 56, letterSpacing: "0.08em" }}>
          N5 · N4 · N3 · N2 · N1
        </div>
      </div>
    ),
    size,
  );
}
