import { z } from "zod";

/* --------------------------------------------------------------------------
   Stock, as one screen.

   The numbers here already existed; what did not exist was anywhere to see
   them together. `stock_quantity` was edited in the catalog form between the
   cover image and the SEO fields, the queue's share was decided on the
   waitlist page behind a book filter, and what a stranger could actually buy —
   the number the shop sells against — was rendered nowhere in the admin panel
   at all. Three inputs to one decision, in three places, with the output
   missing.

   So this is deliberately not a new source of truth. Every field below is read
   from the same expressions the storefront and the invite path already use, in
   one query, so a row cannot disagree with the shop it describes.
   -------------------------------------------------------------------------- */

/**
 * One book's supply, and the demand waiting on it.
 *
 * The four quantities sum to `onHand` by construction, which is the property
 * the screen is built to show: a manager reads a row as one thing being
 * divided, not as four independent numbers that happen to be nearby.
 */
export const adminStockRowSchema = z.object({
  bookId: z.string().uuid(),
  title: z.string(),
  slug: z.string(),

  /** `books.stock_quantity` — the copies that physically exist. */
  onHand: z.number().int(),

  /** Copies held by invites someone can still spend: sent, unused, unexpired. */
  promised: z.number().int().nonnegative(),

  /** The open release's unspent budget — set aside for the queue, not yet sent. */
  reserved: z.number().int().nonnegative(),

  /** What a stranger may buy right now: `onHand − promised − reserved`, floored. */
  onShelf: z.number().int().nonnegative(),

  /** People in the queue for this title who have neither converted nor cancelled. */
  waiting: z.number().int().nonnegative(),

  /** Copies those people are asking for, which is what the queue actually costs. */
  waitingQuantity: z.number().int().nonnegative(),

  /**
   * The open release's id, or null when the book has none.
   *
   * Null with `waiting > 0` is the state that made this screen necessary: every
   * invite for that book is refused before a text is attempted, and nothing
   * anywhere said so. The row renders it as a warning.
   */
  allocationId: z.string().uuid().nullable(),

  /** The open release's size, for "32 of 50 left to give out". */
  allocationCopies: z.number().int().positive().nullable(),

  /**
   * More copies promised than the shop owns.
   *
   * Reachable whenever stock is lowered under live invites. The storefront
   * already refuses to sell such a book; only a person can decide whether to
   * print more or withdraw somebody's link, so the one useful thing is to say
   * so where that person will see it.
   */
  overIssued: z.boolean(),
});

export type AdminStockRow = z.infer<typeof adminStockRowSchema>;

/**
 * Every book that can hold stock, warnings first.
 *
 * Unpaginated on purpose. This is a shop with a shelf of titles, not a
 * marketplace, and the whole value of the screen is that one glance covers
 * everything — a paginated version would let a book needing attention sit on
 * page two, which is the failure it exists to prevent.
 */
export const adminStockListSchema = z.object({
  items: z.array(adminStockRowSchema),
});

export type AdminStockList = z.infer<typeof adminStockListSchema>;
