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
  adminRestockScheduleSchema,
  adminRecordRefundRequestSchema,
  adminRegionSchema,
  adminSessionSchema,
  adminShippingTermsSchema,
  adminUploadResultSchema,
  adminWaitlistBooksSchema,
  adminWaitlistEntrySchema,
  adminWaitlistListSchema,
  adminWaitlistNotifyRequestSchema,
  adminWaitlistNotifyResultSchema,
  adminWaitlistUpdateRequestSchema,
  dashboardSchema,
  monthlyReportSchema,
  paymentBreakdownSchema,
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
  type AdminWaitlistBook,
  type WaitlistBooksUpdate,
  type AdminRecordRefundRequest,
  type AdminRegion,
  type AdminRegionCreate,
  type AdminRegionUpdate,
  type AdminSession,
  type AdminShippingTerms,
  type AdminUploadResult,
  type AdminWaitlistEntry,
  type AdminWaitlistList,
  type AdminWaitlistNotifyRequest,
  type AdminWaitlistNotifyResult,
  type AdminWaitlistQuery,
  type AdminWaitlistUpdateRequest,
  type Dashboard,
  type MonthlyReport,
  type PaymentBreakdown,
  type PaymentBreakdownQuery,
  type AdminRestockSchedule,
  type PaymentNumbersUpdate,
  type RestockScheduleUpdate,
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

/**
 * Auth routes a 401 retry must not touch: retrying `login` would mask a wrong
 * password as a network hiccup, and retrying `refresh` itself would recurse
 * into the thing that is failing.
 */
const NO_REFRESH_RETRY_PATHS = new Set(["/admin/auth/login", "/admin/auth/refresh"]);

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchange the refresh cookie for a new access/refresh pair, in place.
 *
 * The refresh token rotates on every use and a token presented twice reads
 * to the server as theft — it revokes the whole session family (see
 * `AdminAuthService.refresh`). So concurrent 401s (five admin requests firing
 * on a stale access token at once) must share one refresh call rather than
 * each spending the cookie themselves; the single in-flight promise is what
 * keeps that from happening.
 */
