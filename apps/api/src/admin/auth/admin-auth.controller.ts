import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  ADMIN_ACCESS_COOKIE,
  ADMIN_REFRESH_COOKIE,
  adminLoginRequestSchema,
  type AdminSession,
} from "@sakura/contracts";
import type { CookieOptions, Request, Response } from "express";
import { createZodDto } from "nestjs-zod";
import { StrictThrottle } from "../../common/throttling/strict-throttle.decorator";
import type { Env } from "../../config/env.schema";
import { AdminAuthService, type IssuedSession, type RequestContext } from "./admin-auth.service";
import { CurrentAdmin, Public } from "./admin-auth.decorators";
import { SessionExpiredError } from "./auth.errors";
import type { AccessClaims } from "./tokens";

class AdminLoginDto extends createZodDto(adminLoginRequestSchema) {}

@ApiTags("admin-auth")
@Controller("admin/auth")
export class AdminAuthController {
  constructor(
    private readonly authService: AdminAuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Sign in.
   *
   * `@Public` because there is obviously no token yet, and `@StrictThrottle`
   * because this is the fourth endpoint that answers "does this identifier
   * exist?" — the same reason coupon validation and order lookup carry it. Ten
   * attempts a minute per IP is far above a human mistyping their password and
   * far below what credential stuffing needs. The per-*account* lockout in
   * AdminAuthService is the other half; see ADMIN_MAX_FAILED_LOGINS for why
   * both are necessary and neither is sufficient.
   *
   * 200, not 201. Nothing addressable was created — a session is not a
   * resource this API exposes a URL for.
   */
  @Post("login")
  @Public()
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Sign in. Sets httpOnly session cookies." })
  async login(
    @Body() body: AdminLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminSession> {
    const issued = await this.authService.login(body, contextOf(request));

    return this.respondWithSession(issued, response);
  }

  /**
   * Exchange the refresh cookie for a new pair.
   *
   * `@Public` in the sense that matters here: it presents no *access* token,
   * which is the only thing AdminJwtGuard knows how to check. It is not
   * unauthenticated — the refresh cookie is the credential, and the service
   * verifies it against a row.
   *
   * Throttled too. Rotation makes a stolen refresh token detectable, but the
   * detection happens on the *second* use; a limit is what stops someone
   * grinding random token values looking for a first.
   */
  @Post("refresh")
  @Public()
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rotate the session. Reuse of a spent token revokes the family." })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminSession> {
    try {
      const issued = await this.authService.refresh(readCookie(request, ADMIN_REFRESH_COOKIE), contextOf(request));

      return this.respondWithSession(issued, response);
    } catch (error) {
      /* Clear the cookies on the way out, or the browser keeps sending a token
         that can never work again — and every subsequent page load retries the
         refresh, fails, and retries. The client's recovery is the login form,
         and it cannot get there while a dead cookie keeps re-arming the
         attempt. */
      if (error instanceof SessionExpiredError) this.clearSessionCookies(response);

      throw error;
    }
  }

  /**
   * Who am I.
   *
   * Read from the table rather than reconstructed from the token's claims,
   * even though the claims carry email and role. The panel renders a header
   * from this and a name change or a demotion should show up on the next page
   * load, not when the token expires.
   */
  @Get("me")
  @ApiOperation({ summary: "The signed-in admin." })
  async me(@CurrentAdmin() admin: AccessClaims): Promise<AdminSession> {
    const user = await this.authService.findById(admin.sub);

    // The guard verified this id against the table a moment ago, so the row
    // going missing here means it was deleted mid-request. 401 rather than 404
    // — the session is what stopped being valid.
    if (!user) throw new SessionExpiredError();

    return { user, expiresAt: new Date(admin.exp * 1000).toISOString() };
  }

  /**
   * Sign out this device.
   *
   * `@Public` so an expired access token does not prevent signing out. That is
   * not a hole: the refresh cookie is what gets revoked, and revoking a token
   * requires holding it. Requiring a valid access token here would mean a
   * staff member who left the tab open overnight cannot sign out without first
   * signing in, which is the kind of rule that gets worked around by clearing
   * cookies and leaving the server-side session live.
   *
   * 204 — there is nothing meaningful to return, and the cookies are the
   * response.
   */
  @Post("logout")
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke this device's session and clear its cookies." })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.authService.logout(readCookie(request, ADMIN_REFRESH_COOKIE));

    this.clearSessionCookies(response);
  }

  private respondWithSession(issued: IssuedSession, response: Response): AdminSession {
    response.cookie(ADMIN_ACCESS_COOKIE, issued.accessToken, {
      ...this.cookieOptions(),
      // The access cookie expires with the token it carries. A cookie that
      // outlived its token would be sent on every request only to be rejected,
      // and the client would have no way to tell "expired" from "not signed in".
      expires: issued.accessExpiresAt,
    });

    response.cookie(ADMIN_REFRESH_COOKIE, issued.refreshToken, {
      ...this.cookieOptions(),
      expires: issued.refreshExpiresAt,
      /**
       * Scoped to the two routes that consume it, so it is not attached to
       * every catalog and order request the panel makes. A long-lived
       * credential that travels on a hundred requests has a hundred chances to
       * end up in a proxy log; one that travels on two has two.
       */
      path: "/api/v1/admin/auth",
    });

    return {
      user: issued.user,
      expiresAt: issued.accessExpiresAt.toISOString(),
    };
  }

  /**
   * Cleared with the *same* attributes they were set with.
   *
   * A browser matches a clearing cookie on name, domain and path, so clearing
   * the refresh cookie without repeating its narrower `path` silently does
   * nothing — the dead cookie stays, and the user cannot sign out. This is the
   * single most common way a cookie logout is subtly broken.
   */
  private clearSessionCookies(response: Response): void {
    response.clearCookie(ADMIN_ACCESS_COOKIE, this.cookieOptions());
    response.clearCookie(ADMIN_REFRESH_COOKIE, {
      ...this.cookieOptions(),
      path: "/api/v1/admin/auth",
    });
  }

  private cookieOptions(): CookieOptions {
    const secure =
      this.config.get("ADMIN_COOKIE_SECURE", { infer: true }) ??
      this.config.get("NODE_ENV", { infer: true }) !== "development";

    return {
      // The whole point: no script can read these, so an XSS on the panel
      // cannot steal the session.
      httpOnly: true,
      secure,
      /**
       * Strict rather than Lax, and the trade-off is deliberate. Lax would
       * attach the cookie to top-level navigations from other sites, which is
       * what makes "click a link in an email and still be signed in" work.
       * That convenience is worth having on a storefront and worth nothing on
       * an admin panel that is reached by typing a bookmark — and Strict is
       * the layer that makes cross-site request forgery structurally
       * impossible rather than merely unlikely.
       */
      sameSite: "strict",
      path: "/",
      domain: this.config.get("ADMIN_COOKIE_DOMAIN", { infer: true }),
    };
  }
}

function readCookie(request: Request, name: string): string | undefined {
  return (request as Request & { cookies?: Record<string, string> }).cookies?.[name];
}

/**
 * `request.ip` respects Express's `trust proxy` setting, which main.ts must set
 * for it to mean anything behind a load balancer — otherwise every session row
 * records the proxy's address and the audit trail is uniformly useless.
 */
function contextOf(request: Request): RequestContext {
  return {
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  };
}
