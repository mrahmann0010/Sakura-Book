"use client";

import { useState, type ReactNode } from "react";
import { Provider } from "react-redux";

import { makeStore } from "./index";

export function StoreProvider({ children }: { children: ReactNode }) {
  /* No PersistGate: gating here would withhold the server-rendered markup of
     every page until localStorage answered. Instead the store renders
     immediately with the empty cart and rehydrates underneath, and the few
     components that read the cart hold a skeleton until `useCartHydrated`
     turns true. */
  const [{ store }] = useState(makeStore);

  return <Provider store={store}>{children}</Provider>;
}
