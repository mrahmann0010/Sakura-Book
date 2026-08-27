/**
 * The waitlist module's public surface. See coupons/index.ts for why this
 * boundary is enforced by eslint's no-restricted-imports rather than left to
 * convention.
 */
export { WaitlistModule } from "./waitlist.module";
export { WaitlistService } from "./waitlist.service";
export { RestockScheduleService } from "./restock-schedule.service";
