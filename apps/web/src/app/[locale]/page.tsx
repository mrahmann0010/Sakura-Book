import type { Metadata } from "next";
import { Fragment, Suspense } from "react";

// import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { BuyNowButton } from "@/components/cart/buy-now-button";
import { BookCard, BookGrid, BookGridSkeleton, HowItWorks, ProofPoints } from "@/components/domain";
import type { BookSummary } from "@/components/domain";
import { AppNav, PageShell, Shell, SiteFooter } from "@/components/layout";
import { LinkButton } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { listBooks } from "@/lib/api/catalog";
import { footerColumns } from "@/lib/books";
import { toBookSummaries } from "@/lib/book-view";
import { routes } from "@/lib/routes";
import { localeAlternates } from "@/lib/site";

/* Landing page, per the Landing Wireframe (sheet 05, option 1a/1b): a brief
   centred hero, then straight into the books: one shelf, the catalogue CTA
   beneath it, then the "Why Nihonova" proof band and the "How It Works"
   journey closing the page.

   The shelf is the catalog's grid, not a shelf of its own: the same
   `BookCard` in its `bare` reference variant, the same `AddToCartButton`
   footer, the same 2/3/4-up `grid-books`. It used to be `variant="panel"` on a
   6-up rail with a quick-view glyph and everything past the second card hidden
   below `lg` — three separate ways for a book to look different here than it
   does on /catalog, which made the landing cards read as a downgrade of the
   real thing and put the buy button a click further away on the page most
   visitors land on first.

   Book titles and authors stay untranslated — they are proper nouns.

   The shelf comes from GET /books rather than the placeholder arrays that
   used to sit in lib/books.ts.

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
   pattern as the pre-order page — lets the hero, proof band, and how-it-works
   section paint immediately instead of blocking on `listBooks`. */

/** Canonical and hreflang for the landing page. Everything else — the title
    template, the description, the Open Graph defaults — is inherited from the
    layout, so this only states what differs per locale. */
export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = (await params) as { locale: Locale };
  return { alternates: localeAlternates(locale) };
}

type T = Awaited<ReturnType<typeof getTranslation>>["t"];

/**
 * How many books the landing shelf shows.
 *
 * Eight rather than the old twelve, because the shelf no longer hides
 * anything: the panel rail showed 2 of 12 below `lg` and revealed the rest at
 * desktop, whereas `grid-books` shows every card it is given at every width.
 * Eight fills its rows exactly — 4 down on mobile, 3 across on tablet, 2 rows
 * of 4 on desktop — with no orphan on the last row, and keeps the catalogue
 * CTA, the proof band and the journey within reach of the fold. It is also the
 * catalog's own skeleton count, so both pages wait at the same size.
 */
const HOME_SHELF_COUNT = 8;

/**
 * How many of those eight survive below `sm`.
 *
 * The shelf runs one book per row on a phone (`grid-books-1`), so eight cards
 * is eight screens of scrolling before the catalogue CTA, the proof band or
 * the journey is reachable. Three is a shelf you can take in at once and still
 * leaves the rest of the page within reach.
 *
 * The tail is hidden rather than not fetched: the count is one number for the
 * whole render, and a server component cannot know the viewport. The five
 * extra cards cost DOM, not bandwidth — `BookCover` lazy-loads, and nothing
 * below the fold of a `display: none` cell is ever requested.
 */
const MOBILE_SHELF_COUNT = 3;

/* Word-by-word stagger for the hero headline. Base is the beat before the
   first word — long enough to read as a deliberate entrance, short enough that
   a headline is not missing on arrival. Step is the gap between words: at
   55ms a fourteen-word tagline finishes inside 1.5s including the last word's
   own 700ms. */
const HERO_WORD_BASE_MS = 80;
const HERO_WORD_STEP_MS = 55;

