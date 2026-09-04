import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  adminConfirmPaymentRequestSchema,
  adminInternalNoteRequestSchema,
  adminOrderQuerySchema,
  adminOrderTransitionRequestSchema,
  adminRecordRefundRequestSchema,
  adminRevertPaymentRequestSchema,
  type AdminOrderDetail,
  type AdminOrderList,
  type AdminOrderVerifyPaymentResult,
} from "@sakura/contracts";
import type { Request, Response } from "express";
import { createZodDto } from "nestjs-zod";
import { CurrentAdmin, Roles } from "../auth/admin-auth.decorators";
import type { AccessClaims } from "../auth/tokens";
import { AdminOrdersService, type AdminContext } from "./admin-orders.service";

class AdminOrderQueryDto extends createZodDto(adminOrderQuerySchema) {}
class AdminOrderTransitionDto extends createZodDto(adminOrderTransitionRequestSchema) {}
class AdminConfirmPaymentDto extends createZodDto(adminConfirmPaymentRequestSchema) {}
class AdminRecordRefundDto extends createZodDto(adminRecordRefundRequestSchema) {}
class AdminRevertPaymentDto extends createZodDto(adminRevertPaymentRequestSchema) {}
class AdminInternalNoteDto extends createZodDto(adminInternalNoteRequestSchema) {}

/**
 * The fulfilment desk, over HTTP.
 *
 * Every route here is authenticated by AdminJwtGuard, which applies because
 * the controller path starts with `admin/` — see the guard for why that is
 * matched on the controller's metadata rather than on the request URL.
 *
 * Most routes carry no `@Roles`, which means any signed-in admin including
 * STAFF. That is the deliberate default: moving orders through the lifecycle
 * *is* the staff job, and requiring ADMIN for it would leave the shop unable
 * to ship anything unless the owner is at a keyboard. The exception is the
 * refund, below.
 *
 * Addressed by order number throughout. It is what staff have in front of
 * them, and it keeps the UUID out of URLs and browser history on the admin
 * side exactly as the storefront keeps it out on the customer side.
 */
@ApiTags("admin-orders")
@Controller("admin/orders")
export class AdminOrdersController {
  constructor(private readonly adminOrdersService: AdminOrdersService) {}

  /**
   * The queue.
   *
   * No cache headers, unlike the catalog. A fulfilment list is the one view in
   * this API where a stale response is actively harmful: two staff members
   * working from a sixty-second-old queue will both pick the same order.
   */
  @Get()
  @ApiOperation({ summary: "Browse orders: filter by status, method, date, free text." })
  async list(@Query() query: AdminOrderQueryDto): Promise<AdminOrderList> {
    return this.adminOrdersService.list(query);
  }

  /**
   * The filtered list as a Pathao bulk-order CSV, unpaginated.
   *
   * Declared above `:orderNumber` and not below it. Express matches routes in
   * registration order, so a literal path that shares a segment with a
   * parameter has to come first — the other way round, this would be a lookup
   * for the order numbered "export.csv", and the bug would be a 404 that looks
   * like a missing feature rather than a routing mistake.
   *
   * Not `@Roles("ADMIN")`, unlike the waitlist's export, and the difference is
   * deliberate. That file is the shop's entire marketing contact list and has
   * no reason to leave the building; this one is a courier manifest whose
   * whole purpose is to be handed to Pathao, by whoever is packing parcels
   * that morning. Gating it on ADMIN would mean nothing ships unless the owner
   * is at a keyboard, which is the same reasoning that leaves the transitions
   * open to STAFF.
   */
  @Get("export.csv")
  @ApiOperation({ summary: "Export the filtered orders as a Pathao bulk-order CSV." })
  async exportPathaoCsv(
    @Query() query: AdminOrderQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const csv = await this.adminOrdersService.exportPathaoCsv(query);
    const stamp = new Date().toISOString().slice(0, 10);

    response.setHeader("content-type", "text/csv; charset=utf-8");
    response.setHeader("content-disposition", `attachment; filename="pathao-${stamp}.csv"`);

    return csv;
  }

  @Get(":orderNumber")
  @ApiOperation({ summary: "Full order, with payments and the transitions it allows." })
  async detail(@Param("orderNumber") orderNumber: string): Promise<AdminOrderDetail> {
    return this.adminOrdersService.detail(orderNumber);
  }

