"use client";

import type { AdminRole } from "@sakura/contracts";
import { createContext, useContext } from "react";

/**
 * The signed-in account's role, for screens that draw fewer controls for a
 * packer.
 *
 * Provided by AdminShell from `useAdminGate`. Null until known — the first
 * paint in a browser that has never recorded one — and screens should read
 * null as "show the full screen", since the API is what actually refuses.
 * Hiding a control here is courtesy, never enforcement.
 */
export const AdminRoleContext = createContext<AdminRole | null>(null);

export function useAdminRole(): AdminRole | null {
  return useContext(AdminRoleContext);
}
