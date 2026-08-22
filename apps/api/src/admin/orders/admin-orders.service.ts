import { Injectable, Logger } from "@nestjs/common";
import type {
  AdminConfirmPaymentRequest,
  AdminInternalNoteRequest,
  AdminOrderDetail,
  AdminOrderList,
  AdminOrderQuery,
  AdminOrderTransitionRequest,
  AdminOrderVerifyPaymentResult,
  AdminRecordRefundRequest,
} from "@sakura/contracts";
import { eq, inArray, sql } from "drizzle-orm";
import { InvalidInputError, ResourceNotFoundError } from "../../common/errors";
import { DbService } from "../../db/db.service";
import { orderItems, orders } from "../../db/schema";
import { findOrder, type OrderRow } from "../../orders";
import { OrdersService } from "../../orders";
import { PaymentsService } from "../../payments";
import { AuditService } from "../../audit";
import {
  PaymentVerificationService,
  toVerificationRecord,
  type PaymentVerification,
} from "../../payment-verification";
import type { AccessClaims } from "../auth/tokens";
import { adminOrderFilters, adminOrderOrder } from "./admin-order.query";
import { toAdminOrderDetail, toAdminOrderSummary } from "./admin-order.mapper";

/** Who did it and from where, threaded through to every audit entry. */
export type AdminContext = {
  actor: AccessClaims;
  ipAddress?: string;
  userAgent?: string;
};

/**
 * The fulfilment desk.
 *
 * ## What this service is not allowed to do
 *
 * It does not write `orders.status` — `OrdersService.transition` does, and that
 * remains the single write path for the column. It does not write
 * `books.stock_quantity` — the transition does that too, when the move
 * releases stock. It does not insert payment rows — `PaymentsService` does,
 * through the same code a gateway webhook uses.
 *
 * That is the whole design of the admin layer in one paragraph: an admin
 * endpoint is a *caller* of the domain, never a second implementation of it.
 * The panel can do things a customer cannot, but it cannot do them differently
 * — otherwise every guarantee the storefront proves (one writer per column,
 * stock returned exactly once, payments idempotent) would hold for customers
 * and quietly not for staff, which is the population that makes the most
 * changes.
 *
 * What this service adds is the part the domain genuinely does not have: an
 * authenticated actor, and an audit entry recording what they did.
 */
