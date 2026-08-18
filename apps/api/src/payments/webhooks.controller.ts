import { Controller, Headers, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { StrictThrottle } from "../common/throttling/strict-throttle.decorator";
import { PaymentsService } from "./payments.service";

/**
 * Where payment confirmations arrive.
 *
 * Excluded from the public API docs: nothing a customer's browser calls, and
 * publishing the payload shape of a signature-verified endpoint invites people
 * to try forging it. The signature is what actually protects it — this is only
 * about not advertising.
 */
@ApiTags("payments")
@Controller("payments")
export class WebhooksController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Verify, record, and confirm.
   *
   * The raw body is what the signature covers, so it is read from
   * `request.rawBody` rather than from the parsed object — `JSON.parse`
   * followed by re-serialisation does not reproduce the bytes that were
   * signed, and a signature check against re-serialised JSON passes or fails on
   * key order. `main.ts` enables `rawBody` for this route's sake.
   *
   * Always 200 once the signature verifies, including for a replay. Gateways
   * retry on any non-2xx, so answering a duplicate with an error is how a
   * retry storm starts — the idempotency is in the unique index, and the
   * response says "received", not "acted".
   */
  @Post(":provider/webhook")
  @HttpCode(HttpStatus.OK)
  @StrictThrottle()
  @ApiExcludeEndpoint()
  async handle(
    @Param("provider") providerName: string,
    @Req() request: Request & { rawBody?: Buffer },
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ received: true; confirmed: boolean }> {
    const provider = this.paymentsService.provider(providerName);

    // Throws WebhookSignatureError (401) if this is not who it claims to be.
    // Deliberately before any database work: an unverified request must not be
    // able to make us do a lookup, let alone a write.
    const event = provider.verifyWebhook(request.rawBody ?? Buffer.alloc(0), headers);

    const { confirmed } = await this.paymentsService.applyWebhook(providerName, event);

    return { received: true, confirmed };
  }
}
