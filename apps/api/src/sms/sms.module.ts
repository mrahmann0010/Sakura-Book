import { Module } from "@nestjs/common";
import { SmsService } from "./sms.service";
import { SmsSettingsService } from "./sms-settings.service";

/**
 * Transactional SMS. No controller, no listener yet — unlike EmailModule,
 * nothing reacts to a domain event today; SmsService is exported for the
 * eventual stock-release flow (or anything else) to call directly.
 * SmsSettingsService is exported separately for the admin settings
 * controller, which reads and writes the SIM choice directly rather than
 * through SmsService.
 */
@Module({
  providers: [SmsService, SmsSettingsService],
  exports: [SmsService, SmsSettingsService],
})
export class SmsModule {}
