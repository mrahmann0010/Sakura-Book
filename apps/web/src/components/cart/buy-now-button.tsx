"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { BagIcon, Button } from "@/components/ui";
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
  preOrder = false,
  size = "sm",
  variant = "secondary",
  block = false,
  icon = false,
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
  /**
   * Swaps the label to "Pre-order now" — nothing else. A `pre_order` book is
   * a normal catalog book that ships later (see the `bookAvailability` enum):
   * same cart, same checkout, same payment taken at the same moment, so there
   * is no second code path here to justify, only an honest word. "Buy now"
   * promises immediacy a book that ships in January does not have.
   *
   * Opt-in, and deliberately not derived from the flag inside this component,
   * because the grid call sites must keep saying "Buy now": a catalog card
   * already carries the pre-order badge and the ships-around caption, and a
   * third repeat in a ~200px cell is the same crowding `BookCard`'s price
   * line avoids — on a label 60% longer, inside an `sm` block button in a
   * ~160pt card, where it would wrap. The detail page is full width and is
   * the screen where the shopper commits, so it is the one that says it.
   */
  preOrder?: boolean;
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
  /**
   * Draws the bag glyph before the label. Off by default, and deliberately
   * opt-in rather than always-on: the grid call sites render this at `sm`
   * inside a card that is about 160pt wide on a phone, where an 18px glyph
   * plus its gap is enough to wrap a Bangla label onto a second line. The
   * book page has a full-width button and the room for it.
   */
  icon?: boolean;
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
      /* Only on the live button. The sold-out and coming-soon branches above
         stay wordmark-only on purpose: a bag on a control that cannot be
         pressed offers a purchase the shop cannot complete. */
      leading={icon ? <BagIcon /> : undefined}
      onClick={() => {
        /* Already in the cart means no add, and so no `add_to_cart` — the
           book was counted when it went in, and counting it again on every
           press of Buy Now would make the funnel wider than the shelf. */
        if (!inCart) add(bookId, 1, { title, priceCents });
        router.push(routes(locale ?? "en").checkout);
      }}
    >
      {t(preOrder ? "actions.preOrder" : "actions.buyNow")}
      {title ? <span className="sr-only">{`, ${title}`}</span> : null}
    </Button>
  );
}
