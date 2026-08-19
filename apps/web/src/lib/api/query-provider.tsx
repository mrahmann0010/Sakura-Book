"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * One QueryClient per browser tab, created inside `useState` so it survives
 * re-renders but not a fresh mount — the same rule `StoreProvider` follows,
 * and for the same reason: a client created at module scope would be shared
 * across requests on the server.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
