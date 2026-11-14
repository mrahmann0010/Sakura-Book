"use client";

import { useTranslation } from "react-i18next";
import { MAX_LINE_QUANTITY } from "@sakura/contracts";

import { BookCover } from "@/components/domain";
import { Button, Eyebrow, Stepper } from "@/components/ui";
import type { CartLine } from "@/lib/cart";
import { formatMoney } from "@/lib/money";

/* --------------------------------------------------------------------------
   The books being bought, editable, at the top of checkout's delivery step.

   Checkout used to show the cart read-only and send edits back to /cart. That
   stopped working once Buy Now became the only purchase button: it adds one
   copy and lands here, so a shopper who wanted two never saw a page where
   that was possible. Quantity is now changed where the order is placed, the
   way most checkouts do it.

   Delivery step only. On the payment step the shopper may already have sent
   the total through bKash, and a stepper there could change it after the
   money has gone.
   -------------------------------------------------------------------------- */

export function CheckoutItems({
  lines,
  money,
  onQuantityChange,
  onRemove,
}: {
  lines: CartLine[];
  /** BCP 47 tag the amounts are formatted for — the same one the rail uses. */
  money: string;
  onQuantityChange: (bookId: string, quantity: number) => void;
  onRemove: (bookId: string) => void;
}) {
  const { t } = useTranslation();

  /* Every line is removable, the last one included. Emptying the cart here
     does not throw the shopper out: CheckoutView keeps the form mounted
     behind its empty message and offers Undo, so a slip costs one tap and
     the typed address survives it. */

  return (
    <section aria-label={t("checkout.items.legend")}>
      <Eyebrow as="h2">{t("checkout.items.legend")}</Eyebrow>

      <ul className="hairline mt-4">
        {lines.map((line) => {
          /* Said only when stock is the reason + stopped working. At the line
             cap itself there are plenty left, and "only 99 left" is not true.
             Read off `available`, not `maxQuantity`: the ceiling is raised to
             meet a line that has run short, and saying "only 3 left" of a
             title with 1 is how the stepper used to cover for it. A line past
             its stock is the notice's to explain, with the buttons to fix it. */
          const atStockLimit =
            line.available !== null &&
            line.available < MAX_LINE_QUANTITY &&
            line.quantity === line.available;

          return (
            <li
              key={line.book.id}
              className="grid-line-sm border-rule items-start gap-4 border-b py-4"
            >
              <BookCover
                src={line.book.coverUrl}
                title={line.book.title}
                author={line.book.author}
                radius="xs"
              />

              <div className="min-w-0">
                <p className="text-15 text-ink font-serif leading-[1.3]">{line.book.title}</p>
                <p className="text-caption text-secondary mt-1">
                  {t("checkout.items.each", { price: formatMoney(line.unitPrice, money) })}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Stepper
                    value={line.quantity}
                    min={1}
                    max={line.maxQuantity}
                    onChange={(next) => onQuantityChange(line.book.id, next)}
                    label={t("checkout.items.quantity", { title: line.book.title })}
                    engaged
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(line.book.id)}
                    className="text-caption hover:text-clay hover:bg-transparent"
                  >
                    {t("cart.removeItem")}
                    <span className="sr-only">{`, ${line.book.title}`}</span>
                  </Button>
                </div>

                {atStockLimit ? (
                  <p aria-live="polite" className="text-caption text-muted mt-2">
                    {t("book.stock.low", { count: line.available })}
                  </p>
                ) : null}
              </div>

              <p className="text-13.5 text-ink">{formatMoney(line.lineTotal, money)}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
