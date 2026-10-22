import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  AdminConfirmPaymentRequest,
  AdminEditTransactionIdRequest,
  AdminEditTransactionIdResult,
  AdminInternalNoteRequest,
  AdminOrderDetail,
  AdminOrderList,
  AdminOrderQuery,
  AdminOrderTransitionRequest,
  AdminOrderVerifyPaymentResult,
  AdminRecordRefundRequest,
  AdminReopenOrderRequest,
  AdminRevertPaymentRequest,
} from "@sakura/contracts";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { claimKeyFor, nextClaimKey, normaliseTrxId, type ClaimOutcome } from "@project-sakura/pay";
import { InvalidInputError, ResourceNotFoundError } from "../../common/errors";
import type { Env } from "../../config/env.schema";
import { DbService } from "../../db/db.service";
import { auditLog, orderItems, orders } from "../../db/schema";
import {
  findOrder,
  findTransactionIdClaim,
  forwardPathTo,
  OrderPaymentClaimService,
  RELEASED_STATUSES,
  reopenBlocker,
  type OrderRow,
} from "../../orders";
import { OrdersService, PaymentVerificationLogService } from "../../orders";
import { PaymentsService } from "../../payments";
import { AuditService } from "../../audit";
import type { AccessClaims } from "../auth/tokens";
import { adminOrderFilters, adminOrderOrder } from "./admin-order.query";
import {
  fulfillmentOrderScope,
  fulfillmentTransitionBlocker,
  isFulfillment,
  isInFulfillmentScope,
  redactDetailForFulfillment,
  redactSummaryForFulfillment,
} from "./fulfillment-scope";
import {
  heldClaimOf,
  receiptUniquenessOf,
  toAdminOrderDetail,
  toAdminOrderSummary,
} from "./admin-order.mapper";
import {
  PaymentClaimRefusedError,
  PaymentNotClaimedError,
  PaymentUnderpaidError,
} from "./admin-order.errors";
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
 *
 * ## Who is asking
 *
 * Every read takes the caller's claims, because a FULFILLMENT account sees a
 * narrower desk: only orders past payment and not long gone, with the payment
 * side blanked out. See fulfillment-scope.ts, which holds all of it. The
 * narrowing happens here, on the data, and not in the controller: the guard
 * can say which routes a packer may call, but only the service knows which
 * order a route is about to return.
 */
