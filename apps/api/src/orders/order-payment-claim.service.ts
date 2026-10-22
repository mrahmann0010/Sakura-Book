import { Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { orders } from "../db/schema";
import { normaliseBdPhone, type PaymentVerificationRecord } from "@sakura/contracts";
import { PaymentClaimService, type ClaimOutcome } from "../payment-gateway";
import { normaliseTransactionId } from "./receipt";
import type { OrderRow } from "./order.mapper";
import { claimKeyFor, nextClaimKey } from "./payment-claim-key";
import { nextRetryDelaySeconds } from "./payment-claim-retry";
import { PaymentVerificationLogService } from "./payment-verification-log.service";
import { RELEASED_STATUSES } from "./transaction-id-claim";

/** The order fields a claim reads. */
export type ClaimableOrder = Pick<
  OrderRow,
  | "id"
  | "orderNumber"
  | "status"
  | "paymentMethod"
  | "provider"
  | "transactionId"
  | "senderNumber"
  | "totalCents"
  | "paymentClaimKey"
  | "paymentClaimAttempts"
>;

/**
 * The "Sent from" number as the gateway gets it: `01XXXXXXXXX`.
 *
 * New orders are stored that way already. Orders placed before checkout
 * validated the number may hold anything, so one that is not a Bangladeshi
 * mobile is sent as its bare digits: the gateway then answers
 * `sender_mismatch`, which staff can act on, rather than "senderPhone is
 * required", which reads as a setup fault. Undefined only when nothing was
 * typed.
 */
export function senderPhoneFor(senderNumber: string | null): string | undefined {
  if (!senderNumber) return undefined;

  return normaliseBdPhone(senderNumber) ?? (senderNumber.replace(/\D/g, "") || undefined);
}

/** What one claim concluded, and the log record written for it. */
export type OrderClaimResult = { outcome: ClaimOutcome; record: PaymentVerificationRecord };

/**
 * Claims an order's payment at the gateway, and keeps the order's side of
 * that in step: the claim key, the log row, and when to try again.
 *
 * Every path that spends a payment comes through here — the automatic claim
 * at checkout, the background retry, and staff confirming at the desk — so
 * the key is reused the same way, and every attempt is logged the same way,
 * whoever asked.
 *
 * It does not grant orders. Granting needs PaymentsService, which depends on
 * this module; each caller grants on CLAIMED itself.
 */
@Injectable()
export class OrderPaymentClaimService {
  private readonly logger = new Logger(OrderPaymentClaimService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly claims: PaymentClaimService,
    private readonly verificationLog: PaymentVerificationLogService,
  ) {}

  /** A manual transfer with a usable transaction ID. Nothing else has a payment to claim. */
  static isClaimable(order: Pick<ClaimableOrder, "paymentMethod" | "transactionId">): boolean {
    return order.paymentMethod === "manual-transfer" && normaliseTransactionId(order.transactionId) !== "";
  }

  /**
   * Claim once, log it, and schedule the next try if one is worth making.
   *
   * @param checkedByEmail the staff member asking, or null for the machine.
   * @param options.retryReleased on RELEASED, move to a new key and claim
   *   again straight away. Only for staff confirming the order: they have
   *   decided it should still be granted. The machine never re-takes a
   *   payment a gateway admin let go of.
   */
  async claim(
    order: ClaimableOrder,
    checkedByEmail: string | null,
    options: { retryReleased?: boolean } = {},
  ): Promise<OrderClaimResult> {
    const transactionId = order.transactionId;

    if (!OrderPaymentClaimService.isClaimable(order) || !transactionId) {
      const outcome: ClaimOutcome = {
        outcome: "MISCONFIGURED",
        reason: "This order has no transaction ID to claim.",
      };
      return {
        outcome,
        record: {
          outcome: outcome.outcome,
          checkedAt: new Date().toISOString(),
          transactionId: "",
          reason: outcome.reason,
        },
      };
    }

    const claimable = { ...order, transactionId };

    let key = claimKeyFor(order);
    // Attempts count only under the key they were made with.
    let attempts = order.paymentClaimKey === key ? order.paymentClaimAttempts : 0;

    let result = await this.attempt(claimable, key, checkedByEmail);
    attempts += 1;

    if (result.outcome.outcome === "RELEASED") {
      key = nextClaimKey(order.orderNumber, key);
      attempts = 0;

      if (options.retryReleased) {
        result = await this.attempt(claimable, key, checkedByEmail);
        attempts = 1;
      }
    }

    await this.persist(order, key, attempts, this.retryAtFor(order, result.outcome, attempts));

    return result;
  }

  /** Ask the worker to try again after `seconds` — e.g. a grant that failed after a claim. */
  async scheduleRetry(orderId: string, seconds: number): Promise<void> {
    await this.update(orderId, { paymentClaimRetryAt: new Date(Date.now() + seconds * 1000) });
  }

  /** Nothing more to try for this order. */
  async clearRetry(orderId: string): Promise<void> {
    await this.update(orderId, { paymentClaimRetryAt: null });
  }

  private async attempt(
    order: ClaimableOrder & { transactionId: string },
    key: string,
    checkedByEmail: string | null,
  ): Promise<OrderClaimResult> {
    const outcome = await this.claims.claim({
      trxId: order.transactionId,
      expectedCents: order.totalCents,
      idempotencyKey: key,
      orderRef: order.orderNumber,
      provider: order.provider ?? undefined,
      senderPhone: senderPhoneFor(order.senderNumber),
    });

    const record = await this.verificationLog.recordClaim(
      order.id,
      outcome,
      { transactionId: order.transactionId, expectedCents: order.totalCents, claimKey: key },
      checkedByEmail,
    );

    return { outcome, record };
  }

  /**
   * When to try again. Only the two "could not tell yet" answers are retried;
   * every other answer is final for this key. Nothing is scheduled while the
   * gateway is not configured, so switching it on later does not suddenly
   * claim a backlog of old orders.
   */
  private retryAtFor(order: ClaimableOrder, outcome: ClaimOutcome, attempts: number): Date | null {
    if (outcome.outcome !== "PENDING_ARRIVAL" && outcome.outcome !== "UNAVAILABLE") return null;
    if (!this.claims.enabled) return null;
    if (RELEASED_STATUSES.includes(order.status)) return null;

    const granted = order.status !== "PENDING";
    const delay = nextRetryDelaySeconds(
      attempts,
      granted,
      outcome.outcome === "UNAVAILABLE" ? outcome.retryAfterSeconds : undefined,
    );

    return delay === null ? null : new Date(Date.now() + delay * 1000);
  }

  private async persist(
    order: ClaimableOrder,
    key: string,
    attempts: number,
    retryAt: Date | null,
  ): Promise<void> {
    await this.update(order.id, {
      paymentClaimKey: key,
      paymentClaimAttempts: attempts,
      paymentClaimRetryAt: retryAt,
    });
  }

  /**
   * Best effort. The claim has already happened at the gateway, and the
   * caller must still act on it; a failed bookkeeping write must not turn a
   * good answer into an error. The worst case is a missed retry, which staff
   * can cover with "Check & confirm".
   */
  private async update(
    orderId: string,
    values: Partial<
      Pick<OrderRow, "paymentClaimKey" | "paymentClaimAttempts" | "paymentClaimRetryAt">
    >,
  ): Promise<void> {
    try {
      await this.dbService.db.update(orders).set(values).where(eq(orders.id, orderId));
    } catch (error) {
      this.logger.error(`Could not update claim state for order ${orderId}: ${String(error)}`);
    }
  }
}
