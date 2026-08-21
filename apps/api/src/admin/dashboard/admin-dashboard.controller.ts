import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Dashboard } from "@sakura/contracts";
import { AdminDashboardService } from "./admin-dashboard.service";

@ApiTags("admin-dashboard")
@Controller("admin/dashboard")
export class AdminDashboardController {
  constructor(private readonly dashboardService: AdminDashboardService) {}

  /**
   * The landing page.
   *
   * No `@Roles` — STAFF sees the same dashboard as ADMIN. The revenue figures
   * are the one arguable inclusion, and they are the wrong thing to hide from
   * the people packing the orders that produced them: a fulfilment team that
   * cannot see whether today was busy is a team working blind, and the numbers
   * are aggregates, not individual customers' details.
   *
   * Uncached, like the order queue and for the same reason — a dashboard is
   * read to decide what to do next, and a minute-old "awaiting action" count
   * sends two people to the same order.
   */
  @Get()
  @ApiOperation({ summary: "Revenue windows, order queue depth, low stock, top sellers." })
  async load(): Promise<Dashboard> {
    return this.dashboardService.load();
  }
}
