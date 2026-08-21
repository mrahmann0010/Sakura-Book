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
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  adminPreOrderFulfillmentTransitionSchema,
  adminPreOrderInternalNoteSchema,
  adminPreOrderPaymentDecisionSchema,
  adminPreOrderQuerySchema,
  type AdminPreOrderDetail,
  type AdminPreOrderList,
} from "@sakura/contracts";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import { CurrentAdmin } from "../auth/admin-auth.decorators";
import type { AccessClaims } from "../auth/tokens";
import type { AdminContext } from "../orders";
import { AdminPreOrdersService } from "./admin-pre-orders.service";

class AdminPreOrderQueryDto extends createZodDto(adminPreOrderQuerySchema) {}
class AdminPreOrderPaymentDecisionDto extends createZodDto(adminPreOrderPaymentDecisionSchema) {}
class AdminPreOrderFulfillmentDto extends createZodDto(adminPreOrderFulfillmentTransitionSchema) {}
class AdminPreOrderNoteDto extends createZodDto(adminPreOrderInternalNoteSchema) {}

/**
 * The pre-order desk, over HTTP.
 *
 * Authenticated by AdminJwtGuard through the `admin/` path prefix, like every
 * other controller here. No `@Roles` on any route: verifying a transfer and
 * dispatching a parcel are the staff job, and requiring ADMIN would leave the
 * shop unable to accept a pre-order unless the owner is at a keyboard. The
 * money-moving exception that justifies `@Roles("ADMIN")` on the orders
 * refund does not exist here — nothing on this controller moves money, and
 * REFUNDED is reachable only as a record of a transfer sent by hand.
 *
 * Two status routes rather than one, mirroring the two columns. A single
 * `/transition` taking either kind of status would have to demultiplex on the
 * value, which is a switch that gets a new arm every time either enum grows,
 * and it would make "accept the payment" and "mark it shipped" look like steps
 * in one sequence when they are months and two people apart.
 */
@ApiTags("admin-pre-orders")
@Controller("admin/pre-orders")
export class AdminPreOrdersController {
  constructor(private readonly service: AdminPreOrdersService) {}

  /** The queue. Never cached — a stale fulfilment list is actively wrong. */
  @Get()
  @ApiOperation({
    summary: "Browse pre-orders: filter by either status track, method, date, text.",
  })
  async list(@Query() query: AdminPreOrderQueryDto): Promise<AdminPreOrderList> {
    return this.service.list(query);
  }

  @Get(":orderNumber")
  @ApiOperation({ summary: "Full pre-order, with the moves each track allows." })
  async detail(@Param("orderNumber") orderNumber: string): Promise<AdminPreOrderDetail> {
    return this.service.detail(orderNumber);
  }

  /**
   * Accept or reject the payment, having read the transaction ID.
   *
   * Returns the full pre-order rather than 204, so the panel re-renders both
   * tracks and their newly-allowed moves from the response — accepting a
   * payment is precisely what unlocks the fulfilment buttons, and a client
   * that had to guess at that would have to know the cross-track rule too.
   */
  @Post(":orderNumber/payment")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Accept, reject or refund the pre-order's payment." })
  async decidePayment(
    @Param("orderNumber") orderNumber: string,
    @Body() body: AdminPreOrderPaymentDecisionDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminPreOrderDetail> {
    return this.service.decidePayment(orderNumber, body, contextOf(admin, request));
  }

  /** Move the parcel along. Refused unless the payment is accepted. */
  @Post(":orderNumber/fulfillment")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Move the pre-order's delivery status through its lifecycle." })
  async transitionFulfillment(
    @Param("orderNumber") orderNumber: string,
    @Body() body: AdminPreOrderFulfillmentDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminPreOrderDetail> {
    return this.service.transitionFulfillment(orderNumber, body, contextOf(admin, request));
  }

  @Patch(":orderNumber/note")
  @ApiOperation({ summary: "Replace the internal note. Previous value goes to the audit log." })
  async setNote(
    @Param("orderNumber") orderNumber: string,
    @Body() body: AdminPreOrderNoteDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminPreOrderDetail> {
    return this.service.setInternalNote(orderNumber, body, contextOf(admin, request));
  }
}

function contextOf(actor: AccessClaims, request: Request): AdminContext {
  return {
    actor,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  };
}
