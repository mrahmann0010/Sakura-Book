import { Injectable } from "@nestjs/common";
import type { WaitlistInvite, WaitlistInviteMode } from "@sakura/contracts";
import { and, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { toPostgresError } from "../common/errors";
import { DbService } from "../db/db.service";
import * as schema from "../db/schema";
import { waitlistEntries } from "../db/schema";
import { toE164Bd } from "../sms/phone";
import { generateInviteToken, normalizeInviteToken } from "./invite-token";
import { WaitlistInviteInvalidError } from "./waitlist-invite.errors";

/** The partial unique index on `invite_token` — see the entry's schema. */
const INVITE_TOKEN_CONSTRAINT = "waitlist_entries_invite_token_idx";

/**
 * Keyed on the one constraint, not the bare 23505, for the reason
 * checkout.service spells out: an UPDATE can violate other unique
 * constraints, and retrying with a fresh token would not fix those.
 */
function isTokenCollision(error: unknown): boolean {
  const cause = toPostgresError(error);

  return cause?.code === "23505" && cause.constraint_name === INVITE_TOKEN_CONSTRAINT;
}

/* An invite entitles its holder to exactly the quantity their entry asked
   for. There was a cap here that silently reduced every larger entry to 3,
   which meant a customer who waitlisted for 5 was texted a link that would
   only let them order 3 — with nothing on either side saying why. The "at
   most 3 books" rule is now applied by staff when they choose who to invite,
   where a person can see the whole picture; the link only ever honours the
   entry behind it. */

/**
 * The invite-token mechanism: issuing, reading, revoking, and single-use
 * redemption.
 *
 * Deliberately separate from `WaitlistService` (which owns signup) and from
 * whatever eventually decides *who* gets invited when stock is released —
 * this class only knows how to mint a token onto an entry that already has
 * one, and how to spend it. Nothing here decides quantities or picks entries.
 */
@Injectable()
export class WaitlistInviteService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Mint a token for one entry and record when it expires.
   *
   * Not restricted to any particular status here — the caller (the eventual
   * stock-release flow) is what decides an entry is eligible to be invited
   * and updates its status alongside this. This method only ever does one
   * thing: attach a fresh, unguessable credential.
   *
   * `mode` travels with the token rather than being inferred from the entry
   * (e.g. from `bookId` being set): the same kind of entry can be invited
   * either way depending on whether *this* release reserved stock against
   * it, so the caller states it explicitly each time.
   *
   * Regenerating overwrites any previous token, which quietly invalidates it
   * — the old link stops resolving because the row it pointed at now holds a
   * different value. There is no need to explicitly revoke it.
   */
  async issue(
    entryId: string,
    ttlHours: number,
    mode: WaitlistInviteMode,
    allocationId: string | null = null,
    waveId: string | null = null,
  ): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    /* Retry on collision rather than trusting 55 bits never to repeat. At the
       volumes this sees a second attempt is close to unreachable, but the
       unique index on `invite_token` is what makes that guarantee real, and
       the alternative to catching it here is a 500 on a staff member's
       restock batch. Three attempts turns a one-in-ten-million event into one
       we can stop thinking about; past that something else is wrong and the
       error deserves to surface. */
    for (let attempt = 1; ; attempt += 1) {
      const token = generateInviteToken();

      try {
        await this.dbService.db
          .update(waitlistEntries)
          .set({
            inviteToken: token,
            inviteMode: mode,
            inviteExpiresAt: expiresAt,
            inviteUsedAt: null,
            /* Written on every issue, including as null. A re-invite is a new
               hold charged to whichever release is open *now*, so carrying the
               previous one forward would bill a closed release for copies it
               never allocated — and leaving it stale is worse than clearing
               it, because the number would still look like an answer. */
            inviteAllocationId: allocationId,
            inviteWaveId: waveId,
            /* Incremented in the same statement rather than read-then-written:
               this is the fairness sort's key, and two concurrent issues
               against one entry that both read 1 would both write 2, quietly
               giving somebody a free turn at the front of the next wave. */
            inviteAttempts: sql`${waitlistEntries.inviteAttempts} + 1`,
          })
          .where(eq(waitlistEntries.id, entryId));

        return { token, expiresAt };
      } catch (error) {
        if (attempt >= 3 || !isTokenCollision(error)) throw error;
      }
    }
  }

  /**
   * Take an unspent invite back, and with it the copies it was holding.
   *
   * The counterpart to `issue`, and the piece that was missing. The
   * reservation subquery in `inventory/reservations.ts` deliberately has no
   * `status` clause — a copy is held for exactly as long as the token behind
   * it could still be spent — so an entry moving to CANCELLED did nothing on
   * its own: the person staff had just taken off the list kept a working link
   * and kept the shop's copies off the shelf until the TTL ran out. Status
   * said one thing and the invite said another, and the invite is what the
   * checkout path actually reads.
   *
   * Nulls all three token columns together, never one without the others —
   * the same invariant `issue` upholds from the other side, and now the one
   * the table's own CHECK constraints enforce against every future writer.
   *
   * `invite_used_at is null` is a guard, not an optimisation. A spent token is
   * history: the order that spent it points back at this entry, and erasing
   * the credential it was redeemed with would leave `invite_used_at` stamped
   * against nothing. There is also nothing to reclaim — a spent invite already
   * dropped out of the reservation subquery when it was spent.
   *
   * Silent when it matches nothing. Revoking is expressed as a desired end
   * state ("this entry holds no live invite"), and an entry that was never
   * invited already satisfies it.
   */
  async revoke(
    entryId: string,
    tx: PostgresJsDatabase<typeof schema> = this.dbService.db,
  ): Promise<void> {
    await tx
      .update(waitlistEntries)
      .set({
        inviteToken: null,
        inviteMode: null,
        inviteExpiresAt: null,
        /* Released with the hold it paid for. A withdrawn invite that kept its
           allocation reference would go on looking like a charge against that
           release forever — `committed` would not count it, since it holds no
           live token, but the row would still point at a budget it no longer
           spends, and the table's own CHECK refuses that pairing anyway. */
        inviteAllocationId: null,
        inviteWaveId: null,
        /* `inviteAttempts` is deliberately *not* reset. Withdrawing a hold
           returns the copies; it does not un-text the person. Zeroing it would
           put someone who has already had a turn back at the front of the next
           wave, ahead of people who have had none. */
        updatedAt: sql`now()`,
      })
      .where(and(eq(waitlistEntries.id, entryId), isNull(waitlistEntries.inviteUsedAt)));
  }

  /**
   * Read what a token entitles its holder to, without spending it.
   *
   * This backs the public `GET /waitlist/invite/:token` lookup a checkout
   * page calls on load to pre-fill itself — a light check for UX, not the
   * security boundary. `consume` below is that boundary, and re-runs the same
   * three conditions itself rather than trusting that this method was called
   * first.
   */
  async redeem(token: string): Promise<WaitlistInvite> {
    const entry = await this.dbService.db.query.waitlistEntries.findFirst({
      where: and(
        eq(waitlistEntries.inviteToken, normalizeInviteToken(token)),
        isNull(waitlistEntries.inviteUsedAt),
        gt(waitlistEntries.inviteExpiresAt, new Date()),
      ),
      columns: {
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        bookId: true,
        bookTitleSnapshot: true,
        quantity: true,
        inviteMode: true,
        inviteExpiresAt: true,
      },
    });

    if (!entry) throw new WaitlistInviteInvalidError();

    return {
      fullName: entry.customerName,
      email: entry.customerEmail,
      phone: entry.customerPhone,
      bookId: entry.bookId,
      bookTitle: entry.bookTitleSnapshot,
      quantity: entry.quantity,
      // Non-null: issue() always sets mode alongside the token this query
      // just matched on.
      mode: entry.inviteMode!,
      // Non-null: the query above requires it to be in the future.
      expiresAt: entry.inviteExpiresAt!.toISOString(),
    };
  }

  /**
   * Spend a token, atomically. The security boundary — `redeem` above is not.
   *
   * A single guarded UPDATE rather than a SELECT-then-UPDATE: the WHERE
   * clause re-checks unused-and-unexpired in the same statement that sets
   * `inviteUsedAt`, so Postgres itself decides which of two racing
   * redemptions (two tabs, a double-click) wins — the loser's UPDATE matches
   * zero rows and this returns null. Same pattern `ResourceConflictError`
   * documents for stock decrements.
   *
   * `tx` lets this run inside the order-creation transaction, so a token
   * spend and the order it paid for commit or roll back together.
   *
   * Returns `mode` alongside the reservation so the caller can enforce it:
   * a LOCKED invite's order must match `bookId`/`quantity` exactly before
   * this transaction commits; an OPEN one only needed the token spent.
   */
  async consume(
    token: string,
    tx: PostgresJsDatabase<typeof schema> = this.dbService.db,
  ): Promise<{
    entryId: string;
    bookId: string | null;
    quantity: number;
    mode: WaitlistInviteMode;
  } | null> {
    const [row] = await tx
      .update(waitlistEntries)
      .set({ inviteUsedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(waitlistEntries.inviteToken, normalizeInviteToken(token)),
          isNull(waitlistEntries.inviteUsedAt),
          gt(waitlistEntries.inviteExpiresAt, new Date()),
        ),
      )
      .returning({
        entryId: waitlistEntries.id,
        bookId: waitlistEntries.bookId,
        quantity: waitlistEntries.quantity,
        mode: waitlistEntries.inviteMode,
      });

    // mode is non-null by the same invariant redeem() relies on: it is only
    // ever null before an invite exists, and this UPDATE only matched a row
    // that has a live, unexpired token.
    return row ? { ...row, mode: row.mode! } : null;
  }

  /**
   * Spend the live invites this customer already holds for the books they are
   * buying, without asking them for the link.
   *
   * The case this exists for is absurd without it. Copies held under an invite
   * are subtracted from public availability by `reservedQuantitySql`, which
   * knows nothing about *whose* invite they are — correctly, because the
   * storefront has no idea who is browsing. So an invited customer who ignores
   * the SMS and buys the book the ordinary way is refused by the shop for lack
   * of stock, and the stock they were refused is the stock being held in their
   * name. They are the only person in the world who cannot buy that copy.
   *
   * Matching on phone and book is what makes the reservation theirs to spend:
   * the link is a convenience for reaching the checkout page with the basket
   * pre-filled, not the thing that entitles them to the copy. Their entry is.
   *
   * Nothing is granted here that the plain checkout would not grant. This only
   * moves copies out of "held for this person" and into "buyable in this
   * transaction" — the identical effect spending the token has, and the reason
   * both must happen before pricing reads availability. `InventoryService`
   * still decides whether the order fits, so an over-large basket is refused
   * on stock exactly as it would have been.
   *
   * LOCKED mode is deliberately not enforced, unlike the token path. That
   * check exists to stop a link being redeemed against a basket it was not
   * issued for, and there is no link here to misuse: an entry can only ever
   * release its own copies of its own book. Ordering fewer copies than the
   * entry asked for returns the difference to the shelf, and ordering more
   * simply buys the rest from public stock.
   */
  async consumeForCustomer(
    phone: string,
    bookIds: readonly string[],
    tx: PostgresJsDatabase<typeof schema> = this.dbService.db,
  ): Promise<{ entryId: string; bookId: string | null; quantity: number }[]> {
    const books = [...new Set(bookIds)];
    if (books.length === 0) return [];

    /* The same three conditions `consume` matches on, and the same guarded
       UPDATE, for the same reason: this runs inside the order transaction, and
       two racing checkouts by one customer must not both spend one hold. The
       difference is only how the row is found — by who they are rather than by
       what they are carrying. */
    return tx
      .update(waitlistEntries)
      .set({ inviteUsedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(waitlistEntries.customerPhone, toE164Bd(phone)),
          inArray(waitlistEntries.bookId, books),
          isNotNull(waitlistEntries.inviteToken),
          isNull(waitlistEntries.inviteUsedAt),
          gt(waitlistEntries.inviteExpiresAt, new Date()),
        ),
      )
      .returning({
        entryId: waitlistEntries.id,
        bookId: waitlistEntries.bookId,
        quantity: waitlistEntries.quantity,
      });
  }

  /**
   * Record which order an invite became, and move the entry to CONVERTED.
   *
   * The other half of `consume`. Spending a token proves the customer came
   * back; it does not say what they bought, because at the moment the token
   * is spent the order row does not exist yet. So this runs after the insert,
   * inside the same transaction — an entry is never marked converted against
   * an order that rolled back, and an order placed through an invite never
   * commits leaving its entry sitting in NOTIFIED. Without it the Converted
   * tab reads zero forever and "how many of our 200 invites became orders?"
   * is a spreadsheet exercise in matching phone numbers.
   *
   * `status` is set unconditionally rather than through the invite's own
   * guard: `consume` already established that this entry held a live token,
   * and it hands back the id precisely so the caller can finish the job.
   */
  async markConverted(
    entryId: string,
    orderId: string,
    tx: PostgresJsDatabase<typeof schema> = this.dbService.db,
  ): Promise<void> {
    await tx
      .update(waitlistEntries)
      .set({ status: "CONVERTED", convertedOrderId: orderId, updatedAt: sql`now()` })
      .where(eq(waitlistEntries.id, entryId));
  }
}
