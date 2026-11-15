"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui";
import { useCart } from "@/hooks/use-cart";
import { useMounted } from "@/hooks/use-mounted";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { button } from "@/lib/variants";
import { useAppSelector } from "@/store/hooks";
import { selectQuantityOf } from "@/store/slices/cart-slice";

import { announceAddedToCart } from "./cart-toast";

/**
 * Puts a book in the cart and leaves the shopper where they are — the
 * catalog and home cards' only purchase control, and the book page's second
 * one under Buy now.
 *
 * Once the book is in, the button becomes a link to the cart page reading
 * "In cart · N". Quantity and removal are edited there (or at checkout), not
 * scattered across every card in the catalogue — and a second press can no
 * longer quietly add a second copy.
 */
export function AddToCartButton({
  bookId,
  title,
  priceCents,
  coverUrl,
  soldOut = false,
  comingSoon = false,
  size = "sm",
  variant = "secondary",
  block = false,
}: {
  bookId: string;
  /**
   * The book's title, spoken but not shown. A catalog grid renders one of
   * these per cell, and without it a screen reader hears the same handful of
   * words a dozen times with nothing to tell the buttons apart.
   */
  title?: string;
  /** Minor units, for the GA4 `add_to_cart` event only — see `BuyNowButton`. */
  priceCents?: number;
  /** Shown as a thumbnail in the "Added to cart" toast, with `title`. */
  coverUrl?: string;
  soldOut?: boolean;
  /** Not yet released — same disabled shape as `soldOut`, different words. */
  comingSoon?: boolean;
  size?: "sm" | "md";
  /**
   * Defaults to `secondary`: a grid of primaries spends the accent a dozen
   * times over, against principle 02. A page passes `primary` for the one
   * button it wants pressed.
   */
  variant?: "primary" | "secondary";
  /** Full-width — grid cells and the book page's buy card. */
  block?: boolean;
}) {
  const { t } = useTranslation();
  const { add } = useCart();
  const mounted = useMounted();
  const quantity = useAppSelector(selectQuantityOf(bookId));
  const inCart = mounted && quantity > 0;
  const { locale } = useParams<{ locale: string }>();

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

  /* The title rides along in a hidden span rather than an `aria-label`. A
     label would replace the visible words instead of extending them, and an
     accessible name that does not contain its own visible label fails WCAG
     2.5.3 and breaks voice control ("click add to cart" matches nothing). */
  if (inCart) {
    return (
      /* Always secondary, whatever the caller asked for: the book is already
         bought as far as this button is concerned, and the accent belongs to
         whatever the shopper has not done yet. The label is the same on touch
         and hover — it used to swap to "Go to cart" on hover only, which a
         phone never shows, leaving a link that did not look like one. */
      <Link
        href={routes(locale ?? "en").cart}
        className={cn(button({ variant: "secondary", size, block }))}
      >
        {t("actions.inCart", { count: quantity })}
        <span aria-hidden>→</span>
        <span className="sr-only">
          {title ? `, ${title}. ` : ". "}
          {t("actions.goToCart")}
        </span>
      </Link>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      block={block}
      onClick={() => {
        add(bookId, 1, { title, priceCents });
        announceAddedToCart({ title, coverUrl });
      }}
    >
      {t("actions.addToCart")}
      {title ? <span className="sr-only">{`, ${title}`}</span> : null}
    </Button>
  );
}
