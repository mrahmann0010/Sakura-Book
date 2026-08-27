import { Module } from "@nestjs/common";
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
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
