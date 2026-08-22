// Pre-order stream disabled — single normal flow for all books.
// Everything below is commented out rather than deleted, in case the
// pre-order stream comes back.

// import {
//   IDEMPOTENCY_KEY_HEADER,
//   placePreOrderRequestSchema,
//   preOrderBookSchema,
//   preOrderSchema,
//   type PlacePreOrderRequest,
//   type PreOrder,
//   type PreOrderBook,
// } from "@sakura/contracts";
//
// import { apiFetch } from "./client";
//
// /**
//  * The active pre-order book, or null when there is not one. See
//  * PreOrderBooksController.active() — this endpoint returns `null` rather than
//  * 404 for "no pre-order right now".
//  */
// export function getActivePreOrderBook(): Promise<PreOrderBook | null> {
//   return apiFetch("/pre-order-books/active", preOrderBookSchema.nullable(), {
//     revalidate: 60,
//   });
// }
//
// /** POST /pre-orders. `idempotencyKey` travels as the Idempotency-Key header. */
// export function placePreOrder(
//   request: PlacePreOrderRequest,
//   idempotencyKey: string,
// ): Promise<PreOrder> {
//   const validated = placePreOrderRequestSchema.parse(request);
//
//   return apiFetch("/pre-orders", preOrderSchema, {
//     method: "POST",
//     body: validated,
//     revalidate: false,
//     headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
//   });
// }
