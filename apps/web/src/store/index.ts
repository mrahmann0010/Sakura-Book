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
import type { PersistedState } from "redux-persist";

import cartReducer from "./slices/cart-slice";
import { storage } from "./storage";

const rootReducer = combineReducers({
  cart: cartReducer,
});

/* Only the cart is persisted, and only the ids and quantities it holds —
   never prices or resolved books. Money is re-derived from the catalogue on
   every render (see lib/cart.ts), so a price change is picked up rather than
   frozen into a stale localStorage blob. */
/* Version 2 starts every browser from an empty cart, once.

   The cart has always *initialised* empty — nothing seeds it, here or in the
   slice. What filled it without anyone asking was the cart page's staged
   removal: the commit to Redux was on a five-second timer that the unmount
   cleanup cancelled, so a book removed and navigated away from stayed in
   localStorage while the screen said it was gone. Removal is immediate now
   (see cart-view.tsx), but that does not reach a blob already written to a
   reader's browser — the stuck entry is still there, still quoted, still
   orderable, and its owner has no way to know it exists.

   So the version bump: redux-persist discards persisted state whose version
   does not match and falls back to `initialState`, which is the empty cart.
   Every browser starts clean exactly once, and fills its cart only from the
   catalogue afterwards. The cost is a genuinely-intended cart abandoned at
   the moment of deploy, which is a fair trade against carrying a phantom
   line into someone's order. */
const persistedReducer = persistReducer(
  {
    key: "sakura-cart",
    version: 2,
    storage,
    whitelist: ["cart"],
    /* Dropping the stored state *is* the migration. redux-persist keeps the
       old blob otherwise — a version bump on its own only records a number —
       so anything written under an earlier version is discarded here and
       rehydration falls through to the slice's `initialState`. */
    migrate: (state: PersistedState, currentVersion: number) =>
      Promise.resolve(state && state._persist.version === currentVersion ? state : undefined),
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
