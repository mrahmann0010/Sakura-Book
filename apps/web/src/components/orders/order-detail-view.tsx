"use client";

import { useQuery } from "@tanstack/react-query";

import { Card, Notice, Skeleton } from "@/components/ui";
import { lookupOrder } from "@/lib/api/orders";

import { OrderDetailCard } from "./order-detail-card";

/* --------------------------------------------------------------------------
   The lookup behind /orders/[orderNumber], run from the browser.

   Deliberately a client component, and for a security reason rather than a
   rendering one. `POST /orders/lookup` carries @StrictThrottle — ten requests
   a minute — and ThrottlerGuard keys that on `req.ip`. Fetched from a server
   component, every customer's lookup arrives from the *Next server's* address,
   so all of them share one bucket: the limit that exists to make order-number
   enumeration slow was counting the wrong thing entirely, and the eleventh
   order page opened in any minute was answered with a 429 that surfaced as a
   500. Issued from the browser, `trust proxy 1` in the API's main.ts resolves
   the real visitor and the limit applies per person, as written.

   This raises the cost of enumeration; it does not end it. Ten a minute across
   many addresses still walks a 90,000-number space eventually, and what sits
   behind a correct guess is a name, an address and a phone number. The real
   fix is for an order number alone to stop being a sufficient credential —
   a signed link, or the email re-entered on a cold visit. That is a product
   decision and not this component's to make.
   -------------------------------------------------------------------------- */

export function OrderDetailView({ orderNumber }: { orderNumber: string }) {
  const {
    data: order,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["order", orderNumber],
    queryFn: async () => (await lookupOrder({ orderNumber }))[0] ?? null,
    /* Never served from cache across mounts: a customer refreshing this page
       is asking whether an admin action has landed since, and a remembered
       "still pending" is the one answer that is actively wrong here. */
    staleTime: 0,
    /* One retry, not the default three. A 429 is the plausible failure now
       that the limit is per-visitor, and retrying into a rate limit is how a
       client turns a slow minute into a blocked one. */
    retry: 1,
  });

  if (isPending) return <OrderDetailSkeleton />;

  /* Both misses read the same on purpose — see OrdersService.lookup. A wrong
     order number returns an empty list rather than a 404, so that a guess
     never learns whether it was close. Splitting "no such order" from "lookup
     failed" here would hand back the distinction the API declines to give. */
  if (isError || !order) {
    return (
      <Notice tone="error" className="mt-10">
        We couldn&apos;t find that order. Check the order ID from your confirmation, or try again in
        a moment.
      </Notice>
    );
  }

  return <OrderDetailCard order={order} />;
}

function OrderDetailSkeleton() {
  return (
    <Card variant="tint" padding="roomy" className="mt-10" aria-busy="true">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-7 w-40" />
      <div className="mt-9 flex flex-col gap-4">
        {Array.from({ length: 3 }, (_, stage) => (
          <Skeleton key={stage} index={stage} className="h-12" />
        ))}
      </div>
    </Card>
  );
}
