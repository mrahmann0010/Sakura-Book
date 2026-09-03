"use client";

import { useEffect, useState } from "react";
import type { PaymentBreakdown, PaymentBreakdownRange, PaymentPlatform } from "@sakura/contracts";

import { AdminShell } from "@/components/admin/admin-shell";
import { AdminApiError, getAdminPaymentBreakdown } from "@/lib/api/admin";
import { formatCredit, formatMoney } from "@/lib/money";
import { useAdminGate } from "@/lib/use-admin-gate";

/* --------------------------------------------------------------------------
   Payments: what the accepted orders added up to, and where the money came
   from.

   Read top-down, and deliberately so — the page is three answers at three
   depths, and someone reconciling a week should be able to stop after any one
   of them:

     1. One number. What the window took, and how much of it is actually in
        hand versus still with a courier.
     2. One bar. What that number was *for* — books, delivery, less discounts.
        Proportion is the point, so it is a bar and not three more figures.
     3. One table. Which wallet each part of it moved through.

   ## Why the split bar rather than four stat cards

   Books and delivery are parts of one total, and the question people actually
   ask of them ("are we making our money on books or on postage?") is a
   question about *ratio*. Four cards make that ratio something you work out;
   one proportional bar makes it something you see. The exact figures are
   directly labelled beside it, so nothing is lost to the picture.

   ## Colour

   Two segments, one hue. The design system allows a single accent, and this
   is exactly the case where that is also the right call rather than merely
   the permitted one: books and delivery are not competing categories, they
   are the larger and smaller part of one sum, which is an *ordinal* pair.
   Clay at full strength and clay mixed toward the surface — validated as an
   ordinal ramp (monotone lightness, the light end clearing the surface at
   3.1:1) — say "same money, two parts" where two hues would say "two things".

   There is a 2px surface gap between the segments, and each one is named,
   valued and given its percentage in the sum rows directly beneath — so
   identity never rests on colour alone.

   ## Discounts are not a segment

   A stacked bar can only show parts that add up. Discounts subtract, so the
   bar spans books + delivery and the discount appears beneath it as the
   deduction it is, ending in the total. The arithmetic is drawn rather than
   asserted — if the figures ever stopped reconciling, the reader would see it
   in the sum, not have to trust a number.
   -------------------------------------------------------------------------- */

const RANGES: readonly { key: PaymentBreakdownRange; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "month", label: "This month" },
  { key: "30d", label: "Last 30 days" },
  { key: "7d", label: "Last 7 days" },
  { key: "today", label: "Today" },
  { key: "custom", label: "Custom" },
];

const PLATFORM_LABELS: Record<PaymentPlatform, string> = {
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
  "cash-on-delivery": "Cash on delivery",
  /* Manual transfers from before the checkout recorded which wallet was used.
     Named for what it is, so nobody reads it as a fifth payment method. */
  other: "Other / unrecorded",
};

