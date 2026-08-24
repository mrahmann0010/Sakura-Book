"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dashboard, MonthlyReport } from "@sakura/contracts";

import { AdminShell } from "@/components/admin/admin-shell";
import { BarChart, type BarPoint } from "@/components/admin/bar-chart";
import { AdminApiError, getAdminDashboard, getAdminMonthlyReport } from "@/lib/api/admin";
import { formatMoney } from "@/lib/money";
import { useAdminGate } from "@/lib/use-admin-gate";

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

export default function AdminDashboardPage() {
  const { checking } = useAdminGate();

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [month, setMonth] = useState(currentMonth());
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    if (checking) return;
    getAdminDashboard()
      .then(setDashboard)
      .catch((err: unknown) => setError(messageOf(err, "Could not load the dashboard.")));
  }, [checking]);

  useEffect(() => {
    if (checking) return;
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
  }, [checking, month]);

  const trendPoints: BarPoint[] = useMemo(
    () =>
      (dashboard?.monthlyTrend ?? []).map((point) => ({
        key: point.month,
        label: monthLabel(point.month),
        value: point.revenueCents,
        tooltip: `${monthLabel(point.month)} — ${formatMoney(point.revenueCents, "en-GB", dashboard?.currency)} · ${point.orderCount} orders`,
      })),
    [dashboard],
  );

  const dailyPoints: BarPoint[] = useMemo(
    () =>
      (report?.daily ?? []).map((point) => ({
        key: point.date,
        label: dayLabel(point.date),
        value: point.revenueCents,
        tooltip: `${point.date} — ${formatMoney(point.revenueCents, "en-GB", report?.currency)} · ${point.orderCount} orders`,
      })),
    [report],
  );

  return (
    <AdminShell checking={checking}>
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
                revenueCents={dashboard.today.totalCents}
                orderCount={dashboard.today.orderCount}
                currency={dashboard.currency}
              />
              <StatCard
                label="Last 7 days"
                revenueCents={dashboard.last7Days.totalCents}
                orderCount={dashboard.last7Days.orderCount}
                currency={dashboard.currency}
              />
              <StatCard
                label="Last 30 days"
                revenueCents={dashboard.last30Days.totalCents}
                orderCount={dashboard.last30Days.orderCount}
                currency={dashboard.currency}
              />
              <div className="rounded-container border-rule bg-surface p-card border">
                <p className="text-caption tracking-eyebrow text-muted uppercase">
                  Awaiting action
                </p>
                <p className="text-h2 text-ink mt-2 font-serif">{dashboard.awaitingAction}</p>
                <p className="text-13.5 text-secondary mt-1">orders need something done</p>
              </div>
            </section>

            <section className="rounded-container border-rule bg-surface p-card border">
              <div className="flex items-baseline justify-between">
                <h2 className="text-h4 text-ink font-serif">Revenue, last 12 months</h2>
              </div>
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
                    type="month"
                    value={month}
                    onChange={(event) => setMonth(event.target.value)}
                    className="rounded-control border-rule bg-page text-13.5 text-ink border px-2 py-1"
                  />
                </label>
              </div>

              {reportError ? <ErrorNotice message={reportError} /> : null}

              {report ? (
                <>
                  <div className="text-13.5 mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-caption text-muted uppercase">Orders</p>
                      <p className="text-h4 text-ink mt-1 font-serif">{report.totalOrders}</p>
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
                        <tr className="border-rule text-caption text-muted border-b uppercase">
                          <th className="py-2 pr-4 font-medium">Date</th>
                          <th className="py-2 pr-4 font-medium">Orders</th>
                          <th className="py-2 font-medium">Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.daily.map((day) => (
                          <tr key={day.date} className="border-rule/60 border-b">
                            <td className="text-secondary py-2 pr-4">{day.date}</td>
                            <td className="text-ink py-2 pr-4">{day.orderCount}</td>
                            <td className="text-ink py-2">
                              {formatMoney(day.revenueCents, "en-GB", report.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </section>

            <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-container border-rule bg-surface p-card border">
                <h2 className="text-h4 text-ink font-serif">Order queue</h2>
                <ul className="mt-4 flex flex-col gap-2">
                  {dashboard.statusBuckets.map((bucket) => (
                    <li
                      key={bucket.status}
                      className="border-rule/60 text-13.5 flex items-center justify-between border-b py-2"
                    >
                      <span className="text-secondary">{bucket.status}</span>
                      <span className="text-ink">{bucket.count}</span>
                    </li>
                  ))}
                  {dashboard.statusBuckets.length === 0 ? (
                    <li className="text-13.5 text-muted py-2">No orders yet.</li>
                  ) : null}
                </ul>
              </div>

              <div className="rounded-container border-rule bg-surface p-card border">
                <h2 className="text-h4 text-ink font-serif">Low stock</h2>
                <ul className="mt-4 flex flex-col gap-2">
                  {dashboard.lowStock.map((book) => (
                    <li
                      key={book.slug}
                      className="border-rule/60 text-13.5 flex items-center justify-between border-b py-2"
                    >
                      <span className="text-secondary">{book.title}</span>
                      <span className="text-ink">
                        {book.stockQuantity} / {book.lowStockThreshold}
                      </span>
                    </li>
                  ))}
                  {dashboard.lowStock.length === 0 ? (
                    <li className="text-13.5 text-muted py-2">Nothing running low.</li>
                  ) : null}
                </ul>
              </div>
            </section>

            <section className="rounded-container border-rule bg-surface p-card border">
              <h2 className="text-h4 text-ink font-serif">Top sellers</h2>
              <ul className="mt-4 flex flex-col gap-2">
                {dashboard.topSellers.map((book) => (
                  <li
                    key={book.slug}
                    className="border-rule/60 text-13.5 flex items-center justify-between border-b py-2"
                  >
                    <span className="text-secondary">{book.title}</span>
                    <span className="text-ink">{book.unitsSold} sold</span>
                  </li>
                ))}
                {dashboard.topSellers.length === 0 ? (
                  <li className="text-13.5 text-muted py-2">Nothing has sold yet.</li>
                ) : null}
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}

function StatCard({
  label,
  revenueCents,
  orderCount,
  currency,
}: {
  label: string;
  revenueCents: number;
  orderCount: number;
  currency: string;
}) {
  return (
    <div className="rounded-container border-rule bg-surface p-card border">
      <p className="text-caption tracking-eyebrow text-muted uppercase">{label}</p>
      <p className="text-h2 text-ink mt-2 font-serif">
        {formatMoney(revenueCents, "en-GB", currency)}
      </p>
      <p className="text-13.5 text-secondary mt-1">
        {orderCount} {orderCount === 1 ? "order" : "orders"}
      </p>
    </div>
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
