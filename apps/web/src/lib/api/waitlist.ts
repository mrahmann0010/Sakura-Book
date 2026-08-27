import {
  waitlistEntrySchema,
  waitlistSubscribeRequestSchema,
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
