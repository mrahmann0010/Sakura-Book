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
