import { Injectable, Logger } from "@nestjs/common";
import { paymentProviders } from "@sakura/contracts";
import { z } from "zod";
import type { ClaimOutcome, ClaimRequest } from "./claim.types";
import { PaymentGatewayConfig } from "./gateway.config";

/* --------------------------------------------------------------------------
   POST {gateway}/v1/claims, and nothing else.

   The only file that knows the gateway's URL shape, its auth header, its
   money unit (taka) and its reason codes. Everything it returns is a
   ClaimOutcome in cents.
   -------------------------------------------------------------------------- */

/** A successful claim, as the gateway sends it. Amounts are taka. */
const claimedBodySchema = z.object({
  claimed: z.literal(true),
  trxId: z.string().min(1),
  platform: z.enum(paymentProviders),
  amount: z.number().nonnegative(),
  overpaidBy: z.number().nonnegative().default(0),
  claimedAt: z.string().datetime(),
});

/** Any refusal: `{ claimed: false, reason, ... }`. Every other field is optional. */
const refusedBodySchema = z
  .object({
    claimed: z.literal(false).optional(),
    reason: z.string().optional(),
    detail: z.unknown().optional(),
    expected: z.number().optional(),
    actual: z.number().optional(),
    claimedAt: z.string().optional(),
    retryAfter: z.number().optional(),
  })
  .passthrough();

@Injectable()
export class GatewayHttpClient {
  private readonly logger = new Logger(GatewayHttpClient.name);

  constructor(private readonly config: PaymentGatewayConfig) {}

