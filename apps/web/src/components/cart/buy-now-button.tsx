"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui";
import { useCart } from "@/hooks/use-cart";
import { useMounted } from "@/hooks/use-mounted";
import { routes } from "@/lib/routes";
import { useAppSelector } from "@/store/hooks";
import { selectQuantityOf } from "@/store/slices/cart-slice";

/**
 * Adds the book to the cart, same as `AddToCartButton`, then goes straight to
 * checkout instead of leaving the shopper on the page. It shares the cart
 * rather than a separate order path — whatever else is already in there
 * checks out alongside this book, and "bypassing the cart" only means
 * skipping the `/cart` page, not the state itself.
 *
 * Hidden rather than disabled once the book is unavailable or already in the
 * cart — `AddToCartButton` beside it already carries that message, so a
 * second control saying the same thing would only add noise.
 */
export function BuyNowButton({
  bookId,
  title,
  soldOut = false,
  comingSoon = false,
  size = "sm",
  block = false,
}: {
  bookId: string;
  /** Spoken but not shown — see `AddToCartButton`'s `title` for why. */
  title?: string;
  soldOut?: boolean;
  comingSoon?: boolean;
  size?: "sm" | "md";
  block?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const { add } = useCart();
  const mounted = useMounted();
  const quantity = useAppSelector(selectQuantityOf(bookId));
  const inCart = mounted && quantity > 0;

  if (soldOut || comingSoon || inCart) return null;

  return (
    <Button
      variant="secondary"
      size={size}
      block={block}
      onClick={() => {
        add(bookId);
        router.push(routes(locale ?? "en").checkout);
      }}
    >
      {t("actions.buyNow")}
      {title ? <span className="sr-only">{`, ${title}`}</span> : null}
    </Button>
  );
}
