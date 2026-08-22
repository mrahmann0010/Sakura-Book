import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  Dashboard,
  LowStockBook,
  MonthlyReport,
  MonthlyTrendPoint,
  OrderStatus,
  RevenueWindow,
  StatusBucket,
  TopSeller,
} from "@sakura/contracts";
import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { Env } from "../../config/env.schema";
import { DbService } from "../../db/db.service";
import { books, orders } from "../../db/schema";
import { ShippingTermsService } from "../../shipping";

/**
 * The landing page: what happened, and what needs doing.
 *
 * ## Revenue counts confirmed orders only
 *
 * PENDING is excluded. An order awaiting a bank transfer is an intention, and
 * counting it would make the day's takings a number that goes *down* when a
 * customer changes their mind — which is exactly when someone would be looking
 * at it. CANCELLED and REFUNDED are excluded for the same reason from the
 * other direction.
 *
 * The consequence, stated because it will surprise someone: a cash-on-delivery
 * shop sees revenue appear only when an order is marked delivered, since that
 * is when COD reaches PAYMENT_CONFIRMED. That is the honest reading — the
 * money genuinely does not exist until the courier hands it over.
 *
 * ## Day boundaries are the shop's, not UTC's
 *
 * See SHOP_TIMEZONE. Every window here is computed with `AT TIME ZONE` inside
 * Postgres, so the boundaries land where the shop's day actually starts.
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly dbService: DbService,
    private readonly config: ConfigService<Env, true>,
    private readonly shippingTermsService: ShippingTermsService,
  ) {}

  async load(): Promise<Dashboard> {
    const timezone = this.config.get("SHOP_TIMEZONE", { infer: true });

    /**
     * Six independent reads, issued together.
     *
     * None of them depends on another's result, and the dashboard is the one
     * admin page where latency is felt directly — it is the first thing that
     * loads after signing in. Sequential awaits here would stack six
     * round-trips for no reason; the checkout transaction's deliberate
     * `for...of` exists because those statements *do* contend, and these do
     * not.
     */
    const [today, last7Days, last30Days, statusBuckets, lowStock, topSellers, terms, monthlyTrend] =
      await Promise.all([
        this.revenueSince(0, timezone),
        this.revenueSince(6, timezone),
        this.revenueSince(29, timezone),
        this.statusBuckets(),
        this.lowStock(),
        this.topSellers(),
        this.shippingTermsService.current(),
        this.monthlyTrend(timezone),
      ]);

    return {
      currency: terms.currency,
      timezone,
      today,
      last7Days,
      last30Days,
      statusBuckets,
      awaitingAction: statusBuckets
        .filter((bucket) => AWAITING_ACTION.includes(bucket.status))
        .reduce((sum, bucket) => sum + bucket.count, 0),
      lowStock,
      topSellers,
      monthlyTrend,
    };
  }

  /**
   * The selected month's daily breakdown — the "pick a month" drill-down
   * behind the trend chart. A separate call from `load()` rather than folded
   * into it: computing a daily series for a month nobody has picked yet would
   * be work the dashboard's first paint does not need.
   */
  async monthlyReport(month: string): Promise<MonthlyReport> {
    const timezone = this.config.get("SHOP_TIMEZONE", { infer: true });
    const terms = await this.shippingTermsService.current();

    const result = (await this.dbService.db.execute(sql`
      with bounds as (
        select to_date(${month}, 'YYYY-MM') as month_start
      ),
      days as (
        select generate_series(
          (select month_start from bounds),
          (select (month_start + interval '1 month - 1 day')::date from bounds),
          interval '1 day'
        )::date as day
      )
      select
        to_char(d.day, 'YYYY-MM-DD') as day,
        coalesce(count(${orders.id}), 0)::int as order_count,
        coalesce(sum(${orders.totalCents}), 0)::int as revenue_cents
      from days d
      left join ${orders}
        on (${orders.createdAt} at time zone ${timezone})::date = d.day
        and ${inArray(orders.status, REVENUE_STATUSES)}
      group by d.day
      order by d.day
    `)) as unknown as { day: string; order_count: number; revenue_cents: number }[];

    const daily = (Array.isArray(result) ? result : []).map((row) => ({
      date: row.day,
      orderCount: Number(row.order_count),
      revenueCents: Number(row.revenue_cents),
    }));

    const totalOrders = daily.reduce((sum, point) => sum + point.orderCount, 0);
    const totalRevenueCents = daily.reduce((sum, point) => sum + point.revenueCents, 0);

    return {
      month,
      currency: terms.currency,
      timezone,
      totalOrders,
      totalRevenueCents,
      averageOrderValueCents: totalOrders > 0 ? Math.round(totalRevenueCents / totalOrders) : 0,
      daily,
    };
  }

  /**
   * Last 12 months including the current one, oldest first, zero-filled.
   *
   * `generate_series` builds the calendar spine so a quiet month reports zero
   * rather than being absent — the same reasoning `lowStock`/`topSellers`
   * apply in reverse (omit rows that would just say zero); a *trend* chart
   * needs the opposite, because a gap in the x-axis reads as missing data
   * rather than as "nothing sold".
   */
  private async monthlyTrend(timezone: string): Promise<MonthlyTrendPoint[]> {
    const result = (await this.dbService.db.execute(sql`
      with months as (
        select generate_series(
          date_trunc('month', (now() at time zone ${timezone})) - interval '11 months',
          date_trunc('month', (now() at time zone ${timezone})),
          interval '1 month'
        )::date as month_start
      )
      select
        to_char(m.month_start, 'YYYY-MM') as month,
        coalesce(count(${orders.id}), 0)::int as order_count,
        coalesce(sum(${orders.totalCents}), 0)::int as revenue_cents
      from months m
      left join ${orders}
        on date_trunc('month', (${orders.createdAt} at time zone ${timezone}))::date = m.month_start
        and ${inArray(orders.status, REVENUE_STATUSES)}
      group by m.month_start
      order by m.month_start
    `)) as unknown as { month: string; order_count: number; revenue_cents: number }[];

    return (Array.isArray(result) ? result : []).map((row) => ({
      month: row.month,
      orderCount: Number(row.order_count),
      revenueCents: Number(row.revenue_cents),
    }));
  }

  /**
   * Revenue over a window ending today, inclusive.
   *
   * `daysBack` is an offset in whole shop-days, so 0 is today and 6 is "the
   * last seven days including today" — which is what a panel labelled "7 days"
   * means to the person reading it. Expressing it as a count of days rather
   * than a timestamp keeps the boundary on a day edge: a rolling 168-hour
   * window would make this morning's figure include half of the same weekday a
   * week ago, and the number would move for reasons nobody could explain.
   */
  private async revenueSince(daysBack: number, timezone: string): Promise<RevenueWindow> {
    const [row] = await this.dbService.db
      .select({
        totalCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
        orderCount: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.status, REVENUE_STATUSES),
          sql`(${orders.createdAt} at time zone ${timezone})::date
              >= ((now() at time zone ${timezone})::date - ${daysBack}::int)`,
        ),
      );

    return { totalCents: row.totalCents, orderCount: row.orderCount };
  }

  /**
   * How many orders sit in each status, and how long the oldest has waited.
   *
   * One grouped query rather than a count per status, and it returns only the
   * statuses that actually have orders — a panel drawing seven rows of which
   * five say zero is a panel where the two that matter are hard to find.
   */
  private async statusBuckets(): Promise<StatusBucket[]> {
    const rows = await this.dbService.db
      .select({
        status: orders.status,
        count: sql<number>`count(*)::int`,
        oldestPlacedAt: sql<Date | null>`min(${orders.createdAt})`,
      })
      .from(orders)
      .groupBy(orders.status)
      .orderBy(desc(sql`count(*)`));

    return rows.map((row) => ({
      status: row.status,
      count: row.count,
      oldestPlacedAt: row.oldestPlacedAt ? new Date(row.oldestPlacedAt).toISOString() : null,
    }));
  }

  /**
   * Titles at or below their restock threshold.
   *
   * `low_stock_threshold` has been a column on `books` since the schema was
   * written with nothing reading it. This is the reader — which is why the
   * comparison is against the per-book column rather than a global number: a
   * paperback that reorders in fifties and a signed edition that reorders in
   * twos do not share a threshold, and that is the whole reason the column is
   * per-row.
   *
   * Inactive titles are excluded. A delisted book being out of stock is not a
   * problem to solve, and including them would bury the ones that are.
   */
  private async lowStock(): Promise<LowStockBook[]> {
    return (
      this.dbService.db
        .select({
          slug: books.slug,
          title: books.title,
          stockQuantity: books.stockQuantity,
          lowStockThreshold: books.lowStockThreshold,
        })
        .from(books)
        .where(and(eq(books.isActive, true), lte(books.stockQuantity, books.lowStockThreshold)))
        // Most urgent first: what is already at zero outranks what is merely low.
        .orderBy(asc(books.stockQuantity), asc(books.title))
        .limit(20)
    );
  }

  /**
   * Best sellers, off the denormalised counter.
   *
   * `units_sold` is a cache and can drift, which is acceptable *here* and
   * nowhere else — this is a ranked list on a dashboard, so being one copy out
   * changes nothing a person would notice. Anything that needed the true
   * figure would join `order_items`, and UnitsSoldReconciler is what puts the
   * cache back in step.
   *
   * Stock travels alongside, because "selling well" and "about to run out" is
   * the pairing that prompts a reorder — and it is one query rather than the
   * operator cross-referencing this list against the one above it.
   */
  private async topSellers(): Promise<TopSeller[]> {
    return this.dbService.db
      .select({
        slug: books.slug,
        title: books.title,
        unitsSold: books.unitsSold,
        stockQuantity: books.stockQuantity,
      })
      .from(books)
      .where(and(eq(books.isActive, true), gt(books.unitsSold, 0)))
      .orderBy(desc(books.unitsSold), asc(books.title))
      .limit(10);
  }
}

/**
 * Statuses whose money the shop may count.
 *
 * Not derived from the state machine, because this is a different question
 * from "has stock been committed" and the two lists happening to overlap today
 * would be a coincidence to depend on. Revenue is about whether payment has
 * been confirmed and not since reversed.
 */
const REVENUE_STATUSES: readonly OrderStatus[] = Object.freeze([
  "PAYMENT_CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
]);

/** Orders a human still has to do something about. */
const AWAITING_ACTION: readonly string[] = Object.freeze([
  "PENDING",
  "PAYMENT_CONFIRMED",
  "PROCESSING",
]);
