"use client";

import { useCallback, useMemo } from "react";

import { buildCart, type Cart } from "@/lib/cart";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addItem,
  clearCart,
  removeItem,
  selectCartCount,
  selectCartHydrated,
  selectCartItems,
  setQuantity,
} from "@/store/slices/cart-slice";

import { useMounted } from "./use-mounted";

/* --------------------------------------------------------------------------
   useCart — the single seam between the cart state and any page that shows it.

   Redux owns ids and quantities; lib/cart.ts owns the money; this hook is the
   join. The cart page, the checkout page, the header badge and any future cart
   drawer all read from here, which is what keeps them from disagreeing about
   the total.
   -------------------------------------------------------------------------- */

export type UseCart = Cart & {
  /** False through the first paint, while localStorage is still being read. */
  hydrated: boolean;
  add: (bookId: string, quantity?: number) => void;
  remove: (bookId: string) => void;
  setQuantity: (bookId: string, quantity: number) => void;
  clear: () => void;
};

export function useCart(): UseCart {
  const dispatch = useAppDispatch();
  const items = useAppSelector(selectCartItems);
  const rehydrated = useAppSelector(selectCartHydrated);
  /* Both conditions are needed: `mounted` keeps the first client render
     identical to the server's, `rehydrated` waits for localStorage to answer. */
  const mounted = useMounted();
  const hydrated = mounted && rehydrated;

  /* Derivation is pure and cheap, but it allocates: memoising on the entries
     keeps line identity stable so the rows do not remount on every render. */
  const cart = useMemo(() => buildCart(items), [items]);

  return {
    ...cart,
    hydrated,
    add: useCallback(
      (bookId: string, quantity = 1) => dispatch(addItem({ bookId, quantity })),
      [dispatch],
    ),
    remove: useCallback((bookId: string) => dispatch(removeItem({ bookId })), [dispatch]),
    setQuantity: useCallback(
      (bookId: string, quantity: number) => dispatch(setQuantity({ bookId, quantity })),
      [dispatch],
    ),
    clear: useCallback(() => dispatch(clearCart()), [dispatch]),
  };
}

/** Just the badge count, for a header that must not re-render on every price. */
export function useCartCount(): number {
  const rehydrated = useAppSelector(selectCartHydrated);
  const mounted = useMounted();
  const count = useAppSelector(selectCartCount);
  return mounted && rehydrated ? count : 0;
}
