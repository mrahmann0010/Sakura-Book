import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui";
import { formatMoney, intlLocale } from "@/lib/money";
import { cn, type Variants } from "@/lib/utils";

import { BookCover } from "./book-cover";
import { flagLabels, type BookSummary } from "./types";

/* --------------------------------------------------------------------------
   See ./README.md for the contexts this API was designed against. In short:
   `layout` picks grid-shaped vs. compact row, `size` scales the title, and
   cart/order lines are deliberately separate components.
   -------------------------------------------------------------------------- */

/**
 * `clamp` holds every grid title to exactly two lines — clamped so a long one
 * cannot run, and floored at `2lh` so a short one still occupies the same box.
 * Without the floor, a one-line English title and a three-line Bengali or
 * Japanese one push their price rows to different heights and the bottom of a
 * grid row visibly staggers. The compact `row` layout opts out: a fixed
 * two-line box there would inflate a list built to be short.
 */
const cardTitle = cva("font-serif leading-[1.28] text-ink", {
  variants: {
    size: {
      sm: "text-15 leading-[1.25]",
      md: "text-17",
      lg: "text-18",
      feature: "text-26 leading-tight",
    },
    clamp: {
      true: "line-clamp-2 min-h-[2lh]",
    },
  },
  defaultVariants: { size: "md" },
});

/* `clamp` is internal — the layout decides it, not the caller. */
export type BookCardProps = Omit<Variants<VariantProps<typeof cardTitle>>, "clamp"> & {
  book: BookSummary;
  /**
   * `stack` is every grid-shaped context — catalog, shelves, search, related.
   * `row` is the compact list row: small thumbnail, price to the right.
   */
  layout?: "stack" | "row";
  /** Suppress the metadata badge where a shelf runs deliberately unflagged. */
  showFlag?: boolean;
  /** Hide the price on rails where the cover and title carry the weight. */
  showPrice?: boolean;
  /**
   * Replaces author and price with one line — "Leonora Carrington · £14.00" —
   * as the curated shelf sets it.
   */
  inlineMeta?: boolean;
  /* `splitMeta` — the rating/price bottom row — was removed with its only
     call site. `rating` and `ratingCount` on `BookSummary` are invented
     placeholder values, and no card may show them as social proof until real
     data backs them. Reinstate it alongside real ratings, labelled ("4.6 · 128
     reviews"), not as a bare decimal. */
  /**
   * Which locale to format the price in.
   *
   * A prop rather than a hook, because this card renders in server components
   * on the landing and catalog pages and must not pull in a client-side i18n
   * context to print a number. Every call site sits under `app/[locale]/` and
   * already has the segment in hand.
   *
   * The card formats rather than receiving a formatted string — unlike
   * `CartItem`, which takes `lineTotal` preformatted. The difference is that a
   * line total is arithmetic the caller owns, whereas a unit price is a field
   * on the book the card was already given.
   */
  locale?: string;
  /** A control above the card: quick view, save, remove from a list. */
  action?: ReactNode;
  /**
   * A control below the meta, flush with the cover's edges — the catalog's
   * add-to-cart. Separate from `action` because the two are different weights
   * in different places: `action` is a light control that shares the badge's
   * row, whereas this one closes the card's argument and is read last, after
   * the price has been made. §10.7 draws no control on a book card at all, so
   * anything here is an addition to the reference and stays `secondary` — the
   * clay belongs to whatever single primary action the page owns (§2).
   */
  footerAction?: ReactNode;
  /**
   * `bare` is the reference card — a cover on cream, ink outline on hover
   * (§10.7). `panel` is the landing shelf card the wireframe draws: the same
   * content seated on a tint block, with the badge and action sharing a row
   * above an inset cover. Panel cards must not sit inside a tinted section,
   * per §10.4.
   */
  variant?: "bare" | "panel";
  className?: string;
};

