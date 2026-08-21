import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AdminRole } from "@sakura/contracts";
import { REQUIRED_ROLES_KEY } from "./admin-auth.decorators";
import { InsufficientRoleError } from "./auth.errors";
import type { AccessClaims } from "./tokens";

/**
 * Enforces `@Roles(...)`, after AdminJwtGuard has established who is calling.
 *
 * Registered second, and the ordering is a correctness requirement rather than
 * a preference: this guard reads `request.admin`, which only exists because
 * the JWT guard put it there. Nest runs module-scoped guards in registration
 * order, so the pairing lives in admin.module.ts and must stay in that order.
 *
 * Note that it reads the role from the claims the JWT guard produced — and
 * `verifyAccess` overwrites the token's role claim with the one currently in
 * the table before returning it. So a demotion takes effect on the next
 * request, not when the token expires, and this guard gets that for free
 * without a second lookup.
 *
 * No `@Roles` on a route means any authenticated admin may call it. That is
 * the deliberate default — STAFF exists to do the daily work, and requiring an
 * explicit annotation for the common case would mean the annotation gets
 * copy-pasted rather than considered.
 */
@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AdminRole[] | undefined>(REQUIRED_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<{ admin?: AccessClaims }>();
    const admin = request.admin;

    // No claims on a role-restricted route means this guard ran without the
    // JWT guard ahead of it — a wiring bug, not a request. Refusing is the
    // only safe reading; the alternative is a route that silently stops
    // checking roles because authentication was accidentally skipped.
    if (!admin) throw new InsufficientRoleError(required, "anonymous");

    if (!required.includes(admin.role)) throw new InsufficientRoleError(required, admin.role);

    return true;
  }
}
