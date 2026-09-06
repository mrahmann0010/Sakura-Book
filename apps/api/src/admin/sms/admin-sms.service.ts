import { Injectable } from "@nestjs/common";
import type { AdminSmsSendRequest, AdminSmsSendResult } from "@sakura/contracts";
import { SmsService } from "../../sms";

/**
 * The one-off "type a number, type a message, send it" flow the admin panel
 * exposes today. Delegates entirely to SmsService — this class exists so the
 * feature follows the same controller/service split as every other admin
 * route, not because there is any admin-specific logic yet.
 */
@Injectable()
export class AdminSmsService {
  constructor(private readonly sms: SmsService) {}

  async send(request: AdminSmsSendRequest): Promise<AdminSmsSendResult> {
    // No simNumber here — SmsService falls back to the shop's saved setting.
    await this.sms.send(request.to, request.message);
    return { sentAt: new Date().toISOString() };
  }
}
