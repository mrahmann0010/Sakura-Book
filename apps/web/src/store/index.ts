import { combineReducers, configureStore } from "@reduxjs/toolkit";

import cartReducer from "./slices/cart-slice";

const rootReducer = combineReducers({
  cart: cartReducer,
});

export function makeStore() {
  return configureStore({
    reducer: rootReducer,
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = AppStore["dispatch"];
