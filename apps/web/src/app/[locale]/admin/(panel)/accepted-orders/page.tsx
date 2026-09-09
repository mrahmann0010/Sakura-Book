"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminOrderQuery, AdminOrderSummary, OrderStatus } from "@sakura/contracts";

import { AdminTableRows } from "@/components/admin/skeletons";
import { Button } from "@/components/ui";
import { bdDivisions } from "@/lib/bd-geo";
import {
  AdminApiError,
  downloadPathaoOrdersCsv,
  listAdminOrders,
  transitionAdminOrder,
} from "@/lib/api/admin";
import { formatMoney } from "@/lib/money";

/* --------------------------------------------------------------------------
   The dispatch list: accepted orders by division, and the tick that sends
   them to the courier.

   Deliberately a second screen rather than another control on /admin/orders.
   That page is the triage queue — pending first, one tab per outcome, opened
   to decide what to do with an order. This one answers a different question,
   asked by a different person on a different day: what is going out to Sylhet
   this week, and what has already gone.

   Two tabs, and the split between them is the day's work rather than a filter.
   To do holds the orders that have been accepted and not yet handed over;
   ticking one moves it to Shipped, where it stops being work and starts being
   a record. An order leaves the first list the moment it is ticked, because a
   packing list that still shows the parcels already on the van is a packing
   list nobody trusts.

   DELIVERED sits under Shipped, not under To do. It is past dispatch, so it is
   not work — and leaving it in the first tab would put orders there that have
   nothing left to tick.

   /admin/orders' own "Accepted" tab still spans all four statuses, and that is
   not drift: that screen is answering "what happened to this order", where
   shipped and delivered are both outcomes of accepting it. Here the question
   is "what do I hand over today", and shipped is the answer to a different day.

   The division filter is applied by the API (see admin-order.query.ts), not
   here: an order stores its district, the division→district mapping lives in
   @sakura/contracts, and filtering a single page of twenty-five rows in the
   browser would filter the page rather than the result set.

   The date filter is the same: dates go to the API as query parameters, so
   the count in the heading and the Pathao CSV both cover the whole filtered
   set rather than the page on screen.

   Which date it filters on follows the tab, because the two tabs ask about
   different days. To do asks when an order came in — you are working through a
   backlog of orders *placed* since some point. Shipped asks when a parcel went
   out — "what did we hand over on Tuesday", which is the question a courier
   dispute or a day's reconciliation starts from. Filtering the Shipped tab by
   placed date would answer neither: an order placed on the 1st and shipped on
   the 9th would appear under the 1st, on a list about dispatch.
   -------------------------------------------------------------------------- */

const TABS = [
  {
    key: "todo",
    label: "Accepted",
    statuses: ["PAYMENT_CONFIRMED", "PROCESSING"],
    /* Ticking a row here ships it. Only on this tab: the Shipped tab is a
       record of what has gone, and nothing there has a next step that a
       checkbox could honestly stand for. */
    shippable: true,
    /* Which date the range filters, and the word the control is labelled
       with — see the header comment. Kept beside the statuses because it is
       the same kind of fact: what this tab is a list of. */
    dateField: "placed",
    dateNoun: "Placed",
  },
  {
    key: "shipped",
    label: "Shipped",
    statuses: ["SHIPPED", "DELIVERED"],
    shippable: false,
    dateField: "shipped",
    dateNoun: "Shipped",
  },
] as const satisfies readonly {
  key: string;
  label: string;
  statuses: OrderStatus[];
  shippable: boolean;
  dateField: "placed" | "shipped";
  dateNoun: string;
}[];

type TabKey = (typeof TABS)[number]["key"];

/* --------------------------------------------------------------------------
   Dates.

   Presets plus a custom pair, the same control the Payments screen uses, so
   the two dated admin screens read as one design. The presets are there
   because the day's actual questions are "today" and "this week" — typing two
   ISO dates to ask them is a control that technically works and nobody uses.
   -------------------------------------------------------------------------- */

