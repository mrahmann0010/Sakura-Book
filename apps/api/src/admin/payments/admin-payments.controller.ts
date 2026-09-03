import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { paymentBreakdownQuerySchema, type PaymentBreakdown } from "@sakura/contracts";
import { createZodDto } from "nestjs-zod";
import { AdminPaymentsService } from "./admin-payments.service";

class PaymentBreakdownQueryDto extends createZodDto(paymentBreakdownQuerySchema) {}

@ApiTags("admin-payments")
@Controller("admin/payments")
export class AdminPaymentsController {
  constructor(private readonly paymentsService: AdminPaymentsService) {}

  /**
   * No `@Roles` — same reasoning as the dashboard: these are aggregates, not
   * customers' payment details, and the people packing orders benefit from
   * seeing what the week has actually brought in.
   *
   * Uncached. The window is chosen by the reader, so a cache keyed on the
   * route would serve one range's figures for another's, and keying on the
   * range would cache six variants of a query that already runs as a single
   * grouped scan.
   */
  @Get()
  @ApiOperation({
    summary: "Accepted-order revenue split by component (books/delivery/discount) and platform.",
  })
  async breakdown(@Query() query: PaymentBreakdownQueryDto): Promise<PaymentBreakdown> {
    return this.paymentsService.breakdown(query);
  }
}
