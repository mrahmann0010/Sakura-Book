import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { BookCard, BookGrid, HowItWorks, ProofPoints } from "@/components/domain";
import { AppNav, PageShell, Shell, SiteFooter } from "@/components/layout";
import { LinkButton, Skeleton } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { listBooks } from "@/lib/api/catalog";
import { footerColumns } from "@/lib/books";
import { toBookSummaries } from "@/lib/book-view";
import { routes } from "@/lib/routes";
import { localeAlternates } from "@/lib/site";
import { iconButton } from "@/lib/variants";
import type { BookSummary } from "@/components/domain";

/* Landing page, per the Landing Wireframe (sheet 05, option 1a/1b): a brief
   centred hero, then straight into the books: one shelf of panel cards at
   3-up, the catalogue CTA beneath it, then the "Why Nihonova" proof band and
   the "How It Works" journey closing the page.

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
 * A page-level `generateStaticParams` returning `[]` looks like an escape
 * hatch — opt this route out of the layout's enumeration while leaving
 * `dynamicParams` at its default `true` for on-demand ISR — but Next unions
 * generateStaticParams across segments that share a dynamic param rather than
 * letting the page override the layout, so the build still enumerates every
 * locale and still fails with the API unreachable. Confirmed by running the
 * production build against no API: `ECONNREFUSED` prerendering "/en". Real
 * ISR here would need the build environment to reach the API, which the
 * container it builds in does not.
 *
 * The cost is a render, not a round trip: `listBooks` still asks Next's data
 * cache with a 60s revalidate, so a burst of visitors shares one call to the
 * API exactly as it would under ISR.
 */
export const dynamic = "force-dynamic";

/* True ISR isn't reachable here: Next unions `generateStaticParams` across a
   route's segments rather than letting a page-level override opt out of the
   layout's locale enumeration, so a page-level `generateStaticParams` returning
   `[]` still gets prerendered at build with the rest — confirmed by running a
   production build with no API reachable, which failed exactly as this page's
   force-dynamic already predicts.

   What's fixable without that is what "force-dynamic" actually costs: the
   fetch itself is already cheap (Next's data cache, 60s revalidate, shared
   across concurrent requests), so the per-request cost is a React render of
   the whole tree waiting on the shelf's fetch to resolve before anything can
   stream. Isolating the shelf below its own `await` inside <Suspense> — same
   pattern as the pre-order page — lets the hero title/subhead, proof band, and
   how-it-works section paint immediately instead of blocking on `listBooks`. */

/** Canonical and hreflang for the landing page. Everything else — the title
    template, the description, the Open Graph defaults — is inherited from the
    layout, so this only states what differs per locale. */
export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = (await params) as { locale: Locale };
  return { alternates: localeAlternates(locale) };
}

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

type T = Awaited<ReturnType<typeof getTranslation>>["t"];

/* Both call `listBooks` with the same params as the grid below — Next's
   per-request fetch memoization collapses that to the one call this page
   used to make with Promise.all, not a second round trip. Split from the
   grid so the two can sit in their correct DOM positions: the count line is
   a centred child of the hero's flex column, the grid is a sibling Shell
   below it, and nesting one Shell inside the other (as a single combined
   component would need to, to span both) double-applies the container's
   max-width and gutter. */
async function HeroCount({ t }: { t: T }) {
  const recent = await listBooks({ q: "", genres: [], sort: "recent", page: 1 });

  return <span className="eyebrow">{t("home.hero.count", { count: recent.total })}</span>;
}

async function RecentGrid({ locale, t }: { locale: Locale; t: T }) {
  const recent = await listBooks({ q: "", genres: [], sort: "recent", page: 1 });
  const recentlyAdded = toBookSummaries(recent.items, locale);

  return (
    <>
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
    </>
  );
}

/* Mirrors RecentGrid's 3-up grid of panel cards so nothing shifts when the
   real content lands (§9, same convention as the pre-order page's skeleton). */
function RecentGridSkeleton() {
  return (
    <div className="grid-books-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i}>
          <Skeleton className="aspect-2/3 w-full rounded-md" index={i} />
          <Skeleton className="mt-3 h-4 w-3/4" index={i} />
          <Skeleton className="mt-2 h-3.5 w-1/2" index={i} />
        </div>
      ))}
    </div>
  );
}

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);

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
      {/* Hero — headline · subhead, centred; count line streams in below. */}
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
          <Suspense fallback={<Skeleton className="h-3.5 w-32" />}>
            <HeroCount t={t} />
          </Suspense>
        </p>
      </Shell>

      {/* Recently added — 6 panel cards, 3-up, then the way through to the catalogue. */}
      <Shell>
        <Suspense fallback={<RecentGridSkeleton />}>
          <RecentGrid locale={locale} t={t} />
        </Suspense>
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

      {/* The journey, closing the page after the proof band: what the shop is
          for, then how buying from it actually goes. Full-bleed for the same
          reason as ProofPoints — its top rule is what separates the two. */}
      <HowItWorks
        eyebrow={t("home.howItWorks.eyebrow")}
        title={t("home.howItWorks.title")}
        lede={t("home.howItWorks.lede")}
        stages={[
          {
            number: t("home.howItWorks.find.number"),
            title: t("home.howItWorks.find.title"),
            body: t("home.howItWorks.find.body"),
          },
          {
            number: t("home.howItWorks.order.number"),
            title: t("home.howItWorks.order.title"),
            body: t("home.howItWorks.order.body"),
          },
          {
            number: t("home.howItWorks.receive.number"),
            title: t("home.howItWorks.receive.title"),
            body: t("home.howItWorks.receive.body"),
          },
        ]}
      />

      <div className="lg:h-section h-20" />
    </PageShell>
  );
}
