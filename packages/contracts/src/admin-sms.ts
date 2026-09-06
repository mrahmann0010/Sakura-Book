import { z } from "zod";

/* --------------------------------------------------------------------------
   Ad-hoc SMS from the admin panel: staff pick a phone number, write a
   message, and send it through SmsService (apps/api/src/sms) — the same
   client the waitlist invite flow uses, pointed at the android-sms-gateway
   phone. Nothing here is BD-specific validation on purpose: the gateway
   itself is the thing that accepts or rejects a number.

   Which SIM sends it is not part of this request — see admin-sms-settings
   below. It is shop configuration, set once in Shop Settings, not a choice
   restated on every message.
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

/**
 * Which SIM slot the gateway phone sends from, shop-wide.
 *
 * Persisted (shop_settings.sms_sim_number), unlike a form field that resets
 * on refresh — staff set this once, on the phone that will keep doing this
 * job, and it holds until someone deliberately changes it in Shop Settings.
 */
export const adminSmsSimNumbers = [1, 2, 3] as const;

export const adminSmsSettingsSchema = z.object({
  /** Null → let the gateway app's own sim_selection_mode setting decide. */
  simNumber: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  updatedAt: z.string().nullable(),
  updatedByEmail: z.string().nullable(),
});

export type AdminSmsSettings = z.infer<typeof adminSmsSettingsSchema>;

export const adminSmsSettingsUpdateSchema = z.object({
  simNumber: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
});

export type AdminSmsSettingsUpdate = z.infer<typeof adminSmsSettingsUpdateSchema>;
