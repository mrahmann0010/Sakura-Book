import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { cartQuoteRequestSchema, type CartQuote } from "@sakura/contracts";
import { createZodDto } from "nestjs-zod";
import { toCartQuote } from "./priced-cart";
import { PricingService } from "./pricing.service";

class CartQuoteDto extends createZodDto(cartQuoteRequestSchema) {}

/**
 * `/cart` rather than `/pricing`, because the resource being priced is the
 * cart and the URL is the client's vocabulary, not our module layout. There is
 * still no cart table and this endpoint creates nothing — the contents arrive
 * in the body every time.
 */
@ApiTags("cart")
@Controller("cart")
export class CartController {
  constructor(private readonly pricingService: PricingService) {}

  /**
   * Price a cart. Replaces `buildCart()`/`priceCart()` in the browser bundle,
   * along with the FREE_DELIVERY_THRESHOLD and DELIVERY_FLAT constants that
   * shipped with it — shop policy a customer could edit in devtools and then
   * send back to us.
   *
   * POST for a read, for the same reason /coupons/validate is: the cart is the
   * request data. A GET would need the whole basket and any discount code in
   * the query string, i.e. in access logs and browser history, and would blow
   * past URL length limits on a large cart besides.
   *
   * 200 with `rejected` lines rather than 4xx when part of the cart cannot be
   * priced. A stale localStorage cart is the expected case after any deploy
   * that delists a title, and the page's job is to render the remaining total
   * and say what happened — not to handle an error.
   */
  @Post("quote")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Price a cart: lines, delivery, discount, total" })
  async quote(@Body() body: CartQuoteDto): Promise<CartQuote> {
    const priced = await this.pricingService.priceCart(body.items, {
      couponCode: body.couponCode,
      region: body.region,
    });

    // Narrowed rather than returned whole: PricedCart carries the coupon's
    // internal id for checkout's benefit, and that must not cross the wire.
    return toCartQuote(priced);
  }
}