@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly ordersService: OrdersService,
    private readonly paymentsService: PaymentsService,
    private readonly auditService: AuditService,
    private readonly orderClaims: OrderPaymentClaimService,
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
  async list(query: AdminOrderQuery, viewer: AccessClaims): Promise<AdminOrderList> {
    const where = this.scopedFilters(query, viewer);
    const offset = (query.page - 1) * query.pageSize;

    const [rows, [{ total }], [{ totalCopies }]] = await Promise.all([
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
      /* Copies over the whole filtered set. Its own statement for the same
         reason the item counts are: joined into the page query, the items
         would multiply the rows LIMIT is counting. */
      this.dbService.db
        .select({ totalCopies: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
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

    const redact = isFulfillment(viewer.role) ? redactSummaryForFulfillment : undefined;

    return {
      items: rows.map((row) => {
        const summary = toAdminOrderSummary(
          row,
          counts.get(row.id),
          receiptUniquenessOf(row, duplicated),
          PaymentVerificationLogService.stateOf(verifications, row.id),
        );

        return redact ? redact(summary) : summary;
      }),
      total,
      totalCopies,
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
  async exportPathaoCsv(query: AdminOrderQuery, viewer: AccessClaims): Promise<string> {
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
      .where(this.scopedFilters(query, viewer))
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
  async detail(orderNumber: string, viewer: AccessClaims): Promise<AdminOrderDetail> {
    const row = await this.requireOrder(orderNumber, viewer);

    const [paymentRows, claim, verifications, latest, reopen] = await Promise.all([
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
      this.reopenState(row),
    ]);

    const receipt = receiptUniquenessOf(
      row,
      // A set of one: the claim lookup has already decided this, so the
      // page-wide grouped query would be asking the same question twice.
      claim && row.transactionIdNormalised ? new Set([row.transactionIdNormalised]) : new Set(),
      claim?.orderNumber ?? null,
    );

    const detail = toAdminOrderDetail(
      row,
      paymentRows,
      receipt,
      PaymentVerificationLogService.stateOf(latest, row.id),
      verifications,
      reopen,
      heldClaimOf(verifications),
    );

    return isFulfillment(viewer.role) ? redactDetailForFulfillment(detail) : detail;
  }

  /**
   * "Check & confirm": claim the order's payment at the gateway, and confirm
   * the order if the claim succeeds.
   *
   * A claim is a write — it spends the payment for this order — so this is
   * an action, never a way to look. The latest outcome is already on the
   * detail page for that, and there is no read endpoint to call instead.
   *
   * Refused for a cancelled or refunded order (claiming would spend a
   * payment for an order that will not ship) and for a receipt another live
   * order holds (confirm it there, or use Accept with a reason).
   *
   * `NO_RECEIPT` short-circuits before the gateway: a cash-on-delivery order,
   * or a manual-transfer order placed before the transaction-id field was
   * required, has nothing to claim.
   */
  async verifyPayment(
    orderNumber: string,
    context: AdminContext,
  ): Promise<AdminOrderVerifyPaymentResult> {
    const order = await this.requireOrder(orderNumber, context.actor);

    if (!OrderPaymentClaimService.isClaimable(order)) {
      return {
        record: { outcome: "NO_RECEIPT" },
        summary: "No transaction ID is on file for this order.",
        confirmed: false,
      };
    }

    if (RELEASED_STATUSES.includes(order.status)) {
      throw new InvalidInputError(
        "This order is cancelled or refunded. Reopen it before claiming its payment.",
        { orderNumber, status: order.status },
      );
    }

    const holder = await findTransactionIdClaim(this.dbService.db, order.transactionId, {
      excludeOrderId: order.id,
    });

    if (holder) {
      throw new InvalidInputError(
        `This transaction ID is already recorded against order ${holder.orderNumber} ` +
          `(${holder.status}). Confirm the payment there, or accept this order with a reason ` +
          `to override.`,
        { orderNumber, claimedBy: holder.orderNumber, claimedByStatus: holder.status },
      );
    }

    // Staff asking means the order should still be granted, so a released
    // claim is retried under a new key.
    const { outcome, record } = await this.orderClaims.claim(order, context.actor.email, {
      retryReleased: true,
    });

    let confirmed = false;

    if (outcome.outcome === "CLAIMED" && order.status === "PENDING") {
      ({ confirmed } = await this.paymentsService.confirmManually(order.paymentMethod, {
        referenceId: order.orderNumber,
        status: "SUCCEEDED",
        // The order total: confirmManually checks for exact equality, and the
        // gateway has already established paid >= expected.
        amountCents: order.totalCents,
        raw: {
          source: "admin-check",
          confirmedBy: context.actor.email,
          transactionId: outcome.trxId,
          claimKey: record.claimKey ?? null,
          paidCents: outcome.paidPoisha,
          overpaidCents: outcome.overpaidPoisha,
          claimedAt: outcome.claimedAt.toISOString(),
        },
      }));

      await this.auditService.recordDetached({
        ...auditContext(context),
        action: "UPDATE",
        entityType: "orders",
        entityId: orderNumber,
        before: { status: order.status },
        after: {
          status: confirmed ? "PAYMENT_CONFIRMED" : order.status,
          paymentAmountCents: order.totalCents,
          gatewayClaim: record.claimKey ?? null,
        },
        note: "Confirmed by claiming the payment at the gateway",
      });
    }

    return { record, summary: summarizeClaim(outcome, order.totalCents), confirmed };
  }

  /**
   * What every grant passes through — `confirmPayment` and a `transition`
   * into PAYMENT_CONFIRMED — so neither door can skip it.
   *
   * ## 1. Our own receipts
   *
   * Refuse a receipt already on another live order. A duplicate is genuine
   * at the gateway by construction — a real payment that another of *our*
   * orders already holds — so only this check can catch it, and only it can
   * name the other order.
   *
   * The override is a typed reason, recorded to the audit log before the
   * grant. With it, the gateway is not asked: the other order already holds
   * the payment there, so a claim for this one could only come back
   * `already_claimed`. One payment, covering two orders, is exactly what the
   * reason says.
   *
   * ## 2. The gateway
   *
   * Claim the payment, so it is spent once across every business sharing the
   * receiving number. CLAIMED lets the grant through. Already spent elsewhere
   * is refused outright. Anything else — not arrived, unreachable, refused for
   * a reason a person can judge — needs a written `gatewayClaimOverride`; the
   * background worker then keeps trying to claim the payment after the grant.
   *
   * ## 3. A short payment
   *
   * Refused unless staff give a `shortfallOverride` reason. With one, the
   * payment is claimed again as accepted-short — so it is still spent exactly
   * once at the gateway — and the reason goes to the audit log before the
   * grant, like the other two overrides. The shortfall is returned so the
   * caller can record it on the payment.
   *
   * @returns the accepted shortfall, or null when the payment was not short.
   */
  private async guardPaymentGrant(
    order: OrderRow,
    overrides: {
      duplicateReceiptOverride?: string;
      gatewayClaimOverride?: string;
      shortfallOverride?: string;
    },
    context: AdminContext,
  ): Promise<AcceptedShortfall | null> {
    const claim = await findTransactionIdClaim(this.dbService.db, order.transactionId, {
      excludeOrderId: order.id,
    });

    if (claim) {
      const override = overrides.duplicateReceiptOverride;

      if (!override) {
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

      this.logger.warn(
        `${context.actor.email} overrode the duplicate-receipt block on ${order.orderNumber} ` +
          `(also on ${claim.orderNumber}): ${override}`,
      );

      /* `record` rather than `recordDetached`, in a transaction of its own and
         before the caller grants anything. If the justification cannot be
         written, `record` throws, this method throws, and the grant never
         runs. An override with no record of why is the one outcome worth
         failing a request over. */
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

      return null;
    }

    if (!OrderPaymentClaimService.isClaimable(order)) return null;

    const { outcome } = await this.orderClaims.claim(order, context.actor.email, {
      retryReleased: true,
    });

    if (outcome.outcome === "CLAIMED") return null;

    if (outcome.outcome === "UNDERPAID") {
      return this.acceptShortfall(order, outcome, overrides.shortfallOverride, context);
    }

    const summary = summarizeClaim(outcome, order.totalCents);

    if (outcome.outcome === "ALREADY_CLAIMED") {
      this.logger.warn(
        `${context.actor.email} tried to confirm ${order.orderNumber}; the gateway refused: ${outcome.outcome}`,
      );

      throw new PaymentClaimRefusedError(summary, {
        orderNumber: order.orderNumber,
        outcome: outcome.outcome,
      });
    }

    const override = overrides.gatewayClaimOverride;

    if (!override) {
      throw new PaymentNotClaimedError(
        `The payment gateway could not confirm this payment. ${summary} ` +
          `To confirm it anyway, give a reason.`,
        { orderNumber: order.orderNumber, outcome: outcome.outcome },
      );
    }

    this.logger.warn(
      `${context.actor.email} confirmed ${order.orderNumber} without a gateway claim ` +
        `(${outcome.outcome}): ${override}`,
    );

    // Same shape and the same reasoning as the duplicate override above.
    await this.dbService.db.transaction((tx) =>
      this.auditService.record(
        {
          ...auditContext(context),
          action: "GATEWAY_CLAIM_OVERRIDE",
          entityType: "orders",
          entityId: order.orderNumber,
          before: { gatewayOutcome: outcome.outcome },
          after: { overridden: true },
          note: override,
        },
        tx,
      ),
    );

    return null;
  }

  /**
   * The UNDERPAID branch of `guardPaymentGrant`: refuse, or — with a reason —
   * claim the payment as accepted-short and record why.
   *
   * The claim comes before the audit entry here, the other way round from the
   * two overrides above, because only the claim can say what the shortfall
   * is. If the audit write then fails, the payment is held for this order at
   * the gateway but the order is not granted; staff retry, and the same key
   * replays the claim rather than taking a second one.
   */
  private async acceptShortfall(
    order: OrderRow,
    underpaid: Extract<ClaimOutcome, { outcome: "UNDERPAID" }>,
    reason: string | undefined,
    context: AdminContext,
  ): Promise<AcceptedShortfall> {
    const summary = summarizeClaim(underpaid, order.totalCents);

    if (!reason) {
      this.logger.warn(
        `${context.actor.email} tried to confirm ${order.orderNumber}; the payment is short`,
      );

      throw new PaymentUnderpaidError(
        `${summary} To accept the shorter payment anyway, give a reason.`,
        {
          orderNumber: order.orderNumber,
          outcome: underpaid.outcome,
          expectedCents: order.totalCents,
          paidCents: underpaid.paidPoisha,
        },
      );
    }

    const { outcome } = await this.orderClaims.claim(order, context.actor.email, {
      retryReleased: true,
      acceptShortfall: true,
    });

    if (outcome.outcome !== "CLAIMED") {
      // A gateway too old to know `acceptShortfall` still answers UNDERPAID;
      // anything else changed between the two claims. Either way there is no
      // claim to grant on, and a reason does not change that.
      this.logger.warn(
        `${context.actor.email} accepted a shortfall on ${order.orderNumber}; the gateway still refused: ${outcome.outcome}`,
      );

      throw new PaymentClaimRefusedError(
        outcome.outcome === "UNDERPAID"
          ? "The payment gateway would not accept the short payment. It may need updating before short payments can be taken."
          : summarizeClaim(outcome, order.totalCents),
        { orderNumber: order.orderNumber, outcome: outcome.outcome },
      );
    }

    const shortfall: AcceptedShortfall = {
      paidCents: outcome.paidPoisha,
      underpaidCents: outcome.underpaidPoisha,
      reason,
    };

    this.logger.warn(
      `${context.actor.email} accepted ${order.orderNumber} short by ${shortfall.underpaidCents} poisha: ${reason}`,
    );

    // `record` in its own transaction, before the grant: an accepted
    // shortfall with no record of why is worth failing the request over.
    await this.dbService.db.transaction((tx) =>
      this.auditService.record(
        {
          ...auditContext(context),
          action: "SHORTFALL_ACCEPTED",
          entityType: "orders",
          entityId: order.orderNumber,
          before: { totalCents: order.totalCents, paidCents: shortfall.paidCents },
          after: { underpaidCents: shortfall.underpaidCents, gatewayClaim: true },
          note: reason,
        },
        tx,
      ),
    );

    return shortfall;
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
    const order = await this.requireOrder(orderNumber, context.actor);
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
    /* Before anything else runs, including the duplicate-receipt check below,
       which writes an audit entry when overridden. A packer's request that is
       going to be refused should leave nothing behind but the refusal. */
    if (isFulfillment(context.actor.role)) {
      const blocked = fulfillmentTransitionBlocker(
        from,
        entering,
        request.duplicateReceiptOverride ?? request.shortfallOverride,
      );

      if (blocked) {
        throw new InvalidInputError(blocked, { orderNumber, from, requested: request.status });
      }
    }

    if (entering.includes("PAYMENT_CONFIRMED")) {
      await this.guardPaymentGrant(order, request, context);
    }

    /* The machine allows PAYMENT_CONFIRMED → PENDING; this endpoint does not.
       Walking that edge is only half of undoing a confirmation — the payment
       row has to be voided and the sale un-counted in the same breath — and
       `revertPaymentConfirmation` is the only thing that does all three. A
       bare transition here would leave a SUCCEEDED payment row holding the
       order number, which makes the order unconfirmable ever after, and it
       would carry no reason.

       Refused rather than silently redirected: this is an API, and quietly
       performing a larger action than the one asked for is worse than saying
       no. */
    if (entering.includes("PENDING")) {
      throw new InvalidInputError(
        "Use the revert-payment endpoint to withdraw a confirmation; a plain transition would leave the payment record behind.",
        { orderNumber, from, requested: request.status },
      );
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

    return this.detail(orderNumber, context.actor);
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
    const order = await this.requireOrder(orderNumber, context.actor);

    if (order.paymentMethod === "cash-on-delivery") {
      throw new InvalidInputError(
        "Cash-on-delivery orders are confirmed by marking them delivered, not by recording a transfer.",
        { orderNumber, paymentMethod: order.paymentMethod },
      );
    }

    const shortfall = await this.guardPaymentGrant(order, request, context);

    const { confirmed } = await this.paymentsService.confirmManually(order.paymentMethod, {
      referenceId: order.orderNumber,
      status: "SUCCEEDED",
      amountCents: request.amountCents,
      // Stored verbatim on the payment row, so the statement line a staff
      // member matched from is recoverable months later. An accepted
      // shortfall is kept here too: the row's amount is the order total (the
      // rule every payment follows), and this is where what really arrived is
      // written down.
      raw: {
        source: "admin",
        confirmedBy: context.actor.email,
        bankReference: request.reference ?? null,
        note: request.note ?? null,
        ...(shortfall
          ? {
              paidCents: shortfall.paidCents,
              underpaidCents: shortfall.underpaidCents,
              shortfallReason: shortfall.reason,
            }
          : {}),
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

    return this.detail(orderNumber, context.actor);
  }

  /**
   * Withdraw a payment confirmation that should not have been made, and put
   * the order back to PENDING.
   *
   * The undo for the mistake the desk makes most easily: an order accepted
   * against a receipt that was never really there. Before this existed the
   * only ways out were both wrong — cancel the order, which is terminal and
   * costs a customer who is about to pay their place in the queue, or record a
   * refund for money that never arrived, which puts a fiction in the accounts
   * and cannot be told apart later from a real one.
   *
   * ## The three things it has to do together
   *
   * **Void the payment row**, which is the half that bites if it is skipped —
   * see `PaymentsService.voidConfirmed` for why an order whose row is left
   * alone can never be confirmed again.
   *
   * **Move the status**, through `transition` like everything else, so the
   * history row and the guarded update come for free. Stock is untouched by
   * construction: PENDING is not terminal, so `releasesStock` is false and the
   * copies stay reserved for the customer whose order this still is.
   *
   * **Un-count the sale**, which is not done here at all — it is done by the
   * rollup listener reacting to the status event, exactly as counting it was.
   * That is why the event below is emitted rather than skipped: without it
   * `units_sold` keeps the copies, and the next genuine confirmation counts
   * them a second time.
   *
   * One transaction for the payment row, the status and the audit entry, in
   * the atomic form `recordRefund` uses rather than the detached form
   * `transition` uses. The reasoning is the same as the refund's: a voided
   * payment whose audit entry was lost is a confirmation that vanished with
   * nobody's name on it, and unlike an ordinary transition there is no second
   * append-only record to reconstruct the *why* from.
   *
   * Refused unless the order is sitting exactly at PAYMENT_CONFIRMED. The
   * machine enforces that on its own — PENDING is reachable from nowhere else
   * — so an order already being packed gets `InvalidStatusTransitionError`,
   * which is the honest answer: at that point the question is not "was this
   * confirmed by mistake" but "where is the parcel", and that is a
   * cancellation or a refund.
   *
   * **The customer has already been emailed.** The confirmation goes out the
   * moment the order reaches PAYMENT_CONFIRMED and nothing can unsend it. No
   * correction email is sent from here — someone at the shop calls. The
   * reverted status and its note are on the tracking page, which is the most
   * this can honestly claim to have done.
   */
  async revertPaymentConfirmation(
    orderNumber: string,
    request: AdminRevertPaymentRequest,
    context: AdminContext,
  ): Promise<AdminOrderDetail> {
    const order = await this.requireOrder(orderNumber, context.actor);

    const note = request.note ?? "Payment confirmation withdrawn";

    const voidedCount = await this.dbService.db.transaction(async (tx) => {
      /* Before the transition, mirroring the order `confirmPayment` uses on
         the way in: the payment record is settled first, and the order's
         status is the consequence. If the transition is refused — someone
         moved the order to PROCESSING a second ago — the whole thing rolls
         back and the payment row is untouched. */
      const voided = await this.paymentsService.voidConfirmed(
        order.id,
        { reason: request.reason, voidedBy: context.actor.email },
        tx,
      );

      await this.ordersService.transition(order.id, "PENDING", tx, note);

      await this.auditService.record(
        {
          ...auditContext(context),
          action: "PAYMENT_REVERT",
          entityType: "orders",
          entityId: orderNumber,
          before: { status: order.status },
          // The count is on the record because zero is meaningful and looks
          // identical to one from the outside: it means the order was
          // confirmed by a transition rather than by a recorded transfer, so
          // there was no payment row to withdraw.
          after: { status: "PENDING", voidedPayments: voided },
          note: request.reason,
        },
        tx,
      );

      return voided;
    });

    /* After commit, and by hand because this method owned the transaction —
       the same rule and the same reason as `recordRefund`. This is also the
       call that un-counts the sale: the rollup listens for exactly this event,
       and without it `units_sold` keeps copies the shop has not sold. */
    this.ordersService.announceStatusChange({
      orderId: order.id,
      orderNumber: order.orderNumber,
      from: order.status,
      to: "PENDING",
    });

    this.logger.warn(
      `Payment confirmation on ${orderNumber} withdrawn by ${context.actor.email} ` +
        `(${voidedCount} payment row(s) voided): ${request.reason}`,
    );

    return this.detail(orderNumber, context.actor);
  }

  /**
   * Put an order rejected by mistake back to PENDING, for another look.
   *
   * The rules for *whether* it may be reopened live in `reopenBlocker` and are
   * re-checked here rather than trusted from the page, which may be minutes
   * old. What reopening *takes* — the copies back off the shelf, the TrxID
   * claimed again — is `OrdersService.reopen`, and it refuses if either has
   * gone to someone else in the meantime.
   *
   * One transaction for the order and the audit entry, the atomic form
   * `revertPaymentConfirmation` uses: nothing else records why a rejection
   * was undone.
   *
   * The event is announced for the same reason every status change is, though
   * no listener acts on CANCELLED → PENDING today: the sale was never counted
   * (it was cancelled from PENDING) and no email is sent until confirmation.
   */
  async reopen(
    orderNumber: string,
    request: AdminReopenOrderRequest,
    context: AdminContext,
  ): Promise<AdminOrderDetail> {
    const order = await this.requireOrder(orderNumber, context.actor);

    const { blockedReason } = await this.reopenState(order);
    if (blockedReason) {
      throw new InvalidInputError(blockedReason, { orderNumber, status: order.status });
    }

    const note = request.note ?? "Order reopened for review";

    await this.dbService.db.transaction(async (tx) => {
      await this.ordersService.reopen(order.id, tx, note);

      await this.auditService.record(
        {
          ...auditContext(context),
          action: "ORDER_REOPEN",
          entityType: "orders",
          entityId: order.orderNumber,
          before: { status: order.status },
          after: { status: "PENDING" },
          note: request.reason,
        },
        tx,
      );
    });

    this.ordersService.announceStatusChange({
      orderId: order.id,
      orderNumber: order.orderNumber,
      from: order.status,
      to: "PENDING",
    });

    this.logger.log(
      `Order ${order.orderNumber} reopened by ${context.actor.email}: ${request.reason}`,
    );

    return this.detail(order.orderNumber, context.actor);
  }

  /**
   * `reopenBlocker`, fed with when staff cancelled this order.
   *
   * Only an admin cancellation writes a TRANSITION audit entry, so its
   * presence is what tells a desk rejection from a customer's own cancel.
   * Skipped for any order that is not cancelled — the detail page loads for
   * every order, and only these need the query.
   */
  private async reopenState(row: OrderRow): Promise<AdminOrderDetail["reopen"]> {
    if (row.status !== "CANCELLED") return { allowed: false, blockedReason: null };

    const [entry] = await this.dbService.db
      .select({ createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, "orders"),
          eq(auditLog.entityId, row.orderNumber),
          eq(auditLog.action, "TRANSITION"),
          sql`${auditLog.after}->>'status' = 'CANCELLED'`,
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(1);

    const blockedReason = reopenBlocker(row.status, row.statusHistory, entry?.createdAt ?? null);

    return { allowed: blockedReason === null, blockedReason };
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
    const order = await this.requireOrder(orderNumber, context.actor);

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

    return this.detail(orderNumber, context.actor);
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
    const order = await this.requireOrder(orderNumber, context.actor);
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

    return this.detail(orderNumber, context.actor);
  }

  /**
   * Correct the transaction ID the customer typed at checkout, then claim
   * the payment under the new one.
   *
   * Only while the order is PENDING and holds no payment at the gateway.
   * After that the ID is the evidence a confirmation or a claim was made on,
   * and changing it would leave a payment held under one ID and the order
   * showing another. A confirmed order with the wrong ID is reverted first.
   *
   * The new ID moves the order to its next claim key. The gateway ties a key
   * to the transaction ID it was first sent with and refuses the same key
   * with a different ID (`idempotency_key_reused`), so reusing the old key
   * would fail as a setup error. The old key never claimed anything —
   * that is checked above — so nothing is left behind under it.
   *
   * The update is guarded on the status we read, so an order confirmed a
   * moment ago by the worker is not edited under it. The unique index on the
   * normalised ID is the backstop for two orders racing to the same receipt.
   *
   * The claim afterwards is best effort: the edit is already saved, so a
   * failure there is reported as `check: null`, not as a failed edit.
   */
  async editTransactionId(
    orderNumber: string,
    request: AdminEditTransactionIdRequest,
    context: AdminContext,
  ): Promise<AdminEditTransactionIdResult> {
    const order = await this.requireOrder(orderNumber, context.actor);
    const next = request.transactionId;

    if (order.paymentMethod !== "manual-transfer") {
      throw new InvalidInputError("Only manual-transfer orders have a transaction ID.", {
        orderNumber: order.orderNumber,
        paymentMethod: order.paymentMethod,
      });
    }

    if (order.status !== "PENDING") {
      throw new InvalidInputError(
        "The transaction ID can only be changed while the order is pending. " +
          "Revert the payment confirmation first if it was confirmed on the wrong ID.",
        { orderNumber: order.orderNumber, status: order.status },
      );
    }

    if (normaliseTrxId(next) === normaliseTrxId(order.transactionId)) {
      throw new InvalidInputError("That is the transaction ID already on this order.", {
        orderNumber: order.orderNumber,
      });
    }

    const held = heldClaimOf(await this.verificationLog.historyFor(order.id));
    if (held) {
      throw new InvalidInputError(
        `This order already holds payment ${held.transactionId} at the gateway. ` +
          `Ask a gateway admin to release it before changing the transaction ID.`,
        { orderNumber: order.orderNumber, heldTransactionId: held.transactionId },
      );
    }

    const holder = await findTransactionIdClaim(this.dbService.db, next, {
      excludeOrderId: order.id,
    });
    if (holder) {
      throw new InvalidInputError(
        `Transaction ID ${next} is already recorded against order ${holder.orderNumber} ` +
          `(${holder.status}).`,
        { orderNumber: order.orderNumber, claimedBy: holder.orderNumber },
      );
    }

    const claimKey = nextClaimKey(
      order.orderNumber,
      claimKeyFor(order.orderNumber, order.paymentClaimKey),
    );

    await this.dbService.db.transaction(async (tx) => {
      const updated = await tx
        .update(orders)
        .set({
          transactionId: next,
          paymentClaimKey: claimKey,
          paymentClaimAttempts: 0,
          paymentClaimRetryAt: null,
        })
        .where(and(eq(orders.id, order.id), eq(orders.status, "PENDING")))
        .returning({ id: orders.id });

      if (updated.length === 0) {
        throw new InvalidInputError(
          "This order is no longer pending — it changed while you were editing. Reload it.",
          { orderNumber: order.orderNumber },
        );
      }

      await this.auditService.record(
        {
          ...auditContext(context),
          action: "TRANSACTION_ID_EDIT",
          entityType: "orders",
          entityId: order.orderNumber,
          before: { transactionId: order.transactionId, paymentClaimKey: order.paymentClaimKey },
          after: { transactionId: next, paymentClaimKey: claimKey },
          note: request.reason,
        },
        tx,
      );
    });

    this.logger.log(
      `Transaction ID on ${order.orderNumber} changed by ${context.actor.email}: ` +
        `${order.transactionId ?? "(none)"} → ${next} (${request.reason})`,
    );

    let check: AdminOrderVerifyPaymentResult | null = null;
    try {
      check = await this.verifyPayment(order.orderNumber, context);
    } catch (error) {
      this.logger.warn(
        `Saved the new transaction ID on ${order.orderNumber}, but claiming it failed: ${String(error)}`,
      );
    }

    return { order: await this.detail(order.orderNumber, context.actor), check };
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
  private async requireOrder(orderNumber: string, viewer: AccessClaims): Promise<OrderRow> {
    const normalised = orderNumber.trim().toUpperCase();

    const row = await findOrder(this.dbService.db, eq(orders.orderNumber, normalised));

    if (!row) throw new ResourceNotFoundError("Order", normalised);

    /* The same 404 as an order that does not exist, not a 403. A packer
       typing numbers into the URL learns nothing about which ones are real
       and merely outside their view — and every write in this service goes
       through here first, so an out-of-scope order cannot be acted on either. */
    if (isFulfillment(viewer.role) && !isInFulfillmentScope(row)) {
      throw new ResourceNotFoundError("Order", normalised);
    }

    return row;
  }

  /**
   * The caller's filters, narrowed to the packer's scope when the caller is
   * a packer. `list` and `exportPathaoCsv` both read through this, so the
   * courier manifest can never carry an order the queue would not have shown.
   */
  private scopedFilters(query: AdminOrderQuery, viewer: AccessClaims): SQL | undefined {
    const filters = adminOrderFilters(query);

    if (!isFulfillment(viewer.role)) return filters;

    return filters ? and(filters, fulfillmentOrderScope()) : fulfillmentOrderScope();
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

/** A short payment staff chose to take, as `guardPaymentGrant` reports it. */
type AcceptedShortfall = { paidCents: number; underpaidCents: number; reason: string };

/** One or two sentences for staff, describing what the gateway said. */
function summarizeClaim(outcome: ClaimOutcome, expectedCents: number): string {
  const amount = (cents: number) =>
    (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

  switch (outcome.outcome) {
    case "CLAIMED":
      return (
        `Claimed — ৳${amount(outcome.paidPoisha)} received via ${outcome.platform}.` +
        (outcome.overpaidPoisha > 0
          ? ` Overpaid by ৳${amount(outcome.overpaidPoisha)}: refund or credit the customer.`
          : "") +
        (outcome.underpaidPoisha > 0
          ? ` Short by ৳${amount(outcome.underpaidPoisha)}, accepted by staff.`
          : "")
      );
    case "PENDING_ARRIVAL":
      return "The payment SMS has not reached the gateway yet. It usually arrives within a few minutes.";
    case "UNDERPAID":
      return (
        `Underpaid — ${outcome.paidPoisha === null ? "less than the total" : `৳${amount(outcome.paidPoisha)}`} ` +
        `received, ৳${amount(expectedCents)} expected. The payment stays unclaimed so the customer can ` +
        `top up, or staff can accept it short with a reason.`
      );
    case "ALREADY_CLAIMED":
      return (
        "This payment has already been spent by another order or business" +
        (outcome.claimedAt ? ` (claimed ${outcome.claimedAt.toISOString()}).` : ".")
      );
    case "RELEASED":
      return "A gateway admin released this order's earlier claim.";
    case "REJECTED":
      return `The gateway refused it: ${outcome.reason}`;
    case "MISCONFIGURED":
      return `Gateway setup problem — ${outcome.reason}`;
    case "UNAVAILABLE":
      return `Could not reach the gateway — ${outcome.reason}`;
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
