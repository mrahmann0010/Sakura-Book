"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AdminOrderDetail, AdminOrderSummary, AdminPickList } from "@sakura/contracts";

import { AdminTableRows } from "@/components/admin/skeletons";
import { Button } from "@/components/ui";
import { bdDivisions } from "@/lib/bd-geo";
import {
  AdminApiError,
  getAdminOrder,
  getAdminPickList,
  listAdminOrders,
  transitionAdminOrder,
} from "@/lib/api/admin";
import { formatMoney } from "@/lib/money";
import { fileUrl } from "@/lib/storage-url";

/* --------------------------------------------------------------------------
   The packing table: pick, then pack.

   Its own screen rather than a tab on Processing, because the two answer
   different questions at different moments. Processing is a list for scanning
   many parcels at once: which division, which day, what goes on the van. This
   screen is about one parcel at a time: which books go in this box, and did
   they all go in.

   Two parts, in the order the work happens:

   1. The pick list — copies needed per title across everything waiting, so the
      shelf is cleared in one walk instead of once per order. Clicking a title
      narrows the queue to the orders that need it.
   2. The pack queue — one order open at a time, oldest first, with a tick per
      book. "Mark packed" stays off until every book is ticked, because that
      check is the point of the screen: it is what stops a parcel going out a
      book short.

   Marking packed moves the order PAYMENT_CONFIRMED → PROCESSING, which the
   customer's tracking page already shows as "packed". Processing then only
   lets packed orders be ticked as shipped.
   -------------------------------------------------------------------------- */

/** The oldest hundred, the API's ceiling. More than a day's packing. */
const QUEUE_SIZE = 100;

const TO_PACK = ["PAYMENT_CONFIRMED"] as const;

