import { Controller, Get, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { ShippingTerms } from "@sakura/contracts";
import type { Response } from "express";
import { RegionsService } from "./regions.service";
import { ShippingTermsService } from "./shipping-terms.service";

@ApiTags("shipping")
@Controller("shipping")
export class ShippingController {
  constructor(
    private readonly regionsService: RegionsService,
    private readonly shippingTermsService: ShippingTermsService,
  ) {}

  /**
   * The regions, and the postage rules that apply to them.
   *
   * Returns the terms alongside the list rather than the list alone, because
   * every client that renders the region `<select>` also renders "free
   * delivery over X" next to it, and two endpoints for one paragraph of copy
   * is two chances for the copy to disagree with the total.
   *
   * The names are English. Clients translate by slug — the bn and ja bundles
   * key off it — because a server returning display text in one language is
   * the failure mode a trilingual frontend cannot recover from.
   */
  @Get("regions")
  @ApiOperation({ summary: "Delivery regions and the postage terms" })
  async regions(@Res({ passthrough: true }) response: Response): Promise<ShippingTerms> {
    // Shop policy, changed by staff, read on every checkout. Cached like the
    // other reference data rather than like a price.
    response.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");

    const terms = await this.shippingTermsService.current();

    return {
      currency: terms.currency,
      flatRateCents: terms.flatRateCents,
      freeDeliveryThresholdCents: terms.freeDeliveryThresholdCents,
      originDivision: terms.originDivision,
      regions: await this.regionsService.list(),
    };
  }
}
