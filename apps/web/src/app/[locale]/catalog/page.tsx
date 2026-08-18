import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { BookCard, BookGrid, CatalogControls, EmptyState, Pagination } from "@/components/domain";
import { AppNav, PageHeader, PageShell, Shell, SiteFooter } from "@/components/layout";
import { LinkButton } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { getCategories, listBooks } from "@/lib/api/catalog";
import { footerColumns } from "@/lib/books";
import { toBookSummaries } from "@/lib/book-view";
import { parseSearchParams, toSearchParams } from "@/lib/catalog";
import { routes } from "@/lib/routes";

/* Catalog, per the Catalog Wireframe (option 1a/1b/1c): page title and count,
   search, genre facets, applied chips beside sort, a 3-across grid, then
   pagination.

   Filters live in the URL, so this stays a server component: the grid is
   rendered on the server against GET /books, and every filtered view is a
   shareable link rather than client state. `queryCatalog` over a hardcoded
   array used to sit where `listBooks` now does — that was the seam, and this
   is the API landing on it. */

export default async function Catalog({ params, searchParams }: PageProps<"/[locale]/catalog">) {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);

  const query = parseSearchParams(await searchParams);

  /* In parallel: the rail does not depend on the shelf, and awaiting them in
     sequence would put the categories round-trip on the critical path of every
     page of every search. */
  const [list, categories] = await Promise.all([listBooks(query), getCategories()]);

  const books = toBookSummaries(list.items, locale);

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
      <Shell className="py-14 lg:py-20">
        <PageHeader
          size="lg"
          title={t("catalog.title")}
          /* `total` is the count before pagination — the number the API sends
             for exactly this line, not `books.length`, which is one page. */
          description={t("catalog.count", { count: list.total })}
        />

        <CatalogControls query={query} facets={categories} />

        <div className="mt-10">
          {books.length > 0 ? (
            <>
              <BookGrid columns={3}>
                {books.map((book) => (
                  <BookCard
                    key={book.id}
                    book={book}
                    locale={locale}
                    splitMeta
                    action={<AddToCartButton bookId={book.id} soldOut={book.soldOut} />}
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
