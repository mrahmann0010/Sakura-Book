import { z } from "zod";

/* --------------------------------------------------------------------------
   Waitlist — "notify me when it's back".

   Every signup names one book. `waitlistEntries.bookId` stays nullable at
   the schema level — old rows written before this was required still read
   fine, and the general-list index is harmless dead weight rather than a
   migration — but new requests must choose a title.

   One book per signup, not several. A request maps to one row, so someone
   waiting on three titles submits three times and holds three independent
   places in three queues — rather than one request quietly fanning out into
   rows that can then be notified, converted and cancelled separately from
   each other while pretending to be a single thing.

   Validation messages state the fix rather than the fault, per checkout.ts's
   own rule — they stay English for the same reason: the API ships one
   language and the clients render from `code` + `path` for translation.
   -------------------------------------------------------------------------- */

const required = (fix: string) => z.string().trim().min(1, fix);

export const waitlistStatuses = ["PENDING", "NOTIFIED", "CONVERTED", "CANCELLED"] as const;
export type WaitlistStatus = (typeof waitlistStatuses)[number];

/**
 * Where an entry actually stands right now — the thing staff work from, and
 * the thing `status` above cannot answer on its own.
 *
 * `status` records decisions people made: reached them, they bought, they
 * asked to be removed. It is deliberately monotonic and it has no opinion
 * about the clock. But the question a restock morning asks is "is this person
 * holding a copy, did their window lapse, or have they not had a turn yet",
 * and the answer moves without anybody writing a row.
 *
 *   WAITING    in the queue, holding nothing. Never invited, or their invite
 *              was withdrawn.
 *   INVITED    holding a live, unspent link — and therefore holding copies
 *              that the storefront may not sell to anyone else.
 *   EXPIRED    was invited, never ordered, window closed. Their copies went
 *              back to the pool the instant it did.
 *   CONVERTED  became an order.
 *   CANCELLED  taken off the list.
 *
 * **There is no `EXPIRED` in `waitlistStatuses` and there must never be one.**
 * Storing it would mean writing it, and between a window closing and whatever
 * job noticed, the database would say a copy is held while the shelf says it
 * is free — which is precisely where a shop oversells. The lane is computed
 * from the invite columns by the same expression `inventory/reservations.ts`
 * holds copies back under, so the admin panel and the storefront cannot
 * disagree about who is holding what. See `waitlist/waitlist-lane.ts`.
 */
export const waitlistLanes = [
  "WAITING",
  "INVITED",
  "EXPIRED",
  "CONVERTED",
  "CANCELLED",
] as const;

export type WaitlistLane = (typeof waitlistLanes)[number];

export const waitlistSubscribeRequestSchema = z.object({
  /**
   * The title they want. Required — "notify me about something, someday"
   * isn't a queue staff can act on, so every signup has to name a book.
   *
   * The book's *title* is not accepted here — the server reads it from the
   * catalog and snapshots it. A title sent by the client would be a display
   * string the customer's browser chose, stored as the record of what they
   * asked for.
   */
  bookId: z.string().uuid("Choose a book from the list."),

  fullName: required("Add your name."),
  email: z.string().trim().email("Use an address like you@example.com so we can reach you."),
  /**
   * Bangladeshi mobile, with or without the country code — matches the
   * client's own picker regex. The service normalizes this to E.164 before
   * it dedupes or stores it (see `waitlist.service.ts`), so this schema's
   * job is just to reject anything that couldn't normalize to a real number
   * before it reaches that point.
   */
  phone: z
    .string()
    .trim()
    .regex(/^(\+?88)?01[3-9]\d{8}$/, "Use a Bangladeshi mobile number, e.g. 01712345678."),
  quantity: z
    .number()
    .int("Enter a whole number.")
    .min(1, "Enter at least 1.")
    .max(20, "Enter 20 or fewer — contact us directly for bulk orders."),
  /** BCP 47 tag the form was submitted under (en/bn/ja) — which language to
   *  send the restock alert in. */
  locale: required("Missing locale."),
  /** Which entry point this came from, e.g. "restock-notify-page". Free text
   *  so a future entry point never needs a contract change to be recorded. */
  source: required("Missing source."),
});