@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly ordersService: OrdersService,
    private readonly paymentsService: PaymentsService,
    private readonly auditService: AuditService,
    private readonly paymentVerificationService: PaymentVerificationService,
  ) {}

  /**
   * One page of the queue.
   *
   * Three statements, matching the catalog's `list()` and for the same
   * reasons: ids and their page first, the count alongside as its own
   * statement rather than a window function that returns nothing on an empty
   * page, and the per-order item counts as a separate grouped query so the
   * one-to-many join cannot multiply the rows LIMIT is counting.
   */
  async list(query: AdminOrderQuery): Promise<AdminOrderList> {
    const where = adminOrderFilters(query);
    const offset = (query.page - 1) * query.pageSize;

    const [rows, [{ total }]] = await Promise.all([
      this.dbService.db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
          createdAt: orders.createdAt,
          customerName: orders.customerName,
          customerEmail: orders.customerEmail,
          customerPhone: orders.customerPhone,
          shippingAddress: orders.shippingAddress,
          paymentMethod: orders.paymentMethod,
          provider: orders.provider,
          totalCents: orders.totalCents,
          internalNote: orders.internalNote,
        })
        .from(orders)
        .where(where)
        .orderBy(...adminOrderOrder(query.sort))
        .limit(query.pageSize)
        .offset(offset),
      this.dbService.db
        .select({ total: sql<number>`count(*)::int` })
        .from(orders)
        .where(where),
    ]);

    const counts = await this.itemCounts(rows.map((row) => row.id));

    return {
      items: rows.map((row) => toAdminOrderSummary(row, counts.get(row.id))),
      total,
      page: query.page,
      // Zero, not one, when nothing matched — see the same note in the catalog.
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /**
   * Full detail, addressed by order number.
   *
   * By number rather than by UUID because that is what a staff member has:
   * it is on the customer's confirmation, it is what they read over the phone,
   * and it is what the list view links with. The UUID stays internal exactly
   * as it does on the storefront — there is no reason for the admin panel to
   * be the thing that leaks it into URLs and browser history.
   */
  async detail(orderNumber: string): Promise<AdminOrderDetail> {
    const row = await this.requireOrder(orderNumber);
    const paymentRows = await this.paymentsService.forOrder(row.id);

    return toAdminOrderDetail(row, paymentRows);
  }

  /**
   * Cross-check the transaction ID the customer gave at checkout against the
   * SMS gateway, without touching the order.
   *
   * Purely informational — unlike the pre-order desk's equivalent, this never
   * auto-accepts on a match. Acceptance here stays the admin's explicit
   * `transition`/`confirmPayment` call, per this service's own rule that it
   * never writes `orders.status` outside those two paths.
   *
   * `NO_RECEIPT` short-circuits before calling the verifier: a cash-on-delivery
   * order, or a manual-transfer order placed before the transaction-id field
   * was required, has nothing to look up, and reporting that as NOT_FOUND
   * would misdescribe an absent receipt as an unmatched one.
   */
  async verifyPayment(orderNumber: string): Promise<AdminOrderVerifyPaymentResult> {
    const order = await this.requireOrder(orderNumber);

    if (!order.transactionId) {
      return {
        record: { outcome: "NO_RECEIPT" },
        summary: "No transaction ID is on file for this order.",
      };
    }

    const verification = await this.paymentVerificationService.verify({
      transactionId: order.transactionId,
      expectedCents: order.totalCents,
      // Narrows the gateway lookup to the one collection the customer said
      // they paid through, instead of walking all three. Undefined for an
      // order placed before this field existed, which still works — it just
      // falls back to the scan.
      provider: order.provider ?? undefined,
    });

    return {
      record: toVerificationRecord(verification, order.totalCents),
      summary: summarizeVerification(verification, order.totalCents),
    };
  }

  /**
   * Move an order along the lifecycle.
   *
   * Delegates the actual move to `OrdersService.transitionAndCommit`, which
   * validates against the state machine, guards the update on the status we
   * read, returns stock when the move releases it, and emits after commit.
   * None of that is re-implemented here and none of it may be bypassed — an
   * admin transition is the same transition, performed by a known person.
   *
   * The audit entry is written after the commit rather than inside it, which
   * is the one place this service knowingly departs from AuditService's rule
   * that an entry and its change are atomic. The alternative is worse: to hold
   * them in one transaction this method would have to reach past
   * `transitionAndCommit` and drive `transition` itself, which means
   * duplicating the emit-after-commit handling that exists precisely because
   * getting it wrong makes listeners act on rolled-back state. A missing audit
   * row for a transition is recoverable — `order_status_history` still records
   * that the move happened, and it is append-only — so the trade is a
   * *degraded* record against a *wrong* event. Stock adjustments and refunds,
   * where no second record exists, keep the atomic form.
   */
  async transition(
    orderNumber: string,
    request: AdminOrderTransitionRequest,
    context: AdminContext,
  ): Promise<AdminOrderDetail> {
    const order = await this.requireOrder(orderNumber);
    const from = order.status;

    await this.ordersService.transitionAndCommit(
      order.id,
      request.status,
      request.note ?? `Set to ${request.status} by ${context.actor.email}`,
    );

    await this.auditService.recordDetached({
      ...auditContext(context),
      action: "TRANSITION",
      entityType: "orders",
      entityId: orderNumber,
      before: { status: from },
      after: { status: request.status },
      note: request.note,
    });

    return this.detail(orderNumber);
  }

  /**
   * Record a bank or bKash transfer that arrived out of band.
   *
   * The order's payment method is checked first, and cash-on-delivery is
   * refused. COD is confirmed by the courier handing over money, which is what
   * the DELIVERED transition means — offering a "confirm payment" button for
   * it would let an order be marked paid while the parcel is still on a shelf,
   * and the shop would have no way to tell the two apart afterwards.
   *
   * Everything else — the amount check against the order total, the
   * duplicate-reference index, recording the payment before touching the
   * order — happens inside PaymentsService, on the same path a gateway
   * webhook takes.
   */
  async confirmPayment(
    orderNumber: string,
    request: AdminConfirmPaymentRequest,
    context: AdminContext,
  ): Promise<AdminOrderDetail> {
    const order = await this.requireOrder(orderNumber);

    if (order.paymentMethod === "cash-on-delivery") {
      throw new InvalidInputError(
        "Cash-on-delivery orders are confirmed by marking them delivered, not by recording a transfer.",
        { orderNumber, paymentMethod: order.paymentMethod },
      );
    }

    const { confirmed } = await this.paymentsService.confirmManually(order.paymentMethod, {
      referenceId: order.orderNumber,
      status: "SUCCEEDED",
      amountCents: request.amountCents,
      // Stored verbatim on the payment row, so the statement line a staff
      // member matched from is recoverable months later.
      raw: {
        source: "admin",
        confirmedBy: context.actor.email,
        bankReference: request.reference ?? null,
        note: request.note ?? null,
      },
    });

    await this.auditService.recordDetached({
      ...auditContext(context),
      action: "UPDATE",
      entityType: "orders",
      entityId: orderNumber,
      before: { status: order.status },
      after: {
        status: confirmed ? "PAYMENT_CONFIRMED" : order.status,
        paymentAmountCents: request.amountCents,
        bankReference: request.reference ?? null,
      },
      note: request.note,
    });

    if (!confirmed) {
      // A replay: this reference was already recorded. Not an error — the
      // staff member's intent is satisfied and the order is already confirmed
      // — but worth a line, because two people confirming the same transfer
      // usually means two people are working the same statement.
      this.logger.log(`Manual confirmation for ${orderNumber} was a replay; order unchanged`);
    }

    return this.detail(orderNumber);
  }

  /**
   * Record a refund that has been issued elsewhere, and move the order to
   * REFUNDED.
   *
   * **This moves no money.** There is no gateway to call and the manual
   * methods have none — someone at the shop sends the transfer. See the
   * contract's comment for why the naming is laboured.
   *
   * One transaction for three writes: the payment row, the status change, and
   * the audit entry. This is the case where the atomic form is not negotiable
   * — unlike a transition, a refund has no second append-only record to fall
   * back on, so a lost audit entry here is the only trace of who authorised
   * money leaving the shop.
   *
   * Note the transition is `transition`, not `transitionAndCommit`, because
   * this method owns the transaction. That means the status-changed event is
   * emitted by hand after commit rather than by the service — see below.
   */
  async recordRefund(
    orderNumber: string,
    request: AdminRecordRefundRequest,
    context: AdminContext,
  ): Promise<AdminOrderDetail> {
    const order = await this.requireOrder(orderNumber);

    if (request.amountCents > order.totalCents) {
      throw new InvalidInputError("A refund cannot exceed the order total.", {
        orderNumber,
        totalCents: order.totalCents,
        requestedCents: request.amountCents,
      });
    }

    await this.dbService.db.transaction(async (tx) => {
      await this.paymentsService.recordRefund(
        order.id,
        {
          providerName: order.paymentMethod,
          amountCents: request.amountCents,
          reference: order.orderNumber,
          raw: { source: "admin", refundedBy: context.actor.email, reason: request.reason },
        },
        tx,
      );

      // Restores stock if the order had not shipped — the machine decides,
      // not this method. See releasesStock.
      await this.ordersService.transition(order.id, "REFUNDED", tx, request.reason);

      await this.auditService.record(
        {
          ...auditContext(context),
          action: "UPDATE",
          entityType: "orders",
          entityId: orderNumber,
          before: { status: order.status },
          after: { status: "REFUNDED", refundedCents: request.amountCents },
          note: request.reason,
        },
        tx,
      );
    });

    /* After commit, never inside — the same rule `transitionAndCommit` follows
       for the same reason. Emitted by hand because this method owned the
       transaction, so nothing emitted on its behalf; without it the sales
       rollup never hears that the order was refunded. */
    this.ordersService.announceStatusChange({
      orderId: order.id,
      orderNumber: order.orderNumber,
      from: order.status,
      to: "REFUNDED",
    });

    return this.detail(orderNumber);
  }

  /**
   * Replace the staff-only note.
   *
   * The previous value goes into the audit entry's `before`, which is what
   * makes replacing rather than appending safe: the history of this field is
   * the audit log, so the field itself can stay a scratchpad that reads
   * cleanly instead of an ever-growing transcript nobody scrolls.
   */
  async setInternalNote(
    orderNumber: string,
    request: AdminInternalNoteRequest,
    context: AdminContext,
  ): Promise<AdminOrderDetail> {
    const order = await this.requireOrder(orderNumber);
    const next = request.note?.trim() || null;

    await this.dbService.db.transaction(async (tx) => {
      await tx.update(orders).set({ internalNote: next }).where(eq(orders.id, order.id));

      await this.auditService.record(
        {
          ...auditContext(context),
          action: "UPDATE",
          entityType: "orders",
          entityId: orderNumber,
          before: { internalNote: order.internalNote },
          after: { internalNote: next },
        },
        tx,
      );
    });

    return this.detail(orderNumber);
  }

  /**
   * The order behind a number, or a 404.
   *
   * Unlike the guest lookup this needs no email and returns a plain
   * NOT_FOUND — the enumeration concern that shapes the storefront endpoint
   * does not apply to a caller who is already authenticated and whose every
   * request is audited. The order number is normalised upward anyway, because
   * a staff member types it off the same printed confirmation the customer
   * reads from.
   */
  private async requireOrder(orderNumber: string): Promise<OrderRow> {
    const normalised = orderNumber.trim().toUpperCase();

    const row = await findOrder(this.dbService.db, eq(orders.orderNumber, normalised));

    if (!row) throw new ResourceNotFoundError("Order", normalised);

    return row;
  }

  /** Line and copy counts per order, in one grouped query for the whole page. */
  private async itemCounts(
    orderIds: string[],
  ): Promise<Map<string, { lineCount: number; itemCount: number }>> {
    if (orderIds.length === 0) return new Map();

    const rows = await this.dbService.db
      .select({
        orderId: orderItems.orderId,
        lineCount: sql<number>`count(*)::int`,
        itemCount: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
      })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds))
      .groupBy(orderItems.orderId);

    return new Map(
      rows.map((row) => [row.orderId, { lineCount: row.lineCount, itemCount: row.itemCount }]),
    );
  }
}

/** A one-line, human-readable summary of a verification outcome. */
function summarizeVerification(verification: PaymentVerification, expectedCents: number): string {
  const amount = (cents: number) => (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

  switch (verification.outcome) {
    case "MATCHED":
      return `Matched — ৳${amount(verification.paidCents)} received via ${verification.provider}.`;
    case "UNDERPAID":
      return `Underpaid — ৳${amount(verification.paidCents)} received via ${verification.provider}, ৳${amount(expectedCents)} expected.`;
    case "NOT_FOUND":
      return "No matching transaction found yet — it may still be arriving.";
    case "UNAVAILABLE":
      return `Could not check — ${verification.reason}`;
  }
}

/** The actor half of every audit entry, in one place so no call site omits it. */
function auditContext(context: AdminContext) {
  return {
    actor: { sub: context.actor.sub, email: context.actor.email },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  };
}
