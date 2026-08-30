"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminOrderSummary, OrderStatus } from "@sakura/contracts";

import { AdminShell } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui";
import { bdDivisions } from "@/lib/bd-geo";
import { AdminApiError, downloadPathaoOrdersCsv, listAdminOrders } from "@/lib/api/admin";
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
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

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
    setExported(false);
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

  /**
   * The whole filtered set as Pathao's bulk-order CSV — every accepted order
   * bound for the chosen division, not the twenty-five on screen. The filters
   * go to the server unchanged, so what downloads is what the heading counts.
   */
  async function exportPathao() {
    setExporting(true);
    setError(null);
    setExported(false);
    try {
      await downloadPathaoOrdersCsv({
        status: [...ACCEPTED_STATUSES],
        division: division || undefined,
        q: q || undefined,
      });
      setExported(true);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not export these orders.");
    } finally {
      setExporting(false);
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

          {/* Sits after the search box rather than up beside the heading: it
              acts on the filters to its left, and the manifest you want is
              almost always the one you have just narrowed down to.

              Named rather than an icon on its own. "Export" alone would not
              say which courier's format this is, and the file is only useful
              to the person who already knows the answer to that. */}
          <Button
            type="button"
            variant="secondary"
            loading={exporting}
            loadingLabel="Preparing…"
            disabled={items.length === 0}
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

        {/* Zone and area are both guessed from each address — an order carries
            a district and one line of free text, and neither of Pathao's two
            finer levels of geography is among them (see pathao-export.ts).
            Saying so here is what keeps a guess from passing as a lookup. */}
        {exported ? (
          <p className="text-13.5 text-secondary">
            Downloaded {total} {total === 1 ? "order" : "orders"}. Check the{" "}
            <span className="font-mono">RecipientZone</span> and{" "}
            <span className="font-mono">RecipientArea</span> columns before uploading — both are
            read from each address, not stored with the order.
          </p>
        ) : null}

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
