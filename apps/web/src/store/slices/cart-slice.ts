import { createSelector, createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { RootState } from "../index";

/** What the cart owns: ids and quantities. Never prices — see lib/cart.ts. */
export type CartItem = {
  bookId: string;
  quantity: number;
};

export type CartState = {
  items: CartItem[];
};

/** Guardrail on the stepper, and on a hand-edited localStorage blob. */
export const MAX_QUANTITY = 99;

const initialState: CartState = {
  items: [],
};

const clamp = (quantity: number) => Math.min(Math.max(Math.trunc(quantity), 1), MAX_QUANTITY);

const cartSlice = createSlice({
  name: "cart",
  initialState,
  reducers: {
    addItem(state, action: PayloadAction<{ bookId: string; quantity?: number }>) {
      const { bookId, quantity = 1 } = action.payload;
      const existing = state.items.find((item) => item.bookId === bookId);
      if (existing) {
        existing.quantity = clamp(existing.quantity + quantity);
      } else {
        state.items.push({ bookId, quantity: clamp(quantity) });
      }
    },
    removeItem(state, action: PayloadAction<{ bookId: string }>) {
      state.items = state.items.filter((item) => item.bookId !== action.payload.bookId);
    },
    setQuantity(state, action: PayloadAction<{ bookId: string; quantity: number }>) {
      /* Zero means remove: the stepper's floor is 1, but a quantity field or a
         future API sync can legitimately land on 0. */
      if (action.payload.quantity < 1) {
        state.items = state.items.filter((item) => item.bookId !== action.payload.bookId);
        return;
      }

      const item = state.items.find((item) => item.bookId === action.payload.bookId);
      if (item) item.quantity = clamp(action.payload.quantity);
    },
    clearCart(state) {
      state.items = [];
    },
  },
});

export const { addItem, removeItem, setQuantity, clearCart } = cartSlice.actions;

/* --------------------------------------------------------------------------
   Selectors

   Exported from the slice so no component reaches into `state.cart` by hand —
   the shape stays refactorable.
   -------------------------------------------------------------------------- */

export const selectCartItems = (state: RootState) => state.cart.items;

/** Whether the store has read localStorage yet. False through the first paint. */
export const selectCartHydrated = (state: RootState) => state._persist?.rehydrated ?? false;

/** Books in the cart counting quantity — the header badge. Zero until hydrated. */
export const selectCartCount = createSelector([selectCartItems], (items) =>
  items.reduce((count, item) => count + item.quantity, 0),
);

export const selectQuantityOf = (bookId: string) => (state: RootState) =>
  state.cart.items.find((item) => item.bookId === bookId)?.quantity ?? 0;

export default cartSlice.reducer;
