"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminOrderSummary, OrderStatus } from "@sakura/contracts";

import { AdminShell } from "@/components/admin/admin-shell";
import { PaymentSafetyBadges } from "@/components/admin/payment-safety";
import { Button } from "@/components/ui";
import { AdminApiError, listAdminOrders } from "@/lib/api/admin";
import { formatMoney } from "@/lib/money";
import { useAdminGate } from "@/lib/use-admin-gate";

/* --------------------------------------------------------------------------
   Pending / Accepted / Rejected are views over the same `status[]` filter —
   not three endpoints, not three DB states. Accepting or rejecting a pending
   order just moves its status, and the order stops matching this tab's query
   on the next load; there is no separate "move to accepted" bookkeeping.
   -------------------------------------------------------------------------- */

const TABS = [
  { key: "pending", label: "Pending", statuses: ["PENDING"] },
  {
    key: "accepted",
    label: "Accepted",
    statuses: ["PAYMENT_CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"],
  },
  { key: "rejected", label: "Rejected", statuses: ["CANCELLED", "REFUNDED"] },
] as const satisfies readonly { key: string; label: string; statuses: OrderStatus[] }[];

type TabKey = (typeof TABS)[number]["key"];

export default function AdminOrdersPage() {
  const { checking } = useAdminGate();
  const { locale } = useParams<{ locale: string }>();

  const [tab, setTab] = useState<TabKey>("pending");
  const [items, setItems] = useState<AdminOrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (checking) return;
    void load(tab, "", 1);
  }, [checking, tab]);

  async function load(activeTab: TabKey, query: string, pageNumber: number) {
    setError(null);
    try {
      const statuses = TABS.find((t) => t.key === activeTab)!.statuses;
      const list = await listAdminOrders({
        status: statuses,
        q: query || undefined,
        page: pageNumber,
      });
      setItems(list.items);
      setTotal(list.total);
      setTotalPages(list.totalPages);
      setPage(list.page);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not load orders.");
    }
  }

  return (
    <AdminShell checking={checking}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-h2 text-ink font-serif">Orders</h1>
          <p className="text-13.5 text-secondary mt-1">{total} in this view.</p>
        </div>

        <div className="border-rule flex gap-1 border-b">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`text-13.5 -mb-px border-b-2 px-4 py-2 transition-colors ${
                tab === t.key
                  ? "border-clay text-ink font-medium"
                  : "text-secondary hover:text-ink border-transparent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load(tab, q, 1);
          }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search by order number, name, email, phone…"
            className="rounded-control border-rule bg-surface text-13.5 text-ink w-full max-w-sm border px-3 py-2"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {error ? <p className="text-13.5 text-clay-deep">{error}</p> : null}

        <div className="rounded-container border-rule bg-surface overflow-x-auto border">
          <table className="text-13.5 w-full min-w-[940px] text-left">
            <thead>
              <tr className="border-rule text-caption text-muted border-b uppercase">
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Placed</th>
                <th className="px-4 py-3 font-medium">Payment</th>
                {/* Next to the payment method, not at the end of the row: a
                    duplicate receipt is a fact about the payment, and a badge
                    parked past the total is one nobody scans on a busy
                    morning. */}
                <th className="px-4 py-3 font-medium">Receipt</th>
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
                    <span className="text-caption text-muted">{order.customerEmail}</span>
                  </td>
                  <td className="text-secondary px-4 py-3">
                    {new Date(order.placedAt).toLocaleString()}
                  </td>
                  <td className="text-secondary px-4 py-3">
                    {order.paymentProvider ?? order.paymentMethod}
                  </td>
                  <td className="px-4 py-3">
                    <PaymentSafetyBadges
                      receipt={order.receipt}
                      verification={order.verification}
                    />
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
                    No orders in this view.
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
              onClick={() => void load(tab, q, page - 1)}
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
              onClick={() => void load(tab, q, page + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}
