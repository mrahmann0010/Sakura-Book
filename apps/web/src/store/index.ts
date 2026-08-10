import { combineReducers, configureStore } from "@reduxjs/toolkit";
import {
  FLUSH,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
  REHYDRATE,
  persistReducer,
  persistStore,
} from "redux-persist";

import cartReducer from "./slices/cart-slice";
import { storage } from "./storage";

const rootReducer = combineReducers({
  cart: cartReducer,
});

/* Only the cart is persisted, and only the ids and quantities it holds —
   never prices or resolved books. Money is re-derived from the catalogue on
   every render (see lib/cart.ts), so a price change is picked up rather than
   frozen into a stale localStorage blob. */
const persistedReducer = persistReducer(
  {
    key: "sakura-cart",
    version: 1,
    storage,
    whitelist: ["cart"],
  },
  rootReducer,
);

export function makeStore() {
  const store = configureStore({
    reducer: persistedReducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        /* redux-persist dispatches non-serialisable callbacks in its own
           lifecycle actions. Ignoring exactly those keeps the check on for
           everything the app dispatches. */
        serializableCheck: {
          ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
        },
      }),
  });

  return { store, persistor: persistStore(store) };
}

export type AppStore = ReturnType<typeof makeStore>["store"];

/** `_persist` is injected by persistReducer — components read it to know
    whether the cart on screen is the stored one yet. */
export type RootState = ReturnType<typeof rootReducer> & {
  _persist?: { version: number; rehydrated: boolean };
};
export type AppDispatch = AppStore["dispatch"];
