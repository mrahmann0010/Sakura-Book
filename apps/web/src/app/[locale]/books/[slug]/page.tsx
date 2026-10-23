import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ViewItemTracker } from "@/components/analytics";
// import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { BuyNowButton } from "@/components/cart/buy-now-button";
import { MobileBuyBar } from "@/components/cart/mobile-buy-bar";
import { BookCover, BookMeta, CoverPreview } from "@/components/domain";
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
import { languageName, toBookSummary } from "@/lib/book-view";
import { toSearchParams } from "@/lib/catalog";
import { CURRENCY, formatMoney, intlLocale } from "@/lib/money";
import { routes } from "@/lib/routes";
import { localeAlternates, siteUrl } from "@/lib/site";
import { absoluteFileUrl, fileUrl } from "@/lib/storage-url";

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
  const ogImage = absoluteFileUrl(book.coverImageUrl);

  return {
    title: book.title,
    description,
    alternates: localeAlternates(locale, `/books/${slug}`),
    openGraph: {
      type: "article",
      title: book.title,
      description,
      url: localeAlternates(locale, `/books/${slug}`).canonical,
      /* `absoluteFileUrl`, not the stored URL: the cover is served from this
         shop's own /api/files path (lib/storage-url.ts), and a share card is
         built by a scraper reading the raw HTML with no document base to
         resolve a relative one against. */
      images: ogImage ? [{ url: ogImage, alt: book.coverImageAlt ?? book.title }] : undefined,
    },
  };
}

