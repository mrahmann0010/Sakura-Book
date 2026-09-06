import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { adminSmsSendRequestSchema, type AdminSmsSendResult } from "@sakura/contracts";
import { createZodDto } from "nestjs-zod";
import { AdminSmsService } from "./admin-sms.service";

class AdminSmsSendDto extends createZodDto(adminSmsSendRequestSchema) {}

/**
 * Send one text message to one number, over HTTP.
 *
 * Authenticated by AdminJwtGuard on the `admin/` path prefix, like every
 * other controller here. No `@Roles` restriction: this is the same trust
 * level as messaging the waitlist, not a payments-grade action.
 */
@ApiTags("admin-sms")
@Controller("admin/sms")
export class AdminSmsController {
  constructor(private readonly adminSmsService: AdminSmsService) {}

  @Post("send")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send an SMS to a phone number through the configured gateway." })
  async send(@Body() body: AdminSmsSendDto): Promise<AdminSmsSendResult> {
    return this.adminSmsService.send(body);
  }
}
