"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { Order, OrderStatus } from "@sakura/contracts";

import { OrderStatusTimeline, type OrderStep } from "@/components/domain";
import { Button, Card, Input, Notice, OrderId, StatusPill } from "@/components/ui";
import { Shell } from "@/components/layout";
import { ApiError } from "@/lib/api/client";
import { lookupOrder } from "@/lib/api/orders";

/* --------------------------------------------------------------------------
   Track order — utility shell (Page Skeletons sheet 04): a narrow lookup form
   and, once submitted, the same OrderStatusTimeline the confirmation screen
   uses, now wired to the real GuestOrdersController.lookup endpoint.

   The real OrderStatus is 7-valued; OrderStatusTimeline only knows the four
   forward steps (pending/paid/shipped/delivered) and its own doc comment says
   a cancelled order is a StatusPill, not a fifth step — toOrderStep returns
   null for CANCELLED/REFUNDED so this page can draw that pill instead.
   -------------------------------------------------------------------------- */

function toOrderStep(status: OrderStatus): OrderStep | null {
  switch (status) {
    case "PENDING":
      return "pending";
    case "PAYMENT_CONFIRMED":
    case "PROCESSING":
      return "paid";
    case "SHIPPED":
      return "shipped";
    case "DELIVERED":
      return "delivered";
    case "CANCELLED":
    case "REFUNDED":
      return null;
  }
}

/** Latest timeline entry per display step, so a later status (e.g. PROCESSING
    after PAYMENT_CONFIRMED) overwrites the earlier one mapped to the same step. */
function stepDetail(order: Order): Partial<Record<OrderStep, ReactNode>> {
  const detail: Partial<Record<OrderStep, ReactNode>> = {};

  for (const event of order.timeline) {
    const step = toOrderStep(event.status);
    if (!step) continue;

    const when = new Date(event.occurredAt).toLocaleString();
    detail[step] = event.note ? `${when} — ${event.note}` : when;
  }

  return detail;
}

export function TrackOrderView() {
  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<Order | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotFound(false);
    setResult(null);
    setLoading(true);

    try {
      const order = await lookupOrder({ orderNumber: orderId, email });
      setResult(order);
    } catch (err) {
      if (err instanceof ApiError && err.isNotFound) {
        setNotFound(true);
      } else {
        setError("Something went wrong looking up that order. Try again in a moment.");
      }
    } finally {
      setLoading(false);
    }
  }

  const step = result ? toOrderStep(result.status) : null;

  return (
    <Shell className="max-w-measure py-14 lg:py-20">
      <p className="eyebrow">Track order</p>
      <h1 className="text-36 lg:text-44 text-ink mt-4 font-serif leading-tight">
        Where&apos;s your order?
      </h1>
      <p className="text-body mt-5">
        Enter the order ID from your confirmation email, along with the email address you used.
      </p>

      <form onSubmit={(event) => void handleSubmit(event)} className="mt-8 flex flex-col gap-5">
        <Input
          label="Order ID"
          placeholder="e.g. MG-40718"
          value={orderId}
          onChange={(event) => setOrderId(event.target.value)}
          required
        />
        <Input
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <Button type="submit" className="self-start" loading={loading} loadingLabel="Searching">
          Track order
        </Button>
      </form>

      {notFound ? (
        <Notice tone="error" className="mt-8">
          We couldn&apos;t find an order with that ID and email. Double-check the confirmation email
          and try again.
        </Notice>
      ) : null}

      {error ? (
        <Notice tone="error" className="mt-8">
          {error}
        </Notice>
      ) : null}

      {result ? (
        <Card variant="tint" padding="roomy" className="mt-10">
          <p className="eyebrow">Order</p>
          <OrderId className="mt-2.5 block">{result.orderNumber}</OrderId>

          {step ? (
            <OrderStatusTimeline status={step} detail={stepDetail(result)} className="mt-9" />
          ) : (
            <div className="mt-9">
              <StatusPill status="cancelled" />
              {lastNote(result) ? <p className="text-body mt-3">{lastNote(result)}</p> : null}
            </div>
          )}
        </Card>
      ) : null}
    </Shell>
  );
}

/** The most recent timeline note — the reason a cancelled/refunded order shows one. */
function lastNote(order: Order): string | null {
  for (let i = order.timeline.length - 1; i >= 0; i--) {
    const note = order.timeline[i].note;
    if (note) return note;
  }
  return null;
}
