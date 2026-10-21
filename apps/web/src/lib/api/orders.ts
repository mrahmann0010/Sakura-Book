import {
  IDEMPOTENCY_KEY_HEADER,
  orderCancelRequestSchema,
  orderLookupRequestSchema,
  orderLookupResponseSchema,
  orderPaymentStatusRequestSchema,
  orderSchema,
  placeOrderRequestSchema,
  type Order,
  type OrderCancelRequest,
  type OrderLookupRequest,
  type OrderPaymentStatusRequest,
  type PlaceOrderRequest,
} from "@sakura/contracts";

import { apiFetch } from "./client";

/** POST /orders — the server re-prices from the cart entries and mints the order number. */
export function placeOrder(request: PlaceOrderRequest, idempotencyKey: string): Promise<Order> {
  const validated = placeOrderRequestSchema.parse(request);
  return apiFetch("/orders", orderSchema, {
    method: "POST",
    body: validated,
    revalidate: false,
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
  });
}

/**
 * Guest order lookup — see GuestOrdersController. POST, not GET: email/phone
 * are the credential here, and a GET would put them in the URL, browser
 * history and every access log between here and the API. Never cached, for
 * the same reason — a stale "still processing" is actively wrong for a
 * customer who just refreshed to see whether an admin action landed.
 *
 * Empty strings are normalised to `undefined` before validating — the schema
 * treats each field as either "given" or "omitted", not "given as blank".
 */
export function lookupOrder(request: OrderLookupRequest): Promise<Order[]> {
  const validated = orderLookupRequestSchema.parse({
    orderNumber: request.orderNumber?.trim() || undefined,
    email: request.email?.trim() || undefined,
    phone: request.phone?.trim() || undefined,
  });

  return apiFetch("/orders/lookup", orderLookupResponseSchema, {
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

/**
 * Re-read a just-placed order to see whether its payment has been confirmed.
 * Polled by the checkout modal while the server retries the gateway claim;
 * it never asks the gateway itself. Never cached, for the same reason as lookup.
 */
export function getOrderPaymentStatus(request: OrderPaymentStatusRequest): Promise<Order> {
  const validated = orderPaymentStatusRequestSchema.parse(request);
  return apiFetch("/orders/payment-status", orderSchema, {
    method: "POST",
    body: validated,
    revalidate: false,
  });
}