  /**
   * Ask once. Never throws: a network error, a timeout or an unreadable reply
   * all come back as UNAVAILABLE, because the caller is usually a checkout
   * where the customer has already paid.
   */
  async claim(request: ClaimRequest): Promise<ClaimOutcome> {
    let response: Response;

    try {
      response = await fetch(`${this.config.baseUrl}/v1/claims`, {
        method: "POST",
        headers: {
          Authorization: this.config.authorization,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(toGatewayBody(request)),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";

      return {
        outcome: "UNAVAILABLE",
        reason: timedOut
          ? `The payment gateway did not answer within ${this.config.timeoutMs} ms.`
          : `The payment gateway could not be reached: ${String(error)}`,
      };
    }

    let body: unknown = null;

    try {
      body = await response.json();
    } catch {
      // Left null. A 5xx with an HTML error page lands here and is still
      // answered by its status below.
    }

    const retryAfterHeader = Number(response.headers.get("retry-after") ?? Number.NaN);

    return interpretClaimResponse(response.status, body, request.expectedCents, {
      retryAfterSeconds: Number.isFinite(retryAfterHeader) ? retryAfterHeader : undefined,
      onUnexpected: (message) => this.logger.error(message),
    });
  }
}

/** The request body the gateway expects, with cents turned into taka. */
export function toGatewayBody(request: ClaimRequest): Record<string, unknown> {
  return {
    trxId: request.trxId,
    expectedAmount: request.expectedCents / 100,
    idempotencyKey: request.idempotencyKey,
    ...(request.orderRef ? { orderRef: request.orderRef } : {}),
    ...(request.provider ? { platform: request.provider } : {}),
    ...(request.senderPhone ? { senderPhone: request.senderPhone } : {}),
  };
}

/**
 * Turn one gateway answer into a ClaimOutcome.
 *
 * Pure, so every reason code can be tested without a server. Anything not in
 * the contract never grants: an unknown refusal is MISCONFIGURED (someone
 * needs to look) and a 5xx is UNAVAILABLE (try again later).
 */
export function interpretClaimResponse(
  status: number,
  body: unknown,
  expectedCents: number,
  options: { retryAfterSeconds?: number; onUnexpected?: (message: string) => void } = {},
): ClaimOutcome {
  const unexpected = (message: string) => options.onUnexpected?.(message);

  if (status >= 500) {
    return { outcome: "UNAVAILABLE", reason: `The payment gateway answered ${status}.` };
  }

  if ((status === 200 || status === 201) && isRecord(body) && body.claimed === true) {
    const parsed = claimedBodySchema.safeParse(body);

    if (!parsed.success) {
      // The gateway says yes but the answer is incomplete. Retrying with the
      // same key will replay the claim, so this is safe to treat as "ask again".
      unexpected(`Payment gateway sent an unreadable success body: ${parsed.error.message}`);

      return { outcome: "UNAVAILABLE", reason: "The payment gateway's answer could not be read." };
    }

    const paidCents = toCents(parsed.data.amount);

    /* The gateway has already compared amounts. This is a second look on our
       side, because a grant is the one answer that ships books. */
    if (paidCents < expectedCents) {
      unexpected(
        `Payment gateway claimed ${parsed.data.trxId} for ${paidCents} cents against ${expectedCents} expected`,
      );

      return { outcome: "UNDERPAID", expectedCents, paidCents };
    }

    return {
      outcome: "CLAIMED",
      trxId: parsed.data.trxId,
      provider: parsed.data.platform,
      paidCents,
      overpaidCents: toCents(parsed.data.overpaidBy),
      claimedAt: new Date(parsed.data.claimedAt),
      replay: status === 200,
    };
  }

  const refusal = refusedBodySchema.safeParse(body);
  const fields = refusal.success ? refusal.data : {};
  const reason = fields.reason;

  switch (reason) {
    case "not_found":
      return { outcome: "PENDING_ARRIVAL" };

    case "already_claimed":
      return { outcome: "ALREADY_CLAIMED", claimedAt: toDate(fields.claimedAt) };

    case "claim_released":
      return { outcome: "RELEASED" };

    case "amount_mismatch":
      return {
        outcome: "UNDERPAID",
        expectedCents: fields.expected === undefined ? expectedCents : toCents(fields.expected),
        paidCents: fields.actual === undefined ? null : toCents(fields.actual),
      };

    case "ambiguous_trx":
      return {
        outcome: "REJECTED",
        rejection: "AMBIGUOUS",
        reason: "This transaction ID exists on more than one wallet; the wallet must be named.",
      };

    case "outside_claim_window":
      return {
        outcome: "REJECTED",
        rejection: "TOO_OLD",
        reason: "The payment is older than this shop's claim window.",
      };

    case "exceeds_max_claim":
      return {
        outcome: "REJECTED",
        rejection: "OVER_LIMIT",
        reason: "The payment is above this shop's per-claim limit.",
      };

    case "sender_mismatch":
      return {
        outcome: "REJECTED",
        rejection: "SENDER_MISMATCH",
        reason: "The payer's phone number does not match.",
      };

    case "rate_limited":
      return {
        outcome: "UNAVAILABLE",
        reason: "The payment gateway is rate-limiting this shop.",
        retryAfterSeconds: fields.retryAfter ?? options.retryAfterSeconds,
      };

    case "idempotency_key_reused":
      unexpected("Payment gateway refused a reused idempotency key with a different trxId");
      return {
        outcome: "MISCONFIGURED",
        reason: "The claim key was already used with a different transaction ID.",
      };

    case "invalid_request":
      unexpected(`Payment gateway refused the claim as malformed: ${JSON.stringify(fields.detail)}`);
      return {
        outcome: "MISCONFIGURED",
        reason: `The payment gateway refused the request as malformed: ${describe(fields.detail)}`,
      };

    case "unauthenticated":
    case "client_inactive":
      unexpected(`Payment gateway refused our credential: ${reason}`);
      return {
        outcome: "MISCONFIGURED",
        reason:
          reason === "unauthenticated"
            ? "The payment gateway did not accept this shop's credential."
            : "This shop is deactivated on the payment gateway.",
      };
  }

  if (status === 429) {
    return {
      outcome: "UNAVAILABLE",
      reason: "The payment gateway is rate-limiting this shop.",
      retryAfterSeconds: options.retryAfterSeconds,
    };
  }

  unexpected(`Payment gateway sent an answer outside its contract: ${status} ${reason ?? "(no reason)"}`);

  return {
    outcome: "MISCONFIGURED",
    reason: `The payment gateway sent an unexpected answer (${status}${reason ? `, ${reason}` : ""}).`,
  };
}

/**
 * Taka → cents. Rounded, not truncated: 12.34 arrives as 12.339999…, and
 * truncating would make a correct payment one poisha short.
 */
function toCents(taka: number): number {
  return Math.round(taka * 100);
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function describe(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (detail === undefined) return "no detail given";
  return JSON.stringify(detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
