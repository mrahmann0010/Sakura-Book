import { z } from "zod";

/* --------------------------------------------------------------------------
   Waitlist — "notify me when it's back".

   Covers two signups through one shape: the shop-wide restock list (no book
   named) and a wait on one specific title. Which one it is comes down to
   whether `bookId` is present — that mirrors `waitlistEntries.bookId` being
   nullable, and the two partial unique indexes over it, exactly.

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

export const waitlistSubscribeRequestSchema = z.object({
  /**
   * The title they want, or absent for "tell me when anything is back".
   *
   * Optional rather than required, because the general list is the default
   * the shop-wide pause needs: a customer who just wants to know when you
   * reopen has somewhere to go, and the entry point that has been writing
   * rows since day one keeps working unchanged.
   *
   * The book's *title* is not accepted here — the server reads it from the
   * catalog and snapshots it. A title sent by the client would be a display
   * string the customer's browser chose, stored as the record of what they
   * asked for.
   */
  bookId: z.string().uuid("Choose a book from the list.").optional(),

  fullName: required("Add your name."),
  email: z.string().trim().email("Use an address like you@example.com so we can reach you."),
  phone: required("Add a phone number so we can text you when it's back."),
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