/** Full clay, and clay mixed toward the surface — the validated ordinal pair. */
const BOOKS_FILL = "var(--clay)";
const DELIVERY_FILL = "color-mix(in srgb, var(--clay) 62%, var(--surface))";

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function AdminPaymentsPage() {
  const { checking } = useAdminGate();

  const [range, setRange] = useState<PaymentBreakdownRange>("all");
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [data, setData] = useState<PaymentBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (checking) return;
    // A custom range is only requestable once both ends are set and ordered —
    // otherwise the API would answer a 400 for every keystroke in the date
    // fields, and the reader would watch an error flash as they type.
    if (range === "custom" && (!from || !to || from > to)) return;

    let cancelled = false;

    getAdminPaymentBreakdown({ range, from, to })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err, "Could not load the payment breakdown."));
      });

    return () => {
      cancelled = true;
    };
  }, [checking, range, from, to]);

  /**
   * Whether what is on screen is the answer to what is selected.
   *
   * Derived from the response's own echoed range rather than tracked in a
   * `loading` flag set beside the fetch — which is both what the lint rule
   * about setState-in-effect is pointing at and the more accurate question.
   * A flag records "a request is in flight"; this records "these figures
   * belong to a range nobody has selected any more", which is the thing the
   * reader must not be shown as though it were current. It covers the gap
   * before the first response, a range change mid-flight, and a failed
   * request that left the previous range's numbers standing.
   */
  const selectedKey = rangeKey(range, from, to);
  const shownKey = data ? rangeKey(data.range.key, data.range.from, data.range.to) : null;
  const stale = shownKey !== selectedKey;

  const totals = data?.totals;
  const currency = data?.currency;
  // What the bar spans. Books + delivery, before the discount comes off.
  const gross = totals ? totals.booksCents + totals.deliveryCents : 0;

  return (
    <AdminShell checking={checking}>
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="text-h2 text-ink font-serif">Payments</h1>
          <p className="text-13.5 text-secondary mt-1">
            {data ? `${describeRange(data)} · accepted orders only` : "Loading…"}
          </p>
        </div>

        {/* Filters in one row above everything they affect — every figure on
            the page is scoped by this control and nothing else. */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {RANGES.map((option) => {
              const active = option.key === range;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setRange(option.key)}
                  aria-pressed={active}
                  className={`rounded-control text-13.5 border px-3 py-2 transition-colors ${
                    active
                      ? "border-clay bg-tint text-ink"
                      : "border-rule text-secondary hover:text-ink hover:bg-tint"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {range === "custom" ? (
            <div className="text-13.5 text-secondary flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                From
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(event) => setFrom(event.target.value)}
                  className="rounded-control border-rule bg-page text-13.5 text-ink border px-2 py-1"
                />
              </label>
              <label className="flex items-center gap-2">
                To
                <input
                  type="date"
                  value={to}
                  min={from}
                  onChange={(event) => setTo(event.target.value)}
                  className="rounded-control border-rule bg-page text-13.5 text-ink border px-2 py-1"
                />
              </label>
              {from > to ? (
                <span className="text-clay">The start date must not be after the end date.</span>
              ) : null}
            </div>
          ) : null}
        </section>

        {error ? <ErrorNotice message={error} /> : null}

        {/* Everything below is scoped to the range above it, so while a new
            range is in flight the figures on screen belong to the *old* one.
            Left alone, the page reads as though Today took what All time did —
            a wrong number under a correct label, which on a money screen is
            worse than no number. Dimming says "not this range's answer yet"
            without throwing away the layout and making the page jump. */}
        {data && totals && currency ? (
          <div
            aria-busy={stale}
            className={`flex flex-col gap-8 transition-opacity duration-150 ${
              stale ? "pointer-events-none opacity-40" : "opacity-100"
            }`}
          >
            {totals.orderCount === 0 ? (
              <p className="rounded-container border-rule bg-surface p-card text-13.5 text-secondary border">
                No accepted orders in this window. Orders count here once they reach payment
                confirmed, and stop counting if they are cancelled or refunded.
              </p>
            ) : (
              <>
                {/* ---------- 1. The headline ---------- */}
                <section className="rounded-container border-rule bg-surface p-card border">
                  <p className="text-caption tracking-eyebrow text-muted uppercase">
                    Total from accepted orders
                  </p>
                  <p className="text-h1 text-ink mt-2 font-serif leading-none">
                    {formatMoney(totals.totalCents, "en-GB", currency)}
                  </p>
                  <p className="text-13.5 text-secondary mt-2">
                    {totals.orderCount} {totals.orderCount === 1 ? "order" : "orders"} · average{" "}
                    {formatMoney(data.averageOrderValueCents, "en-GB", currency)}
                  </p>

                  {/* The half of the headline that keeps it honest: cash on
                    delivery is not money the shop has until the courier hands
                    it over, and a single blended figure would say otherwise. */}
                  <div className="border-rule mt-6 grid grid-cols-1 gap-4 border-t pt-5 sm:grid-cols-2">
                    <div>
                      <p className="text-caption tracking-eyebrow text-muted uppercase">
                        Collected
                      </p>
                      <p className="text-h3 text-ink mt-1 font-serif">
                        {formatMoney(totals.collectedCents, "en-GB", currency)}
                      </p>
                      <p className="text-13.5 text-secondary mt-1">
                        Wallet transfers, plus delivered cash orders
                      </p>
                    </div>
                    <div>
                      <p className="text-caption tracking-eyebrow text-muted uppercase">Expected</p>
                      <p className="text-h3 text-ink mt-1 font-serif">
                        {formatMoney(totals.expectedCents, "en-GB", currency)}
                      </p>
                      <p className="text-13.5 text-secondary mt-1">
                        Cash on delivery still with a courier
                      </p>
                    </div>
                  </div>
                </section>

                {/* ---------- 2. What it was for ---------- */}
                <section className="rounded-container border-rule bg-surface p-card border">
                  <h2 className="text-h4 text-ink font-serif">What the money was for</h2>

                  <div className="mt-5">
                    <SplitBar
                      parts={[
                        {
                          key: "books",
                          label: "Books",
                          value: totals.booksCents,
                          fill: BOOKS_FILL,
                        },
                        {
                          key: "delivery",
                          label: "Delivery",
                          value: totals.deliveryCents,
                          fill: DELIVERY_FILL,
                        },
                      ]}
                      total={gross}
                      currency={currency}
                    />
                  </div>

                  {/* The arithmetic, drawn — and the bar's legend, which is the
                    same list. Books + delivery, less discounts, equals the
                    headline above, visibly, so the two blocks can be checked
                    against each other at a glance.

                    A separate legend strip under the bar was tried and cut: it
                    repeated these two labels and these two figures a line
                    above where they already appear. The swatch does the
                    legend's whole job here. */}
                  <dl className="text-13.5 mt-5 flex flex-col gap-2">
                    <SumRow
                      label="Book price collected"
                      swatch={BOOKS_FILL}
                      share={gross > 0 ? totals.booksCents / gross : 0}
                      value={formatMoney(totals.booksCents, "en-GB", currency)}
                    />
                    <SumRow
                      label="Delivery fee collected"
                      swatch={DELIVERY_FILL}
                      share={gross > 0 ? totals.deliveryCents / gross : 0}
                      value={formatMoney(totals.deliveryCents, "en-GB", currency)}
                    />
                    <SumRow
                      label="Discounts given"
                      value={
                        totals.discountCents === 0
                          ? formatMoney(0, "en-GB", currency)
                          : formatCredit(totals.discountCents, "en-GB", currency)
                      }
                    />
                    <div className="border-rule mt-1 flex items-baseline justify-between border-t pt-3">
                      <dt className="text-ink">Total charged</dt>
                      <dd className="text-ink font-serif">
                        {formatMoney(totals.totalCents, "en-GB", currency)}
                      </dd>
                    </div>
                  </dl>
                </section>

                {/* ---------- 3. Where it came from ---------- */}
                <section className="rounded-container border-rule bg-surface p-card border">
                  <h2 className="text-h4 text-ink font-serif">Where it came from</h2>
                  <p className="text-13.5 text-secondary mt-1">
                    Busiest platform first. Share is of the total charged.
                  </p>

                  <div className="mt-4 overflow-x-auto">
                    <table className="text-13.5 w-full min-w-2xl text-left">
                      <thead>
                        <tr className="border-rule text-caption text-muted border-b uppercase">
                          <th className="py-2 pr-4 font-medium">Platform</th>
                          <th className="py-2 pr-4 text-right font-medium">Orders</th>
                          <th className="py-2 pr-4 text-right font-medium">Books</th>
                          <th className="py-2 pr-4 text-right font-medium">Delivery</th>
                          <th className="py-2 pr-4 text-right font-medium">Total</th>
                          <th className="w-40 py-2 font-medium">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.platforms.map((row) => {
                          const share =
                            totals.totalCents > 0 ? row.totalCents / totals.totalCents : 0;

                          return (
                            <tr key={row.platform} className="border-rule/60 border-b">
                              <td className="text-ink py-2.5 pr-4">
                                {PLATFORM_LABELS[row.platform]}
                                {row.expectedCents > 0 ? (
                                  <span className="text-muted block">
                                    {formatMoney(row.expectedCents, "en-GB", currency)} not yet
                                    collected
                                  </span>
                                ) : null}
                              </td>
                              <td className="text-secondary py-2.5 pr-4 text-right tabular-nums">
                                {row.orderCount}
                              </td>
                              <td className="text-secondary py-2.5 pr-4 text-right tabular-nums">
                                {formatMoney(row.booksCents, "en-GB", currency)}
                              </td>
                              <td className="text-secondary py-2.5 pr-4 text-right tabular-nums">
                                {formatMoney(row.deliveryCents, "en-GB", currency)}
                              </td>
                              <td className="text-ink py-2.5 pr-4 text-right tabular-nums">
                                {formatMoney(row.totalCents, "en-GB", currency)}
                              </td>
                              <td className="py-2.5">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="bg-tint h-2 flex-1 overflow-hidden rounded-full"
                                    role="img"
                                    aria-label={`${Math.round(share * 100)} percent of the total`}
                                  >
                                    <div
                                      className="h-full rounded-full"
                                      style={{
                                        width: `${Math.max(share * 100, share > 0 ? 1.5 : 0)}%`,
                                        backgroundColor: BOOKS_FILL,
                                      }}
                                    />
                                  </div>
                                  <span className="text-secondary w-10 text-right tabular-nums">
                                    {formatShare(share)}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="text-ink">
                          <td className="py-2.5 pr-4">Total</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">
                            {totals.orderCount}
                          </td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">
                            {formatMoney(totals.booksCents, "en-GB", currency)}
                          </td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">
                            {formatMoney(totals.deliveryCents, "en-GB", currency)}
                          </td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">
                            {formatMoney(totals.totalCents, "en-GB", currency)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>
              </>
            )}
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}

/** The swatch that ties a sum row to its segment in the bar above it. */
const SWATCH_SIZE = 10;

/**
 * One horizontal bar split into its parts.
 *
 * Carries no text of its own. The percentages lived inside the segments until
 * they were measured against the fills they sat on: `--ink` on `--clay` is
 * about 2.2:1, which is not a contrast ratio to set 11px type at. Moving them
 * into the sum rows below puts every character back on the surface, where the
 * palette's text tokens are the contrast they were chosen to be — and the
 * segments keep a `title`, so the exact figure is still a hover away.
 *
 * A 2px gap between segments rather than a border: a border would sit inside
 * the segment and shorten the thing being measured, which is the one property
 * a proportional bar has to keep.
 */
function SplitBar({
  parts,
  total,
  currency,
}: {
  parts: readonly { key: string; label: string; value: number; fill: string }[];
  total: number;
  currency: string;
}) {
  const safeTotal = Math.max(total, 1);

  return (
    <div className="flex h-10 w-full gap-0.5">
      {parts.map((part) => {
        if (part.value <= 0) return null;
        const share = part.value / safeTotal;

        return (
          <div
            key={part.key}
            title={`${part.label} — ${formatMoney(part.value, "en-GB", currency)} · ${formatShare(share)}`}
            style={{ width: `${share * 100}%`, backgroundColor: part.fill }}
            className="min-w-0 rounded"
          />
        );
      })}
    </div>
  );
}

/**
 * A label, an optional share, and an amount — with the swatch that makes the
 * list double as the bar's legend.
 *
 * The swatch is sized inline rather than by a utility class, alongside the
 * fill it already carries: it is a 10px square whose only job is to match a
 * segment, and one declaration that cannot be half-applied beats two that can.
 */
function SumRow({
  label,
  value,
  swatch,
  share,
}: {
  label: string;
  value: string;
  swatch?: string;
  share?: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-secondary flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="shrink-0 rounded-sm"
          style={{
            display: "inline-block",
            width: SWATCH_SIZE,
            height: SWATCH_SIZE,
            backgroundColor: swatch ?? "transparent",
          }}
        />
        <span className="truncate">{label}</span>
        {share === undefined ? null : (
          <span className="text-muted shrink-0 tabular-nums">{formatShare(share)}</span>
        )}
      </dt>
      <dd className="text-ink shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Identifies a window, so the range on screen can be compared with the range
 * selected. The dates only participate for `custom` — they are the server's
 * to compute for every preset, and folding them in would make "Today" look
 * like a new selection each time the same answer came back.
 */
function rangeKey(key: PaymentBreakdownRange, from?: string | null, to?: string | null): string {
  return key === "custom" ? `custom:${from ?? ""}:${to ?? ""}` : key;
}

/** "56%", or one decimal below 10% where whole percents would round to nothing. */
function formatShare(share: number): string {
  const percent = share * 100;
  if (percent > 0 && percent < 10) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

function describeRange(data: PaymentBreakdown): string {
  const label = RANGES.find((option) => option.key === data.range.key)?.label ?? "All time";
  if (!data.range.from || !data.range.to) return `${label} · ${data.timezone}`;
  if (data.range.from === data.range.to) return `${label} · ${data.range.from}`;
  return `${label} · ${data.range.from} to ${data.range.to}`;
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
