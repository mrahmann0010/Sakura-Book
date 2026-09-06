import { z } from "zod";

/* --------------------------------------------------------------------------
   Ad-hoc SMS from the admin panel: staff pick a phone number, write a
   message, and send it through SmsService (apps/api/src/sms) — the same
   client the waitlist invite flow uses, pointed at the android-sms-gateway
   phone. Nothing here is BD-specific validation on purpose: the gateway
   itself is the thing that accepts or rejects a number.
   -------------------------------------------------------------------------- */

export const adminSmsSendRequestSchema = z.object({
  to: z.string().trim().min(1, "Enter a phone number.").max(32),
  message: z.string().trim().min(1, "Enter a message.").max(1000),
});

export type AdminSmsSendRequest = z.infer<typeof adminSmsSendRequestSchema>;

export const adminSmsSendResultSchema = z.object({
  sentAt: z.string(),
});

export type AdminSmsSendResult = z.infer<typeof adminSmsSendResultSchema>;
