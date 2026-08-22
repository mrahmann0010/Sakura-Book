"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Stepper } from "@/components/ui";
import { cn } from "@/lib/utils";

import { BookCover } from "./book-cover";
import type { BookSummary } from "./types";

export type CartItemProps = {
  book: BookSummary;
  quantity: number;
  /** Line total, preformatted. Not derived here — rounding is a money concern. */
  lineTotal: string;
  onQuantityChange?: (quantity: number) => void;
  onRemove?: () => void;
  onUndoRemove?: () => void;
  /**
   * The row is mid-removal: everything collapses to a sentence with an inline
   * Undo, at half opacity, holding the row height so the list does not jump.
   */
  removing?: boolean;
  className?: string;
};

/**
 * One cart line: 72px cover · content · amount, hairline separated.
 *
 * Kept apart from BookCard on purpose — see ./README.md. This row carries
 * quantity, a line total and two destructive-ish actions, none of which a
 * catalog card has any business knowing about.
 */
export function CartItem({
  book,
  quantity,
  lineTotal,
  onQuantityChange,
  onRemove,
  onUndoRemove,
  removing = false,
  className,
}: CartItemProps) {
  const { t } = useTranslation();
  /* Border goes ink once the row has been touched — local, since no other
     row or the cart-level state has any use for it. */
  const [engaged, setEngaged] = useState(false);

  if (removing) {
    return (
      <div
        className={cn(
          "grid-line-lg border-rule py-card items-start gap-6 border-b opacity-50",
          className,
        )}
      >
        <BookCover src={book.coverUrl} title={book.title} author={book.author} radius="md" />

        <div className="min-w-0">
          <h3 className="text-19 text-ink font-serif leading-[1.25]">{book.title}</h3>
          <p aria-live="polite" className="text-caption text-secondary mt-1.5">
            {t("cart.removingLine", { title: book.title })}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={onUndoRemove}
              className="text-caption"
            >
              {t("cart.addBack")}
              <span className="sr-only">{`, ${book.title}`}</span>
            </Button>
          </div>
        </div>

        <p className="text-13.5 text-secondary">{lineTotal}</p>
      </div>
    );
  }

  return (
    <div className={cn("grid-line-lg border-rule py-card items-start gap-6 border-b", className)}>
      <BookCover src={book.coverUrl} title={book.title} author={book.author} radius="md" />

      <div className="min-w-0">
        <h3 className="text-19 text-ink font-serif leading-[1.25]">{book.title}</h3>
        <p className="text-caption text-secondary mt-1.5">
          {book.author}
          {book.format ? <> · {book.format}</> : null}
        </p>

        {/* Pre-order lines ship later — a normal cart line otherwise, just
            with this one extra fact so the shopper isn't surprised at
            delivery. */}
        {book.flag === "pre-order" && book.expectedShipDate ? (
          <p className="text-caption text-muted mt-1">
            {t("book.preOrder.shipsAround", {
              date: new Intl.DateTimeFormat(undefined, {
                year: "numeric",
                month: "long",
              }).format(new Date(book.expectedShipDate)),
            })}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3.5">
          <Stepper
            value={quantity}
            onChange={(next) => {
              setEngaged(true);
              onQuantityChange?.(next);
            }}
            engaged={engaged}
            label={`Quantity, ${book.title}`}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="text-caption hover:text-clay hover:bg-transparent"
          >
            {t("cart.removeItem")}
            <span className="sr-only">{`, ${book.title}`}</span>
          </Button>
        </div>
      </div>

      <p className="text-13.5 text-ink">{lineTotal}</p>
    </div>
  );
}

/** The hairline-topped list the rows sit in. */
export function CartItemList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("hairline", className)}>{children}</div>;
}
