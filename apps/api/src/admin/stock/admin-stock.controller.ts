import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AdminStockList } from "@sakura/contracts";
import { AllowFulfillment } from "../auth/admin-auth.decorators";
import { AdminStockService } from "./admin-stock.service";

/**
 * Stock, over HTTP.
 *
 * A single read, and no `@Roles`. Seeing how many copies exist and who they
 * are owed to is the daily work of whoever is minding the shop; the two
 * actions this screen leads to are guarded where they live — setting a
 * release is ADMIN on the waitlist controller, editing a stock count is the
 * books controller's business. Restricting the view as well would only mean
 * staff cannot see the warning about work they are allowed to do.
 *
 * Open to FULFILLMENT for the same reason: a packer who can see the shelf is
 * about to run dry says so on Monday rather than discovering it mid-parcel. It
 * is counts per title and nothing about any customer, so there is no view to
 * narrow — and the edits it leads to stay closed to that role.
 */
@ApiTags("admin-stock")
@Controller("admin/stock")
export class AdminStockController {
  constructor(private readonly adminStockService: AdminStockService) {}

  @Get()
  @AllowFulfillment()
  @ApiOperation({ summary: "Every title's stock, split into promised, reserved and on-shelf." })
  async list(): Promise<AdminStockList> {
    return this.adminStockService.list();
  }
}
