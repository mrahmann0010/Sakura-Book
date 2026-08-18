import { z } from "zod";

/* --------------------------------------------------------------------------
   Cart pricing. POST /cart/quote — the server-side priceCart().

   The cart's *contents* stay client state (Redux + persist, no cart table).
   The cart's *price* does not: FREE_DELIVERY_THRESHOLD and DELIVERY_FLAT are
   shop policy, and today they ship in a bundle the customer can edit.
   -------------------------------------------------------------------------- */

/** One quantity cap, applied everywhere a quantity is accepted. */
export const MAX_LINE_QUANTITY = 99;

export const cartItemSchema = z.object({
  bookId: z.string().uuid(),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});

export const cartQuoteRequestSchema = z.object({
  /**
   * Capped so one request cannot ask the server to price an arbitrarily large
   * cart. Well above any real order.
   */
  items: z.array(cartItemSchema).max(100),
  couponCode: z.string().trim().min(1).max(64).optional(),
  /** Region slug, from GET /shipping/regions. Postage may vary by region. */
  region: z.string().trim().min(1).optional(),
});

/**
 * A priced line. Title and author names are echoed back because the client
 * needs them to render and would otherwise hold a second copy of the catalog
 * — and because these are the same snapshot values that get frozen onto the
 * order, so quoting them here keeps one derivation.
 */
export const cartQuoteLineSchema = z.object({
  bookId: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  coverImageUrl: z.string(),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  lineTotalCents: z.number().int().nonnegative(),
  /** So the cart can clamp the stepper and flag a line that has run short. */
  stockQuantity: z.number().int().nonnegative(),
});

/**
 * Lines the server dropped, and why.
 *
 * A cart survives in localStorage across deploys, so it will eventually hold a
 * delisted book. The web app's buildCart() already drops unknown ids silently
 * rather than throwing; the server does the same but *reports* it, because the
 * cart page has to tell the customer why the total changed.
 */
export const cartQuoteRejectionSchema = z.object({
  bookId: z.string().uuid(),
  reason: z.enum(["NOT_FOUND", "UNAVAILABLE", "OUT_OF_STOCK"]),
  /** Present on OUT_OF_STOCK: what could still be supplied. */
  available: z.number().int().nonnegative().optional(),
});

export const cartQuoteSchema = z.object({
  currency: z.string().length(3),
  lines: z.array(cartQuoteLineSchema),
  rejected: z.array(cartQuoteRejectionSchema),

  /** Distinct titles. */
  lineCount: z.number().int().nonnegative(),
  /** Books counting quantity — the header badge, and "3 items". */
  itemCount: z.number().int().nonnegative(),

  subtotalCents: z.number().int().nonnegative(),

  /** Postage before any waiver — the summary rail shows this even when waived. */
  deliveryBaseCents: z.number().int().nonnegative(),
  deliveryCents: z.number().int().nonnegative(),
  /** The waived amount, drawn as a credit row. Zero when nothing is waived. */
  deliveryCreditCents: z.number().int().nonnegative(),

  /** Absent when no code was sent, or when the code was refused. */
  coupon: z
    .object({ code: z.string(), discountCents: z.number().int().nonnegative() })
    .optional(),
  /** Why a sent code was not applied. Discriminate on the presence of `coupon`. */
  couponRejection: z.string().optional(),

  totalCents: z.number().int().nonnegative(),

  /** Echoed so the client can render "free delivery over ৳1,500" from truth. */
  freeDeliveryThresholdCents: z.number().int().nonnegative(),
});

export type CartItem = z.infer<typeof cartItemSchema>;
export type CartQuoteRequest = z.infer<typeof cartQuoteRequestSchema>;
export type CartQuoteLine = z.infer<typeof cartQuoteLineSchema>;
export type CartQuoteRejection = z.infer<typeof cartQuoteRejectionSchema>;
export type CartQuote = z.infer<typeof cartQuoteSchema>;
