import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { BuyNowButton } from "@/components/cart/buy-now-button";
import { BookCover, BookMeta } from "@/components/domain";
import {
  AppNav,
  Breadcrumbs,
  DetailLayout,
  PageShell,
  Shell,
  SiteFooter,
} from "@/components/layout";
import { Badge, Card } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { getBook } from "@/lib/api/catalog";
import { ApiError } from "@/lib/api/client";
import { footerColumns } from "@/lib/books";
import { toBookSummary } from "@/lib/book-view";
import { toSearchParams } from "@/lib/catalog";
import { FREE_DELIVERY_THRESHOLD } from "@/lib/cart";
import { formatMoney, intlLocale } from "@/lib/money";
import { routes } from "@/lib/routes";
import { localeAlternates, siteUrl } from "@/lib/site";

/* Book detail, per the Detail Wireframe: 320px cover · content · 300px buy
   rail. The cards in the catalogue have always linked here; until now nothing
   answered, because there was no endpoint behind it. GET /books/:slug is that
   endpoint, and the slug in the URL is the same one the API keys on — the
   primary key never leaves the database. */

/**
 * One fetch per render pass, shared by the page and its metadata.
 *
 * Next dedupes identical `fetch` calls within a render, so `generateMetadata`
 * and the component below cost one request between them rather than two — but
 * only because both go through the same URL and options. That is the reason
 * this is a function both call rather than each assembling its own request.
 */
async function loadBook(slug: string) {
  try {
    return await getBook(slug);
  } catch (error) {
    /* A slug that is not on the shelf is a 404 page, not an error page: it is
       an ordinary outcome of a stale link or a delisted title. Anything else —
       the API down, a contract mismatch — rethrows to the error boundary,
       because those are not "no such book" and must not be dressed up as one. */
    if (error instanceof ApiError && error.isNotFound) notFound();
    throw error;
  }
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/books/[slug]">): Promise<Metadata> {
  const { locale, slug } = (await params) as { locale: Locale; slug: string };
  const book = await loadBook(slug);

  const description = book.description.slice(0, 160);

  return {
    title: book.title,
    description,
    alternates: localeAlternates(locale, `/books/${slug}`),
    openGraph: {
      type: "article",
      title: book.title,
      description,
      url: localeAlternates(locale, `/books/${slug}`).canonical,
      images: book.coverImageUrl
        ? [{ url: book.coverImageUrl, alt: book.coverImageAlt ?? book.title }]
        : undefined,
    },
  };
}

