"use client";

import type { CartItem, CartQuoteRejection } from "@sakura/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { trackAddToCart, trackRemoveFromCart } from "@/lib/analytics";
import { quoteCart } from "@/lib/api/cart";
import { cartFromQuote, emptyCart, type Cart } from "@/lib/cart";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addItem,
  clearCart,
  removeItem,
  selectCartHydrated,
  selectCartItems,
  setQuantity,
} from "@/store/slices/cart-slice";

import { useMounted } from "./use-mounted";

/* --------------------------------------------------------------------------
   useCart — the single seam between the cart state and any page that shows it.

   Redux owns ids and quantities, kept in localStorage; the price and the
   resolved book details are neither — POST /cart/quote is the one place both
   are decided, so this hook is also the seam between the persisted entries
   and the server's answer about what they are actually worth. The cart page,
   the checkout page and the header badge all read from here, which is what
   keeps them from disagreeing about what's in the cart.
   -------------------------------------------------------------------------- */

export type UseCart = Cart & {
  /** False through the first paint, while localStorage is still being read. */
  hydrated: boolean;
  /**
   * The persisted `{ bookId, quantity }` entries, straight from Redux.
   *
   * Exposed because `lines` lags: it is the last quote to come back, and
   * `keepPreviousData` keeps serving the quote for the *previous* cart while
   * a requote is in flight. A caller that needs to know what is in the cart
   * *now* — rather than what the server last said it was worth — reads this,
   * which changes in the same tick as the dispatch.
   */
  entries: CartItem[];
  /** True while a quote is in flight for the current cart contents. */
  quoting: boolean;
  /** Entries the server could not price — delisted, unavailable, out of stock. */
  rejected: CartQuoteRejection[];
  /**
   * `item` is for analytics only and never reaches Redux, which owns ids and
   * quantities and nothing else. A caller that has the book on screen passes
   * its title and price so the GA4 `add_to_cart` event carries them; one that
   * does not simply omits it and the event still counts. See trackAddToCart.
   */
  add: (bookId: string, quantity?: number, item?: { title?: string; priceCents?: number }) => void;
  remove: (bookId: string) => void;
  setQuantity: (bookId: string, quantity: number) => void;
  clear: () => void;
};

export function useCart(region?: string): UseCart {
  const dispatch = useAppDispatch();
  const items = useAppSelector(selectCartItems);
  const rehydrated = useAppSelector(selectCartHydrated);
  /* Both conditions are needed: `mounted` keeps the first client render
     identical to the server's, `rehydrated` waits for localStorage to answer. */
  const mounted = useMounted();
  const hydrated = mounted && rehydrated;

  /* Keyed on the entries themselves — React Query compares query keys
     structurally, so a quantity edit or a different set of ids naturally
     requotes, while an unrelated re-render does not. Every page reading the
     cart uses this same key, so they share one in-flight request instead of
     each firing their own. `region` joins the key on checkout, once the
     customer's division has resolved one, so the recap's delivery line prices
     against the same zone the order will actually be charged. */
  const { data: quote, isLoading } = useQuery({
    queryKey: ["cart-quote", items, region],
    queryFn: () => quoteCart(items, { region }),
    enabled: hydrated && items.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  /* `items.length === 0` short-circuits straight to `emptyCart` rather than
     trusting `quote`: with no entries left the query is disabled, and
     `keepPreviousData` would otherwise keep handing back the last quote that
     *did* have something in it — the one book that was just removed staying
     on screen forever because nothing ever arrives to replace it. */
  const cart = useMemo(
    () => (items.length === 0 ? emptyCart : quote ? cartFromQuote(quote) : emptyCart),
    [items.length, quote],
  );

  return {
    ...cart,
    hydrated,
    entries: items,
    quoting: hydrated && items.length > 0 && isLoading,
    rejected: quote?.rejected ?? [],
    /* The analytics calls live here rather than in the buttons because this is
       the only seam every cart mutation passes through — a future control that
       adds a book gets tracked by existing, instead of by remembering to. */
    add: useCallback(
      (bookId: string, quantity = 1, item?: { title?: string; priceCents?: number }) => {
        dispatch(addItem({ bookId, quantity }));
        trackAddToCart({ id: bookId, quantity, ...item });
      },
      [dispatch],
    ),
    remove: useCallback(
      (bookId: string) => {
        /* Read before the dispatch: afterwards the line is gone from the quote
           and there is nothing left to describe what was removed. */
        const line = cart.lines.find((candidate) => candidate.book.id === bookId);
        dispatch(removeItem({ bookId }));
        if (line) trackRemoveFromCart(line);
      },
      [cart.lines, dispatch],
    ),
    setQuantity: useCallback(
      (bookId: string, quantity: number) => {
        /* The stepper's floor is 1, but a quantity of 0 removes — and a removal
           is a removal however it was spelled, so it reports as one. */
        const line = cart.lines.find((candidate) => candidate.book.id === bookId);
        dispatch(setQuantity({ bookId, quantity }));
        if (quantity < 1 && line) trackRemoveFromCart(line);
      },
      [cart.lines, dispatch],
    ),
    clear: useCallback(() => dispatch(clearCart()), [dispatch]),
  };
}

/** Just the badge count, for a header that must not re-render on every price. */
export function useCartCount(): number {
  const items = useAppSelector(selectCartItems);
  const rehydrated = useAppSelector(selectCartHydrated);
  const mounted = useMounted();
  const hydrated = mounted && rehydrated;

  const { data: quote } = useQuery({
    queryKey: ["cart-quote", items],
    queryFn: () => quoteCart(items),
    enabled: hydrated && items.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  if (!hydrated || items.length === 0) return 0;
  return quote?.itemCount ?? 0;
}
