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

  /* Removing the last book would empty the cart mid-checkout and drop the
     shopper onto the empty state with a half-filled address. One line left
     means the stepper's floor of 1 is the only way down. */
  const removable = lines.length > 1;

  return (
    <section aria-label={t("checkout.items.legend")}>
      <Eyebrow as="h2">{t("checkout.items.legend")}</Eyebrow>

      <ul className="hairline mt-4">
        {lines.map((line) => {
          /* Said only when stock is the reason + stopped working. At the line
             cap itself there are plenty left, and "only 99 left" is not true. */
          const atStockLimit =
            line.maxQuantity < MAX_LINE_QUANTITY && line.quantity >= line.maxQuantity;

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
                  {removable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemove(line.book.id)}
                      className="text-caption hover:text-clay hover:bg-transparent"
                    >
                      {t("cart.removeItem")}
                      <span className="sr-only">{`, ${line.book.title}`}</span>
                    </Button>
                  ) : null}
                </div>

                {atStockLimit ? (
                  <p aria-live="polite" className="text-caption text-muted mt-2">
                    {t("book.stock.low", { count: line.maxQuantity })}
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
