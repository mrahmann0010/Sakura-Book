import { z } from "zod";
import { monthlyTrendPointSchema } from "./admin-dashboard";
import { orderStatuses } from "./order";
import { reopenDateSchema, restockScheduleSchema } from "./waitlist";

/* --------------------------------------------------------------------------
   Shop settings, the dashboard, and the maintenance jobs.

   What separates this file from the rest of the admin surface: almost nothing
   here is about one order or one book. These are the shop's *policy* and the
   shop's *shape* — the numbers every checkout is priced against, and the
   counts staff look at to decide what to do next.
   -------------------------------------------------------------------------- */

/**
 * The postage rules, as staff may edit them.
 *
 * Currency is absent, deliberately. Every money column in the schema is a bare
 * `*_cents` integer with no currency alongside it, so changing the shop's
 * currency is a migration and a decision about historical orders — not a
 * setting. Exposing it as one would put a text box in the panel that silently
 * reinterprets every price ever recorded.
 */
export const shippingTermsUpdateSchema = z
  .object({
    /** Flat postage below the threshold, in minor units. */
    flatRateCents: z.number().int().nonnegative(),
    /**
     * Subtotal at or above which postage is waived, in minor units.
     *
     * Zero is legal and means "delivery is always free", which is a real
     * campaign. There is no upper bound because a very high threshold is just
     * "never free", which is also a real choice.
     */
    freeDeliveryThresholdCents: z.number().int().nonnegative(),
    /** The division the shop currently ships from. See `originDivision` on `shippingTermsSchema`. */
    originDivision: z.string().trim().min(1),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Change at least one setting.",
  });

export type ShippingTermsUpdate = z.infer<typeof shippingTermsUpdateSchema>;

/**
 * The postage rules as the panel reads them back.
 *
 * `source` says whether these numbers come from the database or are still the
 * environment's defaults, which is the one thing an operator cannot work out
 * from the values themselves. A shop that has never saved its settings and a
 * shop that saved exactly the defaults look identical otherwise — and the
 * difference matters, because only one of them changes when someone edits the
 * deployment's environment variables.
 */
export const adminShippingTermsSchema = z.object({
  currency: z.string().length(3),
  flatRateCents: z.number().int().nonnegative(),
  freeDeliveryThresholdCents: z.number().int().nonnegative(),
  originDivision: z.string().trim().min(1),
  source: z.enum(["database", "environment"]),
  updatedAt: z.string().datetime().nullable(),
  updatedByEmail: z.string().nullable(),
});

/**
 * Named `admin*` because the storefront already exports a `shippingTermsSchema`
 * — the customer-facing one, which carries the region list and none of the
 * provenance fields below. Two different views of the same policy, and the
 * shared barrel makes the collision a compile error rather than a surprise at
 * an import site.
 */
export type AdminShippingTerms = z.infer<typeof adminShippingTermsSchema>;

/**
 * A delivery region as staff manage it.
 *
 * Richer than the storefront's `ShippingRegion`: that one carries only what
 * checkout needs, while this adds the sort order and the active flag, which
 * are operator controls rather than customer-facing data.
 */
export const adminRegionSchema = z.object({
  slug: z.string(),
  name: z.string(),
  deliveryCentsOverride: z.number().int().nonnegative().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});

export type AdminRegion = z.infer<typeof adminRegionSchema>;

/**
 * Slugs are lowercase, hyphenated, and immutable once created.
 *
 * Immutable because orders snapshot the region *string* onto
 * `shipping_address`, so renaming a slug would orphan every historical order
 * that names it — the address would point at a region no lookup resolves. The
 * display name can change freely; the slug is the identifier those snapshots
 * were written against.
 */
export const regionSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens.");

export const adminRegionCreateSchema = z.object({
  slug: regionSlugSchema,
  name: z.string().trim().min(1).max(120),
  /** Null means the flat national rate applies. */
  deliveryCentsOverride: z.number().int().nonnegative().nullable().default(null),
  sortOrder: z.number().int().default(0),
});

export type AdminRegionCreate = z.infer<typeof adminRegionCreateSchema>;

