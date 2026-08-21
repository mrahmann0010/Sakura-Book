import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ADMIN_ACCESS_COOKIE } from "@sakura/contracts";
import type { Request } from "express";
import { AdminAuthService } from "./admin-auth.service";
import { IS_PUBLIC_KEY } from "./admin-auth.decorators";
import { SessionExpiredError } from "./auth.errors";
import type { AccessClaims } from "./tokens";

/**
 * Authenticates every admin route that has not opted out.
 *
 * ## Where the token comes from
 *
 * The httpOnly cookie, and — only as a fallback — an `Authorization: Bearer`
 * header. The cookie is the mechanism the design chose (§3.13): it cannot be
 * read by script, so an XSS on the admin panel cannot exfiltrate the session,
 * which is the failure mode every localStorage-based scheme shares.
 *
 * The header fallback exists for tooling — curl against a running instance,
 * an e2e test, a future job that acts as a service account — and not for the
 * browser. It is checked *second* so a browser request can never be steered
 * onto it by an injected header.
 *
 * ## The CSRF question a cookie raises
 *
 * Cookies are attached by the browser automatically, so a cookie-authenticated
 * mutation is forgeable from another origin unless something stops it. Three
 * things do: `SameSite=Strict` on both cookies (set in the controller), the
 * CORS allowlist pinned to WEB_ORIGIN with credentials, and the fact that
 * every admin mutation is a JSON POST/PATCH — which a cross-origin form cannot
 * produce without a preflight the CORS policy denies. A CSRF token would be a
 * fourth layer over a route group that is already same-origin; it is worth
 * revisiting the day the panel is served from a different host than the API.
 */
@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(
    private readonly authService: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { admin?: AccessClaims }>();

    /**
     * Storefront routes are none of this guard's business.
     *
     * The guard is registered globally (see admin.module.ts) so that a new
     * admin controller is protected the moment it exists rather than when
     * somebody remembers a decorator. The cost of that choice is this check:
     * without it, the catalog, the cart and checkout would all demand a
     * session, and the shop would go dark.
     *
     * Matched on the controller's own path metadata rather than on the request
     * URL, because a URL can be dressed up — `/api/v1/../admin/x`, a matrix
     * parameter, an encoded segment — and a prefix test against a string an
     * attacker controls is the wrong side of the trust boundary. Nest has
     * already routed the request by this point, so the controller it picked is
     * the authoritative answer to "is this an admin endpoint".
     */
    if (!isAdminRoute(context)) return true;

    const token = extractToken(request);

    if (!token) throw new SessionExpiredError();

    // Throws SessionExpiredError, which the global filter renders as a 401
    // envelope like any other domain error. Deliberately not caught and
    // re-thrown as Nest's UnauthorizedException — guards are transport-layer
    // code, but the *reason* is domain vocabulary, and the filter is the one
    // place that maps the two (see common/errors/domain.error.ts).
    request.admin = await this.authService.verifyAccess(token);

    return true;
  }
}

/**
 * Whether the resolved controller lives under the admin prefix.
 *
 * Reads the `path` metadata Nest's `@Controller("admin/...")` writes, which is
 * a compile-time constant on our own class — not request data. A controller
 * that forgets the prefix is therefore *unprotected*, which is the one sharp
 * edge here: the convention is load-bearing, and the e2e suite pins it by
 * asserting every route under /api/v1/admin answers 401 unauthenticated.
 */
function isAdminRoute(context: ExecutionContext): boolean {
  const controllerPath = Reflect.getMetadata("path", context.getClass()) as string | undefined;

  return typeof controllerPath === "string" && ADMIN_PREFIX_PATTERN.test(controllerPath);
}

/** Matches "admin", "admin/auth", "/admin/orders" — but not "administrators". */
const ADMIN_PREFIX_PATTERN = /^\/?admin(\/|$)/;

function extractToken(request: Request): string | undefined {
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  const fromCookie = cookies?.[ADMIN_ACCESS_COOKIE];

  if (fromCookie) return fromCookie;

  const header = request.headers.authorization;

  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim() || undefined;

  return undefined;
}
