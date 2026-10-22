import { afterEach, describe, expect, it, vi } from "vitest";
import { envSchemaChecked } from "../../src/config/env.schema";
import type { ClaimOutcome, ClaimRequest } from "../../src/payment-gateway/claim.types";
import { toClaimRecord } from "../../src/payment-gateway/claim.types";
import {
  GatewayHttpClient,
  interpretClaimResponse,
  toGatewayBody,
} from "../../src/payment-gateway/gateway-http.client";
import type { PaymentGatewayConfig } from "../../src/payment-gateway/gateway.config";
import { PaymentClaimService } from "../../src/payment-gateway/payment-claim.service";
import { claimKeyFor, firstClaimKey, nextClaimKey } from "../../src/orders/payment-claim-key";

/**
 * The payment gateway module, without a gateway.
 *
 * The parts worth pinning are the translation (every reason code lands on
 * the right outcome, in the right unit) and the promise that nothing here
 * throws or grants on an answer it does not understand.
 */

const request: ClaimRequest = {
  trxId: "8F3K2M9X01",
  expectedCents: 125_000,
  idempotencyKey: "SB-10482:1",
  orderRef: "SB-10482",
};

const claimedBody = {
  claimed: true,
  trxId: "8F3K2M9X01",
  platform: "bkash",
  amount: 1300,
  expectedAmount: 1250,
  overpaidBy: 50,
  orderRef: "SB-10482",
  idempotencyKey: "SB-10482:1",
  claimedAt: "2026-10-21T08:14:02.000Z",
  state: "claimed",
};

const refusal = (reason: string, extra: Record<string, unknown> = {}) => ({
  claimed: false,
  reason,
  ...extra,
});

describe("toGatewayBody", () => {
  it("sends the total in taka, not cents", () => {
    expect(toGatewayBody(request)).toEqual({
      trxId: "8F3K2M9X01",
      expectedAmount: 1250,
      idempotencyKey: "SB-10482:1",
      orderRef: "SB-10482",
    });
  });

  it("keeps poisha as a fraction of a taka", () => {
    expect(toGatewayBody({ ...request, expectedCents: 125_050 }).expectedAmount).toBe(1250.5);
  });

  it("names the wallet only when asked to", () => {
    expect(toGatewayBody({ ...request, provider: "nagad" }).platform).toBe("nagad");
    expect(toGatewayBody(request)).not.toHaveProperty("platform");
  });

  it("sends the payer's phone when there is one", () => {
    expect(toGatewayBody({ ...request, senderPhone: "01615951697" }).senderPhone).toBe("01615951697");
    expect(toGatewayBody(request)).not.toHaveProperty("senderPhone");
  });
});

