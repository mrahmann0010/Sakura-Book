import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type CartItem = {
  bookId: string;
  quantity: number;
};

export type CartState = {
  items: CartItem[];
};

const initialState: CartState = {
  items: [],
};

const cartSlice = createSlice({
  name: "cart",
  initialState,
  reducers: {
    addItem(state, action: PayloadAction<{ bookId: string; quantity?: number }>) {
      const { bookId, quantity = 1 } = action.payload;
      const existing = state.items.find((item) => item.bookId === bookId);
      if (existing) {
        existing.quantity += quantity;
      } else {
        state.items.push({ bookId, quantity });
      }
    },
    removeItem(state, action: PayloadAction<{ bookId: string }>) {
      state.items = state.items.filter(
        (item) => item.bookId !== action.payload.bookId,
      );
    },
    setQuantity(state, action: PayloadAction<{ bookId: string; quantity: number }>) {
      const item = state.items.find((item) => item.bookId === action.payload.bookId);
      if (item) item.quantity = action.payload.quantity;
    },
    clearCart(state) {
      state.items = [];
    },
  },
});

export const { addItem, removeItem, setQuantity, clearCart } = cartSlice.actions;
export default cartSlice.reducer;
