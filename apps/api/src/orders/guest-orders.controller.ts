import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  orderCancelRequestSchema,
  orderLookupRequestSchema,
  type Order,
} from "@sakura/contracts";
import { StrictThrottle } from "../common/throttling/strict-throttle.decorator";
import { createZodDto } from "nestjs-zod";
import { OrdersService } from "./orders.service";

class OrderLookupDto extends createZodDto(orderLookupRequestSchema) {}
class OrderCancelDto extends createZodDto(orderCancelRequestSchema) {}

/**
 * What a customer can do with an order they already placed.
 *
 * A separate controller from OrdersController even though both sit under
 * `/orders`, because the two have different threat models: placing an order
 * needs no prior knowledge, while everything here is authenticated by an order
 * number plus a matching email and is therefore an enumeration target. Keeping
 * them apart means the hard throttle on these cannot be loosened by a change
 * aimed at checkout.
 */
@ApiTags("orders")
@Controller("orders")
export class GuestOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * POST for a read, and not for the usual "the body is the query" reason.
   *
   * The email is the credential here. A GET would put it in the URL, and so
   * into browser history, `Referer` headers, and every access log between the
   * customer and us — for a value that, paired with an order number, is the
   * entire authentication of this endpoint. 200 rather than 201 because
   * nothing is created.
   */
  @Post("lookup")
  @HttpCode(HttpStatus.OK)
  // The hard one. This endpoint is the enumeration oracle the NOT_FOUND-on-
  // mismatch rule exists to close, and that rule only works if guessing is slow.
  @StrictThrottle()
  @ApiOperation({ summary: "Look up an order by number and email. Mismatch returns 404." })
  async lookup(@Body() body: OrderLookupDto): Promise<Order> {
    return this.ordersService.lookup(body);
  }

  /**
   * Cancel an order, and put its stock back on the shelf.
   *
   * POST with the credential in the body, like lookup — but note this one
   * *writes*, so the same enumeration limit is doing more work: a guessed order
   * number plus a guessed email would cancel a stranger's order rather than
   * merely read it. The order number is random rather than sequential
   * specifically so that guessing both is not a search anyone can run.
   *
   * Returns the order in its cancelled state rather than 204, so the client
   * renders the new status and timeline from the response instead of
   * optimistically guessing what happened and then refetching.
   *
   * Refusals are the machine's: after the parcel ships this is a 422 naming the
   * statuses that were allowed, because at that point the answer is a refund,
   * which moves money and is not self-service.
   */
  @Post("cancel")
  @HttpCode(HttpStatus.OK)
  @StrictThrottle()
  @ApiOperation({ summary: "Cancel an unshipped order. Mismatch returns 404." })
  async cancel(@Body() body: OrderCancelDto): Promise<Order> {
    return this.ordersService.cancel(body);
  }
}