export function BookCard({
  book,
  layout = "stack",
  size = layout === "row" ? "sm" : "md",
  showFlag = true,
  showPrice = true,
  inlineMeta = false,
  locale = "en",
  action,
  footerAction,
  variant = "bare",
  className,
}: BookCardProps) {
  const flag = showFlag ? book.flag : undefined;
  const priceLine = book.flag === "coming-soon"
    ? "Coming soon"
    : book.soldOut
      ? "Out of stock"
      : formatMoney(book.priceCents, intlLocale(locale));

  /* "Ships around <Month year>" — the same fact the detail page's buy card
     states in full sentence form (`book.preOrder.shipsAround`), shortened to
     fit the caption row a grid card has for it. English only, like every
     other word this component prints — `flagLabels` never went through i18n
     either, and a card is not the place to start. */
  const shipDateLine =
    book.flag === "pre-order" && book.expectedShipDate
      ? `Ships around ${new Intl.DateTimeFormat(intlLocale(locale), {
          year: "numeric",
          month: "long",
        }).format(new Date(book.expectedShipDate))}`
      : undefined;

  const title = book.href ? (
    /* The title anchor stretches over the card, so the whole card is one
       target. Controls opt out by raising themselves above it — `z-10` on the
       `action` row and on `footerAction` — which works wherever they sit, not
       only above the cover. */
    <Link href={book.href} className="before:absolute before:inset-0">
      {book.title}
    </Link>
  ) : (
    book.title
  );

  const meta = inlineMeta ? (
    <p className="text-13 text-secondary mt-1.5">
      {book.author}
      {showPrice ? ` · ${priceLine}` : null}
      {shipDateLine ? ` · ${shipDateLine}` : null}
    </p>
  ) : (
    <>
      <p className="text-caption text-secondary mt-1.5">{book.author}</p>
      {showPrice ? (
        <p className={cn("text-caption mt-1.5", book.soldOut ? "text-secondary" : "text-body")}>
          {priceLine}
        </p>
      ) : null}
      {shipDateLine ? <p className="text-caption text-secondary mt-1">{shipDateLine}</p> : null}
    </>
  );

  if (layout === "row") {
    return (
      <article
        className={cn(
          "group grid-line-sm relative items-center gap-3.5",
          "hairline pt-4",
          "outline-1 outline-offset-6 outline-transparent transition-[outline-color] duration-150",
          "hover:outline-ink has-[a:focus-visible]:outline-ink",
          book.soldOut && "opacity-55",
          className,
        )}
      >
        <BookCover src={book.coverUrl} title={book.title} author={book.author} radius="xs" />
        <div className="min-w-0">
          <h3 className={cardTitle({ size: "sm" })}>{title}</h3>
          <p className="text-12 text-secondary mt-1">{book.author}</p>
        </div>
        {showPrice ? <p className="text-caption text-body">{priceLine}</p> : null}
      </article>
    );
  }

  if (variant === "panel") {
    const badge = flag ? (
      <Badge tone={flag === "editors-pick" ? "accent" : "neutral"}>{flagLabels[flag]}</Badge>
    ) : null;

    return (
      <article
        className={cn(
          "group bg-tint rounded-control relative flex flex-col p-5",
          /* Offset 2 rather than the bare card's 6: the panel already has an
             edge, so the ring sits just off it instead of floating. */
          "outline-1 outline-offset-2 outline-transparent duration-150",
          "hover:outline-ink has-[a:focus-visible]:outline-ink",
          /* One transition list covering both the hover ring and the tap
             scale below — two separate `transition-*` utilities would each
             set `transition-property` and the later one would silently drop
             the other's property from the list. */
          "transition-[outline-color,transform]",
          /* A tap-scale on touch, so the best-sellers shelf feels pressed
             rather than static on a phone. Harmless on desktop, where a mouse
             click is brief enough that the transform barely registers. */
          "active:scale-[0.97]",
          book.soldOut && "opacity-55",
          className,
        )}
      >
        {/* Reserved even when empty, so covers align across a row. */}
        <div className="relative z-10 flex min-h-8 items-start justify-between gap-3">
          {badge}
          {action ? <div className="ml-auto">{action}</div> : null}
        </div>

        <div className="mx-auto mt-4.5 w-[56%]">
          <BookCover
            src={book.coverUrl}
            title={book.title}
            author={book.author}
            fallback={book.coverUrl ? "hatch" : "wordmark"}
          />
        </div>

        <div className="hairline mt-5 pt-4">
          <h3 className={cardTitle({ size, clamp: true })}>{title}</h3>
          {meta}
        </div>

        {footerAction ? <div className="relative z-10 mt-auto pt-4">{footerAction}</div> : null}
      </article>
    );
  }

  return (
    <article
      className={cn(
        "group relative flex flex-col",
        "outline-1 outline-offset-6 outline-transparent transition-[outline-color] duration-150",
        "hover:outline-ink has-[a:focus-visible]:outline-ink",
        book.soldOut && "opacity-55",
        className,
      )}
    >
      {action ? <div className="relative z-10 mb-3 flex justify-end">{action}</div> : null}

      <BookCover
        src={book.coverUrl}
        title={book.title}
        author={book.author}
        fallback={book.coverUrl ? "hatch" : "wordmark"}
      />

      {flag ? (
        <p className="mt-4">
          <Badge
          tone={flag === "editors-pick" ? "accent" : flag === "pre-order" ? "outline" : "neutral"}
        >
          {flagLabels[flag]}
        </Badge>
        </p>
      ) : null}

      <h3 className={cn(cardTitle({ size, clamp: true }), flag ? "mt-3" : "mt-4.5")}>{title}</h3>
      {meta}

      {/* Read last, after the price has made its case, and flush with the
          cover's edges so a row of cards keeps one straight bottom line.
          `mt-auto` seats it against the cell floor when a neighbouring card
          runs taller. */}
      {footerAction ? <div className="relative z-10 mt-auto pt-4">{footerAction}</div> : null}
    </article>
  );
}
