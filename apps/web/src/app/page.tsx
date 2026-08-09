import Link from "next/link";

import { BookCard } from "@/components/book-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { recentlyAdded, staffPicks, titlesInStock } from "@/lib/books";
import { button } from "@/lib/variants";

export default function Home() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        {/* ------------------------------------------------------------------
            Hero — brief and centred, then straight into the books. Headline,
            subhead, count line. No image, no primary CTA: the books below are
            the call to action.
            ------------------------------------------------------------------ */}
        <section className="shell flex flex-col items-center py-14 text-center sm:py-20 lg:py-[88px]">
          <h1 className="max-w-[16ch] font-serif text-36 leading-[1.04] text-ink sm:text-48 lg:text-64">
            Books we have actually read
          </h1>
          <p className="mt-6 max-w-[42ch] text-body text-secondary">
            A small catalogue, chosen by hand and posted from Bristol. When a
            title sells out we take it down rather than order more.
          </p>
          <p className="mt-8 flex items-center gap-3">
            <span aria-hidden className="block h-px w-[120px] bg-rule" />
            <span className="eyebrow">{titlesInStock} titles in stock</span>
          </p>
        </section>

        {/* ------------------------------------------------------------------
            Recently added — two rows of three, then the way through to the
            full catalogue.
            ------------------------------------------------------------------ */}
        <section className="shell" aria-labelledby="recently-added">
          <h2 id="recently-added" className="sr-only">
            Recently added
          </h2>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 lg:gap-gutter">
            {recentlyAdded.map((book) => (
              <BookCard key={book.slug} book={book} />
            ))}
          </div>

          <div className="mt-9 flex justify-center">
            <Link
              href="/catalog"
              className={button({ variant: "secondary", size: "md" })}
            >
              See the whole catalogue
            </Link>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            Second shelf — the curated one. Same card, no badges. Scrolls
            horizontally on mobile so the shelf keeps reading as a shelf.
            ------------------------------------------------------------------ */}
        <section
          className="shell mt-20 lg:mt-section"
          aria-labelledby="staff-picks"
        >
          <div className="hairline flex flex-wrap items-end justify-between gap-6 pt-8">
            <div>
              <p className="eyebrow">Second shelf</p>
              <h2 id="staff-picks" className="mt-3 text-h2">
                Staff picks
              </h2>
              <p className="mt-2.5 max-w-[46ch] text-caption text-secondary">
                Three we keep pressing on people, whatever else is new.
              </p>
            </div>
            <Link href="/staff-picks" className="text-13.5 text-secondary hover:text-clay">
              All picks
            </Link>
          </div>

          <div
            className={[
              "-mx-6 mt-7 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 py-2",
              "sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-8 sm:overflow-visible sm:px-0 lg:gap-gutter",
            ].join(" ")}
          >
            {staffPicks.map((book) => (
              <BookCard
                key={book.slug}
                book={book}
                showFlag={false}
                className="w-[58%] min-w-[190px] shrink-0 snap-start sm:w-auto sm:min-w-0"
              />
            ))}
          </div>
        </section>
      </main>

      <div className="mt-20 lg:mt-section">
        <SiteFooter />
      </div>
    </>
  );
}
