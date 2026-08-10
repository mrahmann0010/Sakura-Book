import Link from "next/link";

import { BookCard, BookGrid, BookScroller } from "@/components/domain";
import {
  LanguageSwitcher,
  PageShell,
  Section,
  Shell,
  SiteFooter,
  SiteHeader,
} from "@/components/layout";
import { LinkButton } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { footerColumns, primaryNav, recentlyAdded, staffPicks, titlesInStock } from "@/lib/books";
import { iconButton } from "@/lib/variants";
import type { BookSummary } from "@/components/domain";

/* Landing page, per the Landing Wireframe (sheet 05, option 1a/1b): a brief
   centred hero, then straight into the books. Two shelves of panel cards at
   3-up, with the catalogue CTA between them.

   Book titles and authors stay untranslated — they are proper nouns. */

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

  return (
    <PageShell
      header={
        <SiteHeader
          nav={primaryNav}
          activeHref="/"
          searchHref="/search"
          actions={<LanguageSwitcher />}
        />
      }
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
        className="lg:pt-page-desktop flex flex-col items-center py-20 text-center lg:pb-block"
      >
        <h1 className="max-w-measure-intro text-36 text-ink sm:text-48 lg:text-64 font-serif leading-[1.04]">
          {t("home.hero.title")}
        </h1>
        <p className="max-w-measure-lede text-secondary mt-6">{t("home.hero.subhead")}</p>
        <p className="mt-8 flex items-center gap-3">
          <span aria-hidden="true" className="bg-rule hidden h-px w-30 sm:block" />
          <span className="eyebrow">{t("home.hero.count", { count: titlesInStock })}</span>
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
              variant="panel"
              inlineMeta
              action={<QuickView book={book} label={t("home.quickView", { title: book.title })} />}
            />
          ))}
        </BookGrid>

        <div className="mt-9 flex justify-center">
          <LinkButton href="/catalog" variant="secondary">
            {t("home.recent.seeMore")}
          </LinkButton>
        </div>
      </Shell>

      {/* Second shelf — same card, no badge. Scrolls on mobile. */}
      <Shell className="mt-20 lg:mt-24">
        <Section
          className="hairline pt-8"
          eyebrow={t("home.second.eyebrow")}
          title={t("home.second.title")}
          description={t("home.second.description")}
          action={<Link href="/staff-picks">{t("home.second.action")} →</Link>}
        >
          <BookScroller settles>
            {staffPicks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                variant="panel"
                showFlag={false}
                inlineMeta
                action={
                  <QuickView book={book} label={t("home.quickView", { title: book.title })} />
                }
              />
            ))}
          </BookScroller>
        </Section>
      </Shell>

      <div className="lg:h-section h-20" />
    </PageShell>
  );
}
