import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  PaymentBreakdown,
  PaymentBreakdownQuery,
  PaymentPlatform,
  PaymentTotals,
  PlatformBreakdown,
} from "@sakura/contracts";
import { inArray, sql, type SQL } from "drizzle-orm";
import type { Env } from "../../config/env.schema";
import { InvalidInputError } from "../../common/errors";
import { DbService } from "../../db/db.service";
import { orders } from "../../db/schema";
import { ShippingTermsService } from "../../shipping";
import { REVENUE_STATUSES } from "../dashboard";

/**
 * Where the money on accepted orders came from, and what it was for.
 *
 * ## "Accepted" is the dashboard's definition, imported, not restated
 *
 * REVENUE_STATUSES comes from AdminDashboardService. Two screens showing
 * revenue for the same shop must not be able to disagree about which orders
 * count, and a second frozen array here — however carefully copied — is a
 * second thing to remember to change. The dashboard's own comment explains
 * why PENDING, CANCELLED and REFUNDED are out.
 *
 * ## Collected vs expected
 *
 * A wallet transfer is money the shop already has: the customer sent it
 * before the order was accepted, which is *why* it was accepted. Cash on
 * delivery is not — it is with a courier until the parcel is handed over, and
 * only DELIVERED says that happened.
 *
 * So the total splits in two, and the split is not cosmetic: a shop that
 * reads one blended figure as "our takings" is counting cash it cannot spend.
 * Both halves are reported; neither is hidden behind the other.
 *
 * ## The two identities the screen draws
 *
 * For every row and for the totals:
 *
 *   totalCents = booksCents + deliveryCents - discountCents
 *   totalCents = collectedCents + expectedCents
 *
 * The first is the orders table's own arithmetic (see the `totalCents` column
 * comment), summed. The second is a partition of the same rows. The panel
 * renders both as visible sums, so a drift would show up as a bar that does
 * not reach its label rather than as a wrong number nobody notices.
 *
 * ## Totals are summed from the platform rows, not queried separately
 *
 * One grouped query, folded up in TypeScript. A second `sum()` over the same
 * predicate would be a second chance to write the predicate differently, and
 * the failure it produces — a headline that does not match the table beneath
 * it — is precisely the failure that makes a reporting screen useless.
 */
@Injectable()
export class AdminPaymentsService {
  constructor(
    private readonly dbService: DbService,
    private readonly config: ConfigService<Env, true>,
    private readonly shippingTermsService: ShippingTermsService,
  ) {}

  async breakdown(query: PaymentBreakdownQuery): Promise<PaymentBreakdown> {
    const timezone = this.config.get("SHOP_TIMEZONE", { infer: true });
    const bounds = this.bounds(query, timezone);

    const [terms, rows, resolved] = await Promise.all([
      this.shippingTermsService.current(),
      this.platformRows(bounds, timezone),
      this.resolveBounds(bounds),
    ]);

    const platforms = rows.sort(
      (a, b) => b.totalCents - a.totalCents || b.orderCount - a.orderCount,
    );
    const totals = sumTotals(platforms);

    return {
      currency: terms.currency,
      timezone,
      range: { key: query.range, from: resolved.from, to: resolved.to },
      totals,
      averageOrderValueCents:
        totals.orderCount > 0 ? Math.round(totals.totalCents / totals.orderCount) : 0,
      platforms,
    };
  }

  /**
   * The window's edges as SQL, in shop-timezone days.
   *
   * Built as expressions rather than dates computed in Node, for the reason
   * `paymentBreakdownRanges` gives: the API process's clock and timezone are
   * not the shop's, and "today" has to mean the shop's today or this screen
   * and the dashboard will report different numbers for the same morning.
   *
   * `null` for an open end — `all` has neither edge, and the filter below
   * drops the comparison rather than substituting a sentinel date.
   */
  private bounds(
    query: PaymentBreakdownQuery,
    timezone: string,
  ): { from: SQL | null; to: SQL | null } {
    const today = sql`((now() at time zone ${timezone})::date)`;

    switch (query.range) {
      case "all":
        return { from: null, to: null };
      case "today":
        return { from: today, to: today };
      case "7d":
        return { from: sql`(${today} - 6)`, to: today };
      case "30d":
        return { from: sql`(${today} - 29)`, to: today };
      case "month":
        return { from: sql`(date_trunc('month', ${today})::date)`, to: today };
      case "custom": {
        /* Checked here rather than in the schema: nestjs-zod builds the
           request DTO's OpenAPI from a ZodObject, and a `.superRefine` turns
           the schema into a ZodEffects that it cannot introspect. The cost is
           that this one rule is enforced a layer later than the rest — hence
           the same error type the pipe would have raised. */
        if (!query.from || !query.to) {
          throw new InvalidInputError("A custom range needs both a start and an end date.");
        }
        if (query.from > query.to) {
          throw new InvalidInputError("The start date must not be after the end date.");
        }
        return { from: sql`(${query.from}::date)`, to: sql`(${query.to}::date)` };
      }
    }
  }

