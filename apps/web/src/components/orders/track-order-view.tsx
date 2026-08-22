"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { Order, OrderStatus } from "@sakura/contracts";

import { OrderProgress, type OrderProgressStep } from "@/components/domain";
import { Button, Card, Input, Notice, OrderId, StatusPill } from "@/components/ui";
import { Shell } from "@/components/layout";
import { formatMoney } from "@/lib/money";
import { lookupOrder } from "@/lib/api/orders";

/* --------------------------------------------------------------------------
   Track order — no accounts, and no order-ID-plus-email pairing either. Any
   one of order ID, email, or phone is enough: an order ID goes straight to
   that one order, while email/phone return every order matching either one,
   since a returning customer may have placed more than one.

   The real OrderStatus is 7-valued; OrderProgress only knows three forward
   stages (placed/verified/shipped) and cancelled/refunded is a StatusPill,
   not a fourth stage — toOrderProgressStep returns null for those two.
   -------------------------------------------------------------------------- */

function toOrderProgressStep(status: OrderStatus): OrderProgressStep | null {
  switch (status) {
    case "PENDING":
      return "placed";
    case "PAYMENT_CONFIRMED":
    case "PROCESSING":
      return "verified";
    case "SHIPPED":
    case "DELIVERED":
      return "shipped";
    case "CANCELLED":
    case "REFUNDED":
      return null;
  }
}

/** Latest timeline entry per display stage, so a later status (e.g.
    DELIVERED after SHIPPED) overwrites the earlier one mapped to the same stage. */
function progressDetail(order: Order): Partial<Record<OrderProgressStep, ReactNode>> {
  const detail: Partial<Record<OrderProgressStep, ReactNode>> = {};

  for (const event of order.timeline) {
    const step = toOrderProgressStep(event.status);
    if (!step) continue;

    const when = new Date(event.occurredAt).toLocaleString();
    detail[step] = event.note ? `${when} — ${event.note}` : when;
  }

  if (order.status === "SHIPPED") {
    detail.shipped = (
      <>
        <span className="block">{detail.shipped}</span>
        <span className="block">Arriving in 4-5 working days.</span>
      </>
    );
  } else if (order.status === "DELIVERED") {
    detail.shipped = (
      <>
        <span className="block">{detail.shipped}</span>
        <span className="text-ink block font-medium">Delivered.</span>
      </>
    );
  }

  return detail;
}

/** The most recent timeline note — the reason a cancelled/refunded order shows one. */
function lastNote(order: Order): string | null {
  for (let i = order.timeline.length - 1; i >= 0; i--) {
    const note = order.timeline[i].note;
    if (note) return note;
  }
  return null;
}

/** Short status word for the picker list — the same three-stage vocabulary
    the progress bar uses, plus the two terminal states it doesn't draw. */
function pickerStatusLabel(status: OrderStatus): string {
  const step = toOrderProgressStep(status);
  if (step === "placed") return "Placed";
  if (step === "verified") return "Verified";
  if (step === "shipped") return status === "DELIVERED" ? "Delivered" : "Shipped";
  return status === "CANCELLED" ? "Cancelled" : "Refunded";
}

export function TrackOrderView() {
  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [results, setResults] = useState<Order[] | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = orderId.trim() || email.trim() || phone.trim();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setResults(null);
    setSelected(null);
    setLoading(true);

    try {
      const orders = await lookupOrder({ orderNumber: orderId, email, phone });
      setResults(orders);
      setSelected(orders.length === 1 ? orders[0] : null);
    } catch {
      setError("Something went wrong looking up your order. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  const step = selected ? toOrderProgressStep(selected.status) : null;

  return (
    <Shell className="max-w-measure py-14 lg:py-20">
      <p className="eyebrow">Track order</p>
      <h1 className="text-36 lg:text-44 text-ink mt-4 font-serif leading-tight">
        Where&apos;s your order?
      </h1>
      <p className="text-body mt-5">
        Enter your order ID, or the email or phone number you ordered with — whichever you have.
      </p>

      <form onSubmit={(event) => void handleSubmit(event)} className="mt-8 flex flex-col gap-5">
        <Input
          label="Order ID"
          placeholder="e.g. MG-40718"
          value={orderId}
          onChange={(event) => setOrderId(event.target.value)}
        />
        <Input
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label="Phone"
          type="tel"
          placeholder="01XXXXXXXXX"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        <Button
          type="submit"
          className="self-start"
          disabled={!canSubmit}
          loading={loading}
          loadingLabel="Searching"
        >
          Track order
        </Button>
      </form>

      {error ? (
        <Notice tone="error" className="mt-8">
          {error}
        </Notice>
      ) : null}

      {results && results.length === 0 ? (
        <Notice tone="error" className="mt-8">
          We couldn&apos;t find any orders matching that. Double-check what you entered and try
          again.
        </Notice>
      ) : null}

      {results && results.length > 1 ? (
        <Card variant="tint" padding="roomy" className="mt-10">
          <p className="eyebrow">{results.length} orders found</p>
          <ul className="mt-4 flex flex-col gap-1">
            {results.map((order) => (
              <li key={order.orderNumber}>
                <button
                  type="button"
                  onClick={() => setSelected(order)}
                  className={`hairline flex w-full items-center justify-between gap-4 py-3 text-left transition-colors ${
                    selected?.orderNumber === order.orderNumber ? "text-ink" : "text-secondary hover:text-ink"
                  }`}
                >
                  <span>
                    <OrderId>{order.orderNumber}</OrderId>
                    <span className="text-caption text-muted ml-3">
                      {new Date(order.placedAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span className="text-13.5 flex items-center gap-4">
                    {pickerStatusLabel(order.status)}
                    <span>{formatMoney(order.totalCents, "en-GB", order.currency)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {selected ? (
        <Card variant="tint" padding="roomy" className="mt-10">
          <p className="eyebrow">Order</p>
          <OrderId className="mt-2.5 block">{selected.orderNumber}</OrderId>

          {step ? (
            <OrderProgress status={step} detail={progressDetail(selected)} className="mt-9" />
          ) : (
            <div className="mt-9">
              <StatusPill status="cancelled">
                {selected.status === "REFUNDED" ? "Refunded" : "Cancelled"}
              </StatusPill>
              {lastNote(selected) ? <p className="text-body mt-3">{lastNote(selected)}</p> : null}
            </div>
          )}
        </Card>
      ) : null}
    </Shell>
  );
}
