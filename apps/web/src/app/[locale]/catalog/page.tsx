import { BookCard, BookGrid, CatalogControls, EmptyState, Pagination } from "@/components/domain";
import {
  LanguageSwitcher,
  PageHeader,
  PageShell,
  Shell,
  SiteFooter,
  SiteHeader,
} from "@/components/layout";
import { LinkButton } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { footerColumns, primaryNav } from "@/lib/books";
import { parseSearchParams, queryCatalog, toSearchParams } from "@/lib/catalog";

/* Catalog, per the Catalog Wireframe (option 1a/1b/1c): page title and count,
   search, genre facets, applied chips beside sort, a 3-across grid, then
   pagination.

   Filters live in the URL, so this stays a server component and every filtered
   view is a shareable link. `queryCatalog` is the seam the API will replace. */

export default async function Catalog({ params, searchParams }: PageProps<"/[locale]/catalog">) {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);

  const query = parseSearchParams(await searchParams);
  const { books, total, page, totalPages } = queryCatalog(query);

  return (
    <PageShell
      header={
        <SiteHeader
          nav={primaryNav}
          activeHref="/catalog"
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
      <Shell className="py-14 lg:py-20">
        <PageHeader
          size="lg"
          title={t("catalog.title")}
          description={t("catalog.count", { count: total })}
        />

        <CatalogControls query={query} />

        <div className="mt-10">
          {books.length > 0 ? (
            <>
              <BookGrid columns={3}>
                {books.map((book) => (
                  <BookCard key={book.id} book={book} splitMeta />
                ))}
              </BookGrid>

              <Pagination
                className="mt-14"
                page={page}
                totalPages={totalPages}
                label={t("catalog.pagination.label")}
                statusFor={(value) => t("catalog.pagination.page", { page: value, totalPages })}
                hrefFor={(value) => `/${locale}/catalog${toSearchParams({ ...query, page: value })}`}
              />
            </>
          ) : (
            <EmptyState
              eyebrow={t("catalog.empty.eyebrow")}
              title={t("catalog.empty.title")}
              description={t("catalog.empty.description")}
              action={
                <LinkButton href={`/${locale}/catalog`} variant="secondary">
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
