import { z } from "zod";

/* --------------------------------------------------------------------------
   Checkout contract

   One schema, shared by the form and (eventually) the API route that accepts
   the order. Validation messages state the fix rather than the fault, per
   principle 03 — the components never invent their own copy.
   -------------------------------------------------------------------------- */

export const paymentMethods = ["cash-on-delivery", "manual-transfer", "card"] as const;

export type PaymentMethod = (typeof paymentMethods)[number];

/** Card is drawn in the wireframe but marked "later", so it ships disabled. */
export const availablePaymentMethods: PaymentMethod[] = ["cash-on-delivery", "manual-transfer"];

/** Delivery regions. A placeholder list until the API owns it. */
export const regions = [
  { value: "dhaka", label: "Dhaka" },
  { value: "chattogram", label: "Chattogram" },
  { value: "sylhet", label: "Sylhet" },
  { value: "khulna", label: "Khulna" },
  { value: "rajshahi", label: "Rajshahi" },
] as const;

export type Region = (typeof regions)[number]["value"];

const regionValues = regions.map((region) => region.value) as [Region, ...Region[]];

const required = (fix: string) => z.string().trim().min(1, fix);

export const checkoutSchema = z
  .object({
    fullName: required("Add the name the parcel should be addressed to."),
    email: z.string().trim().email("Use an address like you@example.com so we can send updates."),
    phone: required("Add a number the courier can reach you on."),
    address: required("Add the street, house and area so the courier can find you."),
    city: required("Add the town or city."),
    region: z.enum(regionValues, { message: "Choose the delivery region." }),
    method: z.enum(paymentMethods),
    /* Transfer details are only asked for when the transfer option is open, so
       they are optional at the field level and required by the refinement. */
    senderNumber: z.string().trim().optional(),
    transactionId: z.string().trim().optional(),
    notes: z.string().trim().max(500, "Keep delivery notes under 500 characters.").optional(),
  })
  .superRefine((values, ctx) => {
    if (values.method !== "manual-transfer") return;

    if (!values.senderNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["senderNumber"],
        message: "Add the number you sent the money from.",
      });
    }
    if (!values.transactionId) {
      ctx.addIssue({
        code: "custom",
        path: ["transactionId"],
        message: "Add the transaction ID from your payment confirmation.",
      });
    }
  });

export type CheckoutValues = z.input<typeof checkoutSchema>;

export const checkoutDefaults: CheckoutValues = {
  fullName: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  region: "dhaka",
  method: "cash-on-delivery",
  senderNumber: "",
  transactionId: "",
  notes: "",
};

/** The fields a given method adds to the form. Drives the expanding panel. */
export function methodNeedsTransferDetails(method: PaymentMethod): boolean {
  return method === "manual-transfer";
}

/**
 * Placeholder order id, in the shape the design system's `OrderId` renders and
 * the "Order IDs are eight characters, like MG-40718" copy promises.
 * Replaced by the id the API returns.
 */
export function draftOrderId(): string {
  return `MG-${Math.floor(10000 + Math.random() * 89999)}`;
}