export type WaitlistSubscribeRequest = z.infer<typeof waitlistSubscribeRequestSchema>;

/**
 * What the client gets back — just enough to render a confirmation and, if
 * ever needed, look the entry up again. Never the phone/email it was just
 * given: the client already has those, and echoing PII back in a response
 * body is a habit worth not starting.
 */
export const waitlistEntrySchema = z.object({
  id: z.string().uuid(),
  status: z.enum(waitlistStatuses),
  /** The snapshotted title, or null for the general list. Echoed back so the
   *  confirmation can name the book — the client sent an id, and reading the
   *  title off the response is how it says "we'll tell you about *this*"
   *  using the same string the entry was actually recorded against. */
  bookTitle: z.string().nullable(),
  createdAt: z.string(),
});

export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;

/* --------------------------------------------------------------------------
   The titles on offer.

   Which books /notify lets a customer wait on is an editorial choice staff
   make in the panel, not the whole catalog and not "everything at zero stock".
   A shop with five titles may want names collected for two of them.

   This is the customer's view of that choice — id and title, which is exactly
   what the picker draws and what `bookId` above is submitted from. Price,
   cover and stock are all absent deliberately: this is a `<select>`, not a
   shelf, and a list that carried them would invite one to grow on this page.
   -------------------------------------------------------------------------- */

export const waitlistBookSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
});

export type WaitlistBook = z.infer<typeof waitlistBookSchema>;

/** Empty is a real answer: no titles on offer means the general list only. */
export const waitlistBooksSchema = z.array(waitlistBookSchema);

/* --------------------------------------------------------------------------
   When ordering reopens.

   Lives here rather than in admin-settings.ts because the customer-facing
   half is the /notify page's own data — the same page this file's subscribe
   request comes from — and the storefront should not import an admin contract
   to render a line of its own copy. The admin's editing view of it sits
   alongside in admin-settings.ts.
   -------------------------------------------------------------------------- */

/**
 * An ISO-8601 calendar date, `YYYY-MM-DD`.
 *
 * A date and not a datetime, matching `shopSettings.reopenDate`: the shop
 * reopens on a day, not at an instant, and a timestamp would render as the
 * day before for anyone west of the zone it was written in. Formatting it for
 * display — and translating the month name — is the client's job, which is
 * the other reason not to send a pre-formatted string.
 */
export const reopenDateSchema = z.iso.date();

export const restockScheduleSchema = z.object({
  /** Null when no date has been announced. The page then omits the line
   *  entirely rather than rendering an empty one — see the column's comment. */
  reopenDate: reopenDateSchema.nullable(),
});

export type RestockSchedule = z.infer<typeof restockScheduleSchema>;

/* --------------------------------------------------------------------------
   Invite tokens — "your turn to order".

   A waitlist entry that has been invited carries a single-use token in its
   link. This is the customer's view of redeeming one: enough to pre-fill and
   lock the checkout form, nothing more.
   -------------------------------------------------------------------------- */

export const waitlistInviteModes = ["LOCKED", "OPEN"] as const;
export type WaitlistInviteMode = (typeof waitlistInviteModes)[number];

export const waitlistInviteSchema = z.object({
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  /**
   * The book this entry names, or null for the general list. Present
   * alongside `bookTitle` (rather than the title alone) because a LOCKED
   * invite's checkout needs a real id to price and order against — the
   * title alone is display copy, not something `/cart/quote` accepts.
   */
  bookId: z.string().uuid().nullable(),
  /** The snapshotted title, or null for the general list. */
  bookTitle: z.string().nullable(),
  quantity: z.number().int(),
  /**
   * LOCKED: checkout is fixed to bookTitle/quantity above, editable only in
   * that it can be completed or abandoned. OPEN: these are a pre-fill only —
   * the cart behaves normally. See the DB enum's own comment for why.
   */
  mode: z.enum(waitlistInviteModes),
  /** When this link stops working. ISO 8601. */
  expiresAt: z.string(),
});

export type WaitlistInvite = z.infer<typeof waitlistInviteSchema>;
