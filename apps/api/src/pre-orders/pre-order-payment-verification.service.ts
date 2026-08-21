import { Injectable, Logger } from "@nestjs/common";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { AuditService } from "../audit";
import { DbService } from "../db/db.service";
import type { Transaction } from "../db/db.types";
import { preOrderOrders } from "../db/schema";
import {
  PaymentVerificationService,
  TransactionIdAlreadyUsedError,
  normaliseTransactionId,
  toVerificationRecord,
  type PaymentVerification,
} from "../payment-verification";
import type { PreOrderRow } from "./pre-order.mapper";

/* --------------------------------------------------------------------------
   Cross-checking a pre-order's claimed payment, and acting on the answer.

   This is the pre-order-shaped half of the flow: PaymentVerificationService
   knows how to ask Mongo whether ৳X arrived under a transaction ID and
   nothing else, and this knows what a pre-order should do about each possible
   answer. Keeping the two apart is what lets orders — or an ebook, or a
   course — reuse the asking without inheriting any of the deciding.
   -------------------------------------------------------------------------- */

@Injectable()
export class PreOrderPaymentVerificationService {
  private readonly logger = new Logger(PreOrderPaymentVerificationService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly verification: PaymentVerificationService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Refuse a transaction ID that is already spoken for.
   *
   * A query rather than a unique index on the column, for two reasons. A
   * unique index would only compare the stored text, so the same receipt
   * retyped in lower case would slip past it — and the rows written before
   * this guard existed are stored exactly as customers typed them. And it
   * would surface as a bare 23505 from inside the insert, which the Postgres
   * mapper can only turn into "already exists" about a constraint name.
   * Asking first lets the refusal name the actual problem while the customer
   * is still looking at the form.
   *
   * Runs inside the caller's transaction so that the check and the insert are
   * serialised against each other rather than merely close together.
   */
  async assertTransactionIdUnused(
    transactionId: string | null,
    tx: Transaction,
    excludePreOrderId?: string,
  ): Promise<void> {
    const normalised = normaliseTransactionId(transactionId);
    if (!normalised) return;

    /**
     * Compared case- and space-insensitively on both sides, because rows
     * written before this guard existed were stored exactly as typed. A
     * customer who reused a receipt but typed it in lower case the second
     * time is the case this is for.
     */
    const [clash] = await tx
      .select({ id: preOrderOrders.id })
      .from(preOrderOrders)
      .where(
        and(
          isNotNull(preOrderOrders.transactionId),
          sql`upper(regexp_replace(${preOrderOrders.transactionId}, '\s', '', 'g')) = ${normalised}`,
          excludePreOrderId ? ne(preOrderOrders.id, excludePreOrderId) : undefined,
        ),
      )
      .limit(1);

    if (clash) throw new TransactionIdAlreadyUsedError(normalised);
  }

  /**
   * Look the payment up and accept it if it is really there.
   *
   * Returns the verdict so the caller can report it; the pre-order itself is
   * updated in place. Only ever moves PENDING → ACCEPTED — never the other
   * way. A gateway that cannot find a receipt has not proven the payment is
   * bad, only that it has not seen it yet, and SMS arrive late often enough
   * that auto-rejecting on a miss would reject real customers. Rejection stays
   * a human decision, which is also what keeps it accountable: REJECTED is
   * terminal in the payment machine.
   */
  async verifyAndAccept(
    row: PreOrderRow,
    actor?: { sub: string; email: string },
  ): Promise<PaymentVerification> {
    const verification = await this.verification.verify({
      transactionId: row.transactionId ?? "",
      expectedCents: row.totalCents,
    });

    const record = toVerificationRecord(verification, row.totalCents);

    await this.dbService.db.transaction(async (tx) => {
      const accepting = verification.outcome === "MATCHED" && row.paymentStatus === "PENDING";

      const updated = await tx
        .update(preOrderOrders)
        .set({
          paymentVerification: record,
          ...(accepting ? { paymentStatus: "ACCEPTED" as const } : {}),
        })
        /**
         * Guarded on the status we read, exactly as the admin desk's manual
         * accept is. An automatic check racing a member of staff clicking
         * Accept is not far-fetched — the check runs seconds after placement,
         * and a re-check runs whenever someone is looking at the row.
         */
        .where(
          and(
            eq(preOrderOrders.id, row.id),
            accepting ? eq(preOrderOrders.paymentStatus, "PENDING") : undefined,
          ),
        )
        .returning({ id: preOrderOrders.id });

      if (updated.length === 0) {
        // Someone moved it first. Their decision stands; ours was only ever
        // going to agree with the evidence, and the evidence has not changed.
        this.logger.log(
          `Pre-order ${row.orderNumber} was already decided while its payment was being checked.`,
        );
        return;
      }

      if (!accepting) return;

      /**
       * Atomic with the acceptance, for the same reason the manual path's
       * entry is: pre-orders have no status-history table, so this row is the
       * only record that the money was ever accepted — and the only one
       * saying it was accepted by a machine rather than by a person.
       */
      await this.auditService.record(
        {
          actor,
          action: "TRANSITION",
          entityType: "pre_order_orders",
          entityId: row.orderNumber,
          before: { paymentStatus: row.paymentStatus },
          after: {
            paymentStatus: "ACCEPTED",
            verifiedBy: actor ? "gateway-check (staff-triggered)" : "gateway-check (automatic)",
            provider: record.provider,
            paidCents: record.paidCents,
          },
          note: verificationNote(verification),
        },
        tx,
      );
    });

    return verification;
  }
}

/**
 * A one-line summary for the audit trail and the staff note field.
 *
 * Written out here rather than at each call site so that the wording of a
 * machine decision is identical everywhere it is read back — an audit log
 * where the same event is phrased three ways is one nobody trusts.
 */
export function verificationNote(verification: PaymentVerification): string {
  switch (verification.outcome) {
    case "MATCHED":
      return `Matched ${verification.provider} transaction ${verification.transactionId} for ${formatCents(verification.paidCents)}.`;
    case "UNDERPAID":
      return `Found ${verification.provider} transaction ${verification.transactionId}, but only ${formatCents(verification.paidCents)} arrived against ${formatCents(verification.expectedCents)} owed.`;
    case "NOT_FOUND":
      return `No payment matching ${verification.transactionId} has reached the gateway yet.`;
    case "UNAVAILABLE":
      return `Could not check ${verification.transactionId}: ${verification.reason}`;
  }
}

/** Minor units → taka, zero fraction digits — see CURRENCY in env.schema.ts. */
function formatCents(cents: number): string {
  return `৳${Math.round(cents / 100).toLocaleString("en-US")}`;
}
