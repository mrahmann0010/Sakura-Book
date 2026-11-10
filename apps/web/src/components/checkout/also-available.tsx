"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, ChevronDownIcon, Stepper } from "@/components/ui";
import type { AlsoAvailableBook } from "@/lib/also-available";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
   "Take more in the same parcel" — the shelf at the top of checkout.

   Placed above the shopper's own books rather than under them, because the
   whole point is being seen on arrival: a shopper who has already started
   typing an address has decided what they are buying, and a shelf found below
   the fold is a shelf found after the decision. Collapsed by default is what
   makes that affordable — one 48px row costs nothing above the fold, and the
   books only appear for someone who asked for them.

   Delivery step only; the caller enforces that. On the payment step the total
   may already have been sent through bKash, and nothing there may change it.

   Deliberately not the invite page's version of this section, which shows six
   titles with the author on a second line. That page is the shop window for a
   customer who arrived from an SMS with one book in hand. This one sits in
   front of someone who came through the catalog and the cart and has seen the
   shelf already: three titles are enough to catch "oh, that one too", and the
   link covers anyone who wants the rest.
   -------------------------------------------------------------------------- */

export function AlsoAvailable({
  books,
  catalogHref,
  totalTitles,
  money,
  onAdd,
  defaultOpen = false,
  className,
}: {
  /** Already filtered to what is in stock and not in the cart. */
  books: AlsoAvailableBook[];
  catalogHref: string;
  /** How many titles the shelf holds in all — the link says so. */
  totalTitles: number;
  /** BCP 47 tag the amounts are formatted for — the same one the rail uses. */
  money: string;
  onAdd: (book: AlsoAvailableBook) => void;
  /**
   * Open on arrival. The caller passes true for a one-book cart: "একসাথে"
   * means something to that shopper and nothing to one who already has four.
   */
  defaultOpen?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  /* An empty "add more books" heading is worse than silence — a shop that
     appears to be offering something and then is not. */
  if (books.length === 0) return null;

  return (
    <Card
      as="section"
      padding="none"
      /* Tinted while shut, white once open: closed, the fill is what makes a
         single quiet row register on the way past; open, the rows below it
         should not have to compete with their own background. */
      className={cn("overflow-hidden", !open && "bg-tint", className)}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="px-card-compact min-h-touch flex w-full items-center justify-between gap-4 py-3.5 text-left"
      >
        <span className="text-13.5 text-ink">{t("checkout.alsoAvailable.title")}</span>
        {/* Rotates to point up when open, so the glyph states the next press
            rather than the current state — `aria-expanded` already carries
            the state for a screen reader. */}
        <ChevronDownIcon
          size={16}
          className={cn(
            "text-muted shrink-0 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="px-card-compact pb-1">
          <ul>
            {books.map((book) => (
              <li
                key={book.id}
                className="border-rule flex items-center gap-3 border-t py-3"
                /* Title, price, stepper on one line. The author is what makes
                   this two lines per book, and on a checkout strip the title
                   and the price are the whole decision. */
              >
                <span className="text-13.5 text-ink min-w-0 flex-1 truncate font-serif">
                  {book.title}
                </span>
                <span className="text-caption text-secondary whitespace-nowrap">
                  {formatMoney(book.priceCents, money)}
                </span>
                {/* Held at 0 and never counting up: the first "+" puts the
                    book in the cart, the cart is what this list excludes, so
                    the row is gone by the next render and the real stepper in
                    CheckoutItems takes over. "−" is disabled at the floor,
                    which is correct here — there is nothing to take away from
                    a book that is not in the order yet. */}
                <Stepper
                  label={t("checkout.alsoAvailable.add", { title: book.title })}
                  value={0}
                  min={0}
                  max={book.maxQuantity}
                  onChange={(next) => {
                    if (next > 0) onAdd(book);
                  }}
                />
              </li>
            ))}
          </ul>

          <p className="border-rule border-t py-3 text-right">
            <Link
              href={catalogHref}
              className="text-caption text-clay hover:text-clay-deep font-semibold"
            >
              {t("checkout.alsoAvailable.all", { count: totalTitles })}
            </Link>
          </p>
        </div>
      ) : null}
    </Card>
  );
}
