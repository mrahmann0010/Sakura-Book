import type { Metadata } from "next";
import { Suspense } from "react";

// import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { BuyNowButton } from "@/components/cart/buy-now-button";
import {
  BookCard,
  BookGrid,
  BookGridSkeleton,
  CatalogControls,
  EmptyState,
  Pagination,
} from "@/components/domain";
import { AppNav, PageHeader, PageShell, Shell, SiteFooter } from "@/components/layout";
import { LinkButton } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { getCategories, listBooks } from "@/lib/api/catalog";
// import { getActivePreOrderBook } from "@/lib/api/pre-order"; // pre-order stream disabled — single normal flow for all books
import { footerColumns } from "@/lib/books";
import { toBookSummaries } from "@/lib/book-view";
// import type { BookSummary } from "@/components/domain";
import { parseSearchParams, toSearchParams } from "@/lib/catalog";
import { routes } from "@/lib/routes";
import { catalogSeo } from "@/lib/seo";
import { localeAlternates } from "@/lib/site";

/* Catalog, per the Catalog Wireframe (option 1a/1b/1c): page title and count,
   search, genre facets, applied chips beside sort, a 3-across grid, then
   pagination.

   Filters live in the URL, so this stays a server component: the grid is
   rendered on the server against GET /books, and every filtered view is a
   shareable link rather than client state. `queryCatalog` over a hardcoded
   array used to sit where `listBooks` now does — that was the seam, and this
   is the API landing on it. */

/**
 * Filtered and paged views are slices of one shelf, not pages of their own.
 *
 * `?q=`/`?genre=`/`?page=` produce an unbounded number of URLs over the same
 * few dozen books — the textbook crawl-budget sink. Page 1 unfiltered is the
 * canonical and is indexed; every other slice points its canonical at that one
 * and is marked noindex,follow, so crawlers still walk through it to the book
 * pages without indexing the slice itself.
 */
export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/[locale]/catalog">): Promise<Metadata> {
  const { locale } = (await params) as { locale: Locale };
  const query = parseSearchParams(await searchParams);

  const isCanonicalView = !query.q && query.genres.length === 0 && query.page === 1;
  const { title, description } = catalogSeo(locale);

  return {
    title,
    description,
    alternates: localeAlternates(locale, "/catalog"),
    robots: isCanonicalView ? undefined : { index: false, follow: true },
  };
}

export default async function Catalog({ params, searchParams }: PageProps<"/[locale]/catalog">) {
  const { locale } = (await params) as { locale: Locale };
  const query = parseSearchParams(await searchParams);
  const [{ t }, categories] = await Promise.all([getTranslation(locale), getCategories()]);

  /* JLPT-skill facets only (vocabulary/kanji/grammar/reading/listening) — the
     shop no longer sells across the seeded "genre" group (fiction/essays/...),
     and that facet must never resurface here even though the data still
     exists in the categories table. */
  const skillFacets = categories.filter((group) => group.group === "skill");

  return (
    <PageShell
      header={<AppNav />}
      footer={
        <SiteFooter
          blurb="A small catalogue of books, chosen by hand and posted from Bristol."
          columns={footerColumns}
          note={`© ${new Date().getFullYear()} Nihonova Books`}
        />
      }
    >
      <Shell className="py-14 lg:py-20">
        {/* Title renders instantly on navigation — it doesn't depend on the
            books fetch. The count (below) does, so it waits with the grid. */}
        <PageHeader size="lg" title={t("catalog.title")} />

        <CatalogControls query={query} facets={skillFacets} />

        <div className="mt-10">
          <Suspense fallback={<BookGridSkeleton footer />}>
            <CatalogResults locale={locale} query={query} />
          </Suspense>
        </div>
      </Shell>
    </PageShell>
  );
}

/* Isolated so its data fetch (`listBooks`) can be caught by the `Suspense`
   boundary above, streaming in once resolved instead of blocking the header
   and the (already-rendered) filter controls. */
async function CatalogResults({
  locale,
  query,
}: {
  locale: Locale;
  query: ReturnType<typeof parseSearchParams>;
}) {
  const [{ t }, list] = await Promise.all([getTranslation(locale), listBooks(query)]);

  const books = toBookSummaries(list.items, locale);

  /* Pre-order stream disabled — single normal flow for all books. See
     git history for the pre-order card that used to prepend here. */
  const gridBooks = books;
  const total = list.total;

  if (gridBooks.length === 0) {
    return (
      <EmptyState
        eyebrow={t("catalog.empty.eyebrow")}
        title={t("catalog.empty.title")}
        description={t("catalog.empty.description")}
        action={
          <LinkButton href={routes(locale).catalog} variant="secondary">
            {t("catalog.empty.action")}
          </LinkButton>
        }
      />
    );
  }

  return (
    <>
      {/* `total` is the count before pagination — the number the API sends
          for exactly this line, not `books.length`, which is one page. */}
      <p className="max-w-measure-lede text-body mb-6">{t("catalog.count", { count: total })}</p>

      {/* No `splitMeta`: it renders `book.rating` / `ratingCount`, which
          are placeholder values invented in `lib/books.ts`. Nothing goes
          in front of a buyer as social proof until real data backs it. */}
      <BookGrid>
        {gridBooks.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            locale={locale}
            footerAction={
              /* <AddToCartButton
                bookId={book.id}
                title={book.title}
                soldOut={book.soldOut}
                comingSoon={book.flag === "coming-soon"}
                variant="secondary"
                block
              /> */
              <BuyNowButton
                bookId={book.id}
                title={book.title}
                priceCents={book.priceCents}
                soldOut={book.soldOut}
                comingSoon={book.flag === "coming-soon"}
                block
              />
            }
          />
        ))}
      </BookGrid>

      <Pagination
        className="mt-14"
        page={list.page}
        totalPages={list.totalPages}
        label={t("catalog.pagination.label")}
        statusFor={(value) =>
          t("catalog.pagination.page", { page: value, totalPages: list.totalPages })
        }
        hrefFor={(value) => `${routes(locale).catalog}${toSearchParams({ ...query, page: value })}`}
      />
    </>
  );
}
