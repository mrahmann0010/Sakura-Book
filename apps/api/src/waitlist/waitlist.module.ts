import { Module } from "@nestjs/common";
import { RestockScheduleService } from "./restock-schedule.service";
import { WaitlistBooksService } from "./waitlist-books.service";
import { WaitlistInviteService } from "./waitlist-invite.service";
import { WaitlistController } from "./waitlist.controller";
import { WaitlistService } from "./waitlist.service";

/**
 * The restock waitlist. Self-contained on purpose: unlike checkout, joining
 * the waitlist touches no stock, no pricing and no coupons, so this has
 * nothing to import from the other bounded contexts yet. That changes the
 * day admin gains a "notify everyone waiting on this book" action, which
 * will need to reach into catalog/email — a reason to import into this
 * module, not a reason for this module to import outward today.
 */
@Module({
  controllers: [WaitlistController],
  providers: [WaitlistService, RestockScheduleService, WaitlistBooksService, WaitlistInviteService],
  // RestockScheduleService is exported for AdminSettingsModule, which owns the
  // editing half of the same setting — the storefront read and the admin write
  // must go through one service, or the two grow separate ideas of what null
  // means. WaitlistInviteService is exported for the same forward-looking
  // reason: the eventual stock-release flow (admin) issues tokens, and
  // checkout (orders) consumes them, and both need this same instance rather
  // than a second idea of what a valid token is.
  exports: [WaitlistService, RestockScheduleService, WaitlistBooksService, WaitlistInviteService],
})
export class WaitlistModule {}
