import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { WaitlistInvite, WaitlistInviteMode } from "@sakura/contracts";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { DbService } from "../db/db.service";
import * as schema from "../db/schema";
import { waitlistEntries } from "../db/schema";
import { WaitlistInviteInvalidError } from "./waitlist-invite.errors";

/* An invite entitles its holder to exactly the quantity their entry asked
   for. There was a cap here that silently reduced every larger entry to 3,
   which meant a customer who waitlisted for 5 was texted a link that would
   only let them order 3 — with nothing on either side saying why. The "at
   most 3 books" rule is now applied by staff when they choose who to invite,
   where a person can see the whole picture; the link only ever honours the
   entry behind it. */

/**
 * The invite-token mechanism: issuing, reading, and single-use redemption.
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
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await this.dbService.db
      .update(waitlistEntries)
      .set({ inviteToken: token, inviteMode: mode, inviteExpiresAt: expiresAt, inviteUsedAt: null })
      .where(eq(waitlistEntries.id, entryId));

    return { token, expiresAt };
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
        eq(waitlistEntries.inviteToken, token),
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
          eq(waitlistEntries.inviteToken, token),
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
