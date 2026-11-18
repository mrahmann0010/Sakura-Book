import type { Metadata } from "next";
import { Suspense } from "react";

import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import {
  BookCard,
  BookGrid,
  BookGridSkeleton,
  CatalogControls,
  EmptyState,
  Pagination,
} from "@/components/domain";
import { AppNav, PageHeader, PageShell, Shell, SiteFooter } from "@/components/layout";
import { JsonLd } from "@/components/seo";
import { LinkButton } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { getCategories, listBooks } from "@/lib/api/catalog";
// import { getActivePreOrderBook } from "@/lib/api/pre-order"; // pre-order stream disabled — single normal flow for all books
import { localizedFooterColumns } from "@/lib/books";
import { toBookSummaries } from "@/lib/book-view";
// import type { BookSummary } from "@/components/domain";
import { parseSearchParams, toSearchParams } from "@/lib/catalog";
import { routes } from "@/lib/routes";
import {
  catalogSeo,
  facetSeo,
  indexableFacet,
  LEVEL_GROUP,
  SKILL_GROUP,
} from "@/lib/seo";
import { localeAlternates, siteUrl } from "@/lib/site";
import { breadcrumbJsonLd, graph, itemListJsonLd } from "@/lib/structured-data";

/* Catalog, per the Catalog Wireframe (option 1a/1b/1c): page title and count,
   search, genre facets, applied chips beside sort, a 3-across grid, then
   pagination.

   Filters live in the URL, so this stays a server component: the grid is
   rendered on the server against GET /books, and every filtered view is a
   shareable link rather than client state. `queryCatalog` over a hardcoded
   array used to sit where `listBooks` now does — that was the seam, and this
   is the API landing on it. */

/**
 * Which slices of the shelf are pages of their own, and which are not.
 *
 * `?q=`/`?genre=`/`?page=` produce an unbounded number of URLs over the same
 * few dozen books — the textbook crawl-budget sink — so this used to index
 * page 1 unfiltered and nothing else. That was half right, and the wrong half
 * was expensive: "JLPT N5 books" and "Japanese kanji book" are the queries
 * this shop exists to answer, and the only page that could answer either was
 * marked noindex. The shop had no category surface at all — not one URL
 * targeting a level or a skill — while `/catalog` alone tried to rank for
 * every one of them.
 *
 * So the line moves. A view filtered to exactly **one** category, on page 1,
 * with no search term, is a category page: it has a stable set of members, a
 * name a learner searches for, and copy of its own (see `facetSeo`). It gets a
 * self-referencing canonical and is indexed.
 *
 * Everything else stays as it was — two or more facets, any `?q=`, any page
 * past the first — because those are combinations, not categories: the number
 * of them grows with the product of the facets, and no learner searches for
 * "N5 kanji reading listening page 3". They canonicalise to the clean
 * `/catalog` and stay `noindex, follow`, so a crawler still walks through them
 * to the book pages.
 */
export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/[locale]/catalog">): Promise<Metadata> {
  const { locale } = (await params) as { locale: Locale };
  const query = parseSearchParams(await searchParams);

  const facet = indexableFacet(query);
  const isCanonicalView = !query.q && query.genres.length === 0 && query.page === 1;

  if (facet) {
    const { title, description } = facetSeo(facet, locale);
    const path = `/catalog${toSearchParams({ genres: [facet] })}`;

    return {
      title,
      description,
      /* Self-canonical, with the hreflang siblings carrying the same query
         string — the three locales of an N5 shelf are translations of one
         page, exactly as the three locales of the home page are. */
      alternates: localeAlternates(locale, path),
    };
  }

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

  /* Level and skill, in that order. The seeded "genre" group
     (fiction/essays/...) must never resurface here even though the data still
     exists in the categories table — the shop does not sell across it.
     `level` used to be dropped alongside it, which left the rail with no way
     to ask for N5: the shop's single most-searched filter was the one filter
     it did not offer, on either the page or the crawlable surface. */
  const facetGroups = categories.filter(
    (group) => group.group === LEVEL_GROUP || group.group === SKILL_GROUP,
  );

  /* A facet view is a category page with copy of its own, so the heading and
     lede come from `facetSeo` rather than the generic catalogue title. The
     <title> tag carries the full two-clause line; the <h1> takes the first
     clause only ("JLPT N5 বই"), because a heading set at 52px has to be a
     phrase and the second clause is there for the search snippet. */
  const facet = indexableFacet(query);
  const facetCopy = facet ? facetSeo(facet, locale) : null;
  const heading = facetCopy ? facetCopy.title.split(" — ")[0] : t("catalog.title");

  return (
    <PageShell
      header={<AppNav />}
      footer={
        <SiteFooter
          blurb={t("footer.blurb")}
          columns={localizedFooterColumns(locale)}
          note={`© ${new Date().getFullYear()} Nihonova Books`}
        />
      }
    >
      <Shell className="py-14 lg:py-20">
        {/* The trail a category page needs, and the one the plain catalogue
            does not: on `/catalog` itself the only crumb would be the page you
            are already on. Markup only on the facet views, matching what is
            drawn. */}
        {facet ? (
          <JsonLd
            data={graph(
              breadcrumbJsonLd([
                { href: routes(locale).catalog, label: t("catalog.title") },
                { label: heading },
              ]),
            )}
          />
        ) : null}

        {/* Title renders instantly on navigation — it doesn't depend on the
            books fetch. The count (below) does, so it waits with the grid. */}
        <PageHeader size="lg" title={heading} description={facetCopy?.description} />

        <CatalogControls query={query} facets={facetGroups} />

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
      {/* The grid, declared as an ordered list of the books it links to.

          Emitted from here rather than from the page above it because this is
          the component that holds the resolved list — the page streams this in
          under <Suspense> and has no books of its own. Absolute URLs, and only
          the books on this page in the order they are rendered, so the markup
          and the grid can never disagree about what the page contains. */}
      <JsonLd
        data={graph(
          itemListJsonLd(
            /* `list.items` — the API's rows, which carry the slug. The view
               model above drops it in favour of a ready-made `href`, and
               re-deriving a slug out of a path would be parsing back what was
               just assembled. */
            list.items.map((book) => `${siteUrl()}${routes(locale).book(book.slug)}`),
            t("catalog.title"),
          ),
        )}
      />

      {/* `total` is the count before pagination — the number the API sends
          for exactly this line, not `books.length`, which is one page. */}
      <p className="max-w-measure-lede text-body mb-6">{t("catalog.count", { count: total })}</p>

      {/* No `splitMeta`: it renders `book.rating` / `ratingCount`, which
          are placeholder values invented in `lib/books.ts`. Nothing goes
          in front of a buyer as social proof until real data backs it. */}
      <BookGrid>
        {gridBooks.map((book, index) => (
          <BookCard
            key={book.id}
            book={book}
            locale={locale}
            priority={index === 0}
            footerAction={
              /* Add to cart only — Buy now lives on the book page. Two
                 buttons do not fit a ~160pt phone cell. */
              <AddToCartButton
                bookId={book.id}
                title={book.title}
                priceCents={book.priceCents}
                coverUrl={book.coverUrl}
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