  /**
   * Cross-check the transaction ID on file against the SMS gateway.
   *
   * No request body, deliberately — the ID is read off the stored order
   * rather than accepted from the caller, so this can't be used to probe
   * arbitrary transaction IDs. Purely informational: it never changes the
   * order's status. See `AdminOrdersService.verifyPayment`.
   */
  @Post(":orderNumber/verify-payment")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Re-check the order's transaction ID against the SMS gateway." })
  async verifyPayment(
    @Param("orderNumber") orderNumber: string,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminOrderVerifyPaymentResult> {
    // The actor is threaded through even though this writes no order, because
    // the check itself is now recorded and "who looked" is the point of
    // recording it.
    return this.adminOrdersService.verifyPayment(orderNumber, contextOf(admin, request));
  }

  /**
   * Move an order along.
   *
   * The target status is in the body rather than the path, so this is one
   * route rather than seven — and, more usefully, so the state machine stays
   * the only thing that decides which moves are legal. A `POST /:n/ship` route
   * per status would put a second, implicit copy of the lifecycle in the URL
   * space, and the day a status is added there would be a route missing.
   *
   * Returns the full order rather than 204, so the panel re-renders the
   * timeline and the newly-allowed transitions from the response instead of
   * guessing and refetching.
   */
  @Post(":orderNumber/transition")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Move an order to a new status, through the state machine." })
  async transition(
    @Param("orderNumber") orderNumber: string,
    @Body() body: AdminOrderTransitionDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminOrderDetail> {
    return this.adminOrdersService.transition(orderNumber, body, contextOf(admin, request));
  }

  /**
   * Record a bank or bKash transfer.
   *
   * STAFF may do this: matching a statement line against an order is the daily
   * job of whoever opens the bank app, and gating it on ADMIN would make the
   * owner a bottleneck on every manual payment. The amount is checked against
   * the order total inside PaymentsService, so a staff member cannot confirm
   * an order for the wrong figure even by accident.
   */
  @Post(":orderNumber/payments/confirm")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Record an out-of-band transfer and confirm the order." })
  async confirmPayment(
    @Param("orderNumber") orderNumber: string,
    @Body() body: AdminConfirmPaymentDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminOrderDetail> {
    return this.adminOrdersService.confirmPayment(orderNumber, body, contextOf(admin, request));
  }

  /**
   * Withdraw a payment confirmation made in error. **ADMIN only.**
   *
   * Unlike confirming, which STAFF do all day from the bank app, this walks an
   * order backwards through a lifecycle that otherwise only moves forward, and
   * it erases a payment record. The line ADMIN_ROLES draws is "can this person
   * change what a customer pays", and un-saying that a customer paid is on the
   * far side of it. Confirming in error is recoverable by asking the owner;
   * quietly un-confirming is how a paid order goes back to looking unpaid with
   * nobody accountable.
   */
  @Post(":orderNumber/payments/revert")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Withdraw a payment confirmation and return the order to pending." })
  async revertPayment(
    @Param("orderNumber") orderNumber: string,
    @Body() body: AdminRevertPaymentDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminOrderDetail> {
    return this.adminOrdersService.revertPaymentConfirmation(
      orderNumber,
      body,
      contextOf(admin, request),
    );
  }

  /**
   * Record a refund. **ADMIN only**, like the revert above.
   *
   * The line drawn in ADMIN_ROLES is "can this person change what a customer
   * pays", and a refund is the sharpest instance of it: it is the only action
   * in the panel that moves money out of the shop, and it is irreversible in
   * the sense that matters — REFUNDED is terminal, so there is no undo, only a
   * new order.
   */
  @Post(":orderNumber/refund")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Record a refund issued out of band. Does not move money." })
  async refund(
    @Param("orderNumber") orderNumber: string,
    @Body() body: AdminRecordRefundDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminOrderDetail> {
    return this.adminOrdersService.recordRefund(orderNumber, body, contextOf(admin, request));
  }

  /**
   * The staff-only note. PATCH rather than POST — it replaces one field on an
   * existing resource, and nothing is created.
   */
  @Patch(":orderNumber/note")
  @ApiOperation({ summary: "Replace the internal note. Previous value goes to the audit log." })
  async setNote(
    @Param("orderNumber") orderNumber: string,
    @Body() body: AdminInternalNoteDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminOrderDetail> {
    return this.adminOrdersService.setInternalNote(orderNumber, body, contextOf(admin, request));
  }
}

function contextOf(actor: AccessClaims, request: Request): AdminContext {
  return {
    actor,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  };
}
