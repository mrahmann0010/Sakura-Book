import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { WaitlistInvite } from "@sakura/contracts";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { DbService } from "../db/db.service";
import * as schema from "../db/schema";
import { waitlistEntries } from "../db/schema";
import { WaitlistInviteInvalidError } from "./waitlist-invite.errors";

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
   * Regenerating overwrites any previous token, which quietly invalidates it
   * — the old link stops resolving because the row it pointed at now holds a
   * different value. There is no need to explicitly revoke it.
   */
  async issue(entryId: string, ttlHours: number): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await this.dbService.db
      .update(waitlistEntries)
      .set({ inviteToken: token, inviteExpiresAt: expiresAt, inviteUsedAt: null })
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
        bookTitleSnapshot: true,
        quantity: true,
        inviteExpiresAt: true,
      },
    });

    if (!entry) throw new WaitlistInviteInvalidError();

    return {
      fullName: entry.customerName,
      email: entry.customerEmail,
      phone: entry.customerPhone,
      bookTitle: entry.bookTitleSnapshot,
      quantity: entry.quantity,
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
   */
  async consume(
    token: string,
    tx: PostgresJsDatabase<typeof schema> = this.dbService.db,
  ): Promise<{ entryId: string; bookId: string | null; quantity: number } | null> {
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
      });

    return row ?? null;
  }
}