const DATE_RANGES = [
  { key: "all", label: "All dates" },
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom" },
] as const;

type RangeKey = (typeof DATE_RANGES)[number]["key"];

/**
 * Local calendar date as `YYYY-MM-DD`.
 *
 * Built from the local getters rather than `toISOString().slice(0, 10)`,
 * which is the same date only west of UTC. In Dhaka, before 6am, that
 * shortcut names yesterday — so "Today" would quietly filter to the day
 * before on exactly the early shift that is packing the previous night's
 * orders.
 */
function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysAgo(count: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - count);
  return date;
}

/**
 * The chosen preset as the two dates the API takes, or `null` when the custom
 * range is not yet a range.
 *
 * `null` rather than a half-open range while someone is still typing: the two
 * date inputs are empty until filled, and sending one end alone would refetch
 * the whole table on the way to a filter nobody asked for. The caller holds
 * the previous rows instead until the pair makes sense.
 *
 * Both bounds are inclusive whole days at the API — `placedTo=the 20th` means
 * up to the end of the 20th — so "Last 7 days" is six days back through today,
 * seven days of orders, rather than eight.
 */
function resolveRange(
  range: RangeKey,
  from: string,
  to: string,
): { from?: string; to?: string } | null {
  const today = isoDay(new Date());

  switch (range) {
    case "all":
      return {};
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: isoDay(daysAgo(6)), to: today };
    case "30d":
      return { from: isoDay(daysAgo(29)), to: today };
    case "month": {
      const now = new Date();
      return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    }
    case "custom":
      return from && to && from <= to ? { from, to } : null;
  }
}

/** The resolved range as the query parameters for whichever date this tab is
 *  about. One place, so the list and the CSV export cannot disagree. */
function dateParams(
  field: "placed" | "shipped",
  bounds: { from?: string; to?: string },
): Partial<AdminOrderQuery> {
  return field === "shipped"
    ? { shippedFrom: bounds.from, shippedTo: bounds.to }
    : { placedFrom: bounds.from, placedTo: bounds.to };
}

