/**
 * Nothing outside `admin/` imports from here today — the admin order routes
 * are a leaf. The barrel exists so that the module-boundary lint rule has a
 * public surface to point at when something eventually does, rather than that
 * something reaching for `admin-orders.service` directly.
 */
export { AdminOrdersController } from "./admin-orders.controller";
export { AdminOrdersService, type AdminContext } from "./admin-orders.service";
