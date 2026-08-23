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
 * The one purchase control the app shows now — `AddToCartButton` is commented
 * out at every call site (§ below) because a cart the shopper has to visit
 * and review before paying was one step too many for this audience. This
 * button adds the book to the cart, same as that one did, then goes straight
 * to checkout instead of leaving the shopper on the page. It still shares the
 * cart rather than a separate order path — whatever else is already in there
 * checks out alongside this book — so "bypassing the cart" only means
 * skipping the `/cart` page, not the state itself.
 *
 * If the book is already in the cart this skips `add` and just navigates, so
 * a shopper who somehow has cart state (an old session, another tab) is never
 * stranded without a working button.
 */
export function BuyNowButton({
  bookId,
  title,
  priceCents,
  soldOut = false,
  comingSoon = false,
  size = "sm",
  variant = "secondary",
  block = false,
}: {
  bookId: string;
  /** Spoken but not shown — see `AddToCartButton`'s `title` for why. */
  title?: string;
  /**
   * Minor units, for the GA4 `add_to_cart` event only — nothing on screen is
   * priced from it. Optional because the event is still worth sending without
   * a price; see trackAddToCart.
   */
  priceCents?: number;
  soldOut?: boolean;
  comingSoon?: boolean;
  size?: "sm" | "md";
  /**
   * Defaults to `secondary`, because the usual context is a grid: a shelf of
   * clay buttons spends the one accent a dozen times over, against principle
   * 02. A page passes `primary` for the single button it wants pressed —
   * exactly one per screen, or the principle is broken in the other
   * direction.
   */
  variant?: "primary" | "secondary";
  block?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const { add } = useCart();
  const mounted = useMounted();
  const quantity = useAppSelector(selectQuantityOf(bookId));
  const inCart = mounted && quantity > 0;

  if (comingSoon) {
    return (
      <Button variant="secondary" size={size} block={block} disabled>
        {t("actions.comingSoon")}
        {title ? <span className="sr-only">{`, ${title}`}</span> : null}
      </Button>
    );
  }

  if (soldOut) {
    return (
      <Button variant="secondary" size={size} block={block} disabled>
        {t("actions.soldOut")}
        {title ? <span className="sr-only">{`, ${title}`}</span> : null}
      </Button>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      block={block}
      onClick={() => {
        /* Already in the cart means no add, and so no `add_to_cart` — the
           book was counted when it went in, and counting it again on every
           press of Buy Now would make the funnel wider than the shelf. */
        if (!inCart) add(bookId, 1, { title, priceCents });
        router.push(routes(locale ?? "en").checkout);
      }}
    >
      {t("actions.buyNow")}
      {title ? <span className="sr-only">{`, ${title}`}</span> : null}
    </Button>
  );
}