function refreshSession(): Promise<boolean> {
  refreshInFlight ??= fetch(`${apiOrigin()}${API_PREFIX}/admin/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { accept: "application/json" },
    cache: "no-store",
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

async function adminFetch<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  init: { method?: string; body?: unknown } = {},
  retriedAfterRefresh = false,
): Promise<z.infer<T>> {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin()}${API_PREFIX}${path}`, {
      method: init.method ?? "GET",
      credentials: "include",
      headers: {
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch {
    /* `fetch` rejects rather than resolving when the request never completes —
       API down, wrong NEXT_PUBLIC_API_URL, DNS, a dropped connection. That was
       a bare TypeError escaping to every caller, which is not an AdminApiError,
       so every one of them showed its own "something went wrong" fallback for
       the one failure with a completely specific cause. */
    throw new AdminApiError(
      0,
      "Could not reach the API. Check that it is running, then try again.",
      [],
      "NETWORK_ERROR",
    );
  }

  if (!response.ok) {
    /* The access token is a 15-minute JWT by design (AdminAuthService's class
       comment) — a 401 partway through a session is the expected, common
       case, not an error state. The 30-day refresh cookie sitting unused in
       the browser is what this retries with, once, before falling through to
       the same failure handling as any other rejected request. */
    if (response.status === 401 && !retriedAfterRefresh && !NO_REFRESH_RETRY_PATHS.has(path)) {
      const refreshed = await refreshSession();
      if (refreshed) return adminFetch(path, schema, init, true);
    }

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

  /**
   * A 2xx whose body does not match the schema is its own failure, and a
   * dangerous one to report as "it did not work".
   *
   * The write succeeded — the book exists — and only reading the reply back
   * failed. Throwing the raw ZodError sent the caller down its unknown-error
   * path, which says the save failed, so the operator fills the form in again
   * and creates a second copy. The code lets the caller say what is actually
   * true: it probably saved, go and look.
   */
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AdminApiError(
      response.status,
      "The API answered with something that is not JSON.",
      [],
      "RESPONSE_INVALID",
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AdminApiError(
      response.status,
      "The request went through, but the reply was not in the shape this app expects.",
      [],
      "RESPONSE_INVALID",
    );
  }

  return parsed.data;
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
  retriedAfterRefresh = false,
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
    // Same 15-minute-access-token story as `adminFetch` — see its comment.
    if (response.status === 401 && !retriedAfterRefresh) {
      const refreshed = await refreshSession();
      if (refreshed) return adminUpload(path, schema, file, true);
    }

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

/**
 * Proactively rotate the session before the access token expires, rather
 * than waiting for a request to hit a 401 and retry — see `AdminShell`'s
 * background timer. Shares `adminFetch`'s dedup, so this and a concurrent
 * reactive refresh never both spend the cookie.
 */
export function adminRefreshSession(): Promise<boolean> {
  return refreshSession();
}

/* --------------------------------------------------------------------------
   Orders — the fulfilment desk. Pending/Accepted/Rejected are views over the
   same `status[]` filter, not separate endpoints; see admin/orders/page.tsx.
   -------------------------------------------------------------------------- */

/** The filters, as a query string. Shared by the queue and the Pathao export
 *  so the manifest always covers exactly what the screen was showing. */
function orderSearch(query: Partial<AdminOrderQuery>): string {
  const search = new URLSearchParams();
  for (const status of query.status ?? []) search.append("status", status);
  if (query.paymentMethod) search.set("paymentMethod", query.paymentMethod);
  if (query.division) search.set("division", query.division);
  if (query.q) search.set("q", query.q);
  if (query.placedFrom) search.set("placedFrom", query.placedFrom);
  if (query.placedTo) search.set("placedTo", query.placedTo);
  if (query.sort) search.set("sort", query.sort);
  if (query.page) search.set("page", String(query.page));
  if (query.pageSize) search.set("pageSize", String(query.pageSize));

  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function listAdminOrders(query: Partial<AdminOrderQuery> = {}): Promise<AdminOrderList> {
  return adminFetch(`/admin/orders${orderSearch(query)}`, adminOrderListSchema);
}

/**
 * Download the filtered orders as Pathao's bulk-order CSV.
 *
 * `page` and `pageSize` are not in the parameter type at all, rather than
 * being accepted and dropped: the export covers every matching order, and a
 * caller that could hand over the page it was browsing would eventually hand
 * it over — producing a manifest of twenty-five parcels for a hundred-parcel
 * pickup, which is a file that looks right and is short.
 *
 * Fetched as a blob rather than opened as a link, for the reason
 * `downloadAdminWaitlistCsv` gives below: the session is httpOnly cookies, and
 * a plain navigation renders a 401 as an error page in a new tab instead of an
 * error the screen can show.
 */
export async function downloadPathaoOrdersCsv(
  filters: Omit<Partial<AdminOrderQuery>, "page" | "pageSize"> = {},
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `${apiOrigin()}${API_PREFIX}/admin/orders/export.csv${orderSearch(filters)}`,
      {
        credentials: "include",
        cache: "no-store",
        headers: { accept: "text/csv" },
      },
    );
  } catch {
    throw new AdminApiError(
      0,
      "Could not reach the API. Check that it is running.",
      [],
      "NETWORK_ERROR",
    );
  }

  if (!response.ok) {
    throw new AdminApiError(response.status, "Could not export these orders.", [], "EXPORT_FAILED");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `pathao-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();

  // See downloadAdminWaitlistCsv: revoking synchronously gives Safari an
  // empty file.
  setTimeout(() => URL.revokeObjectURL(url), 0);
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
   Payment breakdown.
   -------------------------------------------------------------------------- */

/**
 * Accepted-order revenue for one window, split by component and by platform.
 *
 * The preset windows are named rather than sent as dates the browser worked
 * out: their edges are shop-timezone day boundaries, and a client computing
 * "last 7 days" off its own clock would ask for a window the dashboard does
 * not agree with. `from`/`to` travel only for `custom`, which is the one case
 * where the dates genuinely come from the reader.
 */
export function getAdminPaymentBreakdown(query: PaymentBreakdownQuery): Promise<PaymentBreakdown> {
  const params = new URLSearchParams({ range: query.range });
  if (query.range === "custom" && query.from && query.to) {
    params.set("from", query.from);
    params.set("to", query.to);
  }

  return adminFetch(`/admin/payments?${params.toString()}`, paymentBreakdownSchema);
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
   The reopening date announced on /notify. Shop-wide — see the column comment
   on shopSettings.reopenDate for why it is not per book.
   -------------------------------------------------------------------------- */

export function getAdminRestockSchedule(): Promise<AdminRestockSchedule> {
  return adminFetch("/admin/settings/restock", adminRestockScheduleSchema);
}

/** `reopenDate: null` clears the announcement rather than leaving it alone. */
export function updateAdminRestockSchedule(
  changes: RestockScheduleUpdate,
): Promise<AdminRestockSchedule> {
  return adminFetch("/admin/settings/restock", adminRestockScheduleSchema, {
    method: "PATCH",
    body: changes,
  });
}

/* --------------------------------------------------------------------------
   Which titles the notify page offers to wait on. Read is any signed-in
   admin; the write is ADMIN-only, like every other write under /admin/settings.
   -------------------------------------------------------------------------- */

export function getAdminWaitlistBooks(): Promise<AdminWaitlistBook[]> {
  return adminFetch("/admin/settings/waitlist-books", adminWaitlistBooksSchema);
}

/** Replaces the selection outright — send every chosen id, not a delta. */
export function updateAdminWaitlistBooks(
  changes: WaitlistBooksUpdate,
): Promise<AdminWaitlistBook[]> {
  return adminFetch("/admin/settings/waitlist-books", adminWaitlistBooksSchema, {
    method: "PUT",
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

export function updateAdminRegion(slug: string, changes: AdminRegionUpdate): Promise<AdminRegion> {
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

/* --------------------------------------------------------------------------
   Waitlist. See admin-waitlist.controller.ts.
   -------------------------------------------------------------------------- */

/** The filters, as a query string. Shared by the list and the CSV export so
 *  the file always contains exactly what the screen was showing. */
function waitlistSearch(query: Partial<AdminWaitlistQuery>): string {
  const search = new URLSearchParams();
  for (const status of query.status ?? []) search.append("status", status);
  if (query.q) search.set("q", query.q);
  if (query.source) search.set("source", query.source);
  if (query.locale) search.set("locale", query.locale);
  if (query.signedFrom) search.set("signedFrom", query.signedFrom);
  if (query.signedTo) search.set("signedTo", query.signedTo);
  if (query.sort) search.set("sort", query.sort);
  if (query.page) search.set("page", String(query.page));
  if (query.pageSize) search.set("pageSize", String(query.pageSize));

  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function listAdminWaitlist(
  query: Partial<AdminWaitlistQuery> = {},
): Promise<AdminWaitlistList> {
  return adminFetch(`/admin/waitlist${waitlistSearch(query)}`, adminWaitlistListSchema);
}

export function notifyAdminWaitlist(
  request: AdminWaitlistNotifyRequest,
): Promise<AdminWaitlistNotifyResult> {
  const validated = validate(adminWaitlistNotifyRequestSchema, request);
  return adminFetch("/admin/waitlist/notify", adminWaitlistNotifyResultSchema, {
    method: "POST",
    body: validated,
  });
}

export function updateAdminWaitlistEntry(
  id: string,
  request: AdminWaitlistUpdateRequest,
): Promise<AdminWaitlistEntry> {
  const validated = validate(adminWaitlistUpdateRequestSchema, request);
  return adminFetch(`/admin/waitlist/${encodeURIComponent(id)}`, adminWaitlistEntrySchema, {
    method: "PATCH",
    body: validated,
  });
}

/**
 * Download the filtered waitlist as a CSV.
 *
 * Not `adminFetch`: that parses every response against a Zod schema, and this
 * one is a file. It repeats the credential and error handling rather than
 * generalising the wrapper, because the two differ in what a *successful*
 * response even is — one returns parsed data, this one has to reach the disk.
 *
 * The blob is fetched rather than the URL being opened in a tab, because the
 * session lives in httpOnly cookies that a plain navigation would carry but a
 * 401 from would render as a JSON error page instead of a download. This way
 * a failure is an AdminApiError the page can show inline, and the file only
 * appears when there is really a file.
 */
export async function downloadAdminWaitlistCsv(
  query: Partial<AdminWaitlistQuery> = {},
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `${apiOrigin()}${API_PREFIX}/admin/waitlist/export.csv${waitlistSearch(query)}`,
      { credentials: "include", cache: "no-store", headers: { accept: "text/csv" } },
    );
  } catch {
    throw new AdminApiError(
      0,
      "Could not reach the API. Check that it is running.",
      [],
      "NETWORK_ERROR",
    );
  }

  if (!response.ok) {
    /* A 403 here is the expected one: the export is ADMIN-only while the rest
       of the screen is open to STAFF, so this is the first thing a staff
       member hits. Named rather than generic, so the page can say why. */
    if (response.status === 403) {
      throw new AdminApiError(
        403,
        "Only an ADMIN account can export the waitlist.",
        [],
        "FORBIDDEN",
      );
    }

    throw new AdminApiError(response.status, "Could not export the waitlist.", [], "EXPORT_FAILED");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();

  /* Revoked on the next tick rather than immediately: Safari has not started
     reading the blob when `click()` returns, and revoking synchronously gives
     a silently empty file. */
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export type { AdminBookQuery };
