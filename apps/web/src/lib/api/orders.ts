import {
  orderCancelRequestSchema,
  orderLookupRequestSchema,
  orderSchema,
  type Order,
  type OrderCancelRequest,
  type OrderLookupRequest,
} from "@sakura/contracts";

import { apiFetch } from "./client";

/**
 * Guest order lookup — see GuestOrdersController. POST, not GET: the email is
 * the credential here, and a GET would put it in the URL, browser history and
 * every access log between here and the API. Never cached, for the same
 * reason — a stale "still processing" is actively wrong for a customer who
 * just refreshed to see whether an admin action landed.
 */
export function lookupOrder(request: OrderLookupRequest): Promise<Order> {
  const validated = orderLookupRequestSchema.parse(request);
  return apiFetch("/orders/lookup", orderSchema, {
    method: "POST",
    body: validated,
    revalidate: false,
  });
}

export function cancelOrder(request: OrderCancelRequest): Promise<Order> {
  const validated = orderCancelRequestSchema.parse(request);
  return apiFetch("/orders/cancel", orderSchema, {
    method: "POST",
    body: validated,
    revalidate: false,
  });
}
