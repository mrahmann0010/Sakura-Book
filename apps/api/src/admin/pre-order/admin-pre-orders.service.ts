import { Injectable } from "@nestjs/common";
import type {
  AdminPreOrderDetail,
  AdminPreOrderFulfillmentTransition,
  AdminPreOrderInternalNote,
  AdminPreOrderList,
  AdminPreOrderPaymentDecision,
  AdminPreOrderQuery,
} from "@sakura/contracts";
import { and, eq, sql } from "drizzle-orm";
import { ResourceNotFoundError } from "../../common/errors";
import { DbService } from "../../db/db.service";
import { preOrderOrders } from "../../db/schema";
import {
  InvalidPreOrderFulfillmentTransitionError,
  InvalidPreOrderPaymentTransitionError,
  PreOrderPaymentNotAcceptedError,
  canStartFulfillment,
  canTransitionFulfillment,
  canTransitionPayment,
  type PreOrderRow,
} from "../../pre-orders";
import { AuditService } from "../audit/audit.service";
import type { AdminContext } from "../orders";
import { toAdminPreOrderDetail, toAdminPreOrderSummary } from "./admin-pre-order.mapper";
import { adminPreOrderFilters, adminPreOrderOrder } from "./admin-pre-order.query";

/**
 * The pre-order desk.
 *
 * Two jobs, months apart, which is why there are two status methods rather
 * than one: someone reads a bKash transaction ID and decides whether we accept
 * the money, and — much later, once the print run lands — someone else moves
 * parcels. Collapsing them into a single `transition` endpoint would put both
 * in one dropdown and imply a sequence that does not exist.
 *
 * Unlike AdminOrdersService this service *does* write its own status columns.
 * That service is forbidden from writing `orders.status` because a domain
 * service (OrdersService.transition) already owns that column and does stock
 * and event work alongside it. Pre-orders have no such owner: nothing else
 * writes these two columns, there is no stock to return (the book is not
 * printed) and no event to emit, so a second write path here would be a
 * service that exists only to be delegated to. The machine, not the caller,
 * still decides what is legal — that part is not negotiable and lives in
 * pre-order-status.machine.ts.
 */
