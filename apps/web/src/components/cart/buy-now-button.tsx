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
      variant="secondary"
      size={size}
      block={block}
      onClick={() => {
        if (!inCart) add(bookId);
        router.push(routes(locale ?? "en").checkout);
      }}
    >
      {t("actions.buyNow")}
      {title ? <span className="sr-only">{`, ${title}`}</span> : null}
    </Button>
  );
}
