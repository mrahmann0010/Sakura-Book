import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  adminWaitlistNotifyRequestSchema,
  adminWaitlistQuerySchema,
  adminWaitlistUpdateRequestSchema,
  type AdminWaitlistEntry,
  type AdminWaitlistList,
  type AdminWaitlistNotifyResult,
} from "@sakura/contracts";
import type { Request, Response } from "express";
import { createZodDto } from "nestjs-zod";
import { CurrentAdmin, Roles } from "../auth/admin-auth.decorators";
import type { AccessClaims } from "../auth/tokens";
import type { AdminContext } from "../orders";
import { AdminWaitlistService } from "./admin-waitlist.service";

class AdminWaitlistQueryDto extends createZodDto(adminWaitlistQuerySchema) {}
class AdminWaitlistNotifyDto extends createZodDto(adminWaitlistNotifyRequestSchema) {}
class AdminWaitlistUpdateDto extends createZodDto(adminWaitlistUpdateRequestSchema) {}

/**
 * Who is waiting, over HTTP.
 *
 * Authenticated by AdminJwtGuard on the `admin/` path prefix, like every
 * other controller here. Reading and working the list carries no `@Roles`:
 * messaging the people who asked to be messaged is staff work, and the
 * restock day this exists for is exactly the day the owner is least likely to
 * be at a keyboard.
 *
 * The export is the exception — see below.
 */
@ApiTags("admin-waitlist")
@Controller("admin/waitlist")
export class AdminWaitlistController {
  constructor(private readonly adminWaitlistService: AdminWaitlistService) {}

  /**
   * The list. No cache headers, for the same reason the order queue has none:
   * two staff members working a stale list both message the same person.
   */
  @Get()
  @ApiOperation({ summary: "Browse the waitlist: filter by status, source, language, date." })
  async list(@Query() query: AdminWaitlistQueryDto): Promise<AdminWaitlistList> {
    return this.adminWaitlistService.list(query);
  }

  /**
   * The same list as a CSV, unpaginated. **ADMIN only.**
   *
   * The one restricted route here, and restricted on a different axis than
   * the orders controller's refund: not because it changes anything — it
   * changes nothing — but because it is the only endpoint in the app that
   * hands over the shop's entire customer contact list as a file. Every other
   * admin route shows PII a page at a time on a screen; this one produces
   * something that can be forwarded. Staff can work the list all day without
   * ever needing to take it out of the building.
   */
  @Get("export.csv")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Export the filtered waitlist as a CSV file." })
  async exportCsv(
    @Query() query: AdminWaitlistQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const csv = await this.adminWaitlistService.exportCsv(query);
    const stamp = new Date().toISOString().slice(0, 10);

    response.setHeader("content-type", "text/csv; charset=utf-8");
    response.setHeader("content-disposition", `attachment; filename="waitlist-${stamp}.csv"`);

    return csv;
  }

  /**
   * Record that the restock message went out to a batch.
   *
   * POST rather than PATCH: this is an event that happened, applied to a set,
   * not a field being replaced on one resource. It sends nothing itself — see
   * the service's class comment.
   */
  @Post("notify")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark selected entries as notified. Does not send messages." })
  async notify(
    @Body() body: AdminWaitlistNotifyDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminWaitlistNotifyResult> {
    return this.adminWaitlistService.notify(body, contextOf(admin, request));
  }

  /**
   * Edit one entry's status or staff note.
   *
   * Addressed by UUID, unlike orders — a waitlist entry has no order number,
   * nothing is printed, and nobody quotes it over the phone. `ParseUUIDPipe`
   * so a malformed id is a 400 here rather than a Postgres cast error
   * surfacing as a 500 three layers down.
   */
  @Patch(":id")
  @ApiOperation({ summary: "Set an entry's status (including CANCELLED) or its internal note." })
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: AdminWaitlistUpdateDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminWaitlistEntry> {
    return this.adminWaitlistService.update(id, body, contextOf(admin, request));
  }
}

function contextOf(actor: AccessClaims, request: Request): AdminContext {
  return {
    actor,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  };
}
