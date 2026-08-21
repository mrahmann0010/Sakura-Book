import { describe, expect, it } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { AdminRolesGuard } from "../../src/admin/auth/admin-roles.guard";
import { REQUIRED_ROLES_KEY } from "../../src/admin/auth/admin-auth.decorators";
import { InsufficientRoleError } from "../../src/admin/auth/auth.errors";
import type { AccessClaims } from "../../src/admin/auth/tokens";

/**
 * Role enforcement, pinned without booting Nest.
 *
 * The guard is a pure decision over two inputs — the route's metadata and the
 * claims the JWT guard attached — so it can be constructed by hand. That is
 * worth doing precisely because authorisation failures are silent successes:
 * a guard that always returns true breaks nothing visible until the day
 * someone uses it.
 */
function contextFor(options: {
  requiredRoles?: string[];
  admin?: Partial<AccessClaims>;
}): ExecutionContext {
  const handler = () => undefined;

  if (options.requiredRoles) {
    Reflect.defineMetadata(REQUIRED_ROLES_KEY, options.requiredRoles, handler);
  }

  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ admin: options.admin }) }),
  } as unknown as ExecutionContext;
}

const guard = new AdminRolesGuard(new Reflector());

const staff: AccessClaims = {
  sub: "00000000-0000-4000-8000-000000000001",
  sid: "00000000-0000-4000-8000-000000000002",
  role: "STAFF",
  email: "staff@shop.test",
  iat: 0,
  exp: 0,
};

describe("AdminRolesGuard", () => {
  it("allows any authenticated admin when no roles are declared", () => {
    // The documented default: STAFF does the daily fulfilment work, so an
    // unannotated route must not require ADMIN.
    expect(guard.canActivate(contextFor({ admin: staff }))).toBe(true);
  });

  it("allows a matching role", () => {
    expect(guard.canActivate(contextFor({ requiredRoles: ["STAFF"], admin: staff }))).toBe(true);
  });

  it("allows when the role is one of several accepted", () => {
    const context = contextFor({ requiredRoles: ["ADMIN", "STAFF"], admin: staff });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("refuses a role that is not listed", () => {
    expect(() => guard.canActivate(contextFor({ requiredRoles: ["ADMIN"], admin: staff }))).toThrow(
      InsufficientRoleError,
    );
  });

  it("names the required roles, so the panel can explain the refusal", () => {
    try {
      guard.canActivate(contextFor({ requiredRoles: ["ADMIN"], admin: staff }));
      expect.unreachable("guard should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientRoleError);
      expect((error as InsufficientRoleError).details).toEqual({
        required: ["ADMIN"],
        actual: "STAFF",
      });
    }
  });

  it("refuses when no claims are attached, rather than defaulting open", () => {
    // Reachable only by a wiring mistake — this guard registered without the
    // JWT guard ahead of it. The safe reading of "I do not know who this is"
    // on a role-restricted route is no.
    expect(() => guard.canActivate(contextFor({ requiredRoles: ["STAFF"] }))).toThrow(
      InsufficientRoleError,
    );
  });

  it("refuses an empty role list as no constraint at all", () => {
    // `@Roles()` with no arguments is a programming slip; treating it as
    // "nobody may call this" would be a route that 403s for everyone and
    // reads, at the call site, like it was annotated correctly.
    expect(guard.canActivate(contextFor({ requiredRoles: [], admin: staff }))).toBe(true);
  });
});
