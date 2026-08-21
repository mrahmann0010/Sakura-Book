/**
 * The admin module's public surface.
 *
 * Everything here is what a *future admin feature module* — orders, catalog,
 * coupons — legitimately needs: the guard decorators to annotate its routes,
 * the audit writer, and the claims type its handlers receive.
 *
 * What is deliberately absent: AdminAuthService, the password functions, and
 * the token helpers. Nothing outside `admin/auth` has a reason to hash a
 * password or mint a session, and a module that could would be a second way
 * to issue a credential — which is the one thing this design keeps to exactly
 * one implementation. The seed script imports `password.ts` directly and is
 * the sole exception, because it runs outside Nest and creates the account
 * that bootstraps every other one.
 */
export { AdminModule } from "./admin.module";
export { AdminOrdersService, type AdminContext } from "./orders";
export { AdminSettingsService } from "./settings";
export { AdminDashboardService } from "./dashboard";
export { AuditService, type AuditAction, type AuditEntry } from "../audit";
export { CurrentAdmin, Public, Roles } from "./auth/admin-auth.decorators";
export type { AccessClaims } from "./auth/tokens";
