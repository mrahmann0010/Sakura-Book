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
  adminPaymentNumbersSchema,
  adminRecordRefundRequestSchema,
  adminRegionSchema,
  adminSessionSchema,
  adminShippingTermsSchema,
  adminUploadResultSchema,
  dashboardSchema,
  monthlyReportSchema,
  type AdminBookCreateInput,
  type AdminBookDetail,
  type AdminBookList,
  type AdminBookQuery,
  type AdminBookUpdateInput,
  type AdminConfirmPaymentRequest,
  type AdminInternalNoteRequest,
  type AdminLoginRequest,
  type AdminOrderDetail,
  type AdminOrderList,
  type AdminOrderQuery,
  type AdminOrderTransitionRequest,
  type AdminOrderVerifyPaymentResult,
  type AdminPaymentNumbers,
  type AdminRecordRefundRequest,
  type AdminRegion,
  type AdminRegionCreate,
  type AdminRegionUpdate,
  type AdminSession,
  type AdminShippingTerms,
  type AdminUploadResult,
  type Dashboard,
  type MonthlyReport,
  type PaymentNumbersUpdate,
  type ShippingTermsUpdate,
} from "@sakura/contracts";
import { z } from "zod";

import { isErrorResponse, type ErrorResponse, type FieldError } from "@sakura/contracts";

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

  /**
   * The envelope's `error.code` — "STORAGE_NOT_CONFIGURED", "CONFLICT",
   * "SESSION_EXPIRED". Kept so a caller can branch on *which* failure this is
   * without matching on the prose, which is written to be read and therefore
   * free to change. Empty string when the body was not our envelope at all (a
   * proxy's HTML 502, say).
   */
  readonly code: string;

  /**
   * Which fields the server (or the local pre-flight parse) objected to.
   *
   * Empty for the errors that are about the request as a whole — a 401, a
   * conflict, an unreachable API. Non-empty is what lets a form put the
   * message under the offending input instead of showing one line that says
   * only that something, somewhere, was wrong.
   *
   * The envelope has carried `fields[]` since errors.ts was written and this
   * class used to drop it on the floor, which is why a failed save could
   * report "Could not save this book." and nothing else.
   */
  readonly fields: FieldError[];

  constructor(status: number, message: string, fields: FieldError[] = [], code = "") {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.fields = fields;
    this.code = code;
  }
}

/**
 * Validate a request body before sending it, failing the way the server does.
 *
 * The pre-flight parse is worth keeping — it catches a bad price without a
 * round trip — but a raw `ZodError` is not an `AdminApiError`, so every caller
 * that checked `instanceof AdminApiError` fell through to its own generic
 * fallback and threw away the one thing the error knew: which field. Both
 * paths now raise the same type with the same `fields`, so a form needs one
 * branch rather than two.
 *
 * 422 rather than 400: the body was well-formed JSON that failed validation,
 * which is what the status means, and it keeps this distinguishable from a
 * transport failure if anything ever switches on the code.
 */
function validate<T extends z.ZodTypeAny>(schema: T, request: unknown): z.infer<T> {
  const result = schema.safeParse(request);
  if (result.success) return result.data;

  throw new AdminApiError(
    422,
    "Some details need fixing before this can be saved.",
    result.error.issues.map((issue) => ({
      /* Dotted and array-indexed, matching the server's own `path` format
         (see toFieldError in global-exception.filter.ts) so a caller can key
         off one shape whichever side rejected the request. */
      path: issue.path.join("."),
      code: issue.code,
      message: issue.message,
    })),
    "VALIDATION_FAILED",
  );
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
    let fields: FieldError[] = [];
    let code = "";
    try {
      const payload: unknown = await response.json();
      if (isErrorResponse(payload)) {
        message = (payload as ErrorResponse).error.message;
        fields = (payload as ErrorResponse).error.fields ?? [];
        code = (payload as ErrorResponse).error.code;
      }
    } catch {
      // best-effort — fall back to the generic message above
    }
    throw new AdminApiError(response.status, message, fields, code);
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
    let fields: FieldError[] = [];
    let code = "";
    try {
      const payload: unknown = await response.json();
      if (isErrorResponse(payload)) {
        message = (payload as ErrorResponse).error.message;
        fields = (payload as ErrorResponse).error.fields ?? [];
        code = (payload as ErrorResponse).error.code;
      }
    } catch {
      // best-effort — fall back to the generic message above
    }
    throw new AdminApiError(response.status, message, fields, code);
  }

  return schema.parse(await response.json());
}

