import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  waitlistSubscribeRequestSchema,
  type RestockSchedule,
  type WaitlistEntry,
} from "@sakura/contracts";
import type { Response } from "express";
import { createZodDto } from "nestjs-zod";
import { StrictThrottle } from "../common/throttling/strict-throttle.decorator";
import { RestockScheduleService } from "./restock-schedule.service";
import { WaitlistService } from "./waitlist.service";

class WaitlistSubscribeDto extends createZodDto(waitlistSubscribeRequestSchema) {}

@ApiTags("waitlist")
@Controller("waitlist")
export class WaitlistController {
  constructor(
    private readonly waitlistService: WaitlistService,
    private readonly restockScheduleService: RestockScheduleService,
  ) {}

  /**
   * When ordering reopens — the date the /notify page announces.
   *
   * Public and read-only, like `/payments/numbers` and `/shipping/regions`:
   * this is a line of copy on a page anyone can load, so there is nothing here
   * to protect. Same short shared cache for the same reason — it changes
   * rarely, from an admin panel.
   */
  @Get("schedule")
  @ApiOperation({ summary: "The shop-wide date ordering reopens, or null if none is announced." })
  async schedule(@Res({ passthrough: true }) response: Response): Promise<RestockSchedule> {
    response.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");

    return this.restockScheduleService.current();
  }

  /**
   * Join the restock waitlist. 201 always — a repeat signup from the same
   * phone is a 409 ALREADY_EXISTS instead, not a silently-accepted duplicate.
   *
   * Throttled the same way coupon validation and order lookup are: it's a
   * write with no prior authentication, so the tight limit is what stands
   * between this and a form-flooding script.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @StrictThrottle()
  @ApiOperation({ summary: "Join the restock waitlist." })
  async subscribe(@Body() body: WaitlistSubscribeDto): Promise<WaitlistEntry> {
    return this.waitlistService.subscribe(body);
  }
}
