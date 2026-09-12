import { Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { DbService } from "../db/db.service";
import * as schema from "../db/schema";
import { waitlistEntries } from "../db/schema";
import { toE164Bd } from "../sms/phone";

type Executor = PostgresJsDatabase<typeof schema>;

/* --------------------------------------------------------------------------
   The waitlist half of "this customer bought the book".

   A waitlist entry is three promises at once: we will tell you when it is
   back, we will keep a copy for you, and you count as somebody still wanting
   this title. Buying the book settles all three — and until this module
   existed, nothing noticed, because a storefront checkout only ever looked at
   the waitlist when the request carried an invite token. A customer who joined
   the list, then simply bought the book from the shop page like anyone else,
   stayed in the queue as though they were still waiting:

     - they kept getting restock texts for a book already on their shelf, at
       one paid SMS segment each (Bangla is UCS-2: 70 characters a segment);
     - any copies still held under their live link stayed held, off the public
       shelf and off the next person in the queue, until the window lapsed;
     - and in the worst reading of the same bug, the copies held *for them*
       were the copies the storefront refused to sell them, because a
       reservation is subtracted from public availability no matter whose it is.

   The fix is to match the order back to the queue, and the key is the phone
   number — not a new identity concept but the one this table already uses:
   phones are stored E.164-normalised and the uniqueness rule that makes a
   waitlist a queue is `(phone, book)`. If two rows here mean "the same person"
   anywhere in this system, they do so because their phone numbers match.
   -------------------------------------------------------------------------- */

/**
 * What an order says about the waitlist, and what to do about it.
 *
 * Split from `WaitlistInviteService` because the direction of travel is
 * opposite: that class is the invite mechanism, driven by staff deciding who
 * to text. This one is driven by customers doing something on the storefront
 * that happens to have a consequence for the queue, and it must work for
 * customers who were never invited at all.
 */
@Injectable()
export class WaitlistFulfillmentService {
  private readonly logger = new Logger(WaitlistFulfillmentService.name);

  constructor(private readonly dbService: DbService) {}

  /**
   * Link every entry this order appears to settle, and put them in the ORDERED
   * lane.
   *
   * Matched on phone *and* book, both required. Phone alone would close a
   * queue for a title the customer did not buy, which is worse than the bug
   * being fixed: the shop would stop telling somebody about the book they are
   * actually waiting for because they bought a different one. The order's phone
   * is normalised through the same `toE164Bd` the SMS gateway uses, because
   * checkout stores what was typed and the waitlist stores E.164 — an
   * unnormalised comparison matches almost nothing, silently.
   *
   * Terminal entries are left alone. CONVERTED is already done; CANCELLED is
   * the shop's only do-not-contact record and a purchase is not a request to
   * be put back on a list somebody asked to leave.
   *
   * `excludeEntryIds` carries the entries this same checkout has already
   * converted outright by spending their invite. Those are finished, and
   * re-stamping them as merely "ordered" would walk a completed entry
   * backwards — the status filter below would catch it once they are CONVERTED,
   * but this runs in the same transaction as that write and must not depend on
   * the order the two statements happen to be issued in.
   *
   * Deliberately writes no status. The entry stays PENDING or NOTIFIED — the
   * record of what the shop has actually done with this person — and the lane
   * reports ORDERED off this column alone. That is what makes `release` below
   * a single null-out rather than a guess at which status to restore.
   */
  async markOrdered(
    phone: string,
    bookIds: readonly string[],
    orderId: string,
    tx: Executor = this.dbService.db,
    options: { excludeEntryIds?: readonly string[] } = {},
  ): Promise<string[]> {
    const books = [...new Set(bookIds)];
    if (books.length === 0) return [];

    const { excludeEntryIds } = options;

    const matched = await tx
      .update(waitlistEntries)
      .set({ fulfillingOrderId: orderId, updatedAt: sql`now()` })
      .where(
        and(
          eq(waitlistEntries.customerPhone, toE164Bd(phone)),
          inArray(waitlistEntries.bookId, books),
          ne(waitlistEntries.status, "CONVERTED"),
          ne(waitlistEntries.status, "CANCELLED"),
          ...(excludeEntryIds && excludeEntryIds.length > 0
            ? [notInArray(waitlistEntries.id, [...excludeEntryIds])]
            : []),
        ),
      )
      .returning({ id: waitlistEntries.id });

    return matched.map((row) => row.id);
  }

  /**
   * The order was paid for: the entries it settles are conversions now.
   *
   * PAYMENT_CONFIRMED rather than placement, for the reason the column's own
   * comment gives, and PAYMENT_CONFIRMED rather than DELIVERED because that is
   * the earliest point at which the money is real for *both* payment methods —
   * a bKash transfer confirmed at the desk, and a cash-on-delivery order, which
   * reaches this status only by being marked delivered (see
   * `AdminOrdersService.confirmPayment`, which refuses COD outright). Waiting
   * for DELIVERED would leave prepaid entries suppressed for days after the
   * shop had the money, unable to rejoin for the next print run.
   *
   * `fulfillingOrderId` is cleared in the same statement. The belief has been
   * replaced by the fact, and leaving both set would give the entry two
   * answers to "which order was this" that some later query would have to pick
   * between.
   *
   * CANCELLED is excluded, and only CANCELLED: somebody who asked to come off
   * the list while their order was in flight has still asked to come off the
   * list. Their link to the order is dropped all the same, so the lane stops
   * claiming an order is pending for a row nobody is working.
   */
  async settle(orderId: string, tx: Executor = this.dbService.db): Promise<void> {
    const settled = await tx
      .update(waitlistEntries)
      .set({
        status: "CONVERTED",
        convertedOrderId: orderId,
        fulfillingOrderId: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(waitlistEntries.fulfillingOrderId, orderId),
          ne(waitlistEntries.status, "CANCELLED"),
        ),
      )
      .returning({ id: waitlistEntries.id });

    /* The cancelled leftovers, dropped without being converted. Separate
       statement rather than a wider WHERE on the one above, because these two
       are different acts that happen to touch the same column: one records a
       sale, the other tidies up a link to an order that will never mean
       anything for this row. */
    await tx
      .update(waitlistEntries)
      .set({ fulfillingOrderId: null, updatedAt: sql`now()` })
      .where(
        and(
          eq(waitlistEntries.fulfillingOrderId, orderId),
          eq(waitlistEntries.status, "CANCELLED"),
        ),
      );

    if (settled.length > 0) {
      this.logger.log(`Order ${orderId} converted ${settled.length} waitlist entr(y|ies)`);
    }
  }

  /**
   * The order died: put everyone it was holding back in the queue.
   *
   * A cancelled or refunded order proves nothing about whether the customer
   * still wants the book — an abandoned cash-on-delivery parcel is the most
   * ordinary event on this desk — so the entry goes back to exactly where it
   * was. That is a single null-out precisely because `markOrdered` never wrote
   * `status`: `created_at` still holds their place in the fairness order and
   * `invite_attempts` still records the turns they have had, so they rejoin
   * the queue in their original seat rather than at the back of it.
   *
   * Entries already settled are untouched, because `settle` cleared this
   * column when it converted them. A refund after delivery therefore leaves a
   * CONVERTED entry standing, which is the honest reading: the queue did its
   * job and the sale came apart afterwards, for reasons this table has no
   * opinion about. Such a customer is not stranded either — CONVERTED is the
   * one status the signup uniqueness rule ignores, so they can simply join the
   * list again.
   */
  async release(orderId: string, tx: Executor = this.dbService.db): Promise<void> {
    const released = await tx
      .update(waitlistEntries)
      .set({ fulfillingOrderId: null, updatedAt: sql`now()` })
      .where(eq(waitlistEntries.fulfillingOrderId, orderId))
      .returning({ id: waitlistEntries.id });

    if (released.length > 0) {
      this.logger.log(
        `Order ${orderId} ended without payment; ${released.length} waitlist entr(y|ies) back in the queue`,
      );
    }
  }
}
