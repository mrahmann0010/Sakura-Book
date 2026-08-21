import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { AdminRole } from "@sakura/contracts";
import type { AccessClaims } from "./tokens";

/**
 * Metadata keys and the decorators that set them.
 *
 * Kept in one file so the guards have a single import and so the two keys
 * cannot drift apart from the decorators that write them — a mistyped key
 * string is a guard that silently never fires, which is the worst possible
 * failure mode for an authorisation check.
 */

export const IS_PUBLIC_KEY = "admin:isPublic";
export const REQUIRED_ROLES_KEY = "admin:requiredRoles";

/**
 * Exempt a route from AdminJwtGuard.
 *
 * Needed because the guard is registered for the whole admin module rather
 * than per-route: authentication is opt-*out*, matching how the validation
 * pipe and the throttler are registered globally. Forgetting `@UseGuards` on a
 * new admin endpoint should not be how it ends up open to the internet, so the
 * only way to be public is to say so in one word that a reviewer greps for.
 *
 * The only routes that use it are login and refresh, which by definition
 * cannot present an access token.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Restrict a route to the listed roles.
 *
 * Absent means "any signed-in admin", which is the right default for the
 * fulfilment work STAFF exists to do. `@Roles("ADMIN")` marks the routes that
 * change what the shop sells or charges — see ADMIN_ROLES in @sakura/contracts
 * for where that line is drawn.
 */
export const Roles = (...roles: AdminRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);

/**
 * The verified claims of the calling admin.
 *
 * Reads what AdminJwtGuard attached; it never verifies anything itself. That
 * split matters — a param decorator that could authenticate would be a second
 * authorisation path that runs after the guard has already decided, and Nest
 * runs param decorators for routes the guard rejected only if the guard let
 * them through, so the ordering is easy to reason about precisely because this
 * one does nothing.
 *
 * Non-null by contract: the guard either attached it or the request never
 * reached the handler.
 */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessClaims => {
    const request = context.switchToHttp().getRequest<{ admin?: AccessClaims }>();

    if (!request.admin) {
      // Reachable only by putting @CurrentAdmin on a @Public route, which is a
      // programming error rather than a request the client can make.
      throw new Error("@CurrentAdmin used on a route AdminJwtGuard does not protect");
    }

    return request.admin;
  },
);