/**
 * The landing headline, set one word at a time.
 *
 * Each word is an inline-block that rises out of a blur into place, a beat
 * behind the one before it. The delays have to be inline: they are a function
 * of each word's index in a translated string, which no stylesheet can know.
 *
 * The space between words is a real text node outside the spans rather than
 * `whitespace-pre` inside them. That matters for `ja`, where the tagline has
 * no spaces at all and is therefore one span: an inline-block shrinks to fit
 * and breaks internally between kana, whereas `whitespace-pre` would forbid
 * every break and run the headline off the side of the page.
 *
 * `font-display` — Playfair Display, falling back to the reference's Lora —
 * and the animation are both scoped here rather than to `h1` globally: this is
 * the one headline in the app that is the page's welcome rather than its label.
 *
 * Two class-name hazards this markup has to steer around, both silent:
 *
 *   `[display:inline-block]`, not `inline-block`. Tailwind generates an
 *   `inline-size` utility off the spacing scale, and this theme has a
 *   `--spacing-block` (56px) — so `inline-block` compiles to BOTH
 *   `display:inline-block` and `inline-size:var(--spacing-block)`, pinning
 *   every word to 56px wide while its glyphs paint at their real width. The
 *   result is a headline stacked on top of itself. See the note beside
 *   `--spacing-block` in theme.css.
 *
 *   A plain class string, not `cn()`. tailwind-merge cannot tell this theme's
 *   `text-36` (a font size) from `text-ink` (a colour) — same `text-*` prefix,
 *   a value it has no entry for — so it treats the pair as a conflict and drops
 *   the earlier one. The size vanishes and the headline silently falls back to
 *   the base `h1` rule's 44px. Nothing here needs merging anyway.
 */
