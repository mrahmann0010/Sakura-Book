import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  couponValidateRequestSchema,
  type CouponEvaluation as CouponEvaluationContract,
} from "@sakura/contracts";
import { createZodDto } from "nestjs-zod";
import { StrictThrottle } from "../common/throttling/strict-throttle.decorator";
import { CouponsService } from "./coupons.service";

/**
 * The DTO is the contract schema, not a copy of it. `createZodDto` wraps it so
 * Nest can use it as a parameter type and Swagger can document it, but the
 * validation the pipe runs is the same object the frontend's form runs.
 */
class CouponValidateDto extends createZodDto(couponValidateRequestSchema) {}

@ApiTags("coupons")
@Controller("coupons")
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  /**
   * Advisory check behind the cart's "apply code" field.
   *
   * 200 for a *refused* code, not 4xx. "This code expired" is the expected
   * answer to the question being asked, and the cart renders it beside the
   * input — a 422 would make the frontend's ordinary path an error handler.
   * The failure case that is genuinely an error, redemption losing a race at
   * checkout, throws COUPON_UNAVAILABLE from CouponsService.redeem instead.
   *
   * POST despite being a read: the subtotal is request data, and a GET with
   * the code in the URL would put live discount codes into access logs and
   * browser history.
   *
   * NOT throttled yet. This endpoint is a code-enumeration oracle and §3.14
   * puts a tight limit on it; that arrives with the throttler in Phase 0 and
   * is a real gap until then.
   */
  @Post("validate")
  @HttpCode(HttpStatus.OK)
  // Answers "is this a real code?". Unlimited, it enumerates every discount
  // the shop has ever issued.
  @StrictThrottle()
  @ApiOperation({ summary: "Check a discount code against a subtotal" })
  async validate(@Body() body: CouponValidateDto): Promise<CouponEvaluationContract> {
    const result = await this.couponsService.evaluate(body.code, body.subtotalCents);

    if (!result.ok) {
      return { ok: false, reason: result.reason, minOrderCents: result.minOrderCents };
    }

    // Deliberately narrow: the service returns the whole coupon row, which
    // carries timesUsed, maxUses and internal ids. Only the normalised code
    // and the computed discount cross the wire — leaking usage counts would
    // tell an enumerator which codes are real and how much life they have left.
    return {
      ok: true,
      code: result.coupon.code,
      discountCents: result.discountCents,
    };
  }
}
