import { Module } from "@nestjs/common";
import { RestockScheduleService } from "./restock-schedule.service";
import { WaitlistAllocationService } from "./waitlist-allocation.service";
import { WaitlistBooksService } from "./waitlist-books.service";
import { WaitlistInviteSettingsService } from "./waitlist-invite-settings.service";
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
  providers: [
    WaitlistService,
    RestockScheduleService,
    WaitlistBooksService,
    WaitlistInviteService,
    WaitlistInviteSettingsService,
    WaitlistAllocationService,
  ],
  // RestockScheduleService is exported for AdminSettingsModule, which owns the
  // editing half of the same setting — the storefront read and the admin write
  // must go through one service, or the two grow separate ideas of what null
  // means. WaitlistInviteService is exported so the admin invite action
  // (issues tokens) and checkout (consumes them) share this same instance
  // rather than a second idea of what a valid token is.
  // WaitlistInviteSettingsService is exported for the same reason as
  // RestockScheduleService: AdminSettingsModule owns editing the TTL, this
  // module owns reading it when an invite is issued.
  // WaitlistAllocationService is exported for the same reason
  // WaitlistInviteService is: the admin panel opens and closes releases and
  // the invite path spends them, and a second idea of how much a release has
  // left is exactly the drift the whole design is built to avoid.
  exports: [
    WaitlistService,
    RestockScheduleService,
    WaitlistBooksService,
    WaitlistInviteService,
    WaitlistInviteSettingsService,
    WaitlistAllocationService,
  ],
})
export class WaitlistModule {}
