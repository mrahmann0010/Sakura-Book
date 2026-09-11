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
import { books, orderItems, orders, orderStatusHistory } from "../../db/schema";
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
 * ## Which date a confirmed order counts on
 *
 * Two dates, and they are not interchangeable. `recognisedAt` is when the
 * order entered PAYMENT_CONFIRMED — when the money became real. `createdAt` is
 * when the customer placed it.
 *
 * Every window is reported on both (`collected` and `ordered`), because for a
 * COD shop they are days apart and each answers a question somebody asks.
 * What is *not* offered is the combination this file used to compute: dating
 * by `createdAt` while filtering on confirmed status. That reads as neither
 * question and misleads as both — today's total sits near zero while today's
 * orders are still PENDING, and every past day keeps climbing as its couriers
 * settle, so the same chart shows a different history each time it is opened.
 *
 * The month series take `recognisedAt` alone. A trend has to be a fixed
 * history or it is not a trend, and only the collection date is fixed.
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
      ${this.scopedOrders(timezone)},
      bounds as (
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
        (count(scoped.collected_on))::int as order_count,
        coalesce(sum(scoped.total_cents), 0)::int as revenue_cents,
        coalesce(sum(scoped.units), 0)::int as units_sold
      from days d
      left join scoped on scoped.collected_on = d.day
      group by d.day
      order by d.day
    `)) as unknown as {
      day: string;
      order_count: number;
      revenue_cents: number;
      units_sold: number;
    }[];

    const daily = (Array.isArray(result) ? result : []).map((row) => ({
      date: row.day,
      orderCount: Number(row.order_count),
      revenueCents: Number(row.revenue_cents),
      unitsSold: Number(row.units_sold),
    }));

    const totalOrders = daily.reduce((sum, point) => sum + point.orderCount, 0);
    const totalRevenueCents = daily.reduce((sum, point) => sum + point.revenueCents, 0);
    const totalUnitsSold = daily.reduce((sum, point) => sum + point.unitsSold, 0);

    return {
      month,
      currency: terms.currency,
      timezone,
      totalOrders,
      totalRevenueCents,
      totalUnitsSold,
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
      ${this.scopedOrders(timezone)},
      months as (
        select generate_series(
          date_trunc('month', (now() at time zone ${timezone})) - interval '11 months',
          date_trunc('month', (now() at time zone ${timezone})),
          interval '1 month'
        )::date as month_start
      )
      select
        to_char(m.month_start, 'YYYY-MM') as month,
        (count(scoped.collected_on))::int as order_count,
        coalesce(sum(scoped.total_cents), 0)::int as revenue_cents,
        coalesce(sum(scoped.units), 0)::int as units_sold
      from months m
      left join scoped on date_trunc('month', scoped.collected_on)::date = m.month_start
      group by m.month_start
      order by m.month_start
    `)) as unknown as {
      month: string;
      order_count: number;
      revenue_cents: number;
      units_sold: number;
    }[];

    return (Array.isArray(result) ? result : []).map((row) => ({
      month: row.month,
      orderCount: Number(row.order_count),
      revenueCents: Number(row.revenue_cents),
      unitsSold: Number(row.units_sold),
    }));
  }

  /**
   * Revenue over a window ending today, inclusive — counted on both dates.
   *
   * `daysBack` is an offset in whole shop-days, so 0 is today and 6 is "the
   * last seven days including today" — which is what a panel labelled "7 days"
   * means to the person reading it. Expressing it as a count of days rather
   * than a timestamp keeps the boundary on a day edge: a rolling 168-hour
   * window would make this morning's figure include half of the same weekday a
   * week ago, and the number would move for reasons nobody could explain.
   *
   * One query rather than two. The two halves differ only in which date column
   * they test, and `filter (where ...)` expresses exactly that — issuing this
   * twice would scan the same rows twice to ask the same question about a
   * different column of each.
   */
  private async revenueSince(daysBack: number, timezone: string): Promise<RevenueWindow> {
    const cutoff = sql`((now() at time zone ${timezone})::date - ${daysBack}::int)`;

    const result = (await this.dbService.db.execute(sql`
      ${this.scopedOrders(timezone)}
      select
        coalesce(sum(total_cents) filter (where collected_on >= ${cutoff}), 0)::int
          as collected_cents,
        (count(*) filter (where collected_on >= ${cutoff}))::int as collected_orders,
        coalesce(sum(units) filter (where collected_on >= ${cutoff}), 0)::int as collected_units,
        coalesce(sum(total_cents) filter (where ordered_on >= ${cutoff}), 0)::int as ordered_cents,
        (count(*) filter (where ordered_on >= ${cutoff}))::int as ordered_orders,
        coalesce(sum(units) filter (where ordered_on >= ${cutoff}), 0)::int as ordered_units
      from scoped
    `)) as unknown as {
      collected_cents: number;
      collected_orders: number;
      collected_units: number;
      ordered_cents: number;
      ordered_orders: number;
      ordered_units: number;
    }[];

    const row = (Array.isArray(result) ? result : [])[0];

    return {
      collected: {
        totalCents: Number(row?.collected_cents ?? 0),
        orderCount: Number(row?.collected_orders ?? 0),
        unitsSold: Number(row?.collected_units ?? 0),
      },
      ordered: {
        totalCents: Number(row?.ordered_cents ?? 0),
        orderCount: Number(row?.ordered_orders ?? 0),
        unitsSold: Number(row?.ordered_units ?? 0),
      },
    };
  }

  /**
   * The `scoped` CTE every money query here selects from: one row per
   * countable order, carrying both of its dates and its copy count.
   *
   * ## Why both dependencies arrive pre-aggregated
   *
   * `order_items` has a row per title, so joining it directly would multiply
   * each order's `total_cents` by the number of distinct titles on it — a
   * three-title order would contribute its full value three times, and the
   * revenue figures would be silently, unreproducibly too high. Summing
   * quantity per order *first* keeps the join one-to-one, so the money stays
   * correct while the copies come along for free.
   *
   * `confirmed_at` is folded the same way, and for a second reason on top of
   * that one. An order can hold more than one PAYMENT_CONFIRMED row — a
   * reconfirmation after a correction — so it has to collapse to `min()`
   * before it is joined, or a single order would count twice. Written as a
   * correlated subquery instead, it would also re-scan `order_status_history`
   * once per order: neither `order_id` column here carries an index, because
   * Postgres does not create one for a foreign key. Aggregating once and
   * joining the result asks for a single pass regardless of what is indexed.
   *
   * ## Why `recognised_at` falls back to `created_at`
   *
   * The fallback covers orders confirmed before the status log existed, and
   * any seeded row written straight to a confirmed status without a history
   * entry. Those orders would otherwise drop out of `collected` entirely —
   * money the shop definitely took, vanishing from the dashboard because of
   * how its row happened to be created. Dating them by placement is imprecise;
   * omitting them is wrong.
   *
   * No alias on `orders`: the Drizzle column references interpolated below
   * render as `"orders"."…"`, which an alias would put out of scope.
   */
  private scopedOrders(timezone: string) {
    return sql`
      with copies_per_order as (
        select ${orderItems.orderId} as order_id, sum(${orderItems.quantity})::int as units
        from ${orderItems}
        group by ${orderItems.orderId}
      ),
      confirmed_at as (
        select
          ${orderStatusHistory.orderId} as order_id,
          min(${orderStatusHistory.createdAt}) as recognised_at
        from ${orderStatusHistory}
        where ${orderStatusHistory.status} = 'PAYMENT_CONFIRMED'
        group by ${orderStatusHistory.orderId}
      ),
      scoped as (
        select
          ${orders.totalCents} as total_cents,
          (${orders.createdAt} at time zone ${timezone})::date as ordered_on,
          (coalesce(confirmed_at.recognised_at, ${orders.createdAt})
            at time zone ${timezone})::date as collected_on,
          coalesce(copies_per_order.units, 0) as units
        from ${orders}
        left join copies_per_order on copies_per_order.order_id = ${orders.id}
        left join confirmed_at on confirmed_at.order_id = ${orders.id}
        where ${inArray(orders.status, REVENUE_STATUSES)}
      )
    `;
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
export const REVENUE_STATUSES: readonly OrderStatus[] = Object.freeze([
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