export default function AdminPackingPage() {
  const { locale } = useParams<{ locale: string }>();

  const [division, setDivision] = useState("");
  const [q, setQ] = useState("");
  const [bookFilter, setBookFilter] = useState<{ bookId: string; title: string } | null>(null);

  const [queue, setQueue] = useState<AdminOrderSummary[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [pickList, setPickList] = useState<AdminPickList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickListOpen, setPickListOpen] = useState(true);

  const [activeNumber, setActiveNumber] = useState<string | null>(null);
  const [active, setActive] = useState<AdminOrderDetail | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);
  /* Which lines of the open order have been ticked, by index. Reset whenever
     another order is opened: a tick means "this book is in this box", and it
     cannot carry over to a different box. */
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  const [packing, setPacking] = useState(false);
  const [packedToday, setPackedToday] = useState<string[]>([]);

  /* The order number the latest detail request was for. A slow response for an
     order the packer has already moved past must not replace the one on screen. */
  const latestRequest = useRef<string | null>(null);

  /* The search the queue was last loaded with — set on submit, not on every
     keystroke — and a counter so pressing Search again reloads even when the
     text has not changed. */
  const [submittedQ, setSubmittedQ] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  function open(orderNumber: string | null) {
    // Already open (or opening). A failed open is retried by clicking again.
    if (
      orderNumber !== null &&
      orderNumber === latestRequest.current &&
      (active || activeLoading)
    ) {
      return;
    }

    setActiveNumber(orderNumber);
    setChecked(new Set());
    setActive(null);
    latestRequest.current = orderNumber;

    if (!orderNumber) {
      setActiveLoading(false);
      return;
    }

    setActiveLoading(true);

    getAdminOrder(orderNumber)
      .then((detail) => {
        if (latestRequest.current === orderNumber) setActive(detail);
      })
      .catch((err) => {
        if (latestRequest.current !== orderNumber) return;
        setError(
          err instanceof AdminApiError ? err.message : `Could not open order ${orderNumber}.`,
        );
      })
      .finally(() => {
        if (latestRequest.current === orderNumber) setActiveLoading(false);
      });
  }

  /* Loads the queue and the pick list together whenever a filter changes.
     State is only set when the requests come back; whoever changed the filter
     has already set `loading` (see `reload`). */
  useEffect(() => {
    let cancelled = false;

    const filters = {
      status: [...TO_PACK],
      division: division || undefined,
      q: submittedQ || undefined,
    };

    /* The pick list ignores the book filter on purpose: it is the menu the
       filter is chosen from, and narrowing it to one title would hide the
       others the moment one is clicked. */
    Promise.all([
      listAdminOrders({
        ...filters,
        bookId: bookFilter?.bookId,
        sort: "oldest",
        page: 1,
        pageSize: QUEUE_SIZE,
      }),
      getAdminPickList(filters),
    ])
      .then(([list, picks]) => {
        if (cancelled) return;

        setQueue(list.items);
        setQueueTotal(list.total);
        setPickList(picks);
        setLoading(false);

        // Keep the open order if it is still in the queue; otherwise open the
        // oldest, so the screen always has a parcel ready to pack.
        const current = latestRequest.current;
        const stillThere = list.items.some((order) => order.orderNumber === current);
        if (!stillThere) open(list.items[0]?.orderNumber ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof AdminApiError ? err.message : "Could not load the packing queue.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `open` only touches state setters and a ref, so it is safe to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [division, bookFilter, submittedQ, reloadToken]);

  /** Mark the screen as loading, then apply whatever filter change caused it. */
  function reload(apply: () => void) {
    setError(null);
    setLoading(true);
    apply();
  }

  function toggle(index: number) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  /**
   * Record the parcel as packed and open the next one.
   *
   * The order leaves the queue on success instead of the whole screen being
   * reloaded, so the packer keeps their place. The pick list is refreshed in
   * the background, because its counts just went down.
   */
  async function markPacked() {
    if (!active || packing) return;

    const orderNumber = active.orderNumber;
    setPacking(true);
    setError(null);

    try {
      // The note is shown on the customer's tracking page, so it is written
      // for them rather than naming the staff member.
      await transitionAdminOrder(orderNumber, {
        status: "PROCESSING",
        note: "Packed and ready for the courier.",
      });

      const index = queue.findIndex((order) => order.orderNumber === orderNumber);
      const remaining = queue.filter((order) => order.orderNumber !== orderNumber);
      const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)];

      setQueue(remaining);
      setQueueTotal((current) => Math.max(0, current - 1));
      setPackedToday((current) => [orderNumber, ...current]);
      open(next?.orderNumber ?? null);

      void getAdminPickList({
        status: [...TO_PACK],
        division: division || undefined,
        q: submittedQ || undefined,
      })
        .then(setPickList)
        .catch(() => {
          /* A stale pick list is a nuisance, not a wrong parcel. The next
             load corrects it. */
        });
    } catch (err) {
      setError(
        err instanceof AdminApiError
          ? `${orderNumber}: ${err.message}`
          : `Could not mark ${orderNumber} as packed.`,
      );
    } finally {
      setPacking(false);
    }
  }

  const divisionLabel = bdDivisions.find((d) => d.value === division)?.label;
  const allChecked = active
    ? active.lines.length > 0 && checked.size === active.lines.length
    : false;
  const copiesInActive = active?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      {/* When printing, only the slip is printed. The slip is portalled to
            <body> (see PackingSlip), so every other child of <body> — the
            whole panel — can be taken out of the layout with display: none,
            leaving no blank pages behind it. */}
      <style>{`
        @media print {
          body > *:not(.packing-slip) { display: none !important; }
        }
      `}</style>

      <div>
        <h1 className="text-h2 text-ink font-serif">Packing</h1>
        <p className="text-13.5 text-secondary mt-1">
          {queueTotal} {queueTotal === 1 ? "order" : "orders"} to pack
          {pickList ? (
            <>
              , {pickList.totalCopies} {pickList.totalCopies === 1 ? "copy" : "copies"}
            </>
          ) : null}
          {divisionLabel ? ` bound for ${divisionLabel} division` : ""}
          {bookFilter ? ` with ${bookFilter.title}` : ""}.
          {packedToday.length > 0
            ? ` You've packed ${packedToday.length} on this visit; they're on Processing, ready to ship.`
            : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-caption tracking-eyebrow text-muted uppercase">Division</span>
          <select
            value={division}
            onChange={(event) => {
              const value = event.target.value;
              reload(() => setDivision(value));
            }}
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
            reload(() => {
              setSubmittedQ(q.trim());
              setReloadToken((token) => token + 1);
            });
          }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Order number (40718), name, phone…"
            className="rounded-control border-rule bg-surface text-13.5 text-ink w-full min-w-[16rem] border px-3 py-2"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </div>

      {error ? <p className="text-13.5 text-clay-deep">{error}</p> : null}

      {/* ------------------------------------------------------------ Pick list */}
      <section className="rounded-container border-rule bg-surface border">
        <button
          type="button"
          onClick={() => setPickListOpen((value) => !value)}
          aria-expanded={pickListOpen}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span>
            <span className="text-h4 text-ink font-serif">Pick list</span>
            <span className="text-13.5 text-secondary ml-3">
              Take these off the shelf before you start
            </span>
          </span>
          <span className="text-13.5 text-clay">{pickListOpen ? "Hide" : "Show"}</span>
        </button>

        {pickListOpen ? (
          <div className="border-rule overflow-x-auto border-t">
            <table className="text-13.5 w-full min-w-[520px] text-left">
              <thead>
                <tr className="border-rule-strong text-caption text-muted border-b uppercase">
                  <th className="px-4 py-2.5 font-medium">Book</th>
                  <th className="px-4 py-2.5 text-right font-medium">Copies</th>
                  <th className="px-4 py-2.5 text-right font-medium">Orders</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {loading && !pickList ? <AdminTableRows columns={4} rows={4} /> : null}
                {pickList?.entries.map((entry) => {
                  const selected = bookFilter && entry.bookId === bookFilter.bookId;
                  return (
                    <tr
                      key={`${entry.bookId ?? "removed"}-${entry.title}`}
                      className={`border-rule border-b last:border-0 ${selected ? "bg-tint" : ""}`}
                    >
                      <td className="text-ink px-4 py-2.5">{entry.title}</td>
                      <td className="text-ink px-4 py-2.5 text-right text-base font-medium tabular-nums">
                        {entry.copies}
                      </td>
                      <td className="text-secondary px-4 py-2.5 text-right tabular-nums">
                        {entry.orders}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {/* A removed book has no id to filter by. */}
                        {entry.bookId ? (
                          selected ? (
                            <button
                              type="button"
                              onClick={() => reload(() => setBookFilter(null))}
                              className="text-clay hover:text-clay-deep"
                            >
                              Show all orders
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                reload(() =>
                                  setBookFilter({ bookId: entry.bookId!, title: entry.title }),
                                )
                              }
                              className="text-clay hover:text-clay-deep"
                            >
                              Only these orders
                            </button>
                          )
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {!loading && pickList && pickList.entries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-muted px-4 py-5 text-center">
                      Nothing to pick.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {bookFilter ? (
        <p className="text-13.5 text-secondary">
          Showing only orders with <span className="text-ink">{bookFilter.title}</span>.{" "}
          <button
            type="button"
            onClick={() => reload(() => setBookFilter(null))}
            className="text-clay hover:text-clay-deep underline"
          >
            Show all
          </button>
        </p>
      ) : null}

      {/* ----------------------------------------------------------- Pack queue */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section aria-label="Orders to pack" className="flex flex-col gap-2">
          <h2 className="text-caption tracking-eyebrow text-muted uppercase">
            Queue · oldest first
          </h2>

          {loading && queue.length === 0 ? (
            <div className="rounded-container border-rule bg-surface text-13.5 text-muted border px-4 py-6 text-center">
              Loading…
            </div>
          ) : null}

          {!loading && queue.length === 0 ? (
            <div className="rounded-container border-rule bg-surface text-13.5 text-muted border px-4 py-6 text-center">
              {bookFilter || divisionLabel || submittedQ
                ? "No orders to pack match these filters."
                : "Nothing left to pack."}
            </div>
          ) : null}

          <ul className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
            {queue.map((order) => {
              const isActive = order.orderNumber === activeNumber;
              return (
                <li key={order.orderNumber}>
                  <button
                    type="button"
                    onClick={() => open(order.orderNumber)}
                    aria-current={isActive ? "true" : undefined}
                    className={`rounded-container w-full border px-4 py-3 text-left transition-colors ${
                      isActive ? "border-clay bg-tint" : "border-rule bg-surface hover:bg-tint"
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-ink text-13.5 font-mono">{order.orderNumber}</span>
                      <span className="text-caption text-muted tabular-nums">
                        {order.itemCount} {order.itemCount === 1 ? "copy" : "copies"}
                      </span>
                    </span>
                    <span className="text-13.5 text-secondary block">
                      {order.customerName} · {order.city}
                    </span>
                    <span className="text-caption text-ink mt-1 block">
                      {order.lines.map((line) => `${line.title} ×${line.quantity}`).join(" · ")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {queueTotal > queue.length ? (
            <p className="text-caption text-muted">
              Showing the oldest {queue.length} of {queueTotal}. Pack these first, or narrow by
              division.
            </p>
          ) : null}
        </section>

        <section aria-label="Order being packed">
          {activeLoading ? (
            <div className="rounded-container border-rule bg-surface text-13.5 text-muted border px-6 py-10 text-center">
              Opening {activeNumber}…
            </div>
          ) : null}

          {!activeLoading && !active && !loading && queue.length > 0 ? (
            <div className="rounded-container border-rule bg-surface text-13.5 text-muted border px-6 py-10 text-center">
              Pick an order from the queue.
            </div>
          ) : null}

          {active ? (
            <PackingCard
              order={active}
              locale={locale}
              checked={checked}
              onToggle={toggle}
              allChecked={allChecked}
              copies={copiesInActive}
              packing={packing}
              onPacked={() => void markPacked()}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   One parcel.
   -------------------------------------------------------------------------- */

function PackingCard({
  order,
  locale,
  checked,
  onToggle,
  allChecked,
  copies,
  packing,
  onPacked,
}: {
  order: AdminOrderDetail;
  locale: string;
  checked: ReadonlySet<number>;
  onToggle: (index: number) => void;
  allChecked: boolean;
  copies: number;
  packing: boolean;
  onPacked: () => void;
}) {
  const cod = order.paymentMethod === "cash-on-delivery";
  const total = formatMoney(order.totalCents, "en-GB", order.currency);

  return (
    <div className="rounded-container border-rule bg-surface flex flex-col gap-5 border p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-h3 text-ink font-mono">{order.orderNumber}</p>
          <p className="text-13.5 text-secondary">
            Placed {new Date(order.placedAt).toLocaleString()}
          </p>
        </div>
        {/* The amount the courier collects is the one money fact a packer
              needs, and it goes on the label — so it is large, and only shown
              when there is something to collect. */}
        <div className="text-right">
          {cod ? (
            <>
              <p className="text-caption tracking-eyebrow text-muted uppercase">Cash on delivery</p>
              <p className="text-h3 text-ink tabular-nums">{total}</p>
            </>
          ) : (
            <p className="text-13.5 text-secondary">Paid · nothing to collect</p>
          )}
        </div>
      </div>

      <div className="text-13.5 grid gap-1">
        <p className="text-ink font-medium">{order.shipping.fullName}</p>
        <p className="text-secondary">
          {order.shipping.phone}
          {order.shipping.secondaryPhone ? ` · ${order.shipping.secondaryPhone}` : ""}
        </p>
        <p className="text-secondary">
          {order.shipping.address}, {order.shipping.city}
        </p>
      </div>

      {order.customerNote ? (
        <p className="rounded-control border-clay bg-tint text-13.5 text-ink border px-3 py-2">
          <span className="text-caption tracking-eyebrow text-muted mr-2 uppercase">
            Customer note
          </span>
          {order.customerNote}
        </p>
      ) : null}
      {order.internalNote ? (
        <p className="rounded-control border-rule bg-tint text-13.5 text-ink border px-3 py-2">
          <span className="text-caption tracking-eyebrow text-muted mr-2 uppercase">
            Internal note
          </span>
          {order.internalNote}
        </p>
      ) : null}

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-caption tracking-eyebrow text-muted uppercase">
            In this parcel · {copies} {copies === 1 ? "copy" : "copies"}
          </h3>
          <span className="text-13.5 text-secondary tabular-nums">
            {checked.size} of {order.lines.length} checked
          </span>
        </div>

        <ul className="flex flex-col gap-2">
          {order.lines.map((line, index) => {
            const isChecked = checked.has(index);
            const cover = fileUrl(line.coverImageUrl);
            return (
              <li key={`${line.bookId ?? "removed"}-${index}`}>
                {/* The whole row is the target, not just the box: this is
                      clicked with one hand while the other holds a book. */}
                <label
                  className={`rounded-control flex cursor-pointer items-center gap-4 border px-4 py-3 transition-colors ${
                    isChecked ? "border-clay bg-tint" : "border-rule hover:bg-tint"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onToggle(index)}
                    className="accent-clay size-5 shrink-0"
                  />
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element -- admin-supplied/external URL
                    <img
                      src={cover}
                      alt=""
                      className="border-rule h-14 w-10 shrink-0 rounded-xs border object-cover"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span
                      className={`text-ink block ${isChecked ? "line-through decoration-1" : ""}`}
                    >
                      {line.title}
                    </span>
                    {line.authors.length > 0 ? (
                      <span className="text-caption text-muted block">
                        {line.authors.join(", ")}
                      </span>
                    ) : null}
                  </span>
                  {/* Large, because "×2" read as "×1" is the commonest way a
                        parcel goes out a book short. */}
                  <span
                    className={`shrink-0 font-mono text-xl tabular-nums ${
                      line.quantity > 1 ? "text-clay-deep font-semibold" : "text-ink"
                    }`}
                  >
                    ×{line.quantity}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={!allChecked}
          loading={packing}
          loadingLabel="Saving…"
          onClick={onPacked}
        >
          Mark packed
        </Button>
        <Button type="button" variant="secondary" onClick={() => window.print()}>
          Print packing slip
        </Button>
        <Link
          href={`/${locale}/admin/orders/${order.orderNumber}`}
          className="text-13.5 text-clay hover:text-clay-deep ml-auto"
        >
          Problem? Open the order and leave a note
        </Link>
      </div>
      {!allChecked ? (
        <p className="text-caption text-muted -mt-2">
          Tick every book as it goes into the box to mark the parcel packed.
        </p>
      ) : null}

      <PackingSlip order={order} total={total} cod={cod} copies={copies} />
    </div>
  );
}

/* --------------------------------------------------------------------------
   The slip that goes in the box.

   Hidden on screen and the only thing printed (see the print rule at the top
   of the page). Plain black on white, no colour that a monochrome printer
   would lose, and no payment detail beyond the amount to collect.
   -------------------------------------------------------------------------- */

function PackingSlip({
  order,
  total,
  cod,
  copies,
}: {
  order: AdminOrderDetail;
  total: string;
  cod: boolean;
  copies: number;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="packing-slip hidden bg-white p-8 font-sans text-black print:block">
      <div className="flex items-start justify-between border-b border-black pb-3">
        <div>
          <p className="text-xs tracking-widest uppercase">Packing slip</p>
          <p className="font-mono text-2xl">{order.orderNumber}</p>
          <p className="text-sm">Placed {new Date(order.placedAt).toLocaleDateString()}</p>
        </div>
        <div className="text-right">
          <p className="text-xs tracking-widest uppercase">
            {cod ? "Collect on delivery" : "Prepaid"}
          </p>
          <p className="text-2xl">{cod ? total : "—"}</p>
        </div>
      </div>

      <div className="mt-4 text-sm">
        <p className="text-base font-semibold">{order.shipping.fullName}</p>
        <p>
          {order.shipping.phone}
          {order.shipping.secondaryPhone ? ` / ${order.shipping.secondaryPhone}` : ""}
        </p>
        <p>
          {order.shipping.address}, {order.shipping.city}
        </p>
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="w-8 py-1.5">✓</th>
            <th className="py-1.5">Book</th>
            <th className="py-1.5 text-right">Qty</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line, index) => (
            <tr key={`${line.bookId ?? "removed"}-${index}`} className="border-b border-black/30">
              <td className="py-1.5">☐</td>
              <td className="py-1.5">{line.title}</td>
              <td className="py-1.5 text-right font-mono">{line.quantity}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td />
            <td className="py-1.5 text-right">Total copies</td>
            <td className="py-1.5 text-right font-mono">{copies}</td>
          </tr>
        </tfoot>
      </table>

      {order.customerNote ? (
        <p className="mt-4 text-sm">
          <span className="font-semibold">Note: </span>
          {order.customerNote}
        </p>
      ) : null}
    </div>,
    document.body,
  );
}