export default function AdminAcceptedOrdersPage() {
  const { locale } = useParams<{ locale: string }>();

  const [tab, setTab] = useState<TabKey>("todo");
  const [division, setDivision] = useState("");
  /* "All dates" is the default rather than "Today", because this screen opens
     as a packing list: everything still to go out, however long it has been
     waiting. A date filter that started narrowed would hide the backlog it
     exists to clear, and hide it silently. */
  const [range, setRange] = useState<RangeKey>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [items, setItems] = useState<AdminOrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  /* Starts true: a load fires on mount, and the first thing this screen
     shows should be the shape of a table, not an empty one. */
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  /* The order numbers currently being shipped, so a row can show that its tick
     has been taken and cannot be ticked a second time while the request is in
     flight. A set rather than one "busy" flag: two parcels can be handed over
     while the first request is still open, and a single flag would lock the
     whole table on the first click. */
  const [shipping, setShipping] = useState<ReadonlySet<string>>(new Set());
  const [justShipped, setJustShipped] = useState<string[]>([]);

  const activeTab = TABS.find((t) => t.key === tab)!;
  /* Null while a custom range is half-typed. Nothing is fetched until it is a
     range, and the rows already on screen stay — see resolveRange. */
  const bounds = resolveRange(range, from, to);

  // Reloads on a tab, division or date change as well as on the gate clearing:
  // choosing any of them is the whole point of the screen, and asking someone
  // to press Search after picking one from a dropdown reads as a broken
  // filter. Only the free-text box has a Search button, because there is no
  // moment mid-word where a half-typed name is a filter worth running.
  useEffect(() => {
    if (!bounds) return;
    void load(tab, division, q, bounds, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, division, range, from, to]);

  async function load(
    activeKey: TabKey,
    activeDivision: string,
    query: string,
    dates: { from?: string; to?: string },
    pageNumber: number,
  ) {
    const active = TABS.find((t) => t.key === activeKey)!;

    setError(null);
    setExported(false);
    setJustShipped([]);
    setLoading(true);
    /* Cleared so a refetch shows the skeleton rather than the previous tab's
       rows with a spinner somewhere near them. */
    setItems([]);
    try {
      const list = await listAdminOrders({
        status: [...active.statuses],
        division: activeDivision || undefined,
        q: query || undefined,
        ...dateParams(active.dateField, dates),
        page: pageNumber,
      });
      setItems(list.items);
      setTotal(list.total);
      setTotalPages(list.totalPages);
      setPage(list.page);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not load accepted orders.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Hand one parcel to the courier.
   *
   * `advance` rather than two requests, because SHIPPED is two moves away from
   * an order that has not been marked picked yet (PAYMENT_CONFIRMED →
   * PROCESSING → SHIPPED) and the panel is the wrong place to know that. The
   * API walks the route in one transaction and writes a history row for each
   * step, so the customer's tracking page shows every earlier stage complete
   * rather than a gap where the picking should be.
   *
   * The row is removed from the list on success rather than the page being
   * reloaded. This tab is "what is still to go out", the order is no longer
   * that, and a reload would also throw away the other ticks someone is part
   * way through making. The count is decremented with it so the heading does
   * not contradict the table.
   */
  async function ship(order: AdminOrderSummary) {
    if (shipping.has(order.orderNumber)) return;

    setError(null);
    setShipping((current) => new Set(current).add(order.orderNumber));

    try {
      // A note, rather than letting the API fall back to "Set to SHIPPED by
      // <staff email>". That fallback is written for the audit log's reader,
      // but the status history is also the customer's tracking page — so the
      // default would print a staff member's address to whoever placed the
      // order. This says the same thing to the person it is shown to.
      await transitionAdminOrder(order.orderNumber, {
        status: "SHIPPED",
        advance: true,
        note: "Handed to the courier.",
      });

      setItems((current) => current.filter((row) => row.orderNumber !== order.orderNumber));
      setTotal((current) => Math.max(0, current - 1));
      setJustShipped((current) => [...current, order.orderNumber]);
    } catch (err) {
      // The tick is left un-ticked, which is the honest rendering: the order
      // is still where it was. The row stays put so it can be tried again.
      setError(
        err instanceof AdminApiError
          ? `${order.orderNumber}: ${err.message}`
          : `Could not mark ${order.orderNumber} as shipped.`,
      );
    } finally {
      setShipping((current) => {
        const next = new Set(current);
        next.delete(order.orderNumber);
        return next;
      });
    }
  }

  /**
   * The whole filtered set as Pathao's bulk-order CSV — every order in this
   * tab bound for the chosen division, not the twenty-five on screen. The
   * filters go to the server unchanged, so what downloads is what the heading
   * counts.
   */
  async function exportPathao() {
    setExporting(true);
    setError(null);
    setExported(false);
    try {
      await downloadPathaoOrdersCsv({
        status: [...activeTab.statuses],
        division: division || undefined,
        q: q || undefined,
        ...dateParams(activeTab.dateField, bounds ?? {}),
      });
      setExported(true);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not export these orders.");
    } finally {
      setExporting(false);
    }
  }

  const divisionLabel = bdDivisions.find((d) => d.value === division)?.label;
  const noun = tab === "shipped" ? "shipped" : "accepted";

  /**
   * The active range as a clause for the heading and the empty state.
   *
   * Written out rather than left to the highlighted preset, because the two
   * sentences it joins are the ones that would otherwise mislead: a count with
   * no range reads as the whole shop, and "No accepted orders yet" under a
   * date filter reads as an empty shop rather than an empty Tuesday.
   */
  const rangeLabel = (() => {
    if (!bounds?.from || !bounds.to) return "";

    const verb = activeTab.dateField === "shipped" ? "shipped" : "placed";
    if (bounds.from === bounds.to) return ` ${verb} on ${bounds.from}`;
    return ` ${verb} between ${bounds.from} and ${bounds.to}`;
  })();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h2 text-ink font-serif">Accepted Orders</h1>
        <p className="text-13.5 text-secondary mt-1">
          {total} {noun} {total === 1 ? "order" : "orders"}
          {divisionLabel ? ` bound for ${divisionLabel} division` : " across every division"}
          {rangeLabel}.
        </p>
      </div>

      {/* Same tab treatment as /admin/orders, so the two order screens read
            as one place with two questions rather than two designs. */}
      <div className="border-rule flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={t.key === tab ? "page" : undefined}
            className={`text-13.5 -mb-px border-b-2 px-4 py-2.5 transition-colors ${
              t.key === tab
                ? "border-clay text-ink"
                : "text-secondary hover:text-ink border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Its own row above the other filters, and first, because it is the
            widest cut: division narrows a day's work, the date chooses which
            day's work is being looked at at all. The label carries the tab's
            noun — Placed or Shipped — so the control says which date it means
            rather than leaving that to be inferred from the tab. */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption tracking-eyebrow text-muted mr-1 uppercase">
            {activeTab.dateNoun}
          </span>
          {DATE_RANGES.map((option) => {
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

        {/* Two dates rather than one, and a single day is both of them set to
              it — which is what picking the same date twice already means.
              A separate "one day" mode would be a second control for a case
              this one covers, and the Today preset covers the common one. */}
        {range === "custom" ? (
          <div className="text-13.5 text-secondary flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              From
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => setFrom(event.target.value)}
                className="rounded-control border-rule bg-page text-13.5 text-ink border px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2">
              To
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
                className="rounded-control border-rule bg-page text-13.5 text-ink border px-2 py-1"
              />
            </label>
            {/* Says why nothing has changed. Until both ends are set the table
                  still shows the last range that made sense, and without this
                  line that reads as a filter that has stopped working. */}
            {!bounds ? (
              <span className="text-clay">
                {from && to
                  ? "The start date must not be after the end date."
                  : "Pick both dates to filter. For a single day, pick it twice."}
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-caption tracking-eyebrow text-muted uppercase">Division</span>
          <select
            value={division}
            onChange={(event) => setDivision(event.target.value)}
            className="rounded-control border-rule bg-surface text-13.5 text-ink border px-3 py-2"
          >
            <option value="">All divisions</option>
            {bdDivisions.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load(tab, division, q, bounds ?? {}, 1);
          }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Order number (40718), name, email, phone…"
            className="rounded-control border-rule bg-surface text-13.5 text-ink w-full min-w-[16rem] border px-3 py-2"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {/* Sits after the search box rather than up beside the heading: it
              acts on the filters to its left, and the manifest you want is
              almost always the one you have just narrowed down to.

              Named rather than an icon on its own. "Export" alone would not
              say which courier's format this is, and the file is only useful
              to the person who already knows the answer to that.

              Disabled while a custom range is half-typed as well as on an
              empty table: the rows on screen are the last range that
              resolved, and an export sent without dates would be a file that
              does not match the table above it. */}
        <Button
          type="button"
          variant="secondary"
          loading={exporting}
          loadingLabel="Preparing…"
          disabled={items.length === 0 || !bounds}
          onClick={() => void exportPathao()}
          leading={
            <svg
              viewBox="0 0 20 20"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M10 3v9m0 0 3-3m-3 3-3-3M3.5 14v1.5A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5V14" />
            </svg>
          }
        >
          Pathao Export
        </Button>
      </div>

      {error ? <p className="text-13.5 text-clay-deep">{error}</p> : null}

      {/* Says where the rows went, because they vanished. Without this, a
            tick that is working and a tick that silently deleted the wrong row
            look identical. */}
      {justShipped.length > 0 ? (
        <p className="text-13.5 text-secondary">
          Marked {justShipped.length} {justShipped.length === 1 ? "order" : "orders"} shipped —{" "}
          <span className="font-mono">{justShipped.join(", ")}</span>. They are on the{" "}
          <button
            type="button"
            onClick={() => setTab("shipped")}
            className="text-clay hover:text-clay-deep underline"
          >
            Shipped
          </button>{" "}
          tab now, and the customer&rsquo;s tracking page shows every earlier stage complete.
        </p>
      ) : null}

      {/* Zone and area are both guessed from each address — an order carries
            a district and one line of free text, and neither of Pathao's two
            finer levels of geography is among them (see pathao-export.ts).
            Saying so here is what keeps a guess from passing as a lookup. */}
      {exported ? (
        <p className="text-13.5 text-secondary">
          Downloaded {total} {total === 1 ? "order" : "orders"}. Check the{" "}
          <span className="font-mono">RecipientZone</span> and{" "}
          <span className="font-mono">RecipientArea</span> columns before uploading — both are read
          from each address, not stored with the order. Bangla is written in Latin letters, because
          Pathao&rsquo;s importer cannot read it otherwise.
        </p>
      ) : null}

      <div className="rounded-container border-rule bg-surface overflow-x-auto border">
        <table className="text-13.5 w-full min-w-[880px] text-left">
          <thead>
            <tr className="border-rule-strong text-caption text-muted border-b uppercase">
              {activeTab.shippable ? (
                <th scope="col" className="w-12 px-4 py-3 font-medium">
                  {/* Visible header text rather than a select-all box. The
                        column is one-per-order on purpose: ticking twenty
                        parcels from one control is a mis-click that puts
                        twenty unpacked orders on the van, and there is no
                        transition back from SHIPPED. */}
                  Ship
                </th>
              ) : null}
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">District</th>
              <th className="px-4 py-3 font-medium">Placed</th>
              <th className="px-4 py-3 font-medium">Payment</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? <AdminTableRows columns={9} /> : null}
            {items.map((order) => (
              <tr key={order.orderNumber} className="border-rule border-b last:border-0">
                {activeTab.shippable ? (
                  <td className="px-4 py-3">
                    {/* A checkbox, because the action it stands for is a
                          fact about the parcel — it is with the courier — and
                          a tick is how that gets recorded on a paper manifest.
                          It never un-ticks: the row leaves this tab on success,
                          and SHIPPED has no way back through the machine, so a
                          control that could be cleared would be lying about
                          what it can undo. */}
                    <input
                      type="checkbox"
                      checked={shipping.has(order.orderNumber)}
                      disabled={shipping.has(order.orderNumber)}
                      onChange={() => void ship(order)}
                      aria-label={`Mark ${order.orderNumber} as shipped`}
                      className="accent-clay size-4 cursor-pointer disabled:cursor-wait"
                    />
                  </td>
                ) : null}
                <td className="text-ink px-4 py-3 font-mono">{order.orderNumber}</td>
                <td className="px-4 py-3">
                  <span className="text-ink block">{order.customerName}</span>
                  <span className="text-caption text-muted">{order.customerPhone}</span>
                </td>
                <td className="text-secondary px-4 py-3">{order.city}</td>
                <td className="text-secondary px-4 py-3">
                  {new Date(order.placedAt).toLocaleString()}
                </td>
                <td className="text-secondary px-4 py-3">
                  {order.paymentProvider ?? order.paymentMethod}
                </td>
                <td className="text-ink px-4 py-3">
                  {formatMoney(order.totalCents, "en-GB", order.currency)}
                </td>
                <td className="text-secondary px-4 py-3">{order.status}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/${locale}/admin/orders/${order.orderNumber}`}
                    className="text-clay hover:text-clay-deep"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td
                  colSpan={activeTab.shippable ? 9 : 8}
                  className="text-muted px-4 py-6 text-center"
                >
                  {divisionLabel
                    ? `No ${noun} orders bound for ${divisionLabel} division${rangeLabel}.`
                    : rangeLabel
                      ? `No ${noun} orders${rangeLabel}.`
                      : `No ${noun} orders yet.`}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => void load(tab, division, q, bounds ?? {}, page - 1)}
          >
            Previous
          </Button>
          <span className="text-13.5 text-secondary">
            Page {page} of {totalPages}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => void load(tab, division, q, bounds ?? {}, page + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
