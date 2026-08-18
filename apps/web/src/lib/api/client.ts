import { isErrorResponse, type ErrorBody, type ErrorResponse } from "@sakura/contracts";
import type { z } from "zod";

/* --------------------------------------------------------------------------
   The one place this app talks to @sakura/api.

   Two rules hold everywhere below. First, every response is *parsed* against
   the contract schema rather than cast to its type: a `Promise<BookList>` from
   a bare `fetch` is a claim nobody checked, and the failure mode is a
   `.toFixed` on undefined three components deep, at render time, in a server
   component, with a stack that points at the card. Parsing moves that to the
   fetch, with the field path in the message.

   Second, a non-2xx body is not assumed to be JSON, let alone the error
   envelope. A CDN timeout or a 502 from in front of the API returns HTML, and
   `isErrorResponse` is what keeps that from being read as `{ error: { code } }`.
   -------------------------------------------------------------------------- */

/**
 * Base URL of the API, without a trailing slash or the `/api/v1` prefix —
 * `withVersion` owns that, because the version segment is the API's shape and
 * not something an env var should be able to get wrong.
 *
 * Read through a function rather than a module constant so a missing value
 * fails on the first request with a clear message, instead of producing
 * `fetch("undefined/api/v1/books")` at import time in a build log.
 */
function apiOrigin(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;

  if (!url) {
    throw new Error("NEXT_PUBLIC_API_URL is not set — the web app has no API to talk to.");
  }

  return url.replace(/\/+$/, "");
}

/** Matches `setGlobalPrefix("api")` + URI versioning at v1 in apps/api/src/main.ts. */
const API_PREFIX = "/api/v1";

/**
 * A failed request, carrying the parsed envelope when there was one.
 *
 * `body` is nullable rather than a synthesised placeholder: callers branch on
 * `code` (`NOT_FOUND` → notFound(), `OUT_OF_STOCK` → a message), and inventing
 * a code for a gateway's HTML would let one of those branches fire on
 * something the API never said.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody | null;
  readonly requestId: string | null;

  constructor(status: number, envelope: ErrorResponse | null, message?: string) {
    super(message ?? envelope?.error.message ?? `API request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = envelope?.error ?? null;
    this.requestId = envelope?.requestId ?? null;
  }

  /** The code a caller is allowed to branch on, or null when the API did not speak. */
  get code(): string | null {
    return this.body?.code ?? null;
  }

  get isNotFound(): boolean {
    return this.status === 404 || this.code === "NOT_FOUND";
  }
}

/** Thrown when the API answered 2xx with a body the contract does not describe. */
export class ApiContractError extends Error {
  constructor(path: string, issues: z.ZodError) {
    const summary = issues.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");

    super(`Response from ${path} did not match the contract — ${summary}`);
    this.name = "ApiContractError";
  }
}

/**
 * Query values, in the shapes the callers actually hold.
 *
 * `undefined` and empty arrays are dropped rather than serialised, so a query
 * object built by spreading defaults does not produce `?q=&genre=`. An empty
 * string is dropped for the same reason — "no search" and "search for nothing"
 * are the same request.
 */
export type QueryValue = string | number | boolean | string[] | undefined | null;

function toSearchParams(query: Record<string, QueryValue>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;

    /* Repeated keys, not a comma-joined list: qs on the API side reads
       `genre=a&genre=b` as two values, and a comma would arrive as the single
       slug "a,b" — which matches nothing and looks like an empty shelf rather
       than an error. */
    if (Array.isArray(value)) {
      for (const item of value) if (item !== "") params.append(key, item);
      continue;
    }

    params.set(key, String(value));
  }

  const search = params.toString();
  return search ? `?${search}` : "";
}

export type ApiRequest = {
  query?: Record<string, QueryValue>;
  method?: string;
  body?: unknown;
  /**
   * How long Next may reuse this response.
   *
   * Passed explicitly at each call site rather than defaulted here, because
   * the right answer differs by resource and the API already states it in
   * Cache-Control — the numbers in lib/api/catalog.ts mirror catalog.cache.ts
   * on purpose, and drifting from them is a decision someone should have to
   * make in writing.
   */
  revalidate?: number | false;
  signal?: AbortSignal;
};

/**
 * One request, parsed.
 *
 * The schema is a parameter rather than a type argument because a type
 * argument is erased and a schema is not: `apiFetch<BookList>(...)` would
 * compile and check nothing, which is the exact hole this wrapper exists to
 * close.
 */
export async function apiFetch<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  { query, method = "GET", body, revalidate, signal }: ApiRequest = {},
): Promise<z.infer<T>> {
  const url = `${apiOrigin()}${API_PREFIX}${path}${query ? toSearchParams(query) : ""}`;

  const response = await fetch(url, {
    method,
    signal,
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    /* `revalidate: false` means "do not cache" here rather than "cache
       forever" — that is what a mutation or a stock-sensitive read wants, and
       it is spelled out because Next's own default for the two words is the
       opposite. */
    cache: revalidate === false ? "no-store" : undefined,
    next: typeof revalidate === "number" ? { revalidate } : undefined,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorEnvelope(response));
  }

  const payload: unknown = await response.json();
  const parsed = schema.safeParse(payload);

  if (!parsed.success) throw new ApiContractError(path, parsed.error);

  return parsed.data;
}

/** Best-effort read of the error envelope; null for anything that is not one. */
async function readErrorEnvelope(response: Response): Promise<ErrorResponse | null> {
  try {
    const payload: unknown = await response.json();
    return isErrorResponse(payload) ? payload : null;
  } catch {
    return null;
  }
}
