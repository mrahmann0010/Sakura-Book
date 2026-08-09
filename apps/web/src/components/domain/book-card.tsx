import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui";
import { cn, type Variants } from "@/lib/utils";

import { BookCover } from "./book-cover";
import { flagLabels, type BookSummary } from "./types";

/* --------------------------------------------------------------------------
   See ./README.md for the contexts this API was designed against. In short:
   `layout` picks grid-shaped vs. compact row, `size` scales the title, and
   cart/order lines are deliberately separate components.
   -------------------------------------------------------------------------- */

const cardTitle = cva("font-serif leading-[1.28] text-ink", {
  variants: {
    size: {
      sm: "text-15 leading-[1.25]",
      md: "text-17",
      lg: "text-18",
      feature: "text-26 leading-tight",
    },
  },
  defaultVariants: { size: "md" },
});

export type BookCardProps = Variants<VariantProps<typeof cardTitle>> & {
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
  /** A control above the card: quick view, save, remove from a list. */
  action?: ReactNode;
  className?: string;
};

export function BookCard({
  book,
  layout = "stack",
  size = layout === "row" ? "sm" : "md",
  showFlag = true,
  showPrice = true,
  inlineMeta = false,
  action,
  className,
}: BookCardProps) {
  const flag = showFlag ? book.flag : undefined;
  const priceLine = book.soldOut ? "Out of stock" : book.price;

  const title = book.href ? (
    /* The title anchor stretches over the card, so the whole card is one
       target and any `action` above it stays separately clickable. */
    <Link href={book.href} className="before:absolute before:inset-0">
      {book.title}
    </Link>
  ) : (
    book.title
  );

  const meta = inlineMeta ? (
    <p className="mt-1.5 text-13 text-secondary">
      {book.author}
      {showPrice ? ` · ${priceLine}` : null}
    </p>
  ) : (
    <>
      <p className="mt-1.5 text-caption text-secondary">{book.author}</p>
      {showPrice ? (
        <p
          className={cn(
            "mt-1.5 text-caption",
            book.soldOut ? "text-secondary" : "text-body",
          )}
        >
          {priceLine}
        </p>
      ) : null}
    </>
  );

  if (layout === "row") {
    return (
      <article
        className={cn(
          "group relative grid-line-sm items-center gap-3.5",
          "hairline pt-4",
          "outline-1 outline-offset-6 outline-transparent transition-[outline-color] duration-150",
          "hover:outline-ink has-[a:focus-visible]:outline-ink",
          book.soldOut && "opacity-55",
          className,
        )}
      >
        <BookCover
          src={book.coverUrl}
          title={book.title}
          author={book.author}
          radius="xs"
        />
        <div className="min-w-0">
          <h3 className={cardTitle({ size: "sm" })}>{title}</h3>
          <p className="mt-1 text-12 text-secondary">{book.author}</p>
        </div>
        {showPrice ? (
          <p className="text-caption text-body">{priceLine}</p>
        ) : null}
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
      {action ? (
        <div className="relative z-10 mb-3 flex justify-end">{action}</div>
      ) : null}

      <BookCover
        src={book.coverUrl}
        title={book.title}
        author={book.author}
        fallback={book.coverUrl ? "hatch" : "wordmark"}
      />

      {flag ? (
        <p className="mt-4">
          <Badge tone={flag === "editors-pick" ? "accent" : "neutral"}>
            {flagLabels[flag]}
          </Badge>
        </p>
      ) : null}

      <h3 className={cn(cardTitle({ size }), flag ? "mt-3" : "mt-4.5")}>
        {title}
      </h3>
      {meta}
    </article>
  );
}
