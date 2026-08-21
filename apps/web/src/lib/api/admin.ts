import {
  adminLoginRequestSchema,
  adminPreOrderDetailSchema,
  adminPreOrderFulfillmentTransitionSchema,
  adminPreOrderInternalNoteSchema,
  adminPreOrderListSchema,
  adminPreOrderPaymentDecisionSchema,
  adminPreOrderVerificationResultSchema,
  adminPreOrderBookUpsertRequestSchema,
  adminPreOrderBookListSchema,
  adminSessionSchema,
  preOrderBookSchema,
  type AdminLoginRequest,
  type AdminPreOrderBookList,
  type AdminPreOrderBookUpsertRequest,
  type AdminPreOrderDetail,
  type AdminPreOrderFulfillmentTransition,
  type AdminPreOrderList,
  type AdminPreOrderPaymentDecision,
  type AdminPreOrderVerificationResult,
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

/* --------------------------------------------------------------------------
   Pre-order queue.

   Two status calls rather than one, mirroring the two columns behind them —
   verifying a transfer and dispatching a parcel are different jobs, months
   apart. Both return the whole pre-order, so the panel re-renders the newly
   allowed moves from the response: accepting a payment is exactly what
   unlocks the fulfilment buttons, and a client that inferred that for itself
   would need its own copy of the cross-track rule.
   -------------------------------------------------------------------------- */

export function listAdminPreOrders(
  params: {
    paymentStatus?: readonly string[];
    fulfillmentStatus?: readonly string[];
    q?: string;
    page?: number;
  } = {},
): Promise<AdminPreOrderList> {
  const search = new URLSearchParams();
  for (const status of params.paymentStatus ?? []) search.append("paymentStatus", status);
  for (const status of params.fulfillmentStatus ?? []) search.append("fulfillmentStatus", status);
  if (params.q) search.set("q", params.q);
  if (params.page) search.set("page", String(params.page));

  const query = search.toString();
  return adminFetch(`/admin/pre-orders${query ? `?${query}` : ""}`, adminPreOrderListSchema);
}

export function getAdminPreOrder(orderNumber: string): Promise<AdminPreOrderDetail> {
  return adminFetch(
    `/admin/pre-orders/${encodeURIComponent(orderNumber)}`,
    adminPreOrderDetailSchema,
  );
}

export function decideAdminPreOrderPayment(
  orderNumber: string,
  request: AdminPreOrderPaymentDecision,
): Promise<AdminPreOrderDetail> {
  const validated = adminPreOrderPaymentDecisionSchema.parse(request);
  return adminFetch(
    `/admin/pre-orders/${encodeURIComponent(orderNumber)}/payment`,
    adminPreOrderDetailSchema,
    { method: "POST", body: validated },
  );
}

/**
 * Ask the API to check this pre-order's transaction ID against the SMS
 * payment gateway again.
 *
 * No request body: the transaction ID lives on the pre-order, and the
 * endpoint deliberately refuses to take one from the caller.
 */
export function recheckAdminPreOrderPayment(
  orderNumber: string,
): Promise<AdminPreOrderVerificationResult> {
  return adminFetch(
    `/admin/pre-orders/${encodeURIComponent(orderNumber)}/verify-payment`,
    adminPreOrderVerificationResultSchema,
    { method: "POST" },
  );
}

export function transitionAdminPreOrderFulfillment(
  orderNumber: string,
  request: AdminPreOrderFulfillmentTransition,
): Promise<AdminPreOrderDetail> {
  const validated = adminPreOrderFulfillmentTransitionSchema.parse(request);
  return adminFetch(
    `/admin/pre-orders/${encodeURIComponent(orderNumber)}/fulfillment`,
    adminPreOrderDetailSchema,
    { method: "POST", body: validated },
  );
}

export function setAdminPreOrderNote(
  orderNumber: string,
  note: string | null,
): Promise<AdminPreOrderDetail> {
  const validated = adminPreOrderInternalNoteSchema.parse({ note });
  return adminFetch(
    `/admin/pre-orders/${encodeURIComponent(orderNumber)}/note`,
    adminPreOrderDetailSchema,
    { method: "PATCH", body: validated },
  );
}