  /** The window's edges as plain YYYY-MM-DD, so the panel can label what it is showing. */
  private async resolveBounds(bounds: { from: SQL | null; to: SQL | null }): Promise<{
    from: string | null;
    to: string | null;
  }> {
    if (!bounds.from || !bounds.to) return { from: null, to: null };

    const result = (await this.dbService.db.execute(sql`
      select to_char(${bounds.from}, 'YYYY-MM-DD') as from_date,
             to_char(${bounds.to}, 'YYYY-MM-DD') as to_date
    `)) as unknown as { from_date: string; to_date: string }[];

    const row = Array.isArray(result) ? result[0] : undefined;
    return { from: row?.from_date ?? null, to: row?.to_date ?? null };
  }

  /**
   * One row per platform that had an accepted order in the window.
   *
   * Platforms with nothing in the window are absent rather than zero-filled —
   * the opposite of the dashboard's trend chart, and for the reason stated
   * there in reverse: a table is read by scanning it, and four rows of which
   * three say ৳0 buries the one that does not. A chart's x-axis needs the
   * gap; a list does not.
   */
  private async platformRows(
    bounds: { from: SQL | null; to: SQL | null },
    timezone: string,
  ): Promise<PlatformBreakdown[]> {
    const day = sql`((${orders.createdAt} at time zone ${timezone})::date)`;
    const windowFilter = sql.join(
      [
        sql`${inArray(orders.status, REVENUE_STATUSES)}`,
        ...(bounds.from ? [sql`${day} >= ${bounds.from}`] : []),
        ...(bounds.to ? [sql`${day} <= ${bounds.to}`] : []),
      ],
      sql` and `,
    );

    /* Cash on delivery is keyed off the *method*, not the provider, because
       the provider column is null for it — and a manual transfer whose
       provider was never recorded falls to 'other' rather than being folded
       into a wallet it may not have used. See `paymentPlatforms`. */
    const platform = sql`
      case
        when ${orders.paymentMethod} = 'cash-on-delivery' then 'cash-on-delivery'
        when ${orders.provider} is not null then ${orders.provider}::text
        else 'other'
      end`;

    /* The collected/expected split, decided per row inside the sum so the two
       columns partition the same set the totals are drawn from. */
    const collected = sql`
      case
        when ${orders.paymentMethod} <> 'cash-on-delivery' then ${orders.totalCents}
        when ${orders.status} = 'DELIVERED' then ${orders.totalCents}
        else 0
      end`;

    const result = (await this.dbService.db.execute(sql`
      select
        ${platform} as platform,
        count(*)::int as order_count,
        coalesce(sum(${orders.subtotalCents}), 0)::int as books_cents,
        coalesce(sum(${orders.shippingCents}), 0)::int as delivery_cents,
        coalesce(sum(${orders.discountCents}), 0)::int as discount_cents,
        coalesce(sum(${orders.totalCents}), 0)::int as total_cents,
        coalesce(sum(${collected}), 0)::int as collected_cents
      from ${orders}
      where ${windowFilter}
      group by ${platform}
    `)) as unknown as {
      platform: string;
      order_count: number;
      books_cents: number;
      delivery_cents: number;
      discount_cents: number;
      total_cents: number;
      collected_cents: number;
    }[];

    return (Array.isArray(result) ? result : []).map((row) => {
      const totalCents = Number(row.total_cents);
      const collectedCents = Number(row.collected_cents);

      return {
        platform: row.platform as PaymentPlatform,
        orderCount: Number(row.order_count),
        booksCents: Number(row.books_cents),
        deliveryCents: Number(row.delivery_cents),
        discountCents: Number(row.discount_cents),
        totalCents,
        collectedCents,
        expectedCents: totalCents - collectedCents,
      };
    });
  }
}

/** Folds the platform rows into the headline. See the class comment. */
function sumTotals(rows: readonly PlatformBreakdown[]): PaymentTotals {
  return rows.reduce<PaymentTotals>(
    (total, row) => ({
      orderCount: total.orderCount + row.orderCount,
      booksCents: total.booksCents + row.booksCents,
      deliveryCents: total.deliveryCents + row.deliveryCents,
      discountCents: total.discountCents + row.discountCents,
      totalCents: total.totalCents + row.totalCents,
      collectedCents: total.collectedCents + row.collectedCents,
      expectedCents: total.expectedCents + row.expectedCents,
    }),
    {
      orderCount: 0,
      booksCents: 0,
      deliveryCents: 0,
      discountCents: 0,
      totalCents: 0,
      collectedCents: 0,
      expectedCents: 0,
    },
  );
}
