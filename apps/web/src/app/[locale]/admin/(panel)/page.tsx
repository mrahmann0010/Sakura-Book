"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Dashboard, MonthlyReport, OrderStatus, WindowTotals } from "@sakura/contracts";

import { BarChart, type BarPoint } from "@/components/admin/bar-chart";
import { AdminPanelsSkeleton } from "@/components/admin/skeletons";
import { AdminApiError, getAdminDashboard, getAdminMonthlyReport } from "@/lib/api/admin";
import { formatMoney } from "@/lib/money";

/** "2026-08" → "Aug". Parsed by hand rather than `new Date("2026-08")`, which
    Safari and Node disagree about parsing as UTC vs. local midnight. */
function monthLabel(month: string): string {
  const [, m] = month.split("-");
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return names[Number(m) - 1] ?? month;
}

/** "2026-08-05" → "5". */
function dayLabel(date: string): string {
  return String(Number(date.split("-")[2]));
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/* --------------------------------------------------------------------------
   The order queue, in the operator's words.

   The database's own vocabulary was on screen until now — PAYMENT_CONFIRMED,
   PROCESSING — which reads as a state machine rather than as a job. The
   labels below say what is true of the parcel, because that is what the
   person reading this is about to go and do something about.

   `tab` is where the count sends you. The Orders screen groups the same seven
   statuses into three tabs, so a bucket cannot link to itself precisely; it
   links to the tab that contains it, which is one filter away from the row
   the operator wants and infinitely closer than the rail was.

   `urgentAfterHours` is the age at which the oldest order in a bucket stops
   being a queue and starts being a problem. Payment chases are the impatient
   one: an unpaid order is a held reservation and a customer who has probably
   already forgotten. Delivered has no threshold at all — nothing is waiting.
   -------------------------------------------------------------------------- */
const QUEUE: Record<
  OrderStatus,
  { label: string; hint: string; tab: string; urgentAfterHours: number | null }
> = {
  PENDING: {
    label: "Waiting for payment",
    hint: "Not yet paid or verified",
    tab: "pending",
    urgentAfterHours: 24,
  },
  PAYMENT_CONFIRMED: {
    label: "Paid, not yet packed",
    hint: "Ready to pick",
    tab: "accepted",
    urgentAfterHours: 24,
  },
  PROCESSING: {
    label: "Being packed",
    hint: "Picked, not yet handed over",
    tab: "accepted",
    urgentAfterHours: 48,
  },
  SHIPPED: {
    label: "With the courier",
    hint: "Out for delivery",
    tab: "accepted",
    urgentAfterHours: 168,
  },
  DELIVERED: { label: "Delivered", hint: "Closed", tab: "accepted", urgentAfterHours: null },
  CANCELLED: { label: "Cancelled", hint: "Closed", tab: "rejected", urgentAfterHours: null },
  REFUNDED: { label: "Refunded", hint: "Closed", tab: "rejected", urgentAfterHours: null },
};

/**
 * An ISO timestamp → "4 days", "19 hours", "just now".
 *
 * Coarse on purpose. The question this answers is "has this been sitting too
 * long", and to four decimal places the answer is the same as to none — a
 * precise "3d 7h 12m" would only invite the reader to parse it.
 */
function ageFrom(iso: string): { text: string; hours: number } {
  const hours = Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5);

  if (hours < 1) return { text: "just now", hours };
  if (hours < 48) {
    const whole = Math.round(hours);
    return { text: `${whole} ${whole === 1 ? "hour" : "hours"}`, hours };
  }
  const days = Math.round(hours / 24);
  return { text: `${days} days`, hours };
}

