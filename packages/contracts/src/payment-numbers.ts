import { z } from "zod";

/* --------------------------------------------------------------------------
   The bKash/Rocket/Nagad receiving numbers shown at checkout.

   Same shape as shippingTermsSchema/adminShippingTermsSchema in spirit: a
   customer-facing read with no provenance, and an admin read/write pair that
   adds `source` so staff can tell "still the environment's default" from
   "someone saved this on purpose". These numbers are not priced into
   anything, but a customer sending money to a stale or mistyped number is a
   support ticket for a merchant they cannot get their money back from — the
   same one-source-of-truth reasoning applies even though nothing here is
   money moving through our own ledger.
   -------------------------------------------------------------------------- */

const paymentNumber = z
  .string()
  .trim()
  .min(6, "Enter a valid number.")
  .max(32, "Enter a valid number.");

/** The numbers as the storefront reads them — nothing about who set them. */
export const paymentNumbersSchema = z.object({
  bkashNumber: paymentNumber,
  rocketNumber: paymentNumber,
  nagadNumber: paymentNumber,
});

export type PaymentNumbers = z.infer<typeof paymentNumbersSchema>;

/** The same numbers, plus where they came from and who last touched them. */
export const adminPaymentNumbersSchema = paymentNumbersSchema.extend({
  source: z.enum(["database", "environment"]),
  updatedAt: z.string().datetime().nullable(),
  updatedByEmail: z.string().nullable(),
});

export type AdminPaymentNumbers = z.infer<typeof adminPaymentNumbersSchema>;

/**
 * A save from the panel. Partial and keyed by provider, so an operator can
 * correct one wallet's number without touching the other two — the same
 * partial-write semantics `shippingTermsUpdateSchema` uses, and for the same
 * reason: writing all three every time would silently promote whichever
 * values the form happened to have loaded.
 */
export const paymentNumbersUpdateSchema = z
  .object({
    bkashNumber: paymentNumber,
    rocketNumber: paymentNumber,
    nagadNumber: paymentNumber,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Change at least one number.",
  });

export type PaymentNumbersUpdate = z.infer<typeof paymentNumbersUpdateSchema>;
