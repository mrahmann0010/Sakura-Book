import type { ReactNode } from "react";
import type { Order, OrderStatus } from "@sakura/contracts";

import { OrderProgress, type OrderProgressStep } from "@/components/domain";
import { Card, OrderId, StatusPill } from "@/components/ui";

/* --------------------------------------------------------------------------
   One order's status, rendered as a card — the destination of both the
   tracking form's redirect and a direct visit to /orders/[orderNumber].

   The real OrderStatus is 7-valued; OrderProgress only knows three forward
   stages (placed/verified/shipped) and cancelled/refunded is a StatusPill,
   not a fourth stage — toOrderProgressStep returns null for those two.
   -------------------------------------------------------------------------- */

export function toOrderProgressStep(status: OrderStatus): OrderProgressStep | null {
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

export function OrderDetailCard({ order }: { order: Order }) {
  const step = toOrderProgressStep(order.status);

  return (
    <Card variant="tint" padding="roomy" className="mt-10">
      <p className="eyebrow">Order</p>
      <OrderId className="mt-2.5 block">{order.orderNumber}</OrderId>

      {step ? (
        <OrderProgress status={step} detail={progressDetail(order)} className="mt-9" />
      ) : (
        <div className="mt-9">
          <StatusPill status="cancelled">
            {order.status === "REFUNDED" ? "Refunded" : "Cancelled"}
          </StatusPill>
          {lastNote(order) ? <p className="text-body mt-3">{lastNote(order)}</p> : null}
        </div>
      )}
    </Card>
  );
}