describe("interpretClaimResponse", () => {
  it("reads a new claim as CLAIMED, converting taka back to cents", () => {
    expect(interpretClaimResponse(201, claimedBody, 125_000)).toEqual({
      outcome: "CLAIMED",
      trxId: "8F3K2M9X01",
      provider: "bkash",
      paidCents: 130_000,
      overpaidCents: 5_000,
      claimedAt: new Date("2026-10-21T08:14:02.000Z"),
      replay: false,
    });
  });

  it("marks a 200 as a replay of our own earlier claim", () => {
    const outcome = interpretClaimResponse(200, claimedBody, 125_000);
    expect(outcome).toMatchObject({ outcome: "CLAIMED", replay: true });
  });

  it("rounds float taka to the nearest cent rather than truncating", () => {
    const outcome = interpretClaimResponse(201, { ...claimedBody, amount: 12.34, overpaidBy: 0 }, 1234);
    expect(outcome).toMatchObject({ outcome: "CLAIMED", paidCents: 1234 });
  });

  it("refuses a 'claimed' answer for less than the total, as a second look", () => {
    const onUnexpected = vi.fn();
    const outcome = interpretClaimResponse(201, { ...claimedBody, amount: 1000 }, 125_000, {
      onUnexpected,
    });

    expect(outcome).toEqual({ outcome: "UNDERPAID", expectedCents: 125_000, paidCents: 100_000 });
    expect(onUnexpected).toHaveBeenCalled();
  });

  it("asks again, rather than granting, when a success body is incomplete", () => {
    const { platform: _platform, ...broken } = claimedBody;
    expect(interpretClaimResponse(201, broken, 125_000).outcome).toBe("UNAVAILABLE");
  });

  it.each<[number, string, Record<string, unknown>, Partial<ClaimOutcome>]>([
    [404, "not_found", {}, { outcome: "PENDING_ARRIVAL" }],
    [
      409,
      "already_claimed",
      { claimedAt: "2026-10-20T10:00:00.000Z" },
      { outcome: "ALREADY_CLAIMED", claimedAt: new Date("2026-10-20T10:00:00.000Z") },
    ],
    [409, "claim_released", {}, { outcome: "RELEASED" }],
    [409, "idempotency_key_reused", {}, { outcome: "MISCONFIGURED" }],
    [409, "ambiguous_trx", {}, { outcome: "REJECTED", rejection: "AMBIGUOUS" }],
    [410, "outside_claim_window", {}, { outcome: "REJECTED", rejection: "TOO_OLD" }],
    [
      422,
      "amount_mismatch",
      { expected: 1250, actual: 900 },
      { outcome: "UNDERPAID", expectedCents: 125_000, paidCents: 90_000 },
    ],
    [422, "exceeds_max_claim", {}, { outcome: "REJECTED", rejection: "OVER_LIMIT" }],
    [422, "sender_mismatch", {}, { outcome: "REJECTED", rejection: "SENDER_MISMATCH" }],
    [
      429,
      "rate_limited",
      { retryAfter: 12 },
      { outcome: "UNAVAILABLE", retryAfterSeconds: 12 },
    ],
    [400, "invalid_request", { detail: "trxId is required" }, { outcome: "MISCONFIGURED" }],
    [401, "unauthenticated", {}, { outcome: "MISCONFIGURED" }],
    [403, "client_inactive", {}, { outcome: "MISCONFIGURED" }],
  ])("%i %s", (status, reason, extra, expected) => {
    expect(interpretClaimResponse(status, refusal(reason, extra), 125_000)).toMatchObject(expected);
  });

  it("reads already_claimed without a time as an unknown time, not a crash", () => {
    expect(interpretClaimResponse(409, refusal("already_claimed"), 125_000)).toEqual({
      outcome: "ALREADY_CLAIMED",
      claimedAt: null,
    });
  });

  it("treats every 5xx as unavailable, whatever the body says", () => {
    expect(interpretClaimResponse(503, refusal("not_found"), 125_000).outcome).toBe("UNAVAILABLE");
    expect(interpretClaimResponse(500, "<html>", 125_000).outcome).toBe("UNAVAILABLE");
  });

  it("falls back to the Retry-After header on a bare 429", () => {
    expect(interpretClaimResponse(429, null, 125_000, { retryAfterSeconds: 30 })).toEqual({
      outcome: "UNAVAILABLE",
      reason: expect.any(String),
      retryAfterSeconds: 30,
    });
  });

  it("never grants on an answer outside the contract", () => {
    const onUnexpected = vi.fn();

    expect(
      interpretClaimResponse(418, refusal("teapot"), 125_000, { onUnexpected }).outcome,
    ).toBe("MISCONFIGURED");
    // A wrong URL: the server's own 404 page, no reason code.
    expect(interpretClaimResponse(404, null, 125_000, { onUnexpected }).outcome).toBe(
      "MISCONFIGURED",
    );
    expect(onUnexpected).toHaveBeenCalledTimes(2);
  });
});

describe("GatewayHttpClient", () => {
  const config = {
    baseUrl: "https://gateway.example",
    authorization: "Bearer sakura-book.s3cret",
    timeoutMs: 5000,
  } as PaymentGatewayConfig;

  afterEach(() => vi.unstubAllGlobals());

  it("posts to /v1/claims with the bearer credential", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(claimedBody), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await new GatewayHttpClient(config).claim(request);

    expect(outcome.outcome).toBe("CLAIMED");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gateway.example/v1/claims");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sakura-book.s3cret",
    );
    expect(JSON.parse(init.body as string)).toMatchObject({ expectedAmount: 1250 });
  });

  it("turns a network failure into UNAVAILABLE instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(new GatewayHttpClient(config).claim(request)).resolves.toMatchObject({
      outcome: "UNAVAILABLE",
    });
  });

  it("turns a timeout into UNAVAILABLE and says so", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );

    const outcome = await new GatewayHttpClient(config).claim(request);
    expect(outcome).toMatchObject({ outcome: "UNAVAILABLE" });
    expect(outcome.outcome === "UNAVAILABLE" && outcome.reason).toMatch(/5000 ms/);
  });
});