function HeroTitle({ text }: { text: string }) {
  const words = text.split(" ").filter(Boolean);

  return (
    <h1 className="max-w-measure-intro text-36 text-ink sm:text-48 lg:text-64 font-display leading-[1.04] tracking-[-0.015em]">
      {words.map((word, index) => (
        <Fragment key={`${index}-${word}`}>
          <span
            className="animate-hero-word [display:inline-block]"
            style={{ animationDelay: `${HERO_WORD_BASE_MS + index * HERO_WORD_STEP_MS}ms` }}
          >
            {word}
          </span>
          {index < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </h1>
  );
}

/**
 * Hero — headline, subtitle, closing hairline.
 *
 * One component rather than three because the timing is a sequence: the
 * subtitle waits for the last word to start and the rule waits for the
 * subtitle, so the delay each one needs depends on how many words the
 * translated tagline turned out to have. Every delay downstream of the words
 * is therefore computed here and passed inline, overriding the fixed 90ms the
 * `animate-hero-subtitle` shorthand carries for other callers.
 */
function Hero({ tagline, subhead }: { tagline: string; subhead: string }) {
  const wordCount = tagline.split(" ").filter(Boolean).length || 1;
  const subtitleDelayMs = HERO_WORD_BASE_MS + wordCount * HERO_WORD_STEP_MS;

  return (
    <Shell
      as="section"
      className="lg:pt-page-desktop lg:pb-block flex flex-col items-center py-20 text-center"
    >
      <HeroTitle text={tagline} />

      <p
        className="animate-hero-subtitle text-15 text-secondary max-w-measure-lede sm:text-17 lg:text-19 mt-4"
        style={{ animationDelay: `${subtitleDelayMs}ms` }}
      >
        {subhead}
      </p>

      {/* Closing mark, drawn outwards from the centre once the words have
          landed — the one thing separating the hero from the shelf below it,
          in place of a heavier rule or a scroll cue. */}
      <span
        aria-hidden
        className="animate-hero-rule bg-rule mt-9 block h-px w-16 origin-center"
        style={{ animationDelay: `${subtitleDelayMs + 140}ms` }}
      />
    </Shell>
  );
}

/**
 * Lead the shelf with a pre-order, if one came back.
 *
 * The API will not do this: `orderableBucket()` in book.query.ts ranks
 * `in_stock` (0) above `pre_order` (1) as a primary sort key under *every*
 * sort, and `/books` has no availability filter to ask the other way round. So
 * a pre-order title is structurally last on a shelf of eight, and the landing
 * page wants it first — it is the one thing on the page with a deadline.
 *
 * Reordering on the client is safe *here* specifically. The warning attached
 * to that sort key is about offset pagination: a client that moves a row
 * duplicates or drops books across pages. This shelf is page 1 of 1 and has no
 * next page, so there is nothing for a move to fall out of. Do not copy this
 * into /catalog.
 *
 * If none of the eight is a pre-order the shelf is returned untouched — the
 * alternative is a second round trip for a book that may not exist.
 */
function preOrderFirst(books: BookSummary[]): BookSummary[] {
  const index = books.findIndex((book) => book.flag === "pre-order");
  if (index <= 0) return books;

  const lead = books[index];
  return [lead, ...books.slice(0, index), ...books.slice(index + 1)];
}

/**
 * Which card, if any, gets the page's one clay button.
 *
 * The landing page had no primary action anywhere: every add-to-cart on the
 * shelf was `secondary` (correct on /catalog, where a grid of primaries would
 * spend the accent a dozen times over, against principle 02) and the
 * catalogue CTA is secondary too. A page whose whole job is to get a visitor
 * to buy something ended up with nothing on it weighted to be pressed.
 *
 * Principle 02 reads "one accent, used sparingly — if two things on a screen
 * are clay, one of them is wrong". So: exactly one. It goes to the first card
 * a visitor can actually act on, which after `preOrderFirst` is normally the
 * shelf's lead. `-1` when nothing on the shelf is orderable — a whole page of
 * coming-soon titles has no action to promote, and inventing one by making a
 * disabled button clay would be worse than the flat page it replaced.
 */
function leadBuyable(books: BookSummary[]): number {
  return books.findIndex((book) => !book.soldOut && book.flag !== "coming-soon");
}

/**
 * The landing shelf — the catalog's grid, card for card.
 *
 * Everything the card renders is the catalog's: the `bare` reference variant
 * (§10.7), stacked author and price rather than one inline meta line, and the
 * same `secondary` add-to-cart closing the cell. Any change to how a book
 * looks belongs in `BookCard` so both pages take it, not here.
 */
async function RecentGrid({ locale, t }: { locale: Locale; t: T }) {
  const recent = await listBooks(
    { q: "", genres: [], sort: "recent", page: 1 },
    { pageSize: HOME_SHELF_COUNT },
  );
  const bestSellers = preOrderFirst(toBookSummaries(recent.items, locale));
  const leadIndex = leadBuyable(bestSellers);

  return (
    <>
      <h2 className="sr-only">{t("home.recent.title")}</h2>
      <BookGrid columns={1}>
        {bestSellers.map((book, index) => (
          /* The wrapper carries the mobile cut only. `sm:contents` dissolves
             it at tablet up so the card itself is the grid item again and the
             row's cards keep one shared bottom edge. */
          <div
            key={book.id}
            className={index >= MOBILE_SHELF_COUNT ? "hidden sm:contents" : "contents"}
          >
            <BookCard
              book={book}
              locale={locale}
              mobileRow
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
                  soldOut={book.soldOut}
                  comingSoon={book.flag === "coming-soon"}
                  variant={index === leadIndex ? "primary" : "secondary"}
                  block
                />
              }
            />
          </div>
        ))}
      </BookGrid>

      <div className="mt-12 flex justify-center">
        <LinkButton href={routes(locale).catalog} variant="secondary">
          {t("home.recent.seeMore")}
        </LinkButton>
      </div>
    </>
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
          note={`© ${new Date().getFullYear()} Nihonova Books`}
        />
      }
    >
      {/* Hero — tagline set word by word, then the subtitle, then the rule. */}
      <Hero tagline={t("home.hero.tagline")} subhead={t("home.hero.subhead")} />

      {/* Best-selling, buyable-now books — the catalog's grid at the catalog's
          card, one per row on mobile (three of them, led by a pre-order), 3 on
          tablet, 4 on desktop, then the way through to the rest of the
          catalogue. */}
      <Shell>
        <Suspense
          fallback={
            <BookGridSkeleton
              count={HOME_SHELF_COUNT}
              mobileCount={MOBILE_SHELF_COUNT}
              columns={1}
              mobileRow
              footer
            />
          }
        >
          <RecentGrid locale={locale} t={t} />
        </Suspense>
      </Shell>

      {/* The credibility band, in place of the second shelf: a metric and a
          few quiet claims rather than more covers. Full-bleed so its top rule
          runs the width of the page — hence no <Shell> around it. */}
      <ProofPoints
        className="mt-20 lg:mt-24"
        eyebrow={t("home.proof.eyebrow")}
        metric={t("home.proof.metric")}
        metricLabel={t("home.proof.metricLabel")}
        metricBody={t("home.proof.metricBody") || undefined}
        points={[
          {
            title: t("home.proof.selected.title"),
            body: t("home.proof.selected.body"),
          },
          {
            title: t("home.proof.recommended.title"),
            body: t("home.proof.recommended.body"),
          },
          {
            title: t("home.proof.forYou.title"),
            body: t("home.proof.forYou.body"),
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
