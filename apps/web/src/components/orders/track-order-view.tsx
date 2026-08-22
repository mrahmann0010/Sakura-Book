"use client";

import { useState, type FormEvent } from "react";

import { OrderStatusTimeline, type OrderStep } from "@/components/domain";
import { Button, Card, Input, Notice, OrderId } from "@/components/ui";
import { Shell } from "@/components/layout";

/* --------------------------------------------------------------------------
   Track order — utility shell (Page Skeletons sheet 04): a narrow lookup form
   and, once submitted, the same OrderStatusTimeline the confirmation screen
   uses. There is no lookup API yet, so a submission always resolves to one
   placeholder order rather than a real query — the shape the real result will
   fill is what matters here, not the data.
   -------------------------------------------------------------------------- */

const PLACEHOLDER_ORDER = {
  id: "MG-40718",
  status: "shipped" as OrderStep,
  detail: {
    pending: "12 Aug, 10:04",
    paid: "12 Aug, 10:06",
    shipped: "13 Aug, courier: Evri",
    delivered: "Estimated 16 Aug",
  },
};

export function TrackOrderView() {
  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<typeof PLACEHOLDER_ORDER | null>(null);
  const [notFound, setNotFound] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    /* No backend yet: any input resolves to the placeholder order, except the
       one id it doesn't recognise, kept so the not-found state is reachable. */
    if (orderId.trim().toUpperCase() === "NOTFOUND") {
      setResult(null);
      setNotFound(true);
      return;
    }

    setNotFound(false);
    setResult(PLACEHOLDER_ORDER);
  }

  return (
    <Shell className="max-w-measure py-14 lg:py-20">
      <p className="eyebrow">Track order</p>
      <h1 className="text-36 lg:text-44 text-ink mt-4 font-serif leading-tight">
        Where&apos;s your order?
      </h1>
      <p className="text-body mt-5">
        Enter the order ID from your confirmation email, along with the email address you used.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
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
        <Button type="submit" className="self-start">
          Track order
        </Button>
      </form>

      {notFound ? (
        <Notice tone="error" className="mt-8">
          We couldn&apos;t find an order with that ID and email. Double-check the confirmation email
          and try again.
        </Notice>
      ) : null}

      {result ? (
        <Card variant="tint" padding="roomy" className="mt-10">
          <p className="eyebrow">Order</p>
          <OrderId className="mt-2.5 block">{result.id}</OrderId>

          <OrderStatusTimeline status={result.status} detail={result.detail} className="mt-9" />
        </Card>
      ) : null}
    </Shell>
  );
}
