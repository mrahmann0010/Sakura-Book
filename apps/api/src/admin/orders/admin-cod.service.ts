import { Injectable, Logger } from "@nestjs/common";
import type {
  AdminApproveCodRequest,
  AdminDenyCodRequest,
  AdminOrderDetail,
  OrderStatus,
} from "@sakura/contracts";
import { eq } from "drizzle-orm";
import { AuditService } from "../../audit";
import { InvalidInputError, ResourceNotFoundError } from "../../common/errors";
import { DbService } from "../../db/db.service";
import { orders } from "../../db/schema";
import { OrdersService } from "../../orders";
import { SmsService } from "../../sms";
import { AdminOrdersService, type AdminContext } from "./admin-orders.service";
import { COD_APPROVED_NOTE, COD_DENIED_NOTE, codApprovedSms } from "./cod-approval";

/**
 * Approving and denying cash-on-delivery orders (docs/cod-orders.md Step 1).
 *
 * A COD order is placed with nothing paid and waits in PENDING until the
 * customer messages the shop's Facebook page. Staff check the order against
 * the conversation and the customer's profile, then approve it into
 * fulfilment or turn it down. These are the only two ways a COD order leaves
 * PENDING from the panel — `AdminOrdersService.transition` refuses both moves
 * (see `codPendingTransitionBlocker`), so the record below is never skipped.
 *
 * Its own service rather than two more methods on AdminOrdersService: that
 * class is the whole desk already, and this flow needs SMS, which nothing
 * else there does.
 *
 * Open to STAFF and ADMIN, closed to packers by the controller's default —
 * the same line as confirming a bKash transfer, which is the same job:
 * deciding whether an order may be sent.
 */
@Injectable()
export class AdminCodService {
  private readonly logger = new Logger(AdminCodService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly ordersService: OrdersService,
    private readonly auditService: AuditService,
    private readonly smsService: SmsService,
    private readonly adminOrders: AdminOrdersService,
  ) {}

  /**
   * Accept a COD order for packing, recording how the customer confirmed.
   *
   * The order moves to PAYMENT_CONFIRMED, which for COD means "accepted for
   * fulfilment" — its payment status stays UNPAID until delivery (see
   * `nextPaymentStatus`). Status, confirmation columns and audit entry commit
   * together; the customer's SMS goes after commit and never fails the
   * approval.
   */
  async approve(
    orderNumber: string,
    request: AdminApproveCodRequest,
    context: AdminContext,
  ): Promise<AdminOrderDetail> {
    const order = await this.requirePendingCod(orderNumber);
    const note = request.note?.trim() || null;

    await this.dbService.db.transaction(async (tx) => {
      await this.ordersService.transition(order.id, "PAYMENT_CONFIRMED", tx, COD_APPROVED_NOTE);

      await tx
        .update(orders)
        .set({
          codConfirmedAt: new Date(),
          codConfirmedBy: context.actor.email,
          codConfirmationChannel: request.channel,
          codConfirmationNote: note,
        })
        .where(eq(orders.id, order.id));

      await this.auditService.record(
        {
          ...auditContext(context),
          action: "COD_APPROVED",
          entityType: "orders",
          entityId: order.orderNumber,
          before: { status: "PENDING" },
          after: { status: "PAYMENT_CONFIRMED", channel: request.channel },
          note: note ?? undefined,
        },
        tx,
      );
    });

    this.announce(order, "PAYMENT_CONFIRMED");
    this.logger.log(
      `COD order ${order.orderNumber} approved by ${context.actor.email} (${request.channel})`,
    );

    /* Not awaited. The send is bounded by SMS_GATEWAY_TIMEOUT_MS, but the
       person at the desk should not wait on a phone's gateway to see the
       order move, and a failed text is a follow-up message, not a reason to
       undo an approval that has already committed. */
    void this.textApproval(order.orderNumber, order.customerPhone);

    return this.adminOrders.detail(order.orderNumber, context.actor);
  }

  /**
   * Turn a COD order down. The copies go back on the shelf (the transition
   * does that), the customer's tracking page says only that the order could
   * not be confirmed, and the staff member's reason goes to the audit log.
   *
   * The audit entry records `after.status = CANCELLED`, which is what lets
   * the order be reopened if the denial was a mistake — see
   * `AdminOrdersService.reopenState`.
   */
  async deny(
    orderNumber: string,
    request: AdminDenyCodRequest,
    context: AdminContext,
  ): Promise<AdminOrderDetail> {
    const order = await this.requirePendingCod(orderNumber);

    await this.dbService.db.transaction(async (tx) => {
      await this.ordersService.transition(order.id, "CANCELLED", tx, COD_DENIED_NOTE);

      await this.auditService.record(
        {
          ...auditContext(context),
          action: "COD_DENIED",
          entityType: "orders",
          entityId: order.orderNumber,
          before: { status: "PENDING" },
          after: { status: "CANCELLED" },
          note: request.reason,
        },
        tx,
      );
    });

    this.announce(order, "CANCELLED");
    this.logger.log(
      `COD order ${order.orderNumber} denied by ${context.actor.email}: ${request.reason}`,
    );

    return this.adminOrders.detail(order.orderNumber, context.actor);
  }

  private async requirePendingCod(orderNumber: string) {
    const normalised = orderNumber.trim().toUpperCase();

    const order = await this.dbService.db.query.orders.findFirst({
      where: (row, { eq: equals }) => equals(row.orderNumber, normalised),
      columns: {
        id: true,
        orderNumber: true,
        status: true,
        paymentMethod: true,
        customerPhone: true,
      },
    });

    if (!order) throw new ResourceNotFoundError("Order", normalised);

    if (order.paymentMethod !== "cash-on-delivery") {
      throw new InvalidInputError("Only cash-on-delivery orders are approved this way.", {
        orderNumber: normalised,
        paymentMethod: order.paymentMethod,
      });
    }

    if (order.status !== "PENDING") {
      throw new InvalidInputError("This order has already been approved or closed.", {
        orderNumber: normalised,
        status: order.status,
      });
    }

    return order;
  }

  /** After commit, like every other emitter — see OrdersService.announceStatusChange. */
  private announce(order: { id: string; orderNumber: string }, to: OrderStatus): void {
    this.ordersService.announceStatusChange({
      orderId: order.id,
      orderNumber: order.orderNumber,
      from: "PENDING",
      to,
    });
  }

  private async textApproval(orderNumber: string, phone: string): Promise<void> {
    try {
      await this.smsService.send(phone, codApprovedSms(orderNumber));
    } catch (error) {
      this.logger.warn(
        `Approval SMS for ${orderNumber} did not send: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function auditContext(context: AdminContext) {
  return {
    actor: { sub: context.actor.sub, email: context.actor.email },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  };
}