export function adminLogin(request: AdminLoginRequest): Promise<AdminSession> {
  const validated = validate(adminLoginRequestSchema, request);
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

export function verifyAdminOrderPayment(
  orderNumber: string,
): Promise<AdminOrderVerifyPaymentResult> {
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
  const validated = validate(adminOrderTransitionRequestSchema, request);
  return adminFetch(
    `/admin/orders/${encodeURIComponent(orderNumber)}/transition`,
    adminOrderDetailSchema,
    {
      method: "POST",
      body: validated,
    },
  );
}

export function confirmAdminOrderPayment(
  orderNumber: string,
  request: AdminConfirmPaymentRequest,
): Promise<AdminOrderDetail> {
  const validated = validate(adminConfirmPaymentRequestSchema, request);
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
  const validated = validate(adminRecordRefundRequestSchema, request);
  return adminFetch(
    `/admin/orders/${encodeURIComponent(orderNumber)}/refund`,
    adminOrderDetailSchema,
    {
      method: "POST",
      body: validated,
    },
  );
}

export function setAdminOrderNote(
  orderNumber: string,
  request: AdminInternalNoteRequest,
): Promise<AdminOrderDetail> {
  const validated = validate(adminInternalNoteRequestSchema, request);
  return adminFetch(
    `/admin/orders/${encodeURIComponent(orderNumber)}/note`,
    adminOrderDetailSchema,
    {
      method: "PATCH",
      body: validated,
    },
  );
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
   Payment settings.
   -------------------------------------------------------------------------- */

export function getAdminPaymentNumbers(): Promise<AdminPaymentNumbers> {
  return adminFetch("/admin/settings/payments", adminPaymentNumbersSchema);
}

export function updateAdminPaymentNumbers(
  changes: PaymentNumbersUpdate,
): Promise<AdminPaymentNumbers> {
  return adminFetch("/admin/settings/payments", adminPaymentNumbersSchema, {
    method: "PATCH",
    body: changes,
  });
}

/* --------------------------------------------------------------------------
   Shipping settings — the flat rate, the free-delivery threshold, the
   division the shop currently ships from, and the per-region rate overrides
   that price relative to it (see originDivision on ShippingTerms).
   -------------------------------------------------------------------------- */

export function getAdminShippingTerms(): Promise<AdminShippingTerms> {
  return adminFetch("/admin/settings/shipping", adminShippingTermsSchema);
}

export function updateAdminShippingTerms(
  changes: ShippingTermsUpdate,
): Promise<AdminShippingTerms> {
  return adminFetch("/admin/settings/shipping", adminShippingTermsSchema, {
    method: "PATCH",
    body: changes,
  });
}

export function listAdminRegions(): Promise<AdminRegion[]> {
  return adminFetch("/admin/settings/regions", z.array(adminRegionSchema));
}

export function createAdminRegion(input: AdminRegionCreate): Promise<AdminRegion> {
  return adminFetch("/admin/settings/regions", adminRegionSchema, { method: "POST", body: input });
}

export function updateAdminRegion(
  slug: string,
  changes: AdminRegionUpdate,
): Promise<AdminRegion> {
  return adminFetch(`/admin/settings/regions/${encodeURIComponent(slug)}`, adminRegionSchema, {
    method: "PATCH",
    body: changes,
  });
}

export function deactivateAdminRegion(slug: string): Promise<AdminRegion> {
  return adminFetch(`/admin/settings/regions/${encodeURIComponent(slug)}`, adminRegionSchema, {
    method: "DELETE",
  });
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

export function createAdminBook(request: AdminBookCreateInput): Promise<AdminBookDetail> {
  const validated = validate(adminBookCreateRequestSchema, request);
  return adminFetch("/admin/books", adminBookDetailSchema, { method: "POST", body: validated });
}

export function updateAdminBook(
  id: string,
  request: AdminBookUpdateInput,
): Promise<AdminBookDetail> {
  const validated = validate(adminBookUpdateRequestSchema, request);
  return adminFetch(`/admin/books/${encodeURIComponent(id)}`, adminBookDetailSchema, {
    method: "PATCH",
    body: validated,
  });
}

/** Refused with a 409 `AdminApiError` if the book has any order history. */
export function deleteAdminBook(id: string): Promise<void> {
  return adminFetch(`/admin/books/${encodeURIComponent(id)}`, z.void(), { method: "DELETE" });
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
