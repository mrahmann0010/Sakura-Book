import {
  adminLoginRequestSchema,
  adminPreOrderBookUpsertRequestSchema,
  adminPreOrderBookListSchema,
  adminSessionSchema,
  preOrderBookSchema,
  type AdminLoginRequest,
  type AdminPreOrderBookList,
  type AdminPreOrderBookUpsertRequest,
  type AdminSession,
  type PreOrderBook,
} from "@sakura/contracts";
import { z } from "zod";

import { isErrorResponse, type ErrorResponse } from "@sakura/contracts";

/* --------------------------------------------------------------------------
   Admin API calls — separate from lib/api/client.ts's apiFetch.

   apiFetch is built for the storefront: no credentials, Next's data cache.
   Every admin call here carries `credentials: "include"` instead, because the
   admin session travels as the httpOnly cookies AdminAuthController sets
   (§3.13) — there is no bearer token this client ever holds, so there is
   nothing to attach except "send cookies". Never cached, for the same reason
   the admin order queue is never cached: a stale admin read is actively
   wrong, not just late.
   -------------------------------------------------------------------------- */

const API_PREFIX = "/api/v1";

function apiOrigin(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) throw new Error("NEXT_PUBLIC_API_URL is not set.");
  return url.replace(/\/+$/, "");
}

export class AdminApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

async function adminFetch<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  init: { method?: string; body?: unknown } = {},
): Promise<z.infer<T>> {
  const response = await fetch(`${apiOrigin()}${API_PREFIX}${path}`, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const payload: unknown = await response.json();
      if (isErrorResponse(payload)) message = (payload as ErrorResponse).error.message;
    } catch {
      // best-effort — fall back to the generic message above
    }
    throw new AdminApiError(response.status, message);
  }

  if (response.status === 204) return schema.parse(undefined);

  const payload: unknown = await response.json();
  return schema.parse(payload);
}

export function adminLogin(request: AdminLoginRequest): Promise<AdminSession> {
  const validated = adminLoginRequestSchema.parse(request);
  return adminFetch("/admin/auth/login", adminSessionSchema, { method: "POST", body: validated });
}

export function adminMe(): Promise<AdminSession> {
  return adminFetch("/admin/auth/me", adminSessionSchema);
}

export function adminLogout(): Promise<void> {
  return adminFetch("/admin/auth/logout", z.void());
}

export function listAdminPreOrderBooks(): Promise<AdminPreOrderBookList> {
  return adminFetch("/admin/pre-order-books", adminPreOrderBookListSchema);
}

export function createAdminPreOrderBook(
  request: AdminPreOrderBookUpsertRequest,
): Promise<PreOrderBook> {
  const validated = adminPreOrderBookUpsertRequestSchema.parse(request);
  return adminFetch("/admin/pre-order-books", preOrderBookSchema, {
    method: "POST",
    body: validated,
  });
}

export function updateAdminPreOrderBook(
  id: string,
  request: AdminPreOrderBookUpsertRequest,
): Promise<PreOrderBook> {
  const validated = adminPreOrderBookUpsertRequestSchema.parse(request);
  return adminFetch(`/admin/pre-order-books/${encodeURIComponent(id)}`, preOrderBookSchema, {
    method: "PUT",
    body: validated,
  });
}