describe("PaymentClaimService", () => {
  function serviceWith(answers: ClaimOutcome[], enabled = true) {
    const claim = vi.fn(async () => answers.shift() ?? { outcome: "PENDING_ARRIVAL" as const });
    const service = new PaymentClaimService(
      { enabled } as PaymentGatewayConfig,
      { claim } as unknown as GatewayHttpClient,
    );
    return { service, claim };
  }

  it("is UNAVAILABLE — never a grant — when the gateway is not configured", async () => {
    const { service, claim } = serviceWith([], false);

    await expect(service.claim(request)).resolves.toMatchObject({ outcome: "UNAVAILABLE" });
    expect(claim).not.toHaveBeenCalled();
  });

  it("refuses to send a claim with no transaction ID, amount or key", async () => {
    const { service, claim } = serviceWith([]);

    for (const bad of [
      { ...request, trxId: " - " },
      { ...request, expectedCents: 0 },
      { ...request, expectedCents: 12.5 },
      { ...request, idempotencyKey: " " },
    ]) {
      await expect(service.claim(bad)).resolves.toMatchObject({ outcome: "MISCONFIGURED" });
    }

    expect(claim).not.toHaveBeenCalled();
  });

  it("asks without the wallet first, so a wrong wallet pick cannot hide the payment", async () => {
    const { service, claim } = serviceWith([{ outcome: "PENDING_ARRIVAL" }]);

    await service.claim({ ...request, provider: "nagad" });

    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim.mock.calls[0]).toEqual([expect.objectContaining({ provider: undefined })]);
  });

  it("resends once with the order's wallet when the ID is ambiguous", async () => {
    const { service, claim } = serviceWith([
      { outcome: "REJECTED", rejection: "AMBIGUOUS", reason: "two wallets" },
      { outcome: "PENDING_ARRIVAL" },
    ]);

    await expect(service.claim({ ...request, provider: "nagad" })).resolves.toEqual({
      outcome: "PENDING_ARRIVAL",
    });
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claim.mock.calls[1]).toEqual([
      expect.objectContaining({ provider: "nagad", idempotencyKey: "SB-10482:1" }),
    ]);
  });

  it("stays REJECTED on an ambiguous ID when the order names no wallet", async () => {
    const { service, claim } = serviceWith([
      { outcome: "REJECTED", rejection: "AMBIGUOUS", reason: "two wallets" },
    ]);

    await expect(service.claim(request)).resolves.toMatchObject({ outcome: "REJECTED" });
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("turns anything the client throws into UNAVAILABLE", async () => {
    const service = new PaymentClaimService(
      { enabled: true } as PaymentGatewayConfig,
      {
        claim: vi.fn(async () => {
          throw new Error("boom");
        }),
      } as unknown as GatewayHttpClient,
    );

    await expect(service.claim(request)).resolves.toMatchObject({ outcome: "UNAVAILABLE" });
  });
});

describe("toClaimRecord", () => {
  it("keeps the key, the amounts and the overpayment for a claim", () => {
    const record = toClaimRecord(
      {
        outcome: "CLAIMED",
        trxId: "8F3K2M9X01",
        provider: "bkash",
        paidCents: 130_000,
        overpaidCents: 5_000,
        claimedAt: new Date("2026-10-21T08:14:02.000Z"),
        replay: false,
      },
      { transactionId: "8F3K2M9X01", expectedCents: 125_000, claimKey: "SB-10482:1" },
    );

    expect(record).toMatchObject({
      outcome: "CLAIMED",
      claimKey: "SB-10482:1",
      provider: "bkash",
      paidCents: 130_000,
      expectedCents: 125_000,
      overpaidCents: 5_000,
      claimedAt: "2026-10-21T08:14:02.000Z",
    });
  });
});

describe("claim keys", () => {
  it("starts at attempt 1", () => {
    expect(firstClaimKey("SB-10482")).toBe("SB-10482:1");
  });

  it("gives orders placed before keys existed the first key", () => {
    expect(claimKeyFor({ orderNumber: "SB-1", paymentClaimKey: null })).toBe("SB-1:1");
    expect(claimKeyFor({ orderNumber: "SB-1", paymentClaimKey: "SB-1:3" })).toBe("SB-1:3");
  });

  it("moves to the next attempt", () => {
    expect(nextClaimKey("SB-10482", "SB-10482:1")).toBe("SB-10482:2");
    expect(nextClaimKey("SB-10482", "SB-10482:9")).toBe("SB-10482:10");
    expect(nextClaimKey("SB-10482", null)).toBe("SB-10482:2");
  });
});

describe("payment gateway env", () => {
  const base = { NODE_ENV: "development", DATABASE_URL: "postgres://localhost/db" };
  const gateway = {
    SAKURA_PAYMENT_GATEWAY_URL: "https://gateway.example",
    SAKURA_PAYMENT_GATEWAY_CLIENT_ID: "sakura-book",
    SAKURA_PAYMENT_GATEWAY_SECRET: "s3cret",
  };
  const gatewayIssues = (env: Record<string, unknown>) => {
    const parsed = envSchemaChecked.safeParse(env);
    return parsed.success
      ? []
      : parsed.error.issues.filter((issue) =>
          String(issue.path[0]).startsWith("SAKURA_PAYMENT_GATEWAY_"),
        );
  };

  it("is optional outside production", () => {
    expect(gatewayIssues(base)).toEqual([]);
  });

  it("refuses half a config", () => {
    const { SAKURA_PAYMENT_GATEWAY_SECRET: _secret, ...partial } = gateway;
    expect(gatewayIssues({ ...base, ...partial }).map((issue) => issue.path[0])).toEqual([
      "SAKURA_PAYMENT_GATEWAY_SECRET",
    ]);
  });

  it("is required in production", () => {
    expect(gatewayIssues({ ...base, NODE_ENV: "production" })).toHaveLength(3);
    expect(gatewayIssues({ ...base, ...gateway, NODE_ENV: "production" })).toEqual([]);
  });
});
