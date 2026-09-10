import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AdminStockList } from "@sakura/contracts";
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
 */
@ApiTags("admin-stock")
@Controller("admin/stock")
export class AdminStockController {
  constructor(private readonly adminStockService: AdminStockService) {}

  @Get()
  @ApiOperation({ summary: "Every title's stock, split into promised, reserved and on-shelf." })
  async list(): Promise<AdminStockList> {
    return this.adminStockService.list();
  }
}
