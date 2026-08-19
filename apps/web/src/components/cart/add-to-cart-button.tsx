"use client";

import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui";
import { useCart } from "@/hooks/use-cart";
import { useMounted } from "@/hooks/use-mounted";
import { useAppSelector } from "@/store/hooks";
import { selectQuantityOf } from "@/store/slices/cart-slice";

/**
 * The one control that puts a book in the cart, so the cart and checkout pages
 * have something to work on.
 *
 * Once the book is in, the button says so and keeps adding — quantity is edited
 * on the cart page, not scattered across every card in the catalogue. That is
 * the same division of labour the two pages are built on.
 */
export function AddToCartButton({
  bookId,
  soldOut = false,
  size = "sm",
  block = false,
}: {
  bookId: string;
  soldOut?: boolean;
  size?: "sm" | "md";
  /** Full-width — the detail page's buy card, where the button is the card's
      one job and should read as wide as the price line above it. */
  block?: boolean;
}) {
  const { t } = useTranslation();
  const { add } = useCart();
  const mounted = useMounted();
  const quantity = useAppSelector(selectQuantityOf(bookId));
  const inCart = mounted && quantity > 0;

  if (soldOut) {
    return (
      <Button variant="secondary" size={size} block={block} disabled>
        {t("actions.soldOut")}
      </Button>
    );
  }

  return (
    <Button
      variant={inCart ? "secondary" : "primary"}
      size={size}
      block={block}
      onClick={() => add(bookId)}
      aria-label={t("actions.addToCartNamed", { count: quantity })}
    >
      {inCart ? t("actions.inCart", { count: quantity }) : t("actions.addToCart")}
    </Button>
  );
}