export default async function BookDetail({ params }: PageProps<"/[locale]/books/[slug]">) {
  const { locale, slug } = (await params) as { locale: Locale; slug: string };

  /* The book fetch is deduped with generateMetadata's (see loadBook above),
     but translations don't depend on it either way — load both at once. */
  const [{ t }, book] = await Promise.all([getTranslation(locale), loadBook(slug)]);
  const view = toBookSummary(book, locale);
  const money = (cents: number) => formatMoney(cents, intlLocale(locale));

  /* Every fact the API sends and the shop actually knows, in the two-column
     block the wireframe draws. Nulls drop out rather than rendering "—":
     an unknown page count is not a fact about the book. */
  const meta = [
    book.publisher ? book.publisher.name : null,
    book.pageCount ? t("book.meta.pages", { count: book.pageCount }) : null,
    book.isbn13 ? t("book.meta.isbn", { isbn: book.isbn13 }) : null,
    book.publishedDate
      ? t("book.meta.published", {
          date: new Intl.DateTimeFormat(intlLocale(locale), {
            year: "numeric",
            month: "long",
          }).format(new Date(book.publishedDate)),
        })
      : null,
    t("book.meta.language", { language: book.language }),
  ].filter((item): item is string => item !== null);

  /* The buy card, rendered twice: inline under the title on narrow viewports,
     where it is the thing the reader reaches for right after deciding they
     want the book, and again in the sticky rail at `lg:`, where there is
     room for it beside the description. Each copy is hidden at the other's
     breakpoint via `display: none`, which drops it from both the tab order
     and the accessibility tree — never two live "Add to cart" controls on
     screen at once. */
  const buyCard = (
    <Card className="p-6">
      <p className="flex items-baseline gap-3">
        <span className="text-26 text-ink font-serif">{money(book.priceCents)}</span>
        {/* Only ever shown when it is genuinely higher — a "was" price
            at or below the current one is a data error, and printing it
            would read as a price rise dressed as a discount. */}
        {book.compareAtPriceCents && book.compareAtPriceCents > book.priceCents ? (
          <span className="text-13 text-muted line-through">{money(book.compareAtPriceCents)}</span>
        ) : null}
      </p>

      <p className="text-13 text-secondary mt-3">
        {view.flag === "coming-soon"
          ? t("book.stock.comingSoon")
          : book.stockQuantity === 0
            ? t("book.stock.out")
            : view.expectedShipDate
              ? t("book.preOrder.shipsAround", {
                  date: new Intl.DateTimeFormat(intlLocale(locale), {
                    year: "numeric",
                    month: "long",
                  }).format(new Date(view.expectedShipDate)),
                })
              : book.stockQuantity <= 5
                ? t("book.stock.low", { count: book.stockQuantity })
                : t("book.stock.in")}
      </p>

      <div className="mt-5 flex flex-col gap-2.5">
        <AddToCartButton
          bookId={book.id}
          soldOut={view.soldOut}
          comingSoon={view.flag === "coming-soon"}
          size="md"
          block
        />
        <BuyNowButton
          bookId={book.id}
          soldOut={view.soldOut}
          comingSoon={view.flag === "coming-soon"}
          size="md"
          block
        />
      </div>

      {/* Reassurance at the decision moment — the same delivery facts the
          cart and checkout summaries already state, not a new claim. */}
      <p className="text-11.5 text-muted mt-4">
        {t("cart.summary.deliveryFree", {
          threshold: money(FREE_DELIVERY_THRESHOLD),
        })}{" "}
        · {t("cart.summary.note")}
      </p>
    </Card>
  );

  /* schema.org Book + Offer, which is what turns a result into a rich one:
     price, currency and availability in the search listing rather than a blue
     link. Built from the same `book` the page renders, so it can never claim a
     price the page does not show — the one rule structured data has. */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Book",
    name: book.title,
    ...(book.subtitle ? { alternateName: book.subtitle } : {}),
    description: book.description,
    inLanguage: book.language,
    ...(book.isbn13 ? { isbn: book.isbn13 } : {}),
    ...(book.pageCount ? { numberOfPages: book.pageCount } : {}),
    ...(book.publishedDate ? { datePublished: book.publishedDate } : {}),
    ...(book.publisher
      ? { publisher: { "@type": "Organization", name: book.publisher.name } }
      : {}),
    ...(book.authors.length > 0
      ? { author: book.authors.map((name) => ({ "@type": "Person", name })) }
      : {}),
    ...(book.coverImageUrl ? { image: book.coverImageUrl } : {}),
    ...(book.rating != null && book.ratingCount
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: book.rating,
            reviewCount: book.ratingCount,
          },
        }
      : {}),
    offers: {
      "@type": "Offer",
      url: `${siteUrl()}${routes(locale).book(slug)}`,
      price: (book.priceCents / 100).toFixed(2),
      priceCurrency: "GBP",
      availability:
        book.stockQuantity > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

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
      <script
        type="application/ld+json"
        /* Serialised, not spread into props: this is a <script> body, and JSON
           is the only thing that may go in it. */
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Shell className="py-10 lg:py-14">
        <Breadcrumbs
          items={[
            { href: routes(locale).catalog, label: t("nav.catalog", { defaultValue: "Books" }) },
            /* The first category is the one the crumb trail uses. It links back
               into the catalogue as a filter rather than to a category page,
               because the filtered catalogue *is* the category page — one
               view, one URL shape, one thing to keep working. */
            ...(book.categories[0]
              ? [
                  {
                    href: `${routes(locale).catalog}${toSearchParams({
                      genres: [book.categories[0].slug],
                    })}`,
                    label: book.categories[0].name,
                  },
                ]
              : []),
            { label: book.title },
          ]}
        />

        <DetailLayout
          className="mt-8 lg:mt-10"
          cover={
            <BookCover
              src={view.coverUrl}
              title={book.title}
              author={view.author}
              fallback="wordmark"
            />
          }
          rail={<div className="hidden lg:block">{buyCard}</div>}
        >
          {/* Neutral tone even for editor's-pick, unlike the catalog card: this
              page also carries the clay Add to Cart button, and clay marks
              exactly one thing per screen (DESIGN_SYSTEM.md principle 02). */}
          {view.flag ? (
            <p className="mb-4">
              <Badge tone="neutral">{t(`book.flags.${view.flag}`)}</Badge>
            </p>
          ) : null}

          <h1 className="text-32 text-ink lg:text-40 font-serif leading-[1.08]">{book.title}</h1>
          {book.subtitle ? (
            <p className="text-18 text-secondary mt-3 font-serif italic">{book.subtitle}</p>
          ) : null}

          {view.author ? <p className="text-caption text-secondary mt-4">{view.author}</p> : null}

          {/* Words, not stars — §1.03 wants the state stated, and the palette
              has no colour to spend on a glyph scale. */}
          {book.rating != null ? (
            <p className="text-13 text-muted mt-2">
              {t("book.rating", { rating: book.rating.toFixed(1), count: book.ratingCount ?? 0 })}
            </p>
          ) : (
            <p className="text-13 text-muted mt-2">{t("book.noReviews")}</p>
          )}

          <div className="mt-6 lg:hidden">{buyCard}</div>

          <div className="max-w-measure-lede text-body hairline mt-8 space-y-4 pt-8">
            {book.description.split(/\n{2,}/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

          <BookMeta className="hairline mt-8 pt-8" items={meta} />

          {book.galleryImageUrls.length > 0 ? (
            <div className="mt-8 grid grid-cols-3 gap-4">
              {book.galleryImageUrls.map((url) => (
                <BookCover key={url} src={url} title={book.title} radius="md" />
              ))}
            </div>
          ) : null}
        </DetailLayout>
      </Shell>
    </PageShell>
  );
}
