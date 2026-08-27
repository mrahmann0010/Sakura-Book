import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { waitlistSubscribeRequestSchema, type WaitlistEntry } from "@sakura/contracts";
import { createZodDto } from "nestjs-zod";
import { StrictThrottle } from "../common/throttling/strict-throttle.decorator";
import { WaitlistService } from "./waitlist.service";

class WaitlistSubscribeDto extends createZodDto(waitlistSubscribeRequestSchema) {}

@ApiTags("waitlist")
@Controller("waitlist")
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

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
