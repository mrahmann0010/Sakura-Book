"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SampleArrowIcon } from "@/components/ui";

import { BookPreviewDialog } from "./book-preview";

/* --------------------------------------------------------------------------
   The cover, as the way into the sample.

   The book page used to ask for the sample with a full-width button stacked
   directly under Buy Now, which never worked: two controls of the same shape
   and size, one of them the page's only clay element, and the quieter of the
   two was the one that lets somebody judge an unfamiliar title before paying.
   It was read as a caption under the button rather than a second control.

   So the cover opens it instead. It is the largest thing on the page and the
   thing a reader already reaches for, and a label down its edge says so —
   leaving the buy bar to carry exactly one control.

   The label is bare ink text down the cover's edge — no fill, no border, no
   panel — with the arrow aimed into the artwork beside it.

   It is not clay, and it is not a chip. Not clay because the accent marks one
   thing per screen (DESIGN_SYSTEM principle 02) and on this page that one
   thing is Buy Now. Not a chip because the first attempt was one, in `tint`
   with a `rule` border, and it could not be seen: the palette's three light
   neutrals — page #faf9f5, surface #ffffff, tint #f0ece2 — sit within 2% of
   each other, so a flag filled with any of them is a flag with no edge, and
   the lighter the fill the worse it gets. Ink type on cream is 18:1 and needs
   nothing behind it.
   -------------------------------------------------------------------------- */

export function CoverPreview({
  /**
   * The sample, already on this app's own `/api/files/…` path. Null when the
   * shop has not uploaded one — then the cover renders exactly as it did
   * before, a plain image with no flag and nothing to press. A cover that
   * looks pressable and is not is worse than one that never offered.
   */
  pdfUrl,
  bookTitle,
  /** The cover itself, rendered by the server page. */
  children,
}: {
  pdfUrl: string | null;
  bookTitle: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (!pdfUrl) return <>{children}</>;

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        /* An explicit name, rather than letting the browser concatenate the
           flag's words with the cover's alt text — which reads out as
           "পড়ে দেখুন Kanji Redical Guide Book — cover" and says "cover"
           to somebody who cannot see one. */
        aria-label={`${t("book.preview.action")} — ${bookTitle}`}
        onClick={() => setOpen(true)}
        /* `w-fit` and centred while the layout is stacked, so the flag and the
           capped cover travel together as one object in the middle of the
           column; full width in the detail grid's cover column at `lg:`,
           where the cover takes whatever the flag leaves. */
        className="group focus-visible:ring-clay-ring rounded-control mx-auto flex w-fit cursor-pointer items-stretch gap-2 focus-visible:ring-2 focus-visible:outline-none lg:mx-0 lg:w-full"
      >
        {/* No chip behind the label: ink on the cream page is 18:1, and once
            the words are that legible a panel around them is decoration. It
            also keeps the one quiet thing in the cover column from looking
            like a second button beside the bar's clay one.

            The underline is the affordance in its place. Colour cannot be it
            — the accent is spent on Buy Now — and a bare line of text needs
            something that answers "is this pressable?" on contact. */}
        <span className="flex w-7 flex-none flex-col items-center justify-center gap-2.5">
          <SampleArrowIcon size={16} className="text-secondary" />
          {/* Reads bottom-to-top, the way a spine does: `vertical-rl` turns
              the line box on its side and the half-turn puts its start at the
              bottom. Bangla conjuncts are unaffected — the glyphs are laid
              out normally and the whole line is rotated. */}
          {/* `font-semibold` (600): with no panel behind it the weight is the
              only thing left to give the label presence, and at 12px rotated
              onto its side Bangla needs the extra stroke to hold up. */}
          <span className="text-12 text-ink rotate-180 font-semibold tracking-wide whitespace-nowrap underline-offset-4 [writing-mode:vertical-rl] group-hover:underline">
            {t("book.preview.action")}
          </span>
        </span>

        {/* 200px holds the cover's 2:3 crop to 300px tall on a phone, which is
            what keeps the title, the price and the stock line above the fold.
            Released at `lg:`, where the cover column is 320px wide and the
            fold is not a constraint. */}
        <span className="w-[200px] min-w-0 lg:w-auto lg:flex-1">{children}</span>
      </button>

      {open ? (
        <BookPreviewDialog pdfUrl={pdfUrl} bookTitle={bookTitle} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
