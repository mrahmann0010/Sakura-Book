"use client";

import { useTranslation } from "react-i18next";

import { Button, Notice } from "@/components/ui";
import type { StockShortage } from "@/lib/stock-shortage";

/* --------------------------------------------------------------------------
   The lines that will not go through as they stand, each with its way out.

   Shared by the cart and checkout so the shopper meets the same sentence and
   the same buttons wherever they find out. The fix is offered in place rather
   than described — "Change to 1" is one tap, "reduce the quantity above" is a
   hunt for the stepper on a phone.
   -------------------------------------------------------------------------- */

export function StockShortageNotice({
  shortages,
  onReduce,
  onRemove,
  className,
}: {
  shortages: StockShortage[];
  onReduce: (bookId: string, quantity: number) => void;
  onRemove: (bookId: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();

  if (shortages.length === 0) return null;

  return (
    <Notice tone="error" lead={t("cart.stock.lead")} className={className}>
      <ul className="mt-2 flex flex-col gap-3">
        {shortages.map((shortage) => {
          const title = shortage.title ?? t("cart.stock.unknownTitle");

          return (
            <li key={shortage.bookId} className="flex flex-col gap-2">
              <span>
                {shortage.available > 0
                  ? t("cart.stock.short", {
                      title,
                      requested: shortage.requested,
                      available: shortage.available,
                    })
                  : t("cart.stock.soldOut", { title })}
              </span>
              <span className="flex flex-wrap gap-2">
                {shortage.available > 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onReduce(shortage.bookId, shortage.available)}
                  >
                    {t("cart.stock.reduce", { count: shortage.available })}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(shortage.bookId)}
                  className="hover:text-clay hover:bg-transparent"
                >
                  {t("cart.removeItem")}
                  <span className="sr-only">{`, ${title}`}</span>
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </Notice>
  );
}
