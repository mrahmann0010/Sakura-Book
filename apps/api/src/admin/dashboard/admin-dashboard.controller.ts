import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { monthlyReportQuerySchema, type Dashboard, type MonthlyReport } from "@sakura/contracts";
import { createZodDto } from "nestjs-zod";
import { AdminDashboardService } from "./admin-dashboard.service";

class MonthlyReportQueryDto extends createZodDto(monthlyReportQuerySchema) {}

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
  @ApiOperation({
    summary: "Revenue windows, order queue depth, low stock, top sellers, 12-month trend.",
  })
  async load(): Promise<Dashboard> {
    return this.dashboardService.load();
  }

  /** The daily drill-down behind one point on the trend chart. */
  @Get("report")
  @ApiOperation({ summary: "Daily orders and revenue for one calendar month (YYYY-MM)." })
  async report(@Query() query: MonthlyReportQueryDto): Promise<MonthlyReport> {
    return this.dashboardService.monthlyReport(query.month);
  }
}
