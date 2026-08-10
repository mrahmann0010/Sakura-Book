"use client";

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
  /** Border of the stepper goes ink once the row has been touched. */
  engaged?: boolean;
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
  engaged,
  className,
}: CartItemProps) {
  if (removing) {
    return (
      <div
        className={cn(
          "grid-line-lg border-rule py-card items-center gap-6 border-b opacity-50",
          className,
        )}
      >
        <span aria-hidden className="cover rounded-md" />
        <p aria-live="polite" className="text-13 text-secondary">
          Removing “{book.title}”…{" "}
          <button type="button" onClick={onUndoRemove} className="text-clay font-semibold">
            Undo
          </button>
        </p>
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

        <div className="mt-4 flex flex-wrap items-center gap-3.5">
          <Stepper
            value={quantity}
            onChange={onQuantityChange}
            engaged={engaged}
            label={`Quantity, ${book.title}`}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="text-caption hover:text-clay hover:bg-transparent"
          >
            Remove
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
