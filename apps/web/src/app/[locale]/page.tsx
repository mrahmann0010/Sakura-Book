import Link from "next/link";

import { BookCard, BookGrid, ProofPoints } from "@/components/domain";
import { AppNav, PageShell, Shell, SiteFooter } from "@/components/layout";
import { LinkButton } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { listBooks } from "@/lib/api/catalog";
import { footerColumns } from "@/lib/books";
import { toBookSummaries } from "@/lib/book-view";
import { routes } from "@/lib/routes";
import { iconButton } from "@/lib/variants";
import type { BookSummary } from "@/components/domain";

/* Landing page, per the Landing Wireframe (sheet 05, option 1a/1b): a brief
   centred hero, then straight into the books: one shelf of panel cards at
   3-up, the catalogue CTA beneath it, and the "Why Nihonova" proof band
   closing the page.

   Book titles and authors stay untranslated — they are proper nouns.

   The shelf and the stock count come from GET /books rather than the
   placeholder arrays that used to sit in lib/books.ts. The count line is the
   list envelope's `total` — the number of titles the shop actually has, not a
   constant someone has to remember to change.

   The second shelf ("Staff picks") is gone: it was sorted by rating rather
   than curation, because the API has no `featured` filter to ask for, and a
   shelf that claims one thing while showing another is worse than no shelf.
   The proof band now closes the page in its place. */

/**
 * Rendered per request rather than prerendered at build.
 *
 * This is the one page with `generateStaticParams` above it (the layout's
 * locale list), so it is the one page Next would otherwise try to build
 * statically — and it now fetches. A production image is built in a container
 * with no API reachable, so prerendering would turn every deploy into a
 * dependency on the API being up at build time, failing the build rather than
 * degrading the page.
 *
 * The cost is a render, not a round trip: `listBooks` still asks Next's data
 * cache with a 60s revalidate, so a burst of visitors shares one call to the
 * API exactly as it would under ISR.
 */
export const dynamic = "force-dynamic";

/** The wireframe's quick-view control. No modal exists yet, so it goes to the
    book rather than rendering a button that does nothing. */
function QuickView({ book, label }: { book: BookSummary; label: string }) {
  if (!book.href) return null;

  return (
    <Link
      href={book.href}
      aria-label={label}
      title={label}
      className={iconButton({ variant: "outline", size: "sm" })}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M7 13L13 7M13 7H8M13 7v5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="square"
        />
      </svg>
    </Link>
  );
}

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);

  /* One shelf and a count, in a single round trip. The hero's count comes off
     the list's `total`, so the shop never advertises a number no query would
     return. */
  const recent = await listBooks({ q: "", genres: [], sort: "recent", page: 1 });

  const recentlyAdded = toBookSummaries(recent.items, locale);

  return (
    <PageShell
      header={<AppNav />}
      footer={
        <SiteFooter
          blurb="A small catalogue of books, chosen by hand and posted from Bristol."
          columns={footerColumns}
          note={`© ${new Date().getFullYear()} Marginalia Books`}
        />
      }
    >
      {/* Hero — headline · subhead · count line, centred. */}
      <Shell
        as="section"
        className="lg:pt-page-desktop lg:pb-block flex flex-col items-center py-20 text-center"
      >
        <h1 className="max-w-measure-intro text-36 text-ink sm:text-48 lg:text-64 font-serif leading-[1.04]">
          {t("home.hero.title")}
        </h1>
        <p className="max-w-measure-lede text-secondary mt-6">{t("home.hero.subhead")}</p>
        <p className="mt-8 flex items-center gap-3">
          <span aria-hidden="true" className="bg-rule hidden h-px w-30 sm:block" />
          <span className="eyebrow">{t("home.hero.count", { count: recent.total })}</span>
        </p>
      </Shell>

      {/* Recently added — 6 panel cards, 3-up, then the way through to the catalogue. */}
      <Shell>
        <h2 className="sr-only">{t("home.recent.title")}</h2>
        <BookGrid columns={3}>
          {recentlyAdded.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              locale={locale}
              variant="panel"
              inlineMeta
              action={<QuickView book={book} label={t("home.quickView", { title: book.title })} />}
            />
          ))}
        </BookGrid>

        <div className="mt-9 flex justify-center">
          <LinkButton href={routes(locale).catalog} variant="secondary">
            {t("home.recent.seeMore")}
          </LinkButton>
        </div>
      </Shell>

      {/* The credibility band, in place of the second shelf: three quiet
          claims rather than three more covers. Full-bleed so its top rule runs
          the width of the page — hence no <Shell> around it. */}
      <ProofPoints
        className="mt-20 lg:mt-24"
        eyebrow={t("home.proof.eyebrow")}
        metric={t("home.proof.metric")}
        metricLabel={t("home.proof.metricLabel")}
        points={[
          {
            title: t("home.proof.selected.title"),
            body: t("home.proof.selected.body"),
          },
          {
            title: t("home.proof.recommended.title"),
            body: t("home.proof.recommended.body"),
          },
        ]}
      />

      <div className="lg:h-section h-20" />
    </PageShell>
  );
}
