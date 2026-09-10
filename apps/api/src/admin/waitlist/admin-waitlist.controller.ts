import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  adminWaitlistAllocationOpenSchema,
  adminWaitlistAllocationResizeSchema,
  adminWaitlistInviteRequestSchema,
  adminWaitlistNotifyRequestSchema,
  adminWaitlistQuerySchema,
  adminWaitlistUpdateRequestSchema,
  adminWaitlistWaveRequestSchema,
  type AdminWaitlistAllocationView,
  type AdminWaitlistEntry,
  type AdminWaitlistInviteResult,
  type AdminWaitlistList,
  type AdminWaitlistNotifyResult,
  type AdminWaitlistWavePlan,
} from "@sakura/contracts";
import type { Request, Response } from "express";
import { createZodDto } from "nestjs-zod";
import { CurrentAdmin, Roles } from "../auth/admin-auth.decorators";
import type { AccessClaims } from "../auth/tokens";
import type { AdminContext } from "../orders";
import { AdminWaitlistAllocationService } from "./admin-waitlist-allocation.service";
import { AdminWaitlistInviteService } from "./admin-waitlist-invite.service";
import { AdminWaitlistWaveService } from "./admin-waitlist-wave.service";
import { AdminWaitlistService } from "./admin-waitlist.service";

class AdminWaitlistQueryDto extends createZodDto(adminWaitlistQuerySchema) {}
class AdminWaitlistNotifyDto extends createZodDto(adminWaitlistNotifyRequestSchema) {}
class AdminWaitlistUpdateDto extends createZodDto(adminWaitlistUpdateRequestSchema) {}
class AdminWaitlistInviteDto extends createZodDto(adminWaitlistInviteRequestSchema) {}
class AdminWaitlistAllocationOpenDto extends createZodDto(adminWaitlistAllocationOpenSchema) {}
class AdminWaitlistAllocationResizeDto extends createZodDto(adminWaitlistAllocationResizeSchema) {}
class AdminWaitlistWaveDto extends createZodDto(adminWaitlistWaveRequestSchema) {}

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
  constructor(
    private readonly adminWaitlistService: AdminWaitlistService,
    private readonly adminWaitlistInviteService: AdminWaitlistInviteService,
    private readonly adminWaitlistAllocationService: AdminWaitlistAllocationService,
    private readonly adminWaitlistWaveService: AdminWaitlistWaveService,
  ) {}

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
   * Issue an invite token to each selected entry and text them the link.
   *
   * Same request shape as `notify` — a single id is the panel's per-row
   * "Invite" button, several ids is the bulk send. Unlike `notify` this one
   * does send: see AdminWaitlistInviteService's own comment for why it lives
   * apart from the class above.
   */
  @Post("invite")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Issue invite tokens to selected entries and text them the link." })
  async invite(
    @Body() body: AdminWaitlistInviteDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminWaitlistInviteResult> {
    return this.adminWaitlistInviteService.invite(body, contextOf(admin, request));
  }

  /**
   * What the next wave for this book would do, without doing it.
   *
   * A read, so it carries no `@Roles` and no side effects — the panel calls it
   * to label the button ("Invite next 19") and to warn about entries too large
   * to fit. Deciding *who* happens here rather than in the browser: the queue's
   * order is a promise the shop made, and a page of the list is not enough to
   * honour it.
   */
  @Get("wave-plan")
  @ApiOperation({
    summary: "Preview the next wave: how many would be invited, and who is skipped.",
  })
  async wavePlan(@Query("bookId", ParseUUIDPipe) bookId: string): Promise<AdminWaitlistWavePlan> {
    const plan = await this.adminWaitlistWaveService.plan(bookId);

    return {
      spendable: plan.spendable,
      count: plan.ids.length,
      quantity: plan.quantity,
      waiting: plan.waiting,
      skipped: plan.skipped,
    };
  }

  /**
   * Send the next wave.
   *
   * Not `@Roles("ADMIN")`, unlike the release it spends: deciding the split is
   * the owner's call, but working down the queue on a restock morning is
   * exactly the staff task this whole panel exists for — and the budget those
   * invites come out of has already been set by someone who could.
   */
  @Post("waves")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Invite the next N in line, capped by the open release's budget." })
  async sendWave(
    @Body() body: AdminWaitlistWaveDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminWaitlistInviteResult> {
    return this.adminWaitlistWaveService.send(body, contextOf(admin, request));
  }

  /* ------------------------------------------------------------------------
     Stock releases.

     Deliberately mounted under the waitlist rather than under books: the
     number being set is not a property of the title, it is a decision about
     this queue's share of one restock, and the screen it belongs on is the one
     where staff can see how many people are waiting for it.
     ---------------------------------------------------------------------- */

  @Get("allocations")
  @ApiOperation({ summary: "A book's open stock release and its release history." })
  async allocations(
    @Query("bookId", ParseUUIDPipe) bookId: string,
  ): Promise<AdminWaitlistAllocationView> {
    return this.adminWaitlistAllocationService.view(bookId);
  }

  /**
   * Decide how many copies of a restock the waitlist gets. **ADMIN only.**
   *
   * Restricted where the rest of this controller is not, and on the same axis
   * the CSV export is: working the list is staff work, but this is the one
   * action that decides how much of the shop's stock is given away through it.
   * Getting it wrong does not just message the wrong person — it takes copies
   * off the shelf for as long as an invite window lasts.
   */
  @Post("allocations")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Open a stock release: how many copies the waitlist may be promised." })
  async openAllocation(
    @Body() body: AdminWaitlistAllocationOpenDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminWaitlistAllocationView> {
    return this.adminWaitlistAllocationService.open(body, contextOf(admin, request));
  }

  /**
   * Correct an open release's size. **ADMIN only**, like opening it.
   *
   * A PATCH rather than a second POST to `allocations`, and the distinction is
   * load-bearing: this edits the release that exists. Closing and reopening is
   * what staff reach for otherwise, and it over-issues silently — `committed`
   * is counted per allocation id, so the replacement starts at zero and
   * promises the same copies again.
   */
  @Patch("allocations/:id")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Change how many copies an open release gives the waitlist." })
  async resizeAllocation(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("bookId", ParseUUIDPipe) bookId: string,
    @Body() body: AdminWaitlistAllocationResizeDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminWaitlistAllocationView> {
    return this.adminWaitlistAllocationService.resize(id, bookId, body, contextOf(admin, request));
  }

  /**
   * Stop charging new invites to a release. **ADMIN only.**
   *
   * Does not touch the invites already issued — they run out their own
   * windows. Withdrawing a live hold is a different action with a different
   * apology attached, and it is not this one.
   */
  @Post("allocations/:id/close")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Close a stock release. Live invites keep their windows." })
  async closeAllocation(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("bookId", ParseUUIDPipe) bookId: string,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminWaitlistAllocationView> {
    return this.adminWaitlistAllocationService.close(id, bookId, contextOf(admin, request));
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
