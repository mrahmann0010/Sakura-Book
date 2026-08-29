"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminOrderSummary, OrderStatus } from "@sakura/contracts";

import { AdminShell } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui";
import { bdDivisions } from "@/lib/bd-geo";
import { AdminApiError, listAdminOrders } from "@/lib/api/admin";
import { formatMoney } from "@/lib/money";
import { useAdminGate } from "@/lib/use-admin-gate";

/* --------------------------------------------------------------------------
   Accepted orders, by division.

   Deliberately a second screen rather than another control on /admin/orders.
   That page is the triage queue — pending first, one tab per outcome, opened
   to decide what to do with an order. This one answers a different question,
   asked by a different person on a different day: what is going out to Sylhet
   this week. Filtering by destination only makes sense once the accept/reject
   decision is behind you, so the status set is fixed here rather than offered
   as a tab.

   "Accepted" is the same status set the Accepted tab uses — everything past
   the pending decision and not cancelled — kept as one constant so the two
   screens cannot come to disagree about what the word means.

   The division filter is applied by the API (see admin-order.query.ts), not
   here: an order stores its district, the division→district mapping lives in
   @sakura/contracts, and filtering a single page of twenty-five rows in the
   browser would filter the page rather than the result set.
   -------------------------------------------------------------------------- */

const ACCEPTED_STATUSES = [
  "PAYMENT_CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
] as const satisfies readonly OrderStatus[];

export default function AdminAcceptedOrdersPage() {
  const { checking } = useAdminGate();
  const { locale } = useParams<{ locale: string }>();

  const [division, setDivision] = useState("");
  const [items, setItems] = useState<AdminOrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reloads on a division change as well as on the gate clearing: choosing a
  // division is the whole point of the screen, and asking someone to press
  // Search after picking one from a dropdown reads as a broken filter.
  useEffect(() => {
    if (checking) return;
    void load(division, q, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, division]);

  async function load(activeDivision: string, query: string, pageNumber: number) {
    setError(null);
    try {
      const list = await listAdminOrders({
        status: [...ACCEPTED_STATUSES],
        division: activeDivision || undefined,
        q: query || undefined,
        page: pageNumber,
      });
      setItems(list.items);
      setTotal(list.total);
      setTotalPages(list.totalPages);
      setPage(list.page);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not load accepted orders.");
    }
  }

  const divisionLabel = bdDivisions.find((d) => d.value === division)?.label;

  return (
    <AdminShell checking={checking}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-h2 text-ink font-serif">Accepted Orders</h1>
          <p className="text-13.5 text-secondary mt-1">
            {total} accepted {total === 1 ? "order" : "orders"}
            {divisionLabel ? ` bound for ${divisionLabel} division` : " across every division"}.
          </p>
        </div>

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
              void load(division, q, 1);
            }}
            className="flex gap-2"
          >
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search by order number, name, email, phone…"
              className="rounded-control border-rule bg-surface text-13.5 text-ink w-full min-w-[16rem] border px-3 py-2"
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
        </div>

        {error ? <p className="text-13.5 text-clay-deep">{error}</p> : null}

        <div className="rounded-container border-rule bg-surface overflow-x-auto border">
          <table className="text-13.5 w-full min-w-[880px] text-left">
            <thead>
              <tr className="border-rule text-caption text-muted border-b uppercase">
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
              {items.map((order) => (
                <tr key={order.orderNumber} className="border-rule/60 border-b">
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
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-muted px-4 py-6 text-center">
                    {divisionLabel
                      ? `No accepted orders bound for ${divisionLabel} division.`
                      : "No accepted orders yet."}
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
              onClick={() => void load(division, q, page - 1)}
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
              onClick={() => void load(division, q, page + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}
