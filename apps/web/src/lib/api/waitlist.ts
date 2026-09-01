import {
  restockScheduleSchema,
  waitlistBooksSchema,
  waitlistEntrySchema,
  waitlistSubscribeRequestSchema,
  type RestockSchedule,
  type WaitlistBook,
  type WaitlistEntry,
  type WaitlistSubscribeRequest,
} from "@sakura/contracts";

import { apiFetch } from "./client";

/** POST /waitlist — join the shop-wide restock waitlist. */
export function subscribeToWaitlist(request: WaitlistSubscribeRequest): Promise<WaitlistEntry> {
  const validated = waitlistSubscribeRequestSchema.parse(request);
  return apiFetch("/waitlist", waitlistEntrySchema, {
    method: "POST",
    body: validated,
    revalidate: false,
  });
}

/**
 * GET /waitlist/schedule — the shop-wide date ordering reopens, or null.
 *
 * Revalidated at 300s to match the endpoint's own `max-age`, rather than being
 * fetched fresh on every render: this is a date that moves a few times a year,
 * and the /notify page is the one page in the shop most likely to be hit by a
 * burst of people who all just got the same SMS.
 */
export function getRestockSchedule(): Promise<RestockSchedule> {
  return apiFetch("/waitlist/schedule", restockScheduleSchema, { revalidate: 300 });
}

/**
 * GET /waitlist/books — the titles staff have put on offer.
 *
 * Revalidated at 300s to match the endpoint's `max-age`, same as the schedule
 * above: this list is edited from the panel a few times a year, and the page
 * that reads it is the one most likely to be opened by a crowd at once. The
 * tradeoff is that a change staff make takes up to five minutes to appear.
 */
export function getWaitlistBooks(): Promise<WaitlistBook[]> {
  return apiFetch("/waitlist/books", waitlistBooksSchema, { revalidate: 300 });
}
