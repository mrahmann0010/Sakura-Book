import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
import type { Env } from "../../config/env.schema";
import { DbService } from "../../db/db.service";
import { orderItems, orders } from "../../db/schema";
import { findOrder, findTransactionIdClaim, forwardPathTo, type OrderRow } from "../../orders";
import { OrdersService, PaymentVerificationLogService } from "../../orders";
import { PaymentsService } from "../../payments";
import { AuditService } from "../../audit";
import { PaymentVerificationService, type PaymentVerification } from "../../payment-verification";
import type { AccessClaims } from "../auth/tokens";
import { adminOrderFilters, adminOrderOrder } from "./admin-order.query";
import { receiptUniquenessOf, toAdminOrderDetail, toAdminOrderSummary } from "./admin-order.mapper";
import { toPathaoCsv } from "./pathao-export";

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
    private readonly verificationLog: PaymentVerificationLogService,
    private readonly config: ConfigService<Env, true>,
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
          transactionIdNormalised: orders.transactionIdNormalised,
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

    /* Three page-wide lookups rather than three per row. The queue renders
       twenty-five orders and each badge needs a fact this row does not carry;
       asking per row would turn one table into seventy-five round trips. */
    const [counts, duplicated, verifications] = await Promise.all([
      this.itemCounts(rows.map((row) => row.id)),
      this.verificationLog.findDuplicatedReceipts(
        rows.flatMap((row) => (row.transactionIdNormalised ? [row.transactionIdNormalised] : [])),
      ),
      this.verificationLog.latestFor(rows.map((row) => row.id)),
    ]);

    return {
      items: rows.map((row) =>
        toAdminOrderSummary(
          row,
          counts.get(row.id),
          receiptUniquenessOf(row, duplicated),
          PaymentVerificationLogService.stateOf(verifications, row.id),
        ),
      ),
      total,
      page: query.page,
      // Zero, not one, when nothing matched — see the same note in the catalog.
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /**
   * Every order matching the filters as a Pathao bulk-order CSV — no
   * pagination.
   *
   * The same filters the queue was drawn with, deliberately: the panel passes
   * whatever the screen was showing, so the file is the manifest for the list
   * in front of the operator rather than for some other set of orders. That
   * includes the status filter, which is what keeps a pending order from
   * reaching a courier — the accepted-orders screen only ever sends the four
   * accepted statuses, and this endpoint has no opinion beyond honouring what
   * it is given.
   *
   * Capped at EXPORT_LIMIT rows so one request cannot render the whole orders
   * table into memory as a string. The cap is far above any batch a courier
   * would collect in a day, and the date filters are the answer if it is ever
   * not.
   *
   * Two statements, not one: the addresses come off `orders`, and the copies
   * per order are a grouped count over `order_items` that would multiply the
   * rows if it were joined in — the same shape, and the same reason, as
   * `list()` above.
   */
  async exportPathaoCsv(query: AdminOrderQuery): Promise<string> {
    const rows = await this.dbService.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        shippingAddress: orders.shippingAddress,
        paymentMethod: orders.paymentMethod,
        totalCents: orders.totalCents,
        customerNote: orders.customerNote,
      })
      .from(orders)
      .where(adminOrderFilters(query))
      .orderBy(...adminOrderOrder(query.sort))
      .limit(EXPORT_LIMIT);

    const counts = await this.itemCounts(rows.map((row) => row.id));

    return toPathaoCsv(
      rows.map((row) => ({
        orderNumber: row.orderNumber,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        shippingAddress: row.shippingAddress,
        paymentMethod: row.paymentMethod,
        totalCents: row.totalCents,
        customerNote: row.customerNote,
        // Zero copies is impossible — checkout rejects an empty cart — but a
        // manifest is the wrong place to discover otherwise, so it renders as
        // zero rather than throwing and costing the operator the whole file.
        itemCount: counts.get(row.id)?.itemCount ?? 0,
      })),
      this.config.get("PATHAO_STORE_NAME", { infer: true }),
    );
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

    const [paymentRows, claim, verifications, latest] = await Promise.all([
      this.paymentsService.forOrder(row.id),
      /* One order, so the named lookup is affordable here in a way it is not
         for a page of the queue — and the name is the useful half of the
         finding. "Duplicate" tells staff to stop; "already on NB-40718" tells
         them where to go. */
      findTransactionIdClaim(this.dbService.db, row.transactionId, { excludeOrderId: row.id }),
      this.verificationLog.historyFor(row.id),
      // The history's newest row again, but carrying who ran it — the one fact
      // the wire record deliberately omits, since a customer-facing shape has
      // no business naming staff.
      this.verificationLog.latestFor([row.id]),
    ]);

    const receipt = receiptUniquenessOf(
      row,
      // A set of one: the claim lookup has already decided this, so the
      // page-wide grouped query would be asking the same question twice.
      claim && row.transactionIdNormalised ? new Set([row.transactionIdNormalised]) : new Set(),
      claim?.orderNumber ?? null,
    );

    return toAdminOrderDetail(
      row,
      paymentRows,
      receipt,
      PaymentVerificationLogService.stateOf(latest, row.id),
      verifications,
    );
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
  async verifyPayment(
    orderNumber: string,
    context: AdminContext,
  ): Promise<AdminOrderVerifyPaymentResult> {
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

    /* Said first, and said even when the gateway matched — especially then. A
       reused receipt matches the gateway by construction: it is a real payment,
       for the right amount, that another order has already been granted
       against. "Verified" is exactly what this looks like from the gateway's
       side, so the summary has to lead with the part the gateway cannot know.

       The record keeps the true gateway verdict rather than being overwritten,
       because the two facts are independent and staff need both: whether the
       money arrived, and whether it has already been spent. */
    const claim = await findTransactionIdClaim(this.dbService.db, order.transactionId, {
      excludeOrderId: order.id,
    });

    const summary = summarizeVerification(verification, order.totalCents);

    /* Written before the answer is returned, so the panel's badge and the
       sentence the admin is about to read come from the same check. Named to
       the actor: the history's whole value is distinguishing the automatic
       check at checkout from a person deciding to look. */
    const record = await this.verificationLog.record(
      order.id,
      verification,
      order.totalCents,
      context.actor.email,
    );

    return {
      record,
      summary: claim
        ? `This transaction ID is already recorded against order ${claim.orderNumber} (${claim.status}). ` +
          `Confirming payment here is blocked. Gateway says: ${summary}`
        : summary,
    };
  }

  /**
   * Refuse to grant an order whose receipt is already on another live one.
   *
   * The single place both grant paths pass through — `confirmPayment` and a
   * `transition` to PAYMENT_CONFIRMED — so neither can be hardened or relaxed
   * without the other following. That is the entire point of it being a
   * method rather than two copies of a check.
   *
   * A duplicate is genuine at the gateway by construction: it is a real
   * payment, of the right amount, that another order has already been granted
   * against. No amount of verification catches it, which is why this runs
   * independently of whether the gateway said MATCHED.
   *
   * The override is a typed reason, not a flag, and it is recorded to the
   * audit log before the grant proceeds. It exists because the previous escape
   * hatch was to *cancel the other order* to release its claim — destructive,
   * lossy, and a genuinely bad thing to ask of someone who simply knows the
   * customer paid for two orders from one wallet.
   */
  private async guardDuplicateReceipt(
    order: OrderRow,
    override: string | undefined,
    context: AdminContext,
  ): Promise<void> {
    const claim = await findTransactionIdClaim(this.dbService.db, order.transactionId, {
      excludeOrderId: order.id,
    });

    if (!claim) return;

    if (override) {
      this.logger.warn(
        `${context.actor.email} overrode the duplicate-receipt block on ${order.orderNumber} ` +
          `(also on ${claim.orderNumber}): ${override}`,
      );

      /* `record` rather than `recordDetached`, in a transaction of its own and
         before the caller grants anything.

         It is not atomic with the grant — the grant belongs to
         `confirmPayment` or `transitionAndCommit` and this method has no
         handle on it. What it does guarantee is the direction that matters: if
         the justification cannot be written, `record` throws, this method
         throws, and the grant never runs. An override that happened with no
         record of why is the one outcome worth failing a request over, since
         nothing else on the order records it — unlike a transition, which
         order_status_history captures regardless. */
      await this.dbService.db.transaction((tx) =>
        this.auditService.record(
          {
            ...auditContext(context),
            action: "DUPLICATE_RECEIPT_OVERRIDE",
            entityType: "orders",
            entityId: order.orderNumber,
            before: { claimedBy: claim.orderNumber, claimedByStatus: claim.status },
            after: { overridden: true },
            note: override,
          },
          tx,
        ),
      );

      return;
    }

    this.logger.warn(
      `${context.actor.email} tried to confirm ${order.orderNumber}, whose transaction ID is ` +
        `already recorded against ${claim.orderNumber}`,
    );

    throw new InvalidInputError(
      `This order's transaction ID is already recorded against order ${claim.orderNumber} ` +
        `(${claim.status}). Confirm the payment there, or — if this order is the real claim — ` +
        `re-send with a reason to override.`,
      {
        orderNumber: order.orderNumber,
        claimedBy: claim.orderNumber,
        claimedByStatus: claim.status,
      },
    );
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

    /* Which statuses this request will actually put the order into.

       For the ordinary single-step request that is just the target. For an
       `advance` request it is the whole route, and it has to be computed here
       rather than left to the domain, because the guard below asks a question
       about the statuses being entered — and an order that reaches
       PAYMENT_CONFIRMED as the first step of a walk has reached it exactly as
       completely as one that was asked for it directly.

       A null route is left to `advanceAndCommit` to refuse. Re-deriving the
       refusal here would put a second copy of "is this move legal" outside the
       machine, which is the thing the machine exists to prevent. */
    const entering = request.advance
      ? (forwardPathTo(from, request.status) ?? [request.status])
      : [request.status];

    /* The other door into the same room.

       `confirmPayment` has refused duplicate receipts since the check existed,
       and this method — which reaches PAYMENT_CONFIRMED just as effectively,
       via the state machine — did not. The panel happened not to offer that
       route for a pending order, so the gap was invisible from the UI; the
       endpoint was open to any admin token, any script, and any future change
       to which buttons get rendered. A guard on one of two paths to the same
       outcome is not a guard.

       Asked of the route rather than of `request.status` for that same reason:
       `advance` to SHIPPED from PENDING passes through PAYMENT_CONFIRMED, and
       a guard that only reads the destination is a third door left open. */
    if (entering.includes("PAYMENT_CONFIRMED")) {
      await this.guardDuplicateReceipt(order, request.duplicateReceiptOverride, context);
    }

    const note = request.note ?? `Set to ${request.status} by ${context.actor.email}`;

    if (request.advance) {
      await this.ordersService.advanceAndCommit(order.id, request.status, note);
    } else {
      await this.ordersService.transitionAndCommit(order.id, request.status, note);
    }

    await this.auditService.recordDetached({
      ...auditContext(context),
      action: "TRANSITION",
      entityType: "orders",
      entityId: orderNumber,
      before: { status: from },
      // The route, not just the destination, when more than one status was
      // entered. "PAYMENT_CONFIRMED became SHIPPED" is a true but incomplete
      // record of an order that was also marked picked on the way, and the
      // audit log is the only place that intermediate move is recoverable
      // once the history rows are a year deep.
      after:
        entering.length > 1
          ? { status: request.status, through: entering }
          : { status: request.status },
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

    await this.guardDuplicateReceipt(order, request.duplicateReceiptOverride, context);

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
  const amount = (cents: number) =>
    (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

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

/** See `exportPathaoCsv`. Far above any single courier pickup; the status,
 *  division and date filters are the answer if it is ever not. */
const EXPORT_LIMIT = 5_000;
