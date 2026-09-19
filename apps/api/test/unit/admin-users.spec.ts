import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUsersService } from "../../src/admin/users/admin-users.service";
import type { AccessClaims } from "../../src/admin/auth/tokens";
import { InvalidInputError, ResourceNotFoundError } from "../../src/common/errors";

/**
 * User management's rules, against an in-memory staff table.
 *
 * The fake transaction supports exactly the query shapes the service uses —
 * lock-and-read everything, update one row by id, insert one row — and no
 * more, so a change to how the service talks to the database fails here
 * loudly rather than passing against a mock that accepts anything.
 */

type Row = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "STAFF" | "FULFILLMENT";
  passwordHash: string;
  disabledAt: Date | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  sessionsValidFrom: Date;
  createdAt: Date;
  updatedAt: Date;
};

function row(id: string, role: Row["role"], extra: Partial<Row> = {}): Row {
  const now = new Date("2026-09-19T00:00:00.000Z");

  return {
    id,
    email: `${id}@shop.test`,
    name: id,
    role,
    passwordHash: "scrypt$old",
    disabledAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    sessionsValidFrom: now,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

function harness(initial: Row[]) {
  let table = initial.map((r) => ({ ...r }));
  let pendingId: string | null = null;

  const tx = {
    select: () => ({
      from: () => ({
        orderBy: () => ({ for: async () => table.map((r) => ({ ...r })) }),
      }),
    }),
    update: () => ({
      set: (changes: Partial<Row>) => ({
        where: () => ({
          returning: async () => {
            table = table.map((r) => (r.id === pendingId ? { ...r, ...changes } : r));
            return [table.find((r) => r.id === pendingId)!];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: Partial<Row>) => ({
        returning: async () => {
          const created = row(`new-${table.length}`, values.role!, values);
          table.push(created);
          return [created];
        },
      }),
    }),
  };

  const signOutEverywhere = vi.fn(async () => undefined);
  const record = vi.fn(async () => undefined);

  const service = new AdminUsersService(
    { db: { transaction: (fn: (t: unknown) => unknown) => fn(tx) } } as never,
    { signOutEverywhere } as never,
    { record } as never,
  );

  return {
    service,
    signOutEverywhere,
    record,
    /** The row the next update targets — the fake does not parse WHERE. */
    targeting: (id: string) => {
      pendingId = id;
    },
    table: () => table,
  };
}

const claimsFor = (id: string): AccessClaims => ({
  sub: id,
  sid: "00000000-0000-4000-8000-000000000009",
  role: "ADMIN",
  email: `${id}@shop.test`,
  iat: 0,
  exp: 0,
});

const as = (id: string) => ({ actor: claimsFor(id) });

describe("AdminUsersService", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness([row("owner", "ADMIN"), row("packer", "FULFILLMENT"), row("desk", "STAFF")]);
  });

  describe("create", () => {
    it("returns a temporary password long enough to satisfy the login rules", async () => {
      const result = await h.service.create(
        { name: "Karim", email: "karim@shop.test", role: "FULFILLMENT" },
        as("owner"),
      );

      expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(12);
      expect(result.user.role).toBe("FULFILLMENT");
      expect(h.record).toHaveBeenCalledOnce();
    });

    it("never writes the password into the audit entry", async () => {
      const result = await h.service.create(
        { name: "Karim", email: "karim@shop.test", role: "STAFF" },
        as("owner"),
      );

      expect(JSON.stringify(h.record.mock.calls)).not.toContain(result.temporaryPassword);
    });

    it("refuses an email that already has an account", async () => {
      await expect(
        h.service.create({ name: "X", email: "packer@shop.test", role: "STAFF" }, as("owner")),
      ).rejects.toBeInstanceOf(InvalidInputError);
    });
  });

  describe("update", () => {
    it("changes a role and signs the person out everywhere", async () => {
      h.targeting("packer");

      const updated = await h.service.update("packer", { role: "STAFF" }, as("owner"));

      expect(updated.role).toBe("STAFF");
      expect(h.signOutEverywhere).toHaveBeenCalledWith("packer", expect.anything());
    });

    it("does not sign anyone out for a rename", async () => {
      h.targeting("packer");

      await h.service.update("packer", { name: "Karim" }, as("owner"));

      expect(h.signOutEverywhere).not.toHaveBeenCalled();
    });

    it("refuses to change your own role", async () => {
      await expect(
        h.service.update("owner", { role: "STAFF" }, as("owner")),
      ).rejects.toBeInstanceOf(InvalidInputError);
    });

    it("refuses to demote the last active admin", async () => {
      // A second, disabled admin does not count: they cannot sign in to undo it.
      h = harness([row("owner", "ADMIN"), row("gone", "ADMIN", { disabledAt: new Date() })]);

      await expect(h.service.update("owner", { role: "STAFF" }, as("gone"))).rejects.toBeInstanceOf(
        InvalidInputError,
      );
    });

    it("allows demoting an admin while another active one remains", async () => {
      h = harness([row("owner", "ADMIN"), row("partner", "ADMIN")]);
      h.targeting("partner");

      const updated = await h.service.update("partner", { role: "STAFF" }, as("owner"));

      expect(updated.role).toBe("STAFF");
    });

    it("answers an unknown id with not-found", async () => {
      await expect(h.service.update("nobody", { name: "X" }, as("owner"))).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
    });
  });

  describe("disable and enable", () => {
    it("disables, signs out everywhere, and records it", async () => {
      h.targeting("packer");

      const disabled = await h.service.disable("packer", as("owner"));

      expect(disabled.disabledAt).not.toBeNull();
      expect(h.signOutEverywhere).toHaveBeenCalledWith("packer", expect.anything());
      expect(h.record).toHaveBeenCalledOnce();
    });

    it("refuses to disable yourself", async () => {
      await expect(h.service.disable("owner", as("owner"))).rejects.toBeInstanceOf(
        InvalidInputError,
      );
    });

    it("refuses to disable the last active admin", async () => {
      h = harness([row("owner", "ADMIN"), row("partner", "ADMIN", { disabledAt: new Date() })]);

      await expect(h.service.disable("owner", as("partner"))).rejects.toBeInstanceOf(
        InvalidInputError,
      );
    });

    it("re-enabling clears a lockout too", async () => {
      h = harness([
        row("owner", "ADMIN"),
        row("packer", "FULFILLMENT", {
          disabledAt: new Date(),
          failedLoginAttempts: 5,
          lockedUntil: new Date(),
        }),
      ]);
      h.targeting("packer");

      const enabled = await h.service.enable("packer", as("owner"));
      const stored = h.table().find((r) => r.id === "packer")!;

      expect(enabled.disabledAt).toBeNull();
      expect(stored.failedLoginAttempts).toBe(0);
      expect(stored.lockedUntil).toBeNull();
    });
  });

  describe("resetPassword", () => {
    it("replaces the hash, signs out everywhere, and returns the new password once", async () => {
      h.targeting("packer");

      const result = await h.service.resetPassword("packer", as("owner"));
      const stored = h.table().find((r) => r.id === "packer")!;

      expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(12);
      expect(stored.passwordHash).not.toBe("scrypt$old");
      expect(stored.passwordHash).not.toContain(result.temporaryPassword);
      expect(h.signOutEverywhere).toHaveBeenCalledWith("packer", expect.anything());
    });

    it("refuses to reset your own password", async () => {
      await expect(h.service.resetPassword("owner", as("owner"))).rejects.toBeInstanceOf(
        InvalidInputError,
      );
    });
  });

  it("marks the viewer's own row", async () => {
    // `list` reads outside a transaction; point the fake's db at the same table.
    const service = new AdminUsersService(
      {
        db: {
          select: () => ({
            from: () => ({ orderBy: async () => [row("owner", "ADMIN"), row("desk", "STAFF")] }),
          }),
        },
      } as never,
      {} as never,
      {} as never,
    );

    const { items } = await service.list(claimsFor("owner"));

    expect(items.find((item) => item.id === "owner")?.isSelf).toBe(true);
    expect(items.find((item) => item.id === "desk")?.isSelf).toBe(false);
  });
});