export default function AdminDashboardPage() {
  const { locale } = useParams<{ locale: string }>();
  const adminBase = `/${locale}/admin`;

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [month, setMonth] = useState(currentMonth());
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  /**
   * The report on screen is for a month that is no longer the selected one.
   *
   * Derived by comparing the two rather than tracked as its own flag: the
   * report carries the month it describes, so a separate boolean would be a
   * second copy of a fact already on hand — and keeping it in step would mean
   * setting state inside the fetch effect, which is the cascading render the
   * lint rule is there to prevent.
   *
   * Used to dim rather than to blank. The previous month's figures stay
   * legible while the new ones arrive, but visibly held back, so nobody reads
   * August's takings believing they are September's.
   */
  const reportPending = report !== null && report.month !== month && reportError === null;

  useEffect(() => {
    getAdminDashboard()
      .then(setDashboard)
      .catch((err: unknown) => setError(messageOf(err, "Could not load the dashboard.")));
  }, []);

  useEffect(() => {
    let cancelled = false;

    getAdminMonthlyReport(month)
      .then((result) => {
        if (cancelled) return;
        setReport(result);
        setReportError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setReportError(messageOf(err, "Could not load that month's report."));
      });

    return () => {
      cancelled = true;
    };
  }, [month]);

  const trendPoints: BarPoint[] = useMemo(
    () =>
      (dashboard?.monthlyTrend ?? []).map((point) => ({
        key: point.month,
        label: monthLabel(point.month),
        value: point.revenueCents,
        tooltip: `${monthLabel(point.month)} — ${formatMoney(point.revenueCents, "en-GB", dashboard?.currency)} · ${point.orderCount} orders · ${point.unitsSold} copies`,
      })),
    [dashboard],
  );

  const dailyPoints: BarPoint[] = useMemo(
    () =>
      (report?.daily ?? []).map((point) => ({
        key: point.date,
        label: dayLabel(point.date),
        value: point.revenueCents,
        tooltip: `${point.date} — ${formatMoney(point.revenueCents, "en-GB", report?.currency)} · ${point.orderCount} orders · ${point.unitsSold} copies`,
      })),
    [report],
  );

  /* Quiet days are dropped from the table, not from the chart. The chart needs
     its calendar spine or a gap reads as missing data; the table does not, and
     thirty rows of ৳0 bury the four that happened. */
  const activeDays = useMemo(
    () => (report?.daily ?? []).filter((day) => day.orderCount > 0),
    [report],
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-h2 text-ink font-serif">Dashboard</h1>
        <p className="text-13.5 text-secondary mt-1">
          {dashboard ? `Day boundaries computed for ${dashboard.timezone}.` : "Loading…"}
        </p>
      </div>

      {error ? <ErrorNotice message={error} /> : null}

      {dashboard ? (
        <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Today"
              window={dashboard.today}
              currency={dashboard.currency}
              href={`${adminBase}/orders?tab=accepted`}
            />
            <StatCard
              label="Last 7 days"
              window={dashboard.last7Days}
              currency={dashboard.currency}
              href={`${adminBase}/orders?tab=accepted`}
            />
            <StatCard
              label="Last 30 days"
              window={dashboard.last30Days}
              currency={dashboard.currency}
              href={`${adminBase}/orders?tab=accepted`}
            />
            <Link
              href={`${adminBase}/orders?tab=pending`}
              className="rounded-container border-rule bg-surface p-card hover:border-clay focus-visible:border-clay block border transition-colors"
            >
              <p className="text-caption tracking-eyebrow text-muted uppercase">Awaiting action</p>
              <p
                className={`text-h2 mt-2 font-serif ${dashboard.awaitingAction > 0 ? "text-clay" : "text-ink"}`}
              >
                {dashboard.awaitingAction}
              </p>
              <p className="text-13.5 text-secondary mt-1">orders need something done</p>
            </Link>
          </section>

          <section className="rounded-container border-rule bg-surface p-card border">
            <div className="flex items-baseline justify-between">
              <h2 className="text-h4 text-ink font-serif">Revenue collected, last 12 months</h2>
            </div>
            <p className="text-13.5 text-secondary mt-1">
              Each month holds the money recognised in it, not the value of the orders placed in it
              — so a cash-on-delivery order counts on the day the courier settles.
            </p>
            <div className="mt-4">
              <BarChart
                points={trendPoints}
                selectedKey={month}
                onSelect={(key) => setMonth(key)}
              />
            </div>
          </section>

          <section className="rounded-container border-rule bg-surface p-card border">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-h4 text-ink font-serif">Monthly report</h2>
              <label className="text-13.5 text-secondary flex items-center gap-2">
                Month
                <input
                  id="dashboard-month"
                  type="month"
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                  className="rounded-control border-rule bg-page text-13.5 text-ink border px-2 py-1"
                />
              </label>
            </div>

            {reportError ? <ErrorNotice message={reportError} /> : null}

            {report ? (
              <div
                className={reportPending ? "opacity-50 transition-opacity" : "transition-opacity"}
                aria-busy={reportPending}
              >
                <div className="text-13.5 mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-caption text-muted uppercase">Orders</p>
                    <p className="text-h4 text-ink mt-1 font-serif">{report.totalOrders}</p>
                  </div>
                  <div>
                    <p className="text-caption text-muted uppercase">Copies</p>
                    <p className="text-h4 text-ink mt-1 font-serif">{report.totalUnitsSold}</p>
                  </div>
                  <div>
                    <p className="text-caption text-muted uppercase">Revenue</p>
                    <p className="text-h4 text-ink mt-1 font-serif">
                      {formatMoney(report.totalRevenueCents, "en-GB", report.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-caption text-muted uppercase">Average order</p>
                    <p className="text-h4 text-ink mt-1 font-serif">
                      {formatMoney(report.averageOrderValueCents, "en-GB", report.currency)}
                    </p>
                  </div>
                </div>

                <div className="mt-6">
                  <BarChart points={dailyPoints} />
                </div>

                <div className="mt-6 max-h-64 overflow-y-auto">
                  <table className="text-13.5 w-full text-left">
                    <thead>
                      <tr className="border-rule-strong text-caption text-muted border-b uppercase">
                        <th className="py-2 pr-4 font-medium">Date</th>
                        <th className="py-2 pr-4 font-medium">Orders</th>
                        <th className="py-2 pr-4 font-medium">Copies</th>
                        <th className="py-2 font-medium">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeDays.map((day) => (
                        <tr key={day.date} className="border-rule border-b last:border-0">
                          <td className="text-secondary py-2 pr-4">{day.date}</td>
                          <td className="text-ink py-2 pr-4">{day.orderCount}</td>
                          <td className="text-ink py-2 pr-4">{day.unitsSold}</td>
                          <td className="text-ink py-2">
                            {formatMoney(day.revenueCents, "en-GB", report.currency)}
                          </td>
                        </tr>
                      ))}
                      {activeDays.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="text-muted py-3">
                            Nothing was collected in {monthLabel(report.month)}.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-container border-rule bg-surface p-card border">
              <h2 className="text-h4 text-ink font-serif">Order queue</h2>
              <ul className="mt-4 flex flex-col">
                {dashboard.statusBuckets.map((bucket) => {
                  const meta = QUEUE[bucket.status];
                  const age = bucket.oldestPlacedAt ? ageFrom(bucket.oldestPlacedAt) : null;
                  const urgent =
                    age !== null &&
                    meta.urgentAfterHours !== null &&
                    age.hours >= meta.urgentAfterHours;

                  return (
                    <li key={bucket.status} className="border-rule border-b last:border-0">
                      <Link
                        href={`${adminBase}/orders?tab=${meta.tab}`}
                        className="hover:bg-tint -mx-2 flex items-center justify-between gap-3 rounded px-2 py-2.5 transition-colors"
                      >
                        <span className="min-w-0">
                          <span
                            className={`text-13.5 block ${urgent ? "text-clay-deep font-medium" : "text-ink"}`}
                          >
                            {meta.label}
                          </span>
                          <span className="text-caption text-muted block">
                            {age ? `oldest waiting ${age.text}` : meta.hint}
                          </span>
                        </span>
                        <span
                          className={`text-13.5 shrink-0 tabular-nums ${urgent ? "text-clay-deep font-medium" : "text-ink"}`}
                        >
                          {bucket.count}
                        </span>
                      </Link>
                    </li>
                  );
                })}
                {dashboard.statusBuckets.length === 0 ? (
                  <li className="text-13.5 text-muted py-2">No orders yet.</li>
                ) : null}
              </ul>
            </div>

            <div className="rounded-container border-rule bg-surface p-card border">
              <h2 className="text-h4 text-ink font-serif">Low stock</h2>
              <ul className="mt-4 flex flex-col">
                {dashboard.lowStock.map((book) => {
                  const out = book.stockQuantity <= 0;
                  return (
                    <li key={book.slug} className="border-rule border-b last:border-0">
                      <Link
                        href={`${adminBase}/stock`}
                        className="hover:bg-tint -mx-2 flex items-center justify-between gap-3 rounded px-2 py-2.5 transition-colors"
                      >
                        <span className="min-w-0">
                          <span
                            className={`text-13.5 block ${out ? "text-clay-deep font-medium" : "text-ink"}`}
                          >
                            {book.title}
                          </span>
                          <span className="text-caption text-muted block">
                            {out ? "out of stock" : `restocks at ${book.lowStockThreshold}`}
                          </span>
                        </span>
                        <span
                          className={`text-13.5 shrink-0 tabular-nums ${out ? "text-clay-deep font-medium" : "text-ink"}`}
                        >
                          {book.stockQuantity}
                        </span>
                      </Link>
                    </li>
                  );
                })}
                {dashboard.lowStock.length === 0 ? (
                  <li className="text-13.5 text-muted py-2">Nothing running low.</li>
                ) : null}
              </ul>
            </div>
          </section>

          <section className="rounded-container border-rule bg-surface p-card border">
            <h2 className="text-h4 text-ink font-serif">Top sellers</h2>
            <p className="text-13.5 text-secondary mt-1">Copies sold since the shop opened.</p>
            <ul className="mt-4 flex flex-col">
              {dashboard.topSellers.map((book) => (
                <li key={book.slug} className="border-rule border-b last:border-0">
                  <Link
                    href={`${adminBase}/books`}
                    className="hover:bg-tint -mx-2 flex items-center justify-between gap-3 rounded px-2 py-2.5 transition-colors"
                  >
                    <span className="text-13.5 text-ink min-w-0">{book.title}</span>
                    <span className="text-13.5 text-secondary shrink-0 tabular-nums">
                      {book.unitsSold} sold · {book.stockQuantity} left
                    </span>
                  </Link>
                </li>
              ))}
              {dashboard.topSellers.length === 0 ? (
                <li className="text-13.5 text-muted py-2">Nothing has sold yet.</li>
              ) : null}
            </ul>
          </section>
        </>
      ) : (
        /* Only when nothing has failed: an error already says what happened,
           and a skeleton under it would promise data that is not coming. */
        !error && <AdminPanelsSkeleton tiles={4} panels={3} />
      )}
    </div>
  );
}

/**
 * One window, counted both ways.
 *
 * Collected leads because it is the figure that is true — money the shop
 * actually holds. Ordered sits under it in smaller type because for a COD
 * shop it is the larger and more flattering number, and the layout should not
 * let it be mistaken for the takings.
 */
function StatCard({
  label,
  window,
  currency,
  href,
}: {
  label: string;
  window: { collected: WindowTotals; ordered: WindowTotals };
  currency: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-container border-rule bg-surface p-card hover:border-clay focus-visible:border-clay block border transition-colors"
    >
      <p className="text-caption tracking-eyebrow text-muted uppercase">{label}</p>
      <p className="text-h2 text-ink mt-2 font-serif">
        {formatMoney(window.collected.totalCents, "en-GB", currency)}
      </p>
      <p className="text-13.5 text-secondary mt-1">
        collected · {window.collected.orderCount}{" "}
        {window.collected.orderCount === 1 ? "order" : "orders"} · {window.collected.unitsSold}{" "}
        {window.collected.unitsSold === 1 ? "copy" : "copies"}
      </p>
      <p className="text-caption text-muted border-rule mt-3 border-t pt-2">
        {formatMoney(window.ordered.totalCents, "en-GB", currency)} ordered ·{" "}
        {window.ordered.orderCount} {window.ordered.orderCount === 1 ? "order" : "orders"} ·{" "}
        {window.ordered.unitsSold} {window.ordered.unitsSold === 1 ? "copy" : "copies"}
      </p>
    </Link>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <p className="rounded-control border-clay bg-tint text-13.5 text-clay-deep border px-4 py-3">
      {message}
    </p>
  );
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof AdminApiError ? error.message : fallback;
}
