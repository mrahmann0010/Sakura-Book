import { Module } from "@nestjs/common";
import { SmsService } from "./sms.service";

/**
 * Transactional SMS. No controller, no listener yet — unlike EmailModule,
 * nothing reacts to a domain event today; SmsService is exported for the
 * eventual stock-release flow (or anything else) to call directly.
 */
@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