@Injectable()
export class AdminPreOrdersService {
  constructor(
    private readonly dbService: DbService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * One page of the queue.
   *
   * Two statements rather than a window function, matching the order queue:
   * a count that returns no row on an empty page is how a "0 results" view
   * becomes a crash.
   */
  async list(query: AdminPreOrderQuery): Promise<AdminPreOrderList> {
    const where = adminPreOrderFilters(query);
    const offset = (query.page - 1) * query.pageSize;

    const [rows, [{ total }]] = await Promise.all([
      this.dbService.db
        .select()
        .from(preOrderOrders)
        .where(where)
        .orderBy(...adminPreOrderOrder(query.sort))
        .limit(query.pageSize)
        .offset(offset),
      this.dbService.db
        .select({ total: sql<number>`count(*)::int` })
        .from(preOrderOrders)
        .where(where),
    ]);

    return {
      items: rows.map(toAdminPreOrderSummary),
      total,
      page: query.page,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async detail(orderNumber: string): Promise<AdminPreOrderDetail> {
    return toAdminPreOrderDetail(await this.requirePreOrder(orderNumber));
  }

  /**
   * Accept or reject the payment.
   *
   * The update is guarded on the status that was read, not just on the id.
   * Two staff members opening the same unverified pre-order and both clicking
   * Accept is not hypothetical — it is what a shared queue does on a busy
   * morning — and without the guard the second write silently overwrites the
   * first, with two audit entries claiming to be the transition.
   */
  async decidePayment(
    orderNumber: string,
    request: AdminPreOrderPaymentDecision,
    context: AdminContext,
  ): Promise<AdminPreOrderDetail> {
    const row = await this.requirePreOrder(orderNumber);
    const from = row.paymentStatus;

    if (!canTransitionPayment(from, request.status)) {
      throw new InvalidPreOrderPaymentTransitionError(row.orderNumber, from, request.status);
    }

    await this.dbService.db.transaction(async (tx) => {
      const updated = await tx
        .update(preOrderOrders)
        .set({ paymentStatus: request.status })
        .where(and(eq(preOrderOrders.id, row.id), eq(preOrderOrders.paymentStatus, from)))
        .returning({ id: preOrderOrders.id });

      if (updated.length === 0) {
        // Someone else moved it between our read and our write. Re-reading and
        // retrying would be guessing at their intent, so this reports the same
        // refusal the machine would have given had we read the newer value.
        throw new InvalidPreOrderPaymentTransitionError(row.orderNumber, from, request.status);
      }

      /**
       * Atomic with the change, unlike AdminOrdersService.transition's
       * detached entry. That service accepts a degraded record because
       * `order_status_history` independently proves the move happened;
       * pre-orders have no history table, so this audit row is the only trace
       * of who accepted the money — losing it would leave an accepted payment
       * nobody is accountable for.
       */
      await this.auditService.record(
        {
          ...auditContext(context),
          action: "TRANSITION",
          entityType: "pre_order_orders",
          entityId: row.orderNumber,
          before: { paymentStatus: from },
          after: { paymentStatus: request.status },
          note: request.note,
        },
        tx,
      );
    });

    return this.detail(row.orderNumber);
  }

  /**
   * Move the parcel along.
   *
   * Both gates are checked, and the payment one first: "you have not verified
   * the money yet" is the more useful answer when both are true, because it
   * names the thing the operator has to go and do.
   */
  async transitionFulfillment(
    orderNumber: string,
    request: AdminPreOrderFulfillmentTransition,
    context: AdminContext,
  ): Promise<AdminPreOrderDetail> {
    const row = await this.requirePreOrder(orderNumber);
    const from = row.fulfillmentStatus;

    if (request.status !== "CANCELLED" && !canStartFulfillment(row.paymentStatus)) {
      throw new PreOrderPaymentNotAcceptedError(row.orderNumber, row.paymentStatus);
    }

    if (!canTransitionFulfillment(from, request.status)) {
      throw new InvalidPreOrderFulfillmentTransitionError(row.orderNumber, from, request.status);
    }

    await this.dbService.db.transaction(async (tx) => {
      const updated = await tx
        .update(preOrderOrders)
        .set({ fulfillmentStatus: request.status })
        .where(and(eq(preOrderOrders.id, row.id), eq(preOrderOrders.fulfillmentStatus, from)))
        .returning({ id: preOrderOrders.id });

      if (updated.length === 0) {
        throw new InvalidPreOrderFulfillmentTransitionError(row.orderNumber, from, request.status);
      }

      await this.auditService.record(
        {
          ...auditContext(context),
          action: "TRANSITION",
          entityType: "pre_order_orders",
          entityId: row.orderNumber,
          before: { fulfillmentStatus: from },
          after: { fulfillmentStatus: request.status },
          note: request.note,
        },
        tx,
      );
    });

    return this.detail(row.orderNumber);
  }

  /**
   * Replace the staff-only note. The previous value goes to the audit entry,
   * which is what makes replacing rather than appending safe — see the same
   * method on AdminOrdersService.
   */
  async setInternalNote(
    orderNumber: string,
    request: AdminPreOrderInternalNote,
    context: AdminContext,
  ): Promise<AdminPreOrderDetail> {
    const row = await this.requirePreOrder(orderNumber);
    const next = request.note?.trim() || null;

    await this.dbService.db.transaction(async (tx) => {
      await tx
        .update(preOrderOrders)
        .set({ internalNote: next })
        .where(eq(preOrderOrders.id, row.id));

      await this.auditService.record(
        {
          ...auditContext(context),
          action: "UPDATE",
          entityType: "pre_order_orders",
          entityId: row.orderNumber,
          before: { internalNote: row.internalNote },
          after: { internalNote: next },
        },
        tx,
      );
    });

    return this.detail(row.orderNumber);
  }

  /** The pre-order behind a number, or a 404. Normalised upward, as staff type it. */
  private async requirePreOrder(orderNumber: string): Promise<PreOrderRow> {
    const normalised = orderNumber.trim().toUpperCase();

    const [row] = await this.dbService.db
      .select()
      .from(preOrderOrders)
      .where(eq(preOrderOrders.orderNumber, normalised))
      .limit(1);

    if (!row) throw new ResourceNotFoundError("Pre-order", normalised);

    return row;
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
