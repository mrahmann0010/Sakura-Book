import { Controller, Get, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { PaymentNumbers } from "@sakura/contracts";
import type { Response } from "express";
import { PaymentNumbersService } from "./payment-numbers.service";

/**
 * The mobile-money numbers checkout shows for manual transfer.
 *
 * Public and read-only, same as `ShippingController.regions`: these numbers
 * are meant to be seen and copied by anyone reaching checkout, so there is no
 * auth to bypass here — the whole point of moving them out of the browser
 * bundle and into Payment Settings was to make them admin-editable, not to
 * make them secret.
 */
@ApiTags("payments")
@Controller("payments")
export class PaymentNumbersController {
  constructor(private readonly paymentNumbersService: PaymentNumbersService) {}

  @Get("numbers")
  @ApiOperation({ summary: "Receiving numbers for bKash/Rocket/Nagad manual transfer." })
  async numbers(@Res({ passthrough: true }) response: Response): Promise<PaymentNumbers> {
    // Changed rarely, from an admin panel, so a short shared cache is safe —
    // same policy as /shipping/regions.
    response.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");

    return this.paymentNumbersService.current();
  }
}
