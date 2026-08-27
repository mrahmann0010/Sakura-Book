/**
 * Same shape as `admin/orders`' barrel, and for the same reason: nothing
 * outside `admin/` imports this today, but the module-boundary rule needs a
 * public surface to point at when something does.
 */
export { AdminWaitlistController } from "./admin-waitlist.controller";
export { AdminWaitlistService } from "./admin-waitlist.service";
