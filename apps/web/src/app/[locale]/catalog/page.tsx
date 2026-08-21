import type { Metadata } from "next";

import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { BookCard, BookGrid, CatalogControls, EmptyState, Pagination } from "@/components/domain";
import { AppNav, PageHeader, PageShell, Shell, SiteFooter } from "@/components/layout";
import { LinkButton } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { getCategories, listBooks } from "@/lib/api/catalog";
import { getActivePreOrderBook } from "@/lib/api/pre-order";
import { footerColumns } from "@/lib/books";
import { toBookSummaries } from "@/lib/book-view";
import type { BookSummary } from "@/components/domain";
import { parseSearchParams, toSearchParams } from "@/lib/catalog";
import { routes } from "@/lib/routes";
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
  const { t } = await getTranslation(locale);
  const query = parseSearchParams(await searchParams);

  const isCanonicalView = !query.q && query.genres.length === 0 && query.page === 1;

  return {
    title: t("catalog.title"),
    alternates: localeAlternates(locale, "/catalog"),
    robots: isCanonicalView ? undefined : { index: false, follow: true },
  };
}

export default async function Catalog({ params, searchParams }: PageProps<"/[locale]/catalog">) {
  const { locale } = (await params) as { locale: Locale };
  const query = parseSearchParams(await searchParams);

  /* In parallel: the rail does not depend on the shelf, and awaiting them in
     sequence would put the categories round-trip on the critical path of every
     page of every search. The pre-order book rides along the same way — it is
     an independent read that only prepends onto the canonical, unfiltered
     first page (§ below), so a filtered or later page never pays for it.
     Translations join the same batch — they don't depend on any of it either. */
  const isCanonicalView = !query.q && query.genres.length === 0 && query.page === 1;

  const [{ t }, list, categories, preOrderBook] = await Promise.all([
    getTranslation(locale),
    listBooks(query),
    getCategories(),
    isCanonicalView ? getActivePreOrderBook() : Promise.resolve(null),
  ]);

  const books = toBookSummaries(list.items, locale);

  /* The pre-order card is not a catalog book: it has no slug, no detail page,
     and clicking it must skip straight to the pre-order cart rather than a
     book-detail page. `href` already does exactly that — BookCard's title
     links wherever `href` points, so pointing it at the pre-order route
     (instead of `routes(locale).book(slug)`) is the whole adaptation; no
     wrapper around BookCard's link behaviour is needed. */
  const preOrderCard: BookSummary | null = preOrderBook
    ? {
        id: `pre-order-${preOrderBook.id}`,
        title: preOrderBook.title,
        author: preOrderBook.authorName,
        priceCents: preOrderBook.priceCents,
        href: routes(locale).preorder,
        coverUrl: preOrderBook.coverImageUrl,
        flag: "new",
      }
    : null;

  const gridBooks = preOrderCard ? [preOrderCard, ...books] : books;
  const total = preOrderCard ? list.total + 1 : list.total;

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
        <PageHeader
          size="lg"
          title={t("catalog.title")}
          /* `total` is the count before pagination — the number the API sends
             for exactly this line, not `books.length`, which is one page. */
          description={t("catalog.count", { count: total })}
        />

        <CatalogControls query={query} facets={categories} />

        <div className="mt-10">
          {gridBooks.length > 0 ? (
            <>
              {/* No `splitMeta`: it renders `book.rating` / `ratingCount`, which
                  are placeholder values invented in `lib/books.ts`. Nothing goes
                  in front of a buyer as social proof until real data backs it. */}
              <BookGrid>
                {gridBooks.map((book) => (
                  <BookCard
                    key={book.id}
                    book={book}
                    locale={locale}
                    /* The pre-order card has nothing to add to the cart — its
                       whole card is a link straight to the pre-order page
                       (see `preOrderCard.href` above). */
                    footerAction={
                      book === preOrderCard ? undefined : (
                        <AddToCartButton
                          bookId={book.id}
                          title={book.title}
                          soldOut={book.soldOut}
                          variant="secondary"
                          block
                        />
                      )
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
                hrefFor={(value) =>
                  `${routes(locale).catalog}${toSearchParams({ ...query, page: value })}`
                }
              />
            </>
          ) : (
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
          )}
        </div>
      </Shell>
    </PageShell>
  );
}
