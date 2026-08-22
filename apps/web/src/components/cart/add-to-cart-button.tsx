"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui";
import { useCart } from "@/hooks/use-cart";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";
import { button } from "@/lib/variants";
import { useAppSelector } from "@/store/hooks";
import { selectQuantityOf } from "@/store/slices/cart-slice";

/**
 * The one control that puts a book in the cart, so the cart and checkout pages
 * have something to work on.
 *
 * Once the book is in, the button becomes a link to the cart page — quantity
 * and removal are edited there, not scattered across every card in the
 * catalogue.
 */
export function AddToCartButton({
  bookId,
  title,
  soldOut = false,
  comingSoon = false,
  size = "sm",
  variant,
  block = false,
}: {
  bookId: string;
  /**
   * The book's title, spoken but not shown. A catalog grid renders one of
   * these per cell, and without it a screen reader hears the same handful of
   * words a dozen times with nothing to tell the buttons apart.
   */
  title?: string;
  soldOut?: boolean;
  /** Not yet released — same disabled shape as `soldOut`, different words. */
  comingSoon?: boolean;
  size?: "sm" | "md";
  /**
   * Defaults to the page-primary clay. The catalog passes `secondary`: a grid
   * of primaries spends the accent a dozen times over, against §2.
   */
  variant?: "primary" | "secondary";
  /** Full-width — the detail page's buy card, where the button is the card's
      one job and should read as wide as the price line above it. */
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
      <Link
        href={`/${locale ?? "en"}/cart`}
        className={cn(button({ variant: variant ?? "secondary", size, block }), "group")}
      >
        <span className="group-hover:hidden">{t("actions.inCart", { count: quantity })}</span>
        <span className="hidden group-hover:inline">{t("actions.goToCart")}</span>
        {title ? <span className="sr-only">{`, ${title}`}</span> : null}
      </Link>
    );
  }

  return (
    <Button
      variant={variant ?? "primary"}
      size={size}
      block={block}
      onClick={() => add(bookId)}
    >
      {t("actions.addToCart")}
      {title ? <span className="sr-only">{`, ${title}`}</span> : null}
    </Button>
  );
}