/** Everything except the slug, which cannot move — see `regionSlugSchema`. */
export const adminRegionUpdateSchema = adminRegionCreateSchema
  .omit({ slug: true })
  .extend({ isActive: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Change at least one field." });

export type AdminRegionUpdate = z.infer<typeof adminRegionUpdateSchema>;

/* --------------------------------------------------------------------------
   Dashboard
   -------------------------------------------------------------------------- */

/**
 * A count of orders sitting in one status.
 *
 * `oldestPlacedAt` is the field that makes this a work queue rather than a
 * vanity number. Twelve orders awaiting payment is unremarkable; twelve
 * orders awaiting payment where the oldest is nine days old is a decision
 * about whether to chase or cancel, and the count alone cannot tell them apart.
 */
export const statusBucketSchema = z.object({
  status: z.enum(orderStatuses),
  count: z.number().int().nonnegative(),
  oldestPlacedAt: z.string().datetime().nullable(),
});

export type StatusBucket = z.infer<typeof statusBucketSchema>;

/** A title running low, for the restock list. */
export const lowStockBookSchema = z.object({
  slug: z.string(),
  title: z.string(),
  stockQuantity: z.number().int(),
  lowStockThreshold: z.number().int(),
});

export type LowStockBook = z.infer<typeof lowStockBookSchema>;

export const topSellerSchema = z.object({
  slug: z.string(),
  title: z.string(),
  unitsSold: z.number().int().nonnegative(),
  stockQuantity: z.number().int(),
});

export type TopSeller = z.infer<typeof topSellerSchema>;

/**
 * Revenue over a window.
 *
 * `orderCount` travels with every total because a revenue figure on its own is
 * unreadable: ৳48,000 is a good day or a bad week depending on how many orders
 * made it, and a panel that shows only the money invites the wrong conclusion.
 *
 * These count *confirmed* orders only — see the service for which statuses
 * qualify and why PENDING is excluded.
 */
export const revenueWindowSchema = z.object({
  totalCents: z.number().int().nonnegative(),
  orderCount: z.number().int().nonnegative(),
});

export type RevenueWindow = z.infer<typeof revenueWindowSchema>;

export const dashboardSchema = z.object({
  currency: z.string().length(3),

  /**
   * The IANA zone the day boundaries were computed in.
   *
   * Returned rather than assumed, because "orders today" is meaningless
   * without it: a shop in Dhaka reading a dashboard whose day rolls over at
   * UTC midnight sees its evening orders land on tomorrow. The panel echoes
   * this next to the figures so the boundary is visible rather than implied.
   */
  timezone: z.string(),

  today: revenueWindowSchema,
  last7Days: revenueWindowSchema,
  last30Days: revenueWindowSchema,

  /** Every status with at least one order in it, busiest first. */
  statusBuckets: z.array(statusBucketSchema),

  /**
   * Orders that need someone to do something: awaiting payment, or paid and
   * not yet dispatched. Pre-computed because it is the number the panel puts
   * in the header, and deriving it client-side from `statusBuckets` would put
   * the definition of "needs attention" in the frontend.
   */
  awaitingAction: z.number().int().nonnegative(),

  lowStock: z.array(lowStockBookSchema),
  topSellers: z.array(topSellerSchema),

  /** Last 12 months, oldest first, zero-filled — the trend chart's spine. */
  monthlyTrend: z.array(monthlyTrendPointSchema),
});

export type Dashboard = z.infer<typeof dashboardSchema>;

/* --------------------------------------------------------------------------
   Maintenance
   -------------------------------------------------------------------------- */

/** One title whose cached `units_sold` disagrees with the order history. */
export const unitsSoldDriftSchema = z.object({
  slug: z.string(),
  title: z.string(),
  /** What `books.units_sold` currently says. */
  recorded: z.number().int(),
  /** What `order_items` joined to confirmed orders actually sums to. */
  actual: z.number().int(),
  /** `actual - recorded`. Negative means the cache is over-counting. */
  delta: z.number().int(),
});

export type UnitsSoldDrift = z.infer<typeof unitsSoldDriftSchema>;

export const unitsSoldReportSchema = z.object({
  checkedAt: z.string().datetime(),
  /** Titles examined — every book, not only the ones that drifted. */
  booksChecked: z.number().int().nonnegative(),
  drifted: z.array(unitsSoldDriftSchema),
  /** True when this report followed a write; false for a dry-run inspection. */
  corrected: z.boolean(),
});

export type UnitsSoldReport = z.infer<typeof unitsSoldReportSchema>;

/* --------------------------------------------------------------------------
   The reopening date, as staff edit it
   -------------------------------------------------------------------------- */

/**
 * The reopening date with its provenance, same shape and same reasoning as
 * `adminShippingTermsSchema` — except `source` has only two states worth
 * distinguishing here, because there is no environment fallback for this one:
 * either a date has been saved or none has.
 */
export const adminRestockScheduleSchema = restockScheduleSchema.extend({
  updatedAt: z.string().datetime().nullable(),
  updatedByEmail: z.string().nullable(),
});

export type AdminRestockSchedule = z.infer<typeof adminRestockScheduleSchema>;

/**
 * Set or clear the reopening date.
 *
 * Explicitly nullable rather than optional-and-absent: unlike the shipping and
 * payment updates, where a missing key means "leave it alone", the only two
 * things anyone wants to do to this single field are set it and clear it.
 * Null is "announce no date", and it has to be sendable — a shop that has
 * slipped its reopening needs to take the promise down, and a schema where
 * absence meant "leave alone" would give it no way to say so.
 */
export const restockScheduleUpdateSchema = z.object({
  reopenDate: reopenDateSchema.nullable(),
});

export type RestockScheduleUpdate = z.infer<typeof restockScheduleUpdateSchema>;

/* --------------------------------------------------------------------------
   Which titles /notify offers
   -------------------------------------------------------------------------- */

/**
 * One title as the selection screen lists it — every book in the catalog,
 * each with whether it is currently offered on /notify.
 *
 * Carries `stockQuantity` and `availability` as context rather than as a rule:
 * staff choosing what to collect names for want to see what is actually sold
 * out, but the panel does not stop them offering an in-stock title (a reprint
 * announced early is a real case) or force a sold-out one onto the list.
 */
export const adminWaitlistBookSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  stockQuantity: z.number().int(),
  availability: z.enum(["in_stock", "coming_soon", "pre_order"]),
  isActive: z.boolean(),
  waitlistEnabled: z.boolean(),
});

export type AdminWaitlistBook = z.infer<typeof adminWaitlistBookSchema>;

export const adminWaitlistBooksSchema = z.array(adminWaitlistBookSchema);

/**
 * Replace the selection outright.
 *
 * The whole set of chosen ids, not a per-book toggle: the panel screen is a
 * list of checkboxes over the catalog, and "these are the titles on offer" is
 * the sentence staff are actually writing. A PATCH of one flag at a time would
 * make a two-book selection two requests that can half-fail, leaving the page
 * offering a list nobody chose.
 *
 * An empty array is legal and means "offer no titles" — the form then collects
 * general-list signups only, which is what the shop-wide pause always meant.
 */
export const waitlistBooksUpdateSchema = z.object({
  bookIds: z.array(z.string().uuid("Choose books from the list.")),
});

export type WaitlistBooksUpdate = z.infer<typeof waitlistBooksUpdateSchema>;
