import { z } from "zod";

/* --------------------------------------------------------------------------
   Stock releases — how much of a restock the waitlist is allowed to spend.

   Step 2 of the queue design: a decision the shop makes deliberately, once
   per restock, *before* anybody is contacted. Sixty copies landed; fifty are
   the queue's and ten stay for whoever walks in.

   Without it the invite budget is the whole print run, and a queue long
   enough holds every copy for the length of an invite window — which is a
   shop that only ever serves its backlog and never acquires anyone new.
   -------------------------------------------------------------------------- */

/**
 * How many copies of this restock the waitlist may be promised.
 *
 * Upper bound is a sanity rail, not a business rule: `spendable` is capped by
 * physical stock anyway, so a number larger than the print run wastes nobody's
 * copies — it just makes the release's own figure meaningless as a record of
 * what was decided.
 */
export const adminWaitlistAllocationOpenSchema = z.object({
  bookId: z.string().uuid(),

  copies: z
    .number()
    .int("Copies must be a whole number.")
    .positive("Allocate at least one copy, or don't open a release.")
    .max(100_000),

  /** Staff-facing: "Sept restock, 10 held for the shop counter". */
  note: z.string().trim().max(500).optional(),
});

export type AdminWaitlistAllocationOpen = z.infer<typeof adminWaitlistAllocationOpenSchema>;

/**
 * Correct an open release's size without ending it.
 *
 * Separate from opening because the id names an existing decision rather than
 * a book, and because the two must not be confused: close-then-reopen is the
 * obvious-looking way to resize and is the one thing that silently over-issues
 * — `committed` is counted per allocation, so a fresh row starts at zero and
 * hands out copies the closed one already promised.
 *
 * `note` is optional and absent means "leave it alone", not "clear it". A
 * correction usually has nothing to say about a note written when the restock
 * landed, and wiping it because the field was not sent would lose the only
 * record of why the split was chosen.
 */
export const adminWaitlistAllocationResizeSchema = z.object({
  copies: z
    .number()
    .int("Copies must be a whole number.")
    .positive("A release of zero copies is a closed one — close it instead.")
    .max(100_000),

  note: z.string().trim().max(500).nullish(),
});

export type AdminWaitlistAllocationResize = z.infer<typeof adminWaitlistAllocationResizeSchema>;

/**
 * A release's budget, worked out at read time.
 *
 * Every number below `copies` is derived from the invites themselves on every
 * request — none of them is stored. See the table's own comment for why: a
 * counter would have to be adjusted on issue, redemption, expiry and
 * withdrawal, and the expiry case is not an event anybody writes, so a counter
 * could only learn about it from a sweep that might not run.
 */
export const adminWaitlistAllocationSchema = z.object({
  id: z.string().uuid(),
  bookId: z.string().uuid(),

  /** The decision: how many copies this release gives the waitlist. */
  copies: z.number().int().positive(),

  /** `books.stock_quantity` when the decision was made, so "50 of 60" stays
   *  legible after the stock count has moved. Never used in arithmetic. */
  stockSnapshot: z.number().int().nonnegative(),

  /** Live stock right now — what `spendable` is actually limited by. */
  stockQuantity: z.number().int().nonnegative(),

  note: z.string().nullable(),

  /** Copies this release has spent: sold through, plus still being held.
   *  Lapsed invites are absent, which is how recycling happens with no job. */
  committed: z.number().int().nonnegative(),

  /** `copies − committed`, floored at zero. This release's own budget left. */
  remaining: z.number().int().nonnegative(),

  /**
   * What staff may actually hand out: the smaller of `remaining` and the
   * copies that physically exist unheld.
   *
   * Allocation narrows, it never widens. A release of 80 on a 60-copy book
   * does not conjure twenty books, and this is the number that says so — it is
   * the one the "Invite next N" button counts.
   */
  spendable: z.number().int().nonnegative(),

  /**
   * More copies are promised than the book has, which an admin lowering the
   * stock count under live invites can create at any moment.
   *
   * Surfaced rather than silently floored because nothing in the system can
   * resolve it: the storefront already refuses to sell, `spendable` is already
   * zero, and the actual choice — print more, or withdraw somebody's invite —
   * belongs to a person.
   */
  overIssued: z.boolean(),

  openedAt: z.string(),
  openedByEmail: z.string().nullable(),
});

export type AdminWaitlistAllocation = z.infer<typeof adminWaitlistAllocationSchema>;

/** One book's release history, newest first, with the open one called out. */
export const adminWaitlistAllocationHistorySchema = z.object({
  id: z.string().uuid(),
  copies: z.number().int().positive(),
  stockSnapshot: z.number().int().nonnegative(),
  note: z.string().nullable(),
  status: z.enum(["OPEN", "CLOSED"]),
  /** Still spent, i.e. sold or currently held. */
  committed: z.number().int().nonnegative(),
  /** Of that, the half that became orders. */
  sold: z.number().int().nonnegative(),
  openedAt: z.string(),
  openedByEmail: z.string().nullable(),
  closedAt: z.string().nullable(),
  closedByEmail: z.string().nullable(),
});

export type AdminWaitlistAllocationHistory = z.infer<typeof adminWaitlistAllocationHistorySchema>;

export const adminWaitlistAllocationViewSchema = z.object({
  /** The open release, or null when the shop has not opened one — in which
   *  case no invite for this book will send. */
  open: adminWaitlistAllocationSchema.nullable(),
  history: z.array(adminWaitlistAllocationHistorySchema),
});

export type AdminWaitlistAllocationView = z.infer<typeof adminWaitlistAllocationViewSchema>;