export default async function BookDetail({ params }: PageProps<"/[locale]/books/[slug]">) {
  const { locale, slug } = (await params) as { locale: Locale; slug: string };

  /* The book fetch is deduped with generateMetadata's (see loadBook above),
     but translations don't depend on it either way — load both at once.

     The postage terms used to be fetched here too, for a free-delivery line
     under the buy card. That line is gone — delivery cost is a question the
     cart and checkout answer, where an address exists to price it against,
     not one to raise on a page where nobody has decided to buy yet — and with
     it goes a shipping request on every render of every book page. */
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
    /* The language named, not its ISO code — see languageName. */
    t("book.meta.language", { language: languageName(book.language, locale) }),
  ].filter((item): item is string => item !== null);

  /* Only ever shown when it is genuinely higher — a "was" price at or below
     the current one is a data error, and printing it would read as a price
     rise dressed as a discount. */
  const compareAtPrice =
    book.compareAtPriceCents && book.compareAtPriceCents > book.priceCents
      ? money(book.compareAtPriceCents)
      : null;

  const priceRow = (
    <p className="flex items-baseline gap-3">
      <span className="text-26 text-ink font-serif">{money(book.priceCents)}</span>
      {compareAtPrice ? (
        <span className="text-13 text-muted line-through">{compareAtPrice}</span>
      ) : null}
    </p>
  );

  const stockRow = (
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
  );

  /* primary, against the component's `secondary` default. That default is
     right where the button appears in a grid of cards — a page of filled clay
     buttons has no hierarchy at all — but this is the one screen devoted to a
     single book, where buying it is the page's purpose.

     It is also now the page's only clay element, which is what principle 02
     asks for and what the old card could not manage: the sample used to sit
     directly beneath this as a second full-width control, and no amount of
     tuning its variant stopped two stacked slabs reading as one. The sample
     moved onto the cover (CoverPreview), where it has a target 200px wide and
     nothing to compete with. */
  const buyAction = (
    <BuyNowButton
      bookId={book.id}
      title={book.title}
      priceCents={book.priceCents}
      soldOut={view.soldOut}
      comingSoon={view.flag === "coming-soon"}
      size="md"
      variant="primary"
      block
      /* The bag glyph, which the grid call sites leave off — see the `icon`
         prop. Here the button is full width and the label has room beside
         it, and a label alone gave the page's one purchase control nothing
         to be recognised by before it is read. */
      icon
    />
  );

  /* Add to cart is commented out, not deleted — the audience doesn't shop
     from a cart, so Buy Now is the only purchase control now. */
  /* <AddToCartButton
    bookId={book.id}
    soldOut={view.soldOut}
    comingSoon={view.flag === "coming-soon"}
    size="md"
    block
  /> */

  /* The buy card, for the sticky rail at `lg:` only.

     It used to be rendered twice, the second copy inline under the title for
     narrow viewports. That copy is gone: on a phone the purchase control now
     lives in MobileBuyBar, pinned to the bottom edge, so it is on screen in
     the description and the gallery too rather than only where the card
     happened to fall. What stays inline under `lg:` is the price and the stock
     line — facts, which belong in the reading order, with no second control to
     go stale beside the pinned one. */
  const buyCard = (
    <Card className="p-6">
      {priceRow}
      {stockRow}
      <div className="mt-5">{buyAction}</div>
    </Card>
  );

  /* schema.org Book + Offer, which is what turns a result into a rich one:
     price, currency and availability in the search listing rather than a blue
     link. Built from the same `book` the page renders, so it can never claim a
     price the page does not show — the one rule structured data has. */
  const jsonLdImage = absoluteFileUrl(book.coverImageUrl);

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
    /* Absolute, and proxied, for the same two reasons as og:image above. */
    ...(jsonLdImage ? { image: jsonLdImage } : {}),
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
      priceCurrency: CURRENCY,
      availability:
        book.stockQuantity > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  return (
    <PageShell
      header={<AppNav />}
      footer={
        <SiteFooter
          blurb={t("footer.blurb")}
          columns={footerColumns}
          note={`© ${new Date().getFullYear()} Nihonova Books`}
        />
      }
    >
      {/* Reports the GA4 `view_item` event; renders nothing.

          Here, in the page body, rather than inside `buyCard` where it used to
          sit. The buy card is deliberately rendered twice — once inline for
          narrow viewports, once in the sticky rail at `lg:` — so the tracker
          went up twice with it, and `display: none` does not stop a component
          mounting. Its own guard is a per-instance ref and `trackViewItem` has
          no dedupe of its own, so both copies fired: every book view counted
          as two, which halves the apparent conversion rate against real orders
          and does so invisibly. One render, one event. */}
      <ViewItemTracker id={book.id} title={book.title} priceCents={book.priceCents} />

      <script
        type="application/ld+json"
        /* Serialised, not spread into props: this is a <script> body, and JSON
           is the only thing that may go in it. */
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* `pt-3` on a phone, against `py-14` at `lg:`. The floating nav already
          reserves its own 60px height in the document (see FloatingNav's
          spacer), so every px here is a second gap stacked under the first
          one — and it is spent before the cover, which means it is spent twice
          over: once as empty cream at the top and again as content pushed off
          the bottom of the first screen.

          `pb-28` clears MobileBuyBar, which is fixed and so takes no space in
          the flow: without it the bar covers the last rows of the gallery and
          the footer's first line, permanently. */}
      <Shell className="pt-3 pb-28 lg:py-14">
        {/* The full trail is a desktop affordance. At 342px "বই · N5 · Kanji
            Redical Guide Book" wraps to two lines and spends ~45px above the
            title to tell a reader on a phone where they are — which they know,
            because they tapped the card that brought them. One way back is the
            useful half of a breadcrumb trail on a phone; the hierarchy is the
            half that is not. */}
        <div className="lg:hidden">
          <Link
            href={routes(locale).catalog}
            className="text-13 text-secondary hover:text-ink inline-flex items-center gap-1.5 transition-colors"
          >
            <span aria-hidden>←</span>
            {t("nav.catalog", { defaultValue: "Books" })}
          </Link>
        </div>

        <div className="hidden lg:block">
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
        </div>

        <DetailLayout
          /* `mt-2` on a phone: the gap between the back link and the cover is
             the last of the three stacked spacings above the fold, and the
             back link is a 13px line, not a heading — it does not need a
             heading's air under it. `lg:mt-10` is untouched, where the
             breadcrumb trail does. */
          className="mt-2 lg:mt-10"
          cover={
            /* The cover is the way into the sample — see CoverPreview. The
               page used to ask for it with a full-width button under Buy Now,
               which nobody pressed; this is a target 200px wide with a label
               down its edge, and on a shop where most titles have never been
               seen in a shop, reading a few pages is how the decision gets
               made.

               The sample is handed to the reader as this shop's own
               `/api/files/…` path, never the storage provider's URL — which
               also makes it a same-origin fetch, so the reader no longer
               relies on the bucket's CORS header. See lib/storage-url.ts. */
            <CoverPreview pdfUrl={fileUrl(book.pdfUrl)} bookTitle={book.title}>
              <BookCover
                src={view.coverUrl}
                title={book.title}
                author={view.author}
                fallback="wordmark"
                priority
                /* The widths this cover is actually rendered at, which the
                   component's card-shaped default got wrong by half — see the
                   `sizes` prop. 200px while the layout is stacked (the cap
                   that keeps the price above the fold), and the whole 320px
                   column at `lg:` — the sample flag hangs in the gutter now
                   and takes none of it. */
                sizes="(max-width: 1023px) 200px, 320px"
              />
            </CoverPreview>
          }
          rail={<div className="hidden lg:block">{buyCard}</div>}
        >
          {/* Neutral tone even for editor's-pick, unlike the catalog card: this
              page also carries the clay Buy Now button, and clay marks exactly
              one thing per screen (DESIGN_SYSTEM.md principle 02). Add to Cart
              is commented out and Buy Now was an outline control until
              recently, which briefly left this reasoning describing a button
              the page did not have. */}
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

          {/* The price and the stock line, inline and unboxed while the layout
              is stacked. The Card they used to sit in came with the purchase
              control; that control is pinned to the bottom of the viewport
              now, so what is left here are two facts, and two facts on a cream
              page do not need a white panel around them to be read. The rule
              above does the separating. */}
          <div className="hairline mt-6 pt-6 lg:hidden">
            {priceRow}
            {stockRow}
          </div>

          <div className="max-w-measure-lede text-body hairline mt-8 space-y-4 pt-8">
            {book.description.split(/\n{2,}/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

          <BookMeta className="hairline mt-8 pt-8" items={meta} />

          {/* Two columns before `sm:`, three after. Locked at three, each cover
              was about a hundred points wide on a phone — too small to judge a
              book by, which is the only thing a gallery is for. */}
          {book.galleryImageUrls.length > 0 ? (
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {book.galleryImageUrls.map((url) => (
                <BookCover
                  key={url}
                  src={fileUrl(url) ?? undefined}
                  title={book.title}
                  radius="md"
                />
              ))}
            </div>
          ) : null}
        </DetailLayout>
      </Shell>

      {/* Last in the tree, after the content it floats over, so a reader
          tabbing through the page reaches the cover, the description and the
          links before the control that leaves for checkout — the DOM order is
          the reading order even where the paint order is not. */}
      <MobileBuyBar
        price={money(book.priceCents)}
        compareAtPrice={compareAtPrice}
        action={buyAction}
      />
    </PageShell>
  );
}
