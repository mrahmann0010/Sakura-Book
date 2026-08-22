import {
  adminBookCreateRequestSchema,
  adminBookDetailSchema,
  adminBookListSchema,
  adminBookUpdateRequestSchema,
  adminConfirmPaymentRequestSchema,
  adminInternalNoteRequestSchema,
  adminLoginRequestSchema,
  adminOrderDetailSchema,
  adminOrderListSchema,
  adminOrderTransitionRequestSchema,
  adminOrderVerifyPaymentResultSchema,
  adminRecordRefundRequestSchema,
  adminSessionSchema,
  adminUploadResultSchema,
  dashboardSchema,
  monthlyReportSchema,
  type AdminBookCreateRequest,
  type AdminBookDetail,
  type AdminBookList,
  type AdminBookQuery,
  type AdminBookUpdateRequest,
  type AdminConfirmPaymentRequest,
  type AdminInternalNoteRequest,
  type AdminLoginRequest,
  type AdminOrderDetail,
  type AdminOrderList,
  type AdminOrderQuery,
  type AdminOrderTransitionRequest,
  type AdminOrderVerifyPaymentResult,
  type AdminRecordRefundRequest,
  type AdminSession,
  type AdminUploadResult,
  type Dashboard,
  type MonthlyReport,
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

/**
 * A `FormData` sibling to `adminFetch`, for the two upload routes. Everything
 * else — cookies, no caching, the error envelope — is identical; the only
 * difference is that a file body must not carry a JSON `content-type`, which
 * `fetch` sets correctly on its own once given a `FormData`.
 */
async function adminUpload<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  file: File,
): Promise<z.infer<T>> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch(`${apiOrigin()}${API_PREFIX}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { accept: "application/json" },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `Upload failed with ${response.status}`;
    try {
      const payload: unknown = await response.json();
      if (isErrorResponse(payload)) message = (payload as ErrorResponse).error.message;
    } catch {
      // best-effort — fall back to the generic message above
    }
    throw new AdminApiError(response.status, message);
  }

  return schema.parse(await response.json());
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

/* --------------------------------------------------------------------------
   Orders — the fulfilment desk. Pending/Accepted/Rejected are views over the
   same `status[]` filter, not separate endpoints; see admin/orders/page.tsx.
   -------------------------------------------------------------------------- */

export function listAdminOrders(query: Partial<AdminOrderQuery> = {}): Promise<AdminOrderList> {
  const search = new URLSearchParams();
  for (const status of query.status ?? []) search.append("status", status);
  if (query.paymentMethod) search.set("paymentMethod", query.paymentMethod);
  if (query.q) search.set("q", query.q);
  if (query.placedFrom) search.set("placedFrom", query.placedFrom);
  if (query.placedTo) search.set("placedTo", query.placedTo);
  if (query.sort) search.set("sort", query.sort);
  if (query.page) search.set("page", String(query.page));
  if (query.pageSize) search.set("pageSize", String(query.pageSize));

  const qs = search.toString();
  return adminFetch(`/admin/orders${qs ? `?${qs}` : ""}`, adminOrderListSchema);
}

export function getAdminOrder(orderNumber: string): Promise<AdminOrderDetail> {
  return adminFetch(`/admin/orders/${encodeURIComponent(orderNumber)}`, adminOrderDetailSchema);
}

export function verifyAdminOrderPayment(orderNumber: string): Promise<AdminOrderVerifyPaymentResult> {
  return adminFetch(
    `/admin/orders/${encodeURIComponent(orderNumber)}/verify-payment`,
    adminOrderVerifyPaymentResultSchema,
    { method: "POST" },
  );
}

export function transitionAdminOrder(
  orderNumber: string,
  request: AdminOrderTransitionRequest,
): Promise<AdminOrderDetail> {
  const validated = adminOrderTransitionRequestSchema.parse(request);
  return adminFetch(`/admin/orders/${encodeURIComponent(orderNumber)}/transition`, adminOrderDetailSchema, {
    method: "POST",
    body: validated,
  });
}

export function confirmAdminOrderPayment(
  orderNumber: string,
  request: AdminConfirmPaymentRequest,
): Promise<AdminOrderDetail> {
  const validated = adminConfirmPaymentRequestSchema.parse(request);
  return adminFetch(
    `/admin/orders/${encodeURIComponent(orderNumber)}/payments/confirm`,
    adminOrderDetailSchema,
    { method: "POST", body: validated },
  );
}

export function recordAdminOrderRefund(
  orderNumber: string,
  request: AdminRecordRefundRequest,
): Promise<AdminOrderDetail> {
  const validated = adminRecordRefundRequestSchema.parse(request);
  return adminFetch(`/admin/orders/${encodeURIComponent(orderNumber)}/refund`, adminOrderDetailSchema, {
    method: "POST",
    body: validated,
  });
}

export function setAdminOrderNote(
  orderNumber: string,
  request: AdminInternalNoteRequest,
): Promise<AdminOrderDetail> {
  const validated = adminInternalNoteRequestSchema.parse(request);
  return adminFetch(`/admin/orders/${encodeURIComponent(orderNumber)}/note`, adminOrderDetailSchema, {
    method: "PATCH",
    body: validated,
  });
}

/* --------------------------------------------------------------------------
   Dashboard.
   -------------------------------------------------------------------------- */

export function getAdminDashboard(): Promise<Dashboard> {
  return adminFetch("/admin/dashboard", dashboardSchema);
}

/** Daily orders/revenue for one calendar month — the trend chart's drill-down. */
export function getAdminMonthlyReport(month: string): Promise<MonthlyReport> {
  return adminFetch(
    `/admin/dashboard/report?month=${encodeURIComponent(month)}`,
    monthlyReportSchema,
  );
}

/* --------------------------------------------------------------------------
   Books.
   -------------------------------------------------------------------------- */

export function listAdminBooks(
  params: { q?: string; page?: number; isActive?: boolean } = {},
): Promise<AdminBookList> {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.page) search.set("page", String(params.page));
  if (params.isActive !== undefined) search.set("isActive", String(params.isActive));

  const query = search.toString();
  return adminFetch(`/admin/books${query ? `?${query}` : ""}`, adminBookListSchema);
}

export function getAdminBook(id: string): Promise<AdminBookDetail> {
  return adminFetch(`/admin/books/${encodeURIComponent(id)}`, adminBookDetailSchema);
}

export function createAdminBook(request: AdminBookCreateRequest): Promise<AdminBookDetail> {
  const validated = adminBookCreateRequestSchema.parse(request);
  return adminFetch("/admin/books", adminBookDetailSchema, { method: "POST", body: validated });
}

export function updateAdminBook(
  id: string,
  request: AdminBookUpdateRequest,
): Promise<AdminBookDetail> {
  const validated = adminBookUpdateRequestSchema.parse(request);
  return adminFetch(`/admin/books/${encodeURIComponent(id)}`, adminBookDetailSchema, {
    method: "PATCH",
    body: validated,
  });
}

/* --------------------------------------------------------------------------
   Uploads. See admin-uploads.controller.ts — both return a public URL to put
   straight into the book form's coverImageUrl/pdfUrl fields.
   -------------------------------------------------------------------------- */

export function uploadAdminCover(file: File): Promise<AdminUploadResult> {
  return adminUpload("/admin/uploads/cover", adminUploadResultSchema, file);
}

export function uploadAdminPdf(file: File): Promise<AdminUploadResult> {
  return adminUpload("/admin/uploads/pdf", adminUploadResultSchema, file);
}

export type { AdminBookQuery };
