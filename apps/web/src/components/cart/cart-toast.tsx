"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { BookCover } from "@/components/domain";

/* --------------------------------------------------------------------------
   "Added to cart · View cart" — the confirmation an Add to cart press gets.

   The nav badge bumps as well, but on a phone that badge is a dot, and a
   shopper who sees nothing happen presses again. So the press announces
   itself here, for four seconds, naming the book (cover + title) so the
   shopper can see *which* one went in, with the way to the cart in the same
   line.

   An event on `window` rather than Redux or context: the toast is momentary
   UI with exactly one producer and one consumer, and nothing about it should
   be persisted, replayed or read anywhere else.
   -------------------------------------------------------------------------- */

const ADDED_EVENT = "sakura:cart-added";
const VISIBLE_MS = 4000;

type AddedBook = { title?: string; coverUrl?: string };

/** Called by AddToCartButton after the dispatch. */
export function announceAddedToCart(book: AddedBook) {
  window.dispatchEvent(new CustomEvent<AddedBook>(ADDED_EVENT, { detail: book }));
}

/**
 * Mounted once, by AppNav, so it exists on every storefront page and nowhere
 * else. Sits just under the floating nav: right-aligned under the Cart link
 * on tablet and up, centred on a phone (where Cart is the last item of a
 * centred pill). Either way it is clear of the docked bars — the book page's
 * buy bar, the cart's total bar — that own the bottom edge on a phone.
 */
export function CartToastHost({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  /* `n` counts presses, so a second add inside the window restarts the timer
     (and replays the entrance) instead of being swallowed by the first one's.
     `path` is the page it was shown on: leaving that page — by the toast's own
     link or any other — ends it without waiting for the timer. The newest
     book replaces the last; there is never a stack. */
  const [shown, setShown] = useState<(AddedBook & { n: number; path: string }) | null>(null);

  useEffect(() => {
    const show = (event: Event) => {
      const book = (event as CustomEvent<AddedBook>).detail ?? {};
      setShown((prev) => ({ ...book, n: (prev?.n ?? 0) + 1, path: window.location.pathname }));
    };
    window.addEventListener(ADDED_EVENT, show);
    return () => window.removeEventListener(ADDED_EVENT, show);
  }, []);

  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setShown(null), VISIBLE_MS);
    return () => clearTimeout(id);
  }, [shown]);

  const visible = shown !== null && shown.path === pathname;

  return (
    /* The live region stays mounted and only its content changes: a region
       inserted together with its text is not reliably announced. The inner
       column repeats the floating nav's own gutters and max width, so the
       right-aligned toast lines up under the Cart link rather than the
       viewport edge. */
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-19 z-40 sm:top-22"
    >
      <div className="max-w-shell lg:px-page-tablet mx-auto flex justify-center px-3 sm:justify-end sm:px-5">
        {visible ? (
          <div
            /* `key` replays the entrance when a second book replaces the
               first. Small on purpose: 300px on a phone, 320 above it, one
               56px row — a receipt, not a panel. */
            key={shown.n}
            className="bg-ink text-page rounded-notice animate-toast-in pointer-events-auto flex w-[300px] max-w-full items-center gap-3 py-2 pr-4 pl-2 shadow-lg sm:w-80"
          >
            {shown.coverUrl ? (
              <BookCover
                src={shown.coverUrl}
                title={shown.title ?? ""}
                radius="md"
                sizes="28px"
                className="h-10 w-7 shrink-0 object-cover"
              />
            ) : null}
            <div className={shown.coverUrl ? "min-w-0 flex-1" : "min-w-0 flex-1 pl-2"}>
              {shown.title ? <p className="text-13 truncate font-medium">{shown.title}</p> : null}
              <p className="text-12 text-page/75 mt-0.5">
                {t("cart.toast.added")}
                <span aria-hidden> · </span>
                <Link
                  href={`/${locale}/cart`}
                  /* The visible link is one short line; the `after` box grows
                     its hit area toward the 44px touch minimum without
                     growing the toast. */
                  className="text-page relative font-semibold whitespace-nowrap underline underline-offset-4 after:absolute after:-inset-x-2 after:-inset-y-3.5"
                >
                  {t("cart.toast.view")}
                  <span aria-hidden> →</span>
                </Link>
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
