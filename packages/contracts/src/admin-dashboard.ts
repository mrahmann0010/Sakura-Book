import { z } from "zod";

/* --------------------------------------------------------------------------
   Dashboard KPI reporting — the monthly trend and the "pick a month" drill-
   down that extends the base Dashboard (admin-settings.ts).

   Split into its own file rather than added to admin-settings.ts because that
   file already carries the original today/7-day/30-day Dashboard schema and
   this is a distinct, separately-fetched concern (the trend loads with the
   dashboard; the monthly report is fetched only once a month is picked).
   -------------------------------------------------------------------------- */

/** One month's totals, for the trend chart. Zero-filled for months with no orders. */
export const monthlyTrendPointSchema = z.object({
  /** "YYYY-MM" in the shop's timezone. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  orderCount: z.number().int().nonnegative(),
  revenueCents: z.number().int().nonnegative(),
});

export type MonthlyTrendPoint = z.infer<typeof monthlyTrendPointSchema>;

export const monthlyReportQuerySchema = z.object({
  /** "YYYY-MM", the calendar month to report on, in the shop's timezone. */
  month: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM."),
});

export type MonthlyReportQuery = z.infer<typeof monthlyReportQuerySchema>;

/** One calendar day's totals within a monthly report. Zero-filled for quiet days. */
export const dailyPointSchema = z.object({
  /** "YYYY-MM-DD" in the shop's timezone. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  orderCount: z.number().int().nonnegative(),
  revenueCents: z.number().int().nonnegative(),
});

export type DailyPoint = z.infer<typeof dailyPointSchema>;

export const monthlyReportSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  currency: z.string().length(3),
  timezone: z.string(),
  totalOrders: z.number().int().nonnegative(),
  totalRevenueCents: z.number().int().nonnegative(),
  averageOrderValueCents: z.number().int().nonnegative(),
  daily: z.array(dailyPointSchema),
});

export type MonthlyReport = z.infer<typeof monthlyReportSchema>;
