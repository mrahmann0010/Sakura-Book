import createWebStorage from "redux-persist/lib/storage/createWebStorage";

/* --------------------------------------------------------------------------
   Storage engine

   redux-persist reaches for `window.localStorage` at import time, which throws
   during the server render of every page in the app. So the engine is chosen
   once, here: the real one in the browser, a no-op that resolves immediately
   on the server. Rehydration then happens on the client, and any component
   reading the cart waits for it via `useCartHydrated` (see ./hooks.ts).
   -------------------------------------------------------------------------- */

function createNoopStorage() {
  return {
    getItem: async () => null,
    setItem: async (_key: string, value: string) => value,
    removeItem: async () => undefined,
  };
}

export const storage =
  typeof window === "undefined" ? createNoopStorage() : createWebStorage("local");
