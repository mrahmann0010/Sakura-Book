import { describe, expect, it, vi } from "vitest";
import { WaitlistInviteInvalidError } from "../../src/waitlist/waitlist-invite.errors";
import { WaitlistInviteService } from "../../src/waitlist/waitlist-invite.service";

/**
 * The invite token is the whole security boundary for "come place your
 * order" — these pin down the two properties that matter: `redeem` must
 * refuse anything that isn't currently valid, and `consume` must be the
 * atomic, race-proof spend rather than a check followed by a separate write.
 */

function fakeDbService(entry: unknown) {
  return {
    db: {
      query: {
        waitlistEntries: {
          findFirst: vi.fn().mockResolvedValue(entry),
        },
      },
    },
  } as never;
}

describe("WaitlistInviteService.redeem", () => {
  it("returns the invite's view when the token resolves to a live entry", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const service = new WaitlistInviteService(
      fakeDbService({
        customerName: "Mina",
        customerEmail: "mina@example.com",
        customerPhone: "01700000000",
        bookTitleSnapshot: "N5 Kanji Book",
        quantity: 2,
        inviteExpiresAt: expiresAt,
      }),
    );

    await expect(service.redeem("tok_abc")).resolves.toEqual({
      fullName: "Mina",
      email: "mina@example.com",
      phone: "01700000000",
      bookTitle: "N5 Kanji Book",
      quantity: 2,
      expiresAt: expiresAt.toISOString(),
    });
  });

  it("throws WaitlistInviteInvalidError when no row matches — wrong, expired, or spent", async () => {
    // The query itself already encodes "unused and unexpired"; a null result
    // covers all three failure causes at once, and the caller cannot tell
    // them apart — see the error's own comment for why that's deliberate.
    const service = new WaitlistInviteService(fakeDbService(undefined));

    await expect(service.redeem("tok_bad")).rejects.toBeInstanceOf(WaitlistInviteInvalidError);
  });
});

describe("WaitlistInviteService.consume", () => {
  function fakeTx(returning: unknown[]) {
    const where = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(returning) });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });

    return { tx: { update } as never, update, set, where };
  }

  it("spends the token and returns what it was worth", async () => {
    const { tx } = fakeTx([{ entryId: "e1", bookId: "b1", quantity: 3 }]);
    const service = new WaitlistInviteService({} as never);

    await expect(service.consume("tok_abc", tx)).resolves.toEqual({
      entryId: "e1",
      bookId: "b1",
      quantity: 3,
    });
  });

  it("returns null when the guarded UPDATE matches nothing — already used, expired, or unknown", async () => {
    // This is the race-proof case: two concurrent redemptions of the same
    // link both call consume(); the WHERE clause's own "unused and
    // unexpired" check is what Postgres evaluates atomically, so at most one
    // UPDATE ever matches a row. The loser sees exactly this: zero rows back,
    // not an error, not a stale read.
    const { tx } = fakeTx([]);
    const service = new WaitlistInviteService({} as never);

    await expect(service.consume("tok_spent", tx)).resolves.toBeNull();
  });
});

/**
 * Taking an invite back.
 *
 * The reservation subquery in `inventory/reservations.ts` holds a copy for
 * exactly as long as its token could still be spent, and reads no status at
 * all — so revoking is the *only* thing that returns copies before the TTL
 * runs out, and cancelling an entry without it leaves the shop holding stock
 * for someone it just removed from the list, who still has a working link.
 */
describe("WaitlistInviteService.revoke", () => {
  function fakeTx() {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });

    return { tx: { update } as never, set, where };
  }

  it("clears all three invite columns together, never one without the others", async () => {
    // The invariant both `redeem` and `consume` assert non-null against, and
    // that the table's CHECK constraint now enforces: a token, its mode and
    // its expiry exist together or not at all.
    const { tx, set } = fakeTx();

    await new WaitlistInviteService({} as never).revoke("e1", tx);

    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]![0]).toMatchObject({
      inviteToken: null,
      inviteMode: null,
      inviteExpiresAt: null,
    });
  });

  it("never touches invite_used_at, so a spent invite keeps its record", async () => {
    // Erasing the token a redemption was made with would leave `invite_used_at`
    // stamped against nothing — and there is nothing to reclaim either: a spent
    // invite dropped out of the reservation count when it was spent.
    const { tx, set } = fakeTx();

    await new WaitlistInviteService({} as never).revoke("e1", tx);

    expect(set.mock.calls[0]![0]).not.toHaveProperty("inviteUsedAt");
  });
});
