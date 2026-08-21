import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ADMIN_ACCESS_COOKIE } from "@sakura/contracts";
import { AdminJwtGuard } from "../../src/admin/auth/admin-jwt.guard";
import { IS_PUBLIC_KEY } from "../../src/admin/auth/admin-auth.decorators";
import { SessionExpiredError } from "../../src/admin/auth/auth.errors";
import type { AdminAuthService } from "../../src/admin/auth/admin-auth.service";

/**
 * Which requests the guard demands a session for.
 *
 * This is the highest-stakes decision in the auth module in both directions.
 * Too narrow and an admin route ships unauthenticated; too broad and the
 * guard — which is registered globally — demands a login for the catalog and
 * the shop goes dark. Neither failure announces itself in a type check.
 */
const claims = {
  sub: "00000000-0000-4000-8000-000000000001",
  sid: "00000000-0000-4000-8000-000000000002",
  role: "ADMIN" as const,
  email: "owner@shop.test",
  iat: 0,
  exp: 0,
};

/**
 * Stand-ins for real controllers.
 *
 * The `path` metadata is set directly rather than with `@Controller(...)`,
 * because the test runner compiles through esbuild, which does not emit
 * decorator metadata. Setting the key the decorator would have set keeps the
 * test honest — it is the same metadata the guard reads at runtime — without
 * depending on a compiler feature the suite does not have.
 */
function controllerAt(path: string): object {
  const controller = class {};

  Reflect.defineMetadata("path", path, controller);

  return controller;
}

const AdminOrdersLike = controllerAt("admin/orders");
const AdminRootLike = controllerAt("admin");
const BooksLike = controllerAt("books");
const LookalikeControllerName = controllerAt("administrators");

function contextFor(controller: object, options: { cookie?: string; header?: string } = {}) {
  const request = {
    cookies: options.cookie ? { [ADMIN_ACCESS_COOKIE]: options.cookie } : {},
    headers: options.header ? { authorization: options.header } : {},
  } as Record<string, unknown>;

  const context = {
    getHandler: () => () => undefined,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

function guardWith(verify = vi.fn().mockResolvedValue(claims)) {
  const authService = { verifyAccess: verify } as unknown as AdminAuthService;

  return { guard: new AdminJwtGuard(authService, new Reflector()), verify };
}

describe("AdminJwtGuard", () => {
  it("lets storefront requests through untouched", async () => {
    // The guard is global. Without this, `GET /books` would demand a session
    // and the entire shop would 401.
    const { guard, verify } = guardWith();

    await expect(guard.canActivate(contextFor(BooksLike).context)).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it("does not mistake a controller that merely starts with the same letters", async () => {
    // "administrators" is not under "admin/". A prefix test written as
    // `startsWith("admin")` would protect it by accident today and, more
    // importantly, would suggest the check is doing something it is not.
    const { guard, verify } = guardWith();

    await expect(guard.canActivate(contextFor(LookalikeControllerName).context)).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it("demands a token on an admin controller", async () => {
    const { guard } = guardWith();

    await expect(guard.canActivate(contextFor(AdminOrdersLike).context)).rejects.toThrow(
      SessionExpiredError,
    );
  });

  it("protects the bare admin prefix too", async () => {
    const { guard } = guardWith();

    await expect(guard.canActivate(contextFor(AdminRootLike).context)).rejects.toThrow(
      SessionExpiredError,
    );
  });

  it("attaches verified claims for the handler to read", async () => {
    const { guard, verify } = guardWith();
    const { context, request } = contextFor(AdminOrdersLike, { cookie: "a.b.c" });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith("a.b.c");
    expect(request.admin).toEqual(claims);
  });

  it("prefers the cookie over an Authorization header", async () => {
    // The header fallback exists for tooling. Checking it second means a
    // browser request cannot be steered onto it by an injected header.
    const { guard, verify } = guardWith();
    const { context } = contextFor(AdminOrdersLike, {
      cookie: "from-cookie",
      header: "Bearer from-header",
    });

    await guard.canActivate(context);
    expect(verify).toHaveBeenCalledWith("from-cookie");
  });

  it("accepts a bearer token when there is no cookie", async () => {
    const { guard, verify } = guardWith();
    const { context } = contextFor(AdminOrdersLike, { header: "Bearer tooling-token" });

    await guard.canActivate(context);
    expect(verify).toHaveBeenCalledWith("tooling-token");
  });

  it("ignores an Authorization header that is not a bearer token", async () => {
    const { guard } = guardWith();
    const { context } = contextFor(AdminOrdersLike, { header: "Basic dXNlcjpwYXNz" });

    await expect(guard.canActivate(context)).rejects.toThrow(SessionExpiredError);
  });

  it("exempts a route marked @Public", async () => {
    // Login and refresh, which by definition present no access token.
    const login = () => undefined;

    Reflect.defineMetadata(IS_PUBLIC_KEY, true, login);

    const { guard, verify } = guardWith();
    const context = {
      getHandler: () => login,
      getClass: () => AdminOrdersLike,
      switchToHttp: () => ({ getRequest: () => ({ cookies: {}, headers: {} }) }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });
});
