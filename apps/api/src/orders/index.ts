/**
 * The orders module's public surface.
 *
 * The lifecycle pieces were here before CheckoutService was, because they are
 * pure and decided, and payments and admin need them regardless of how orders
 * end up being written.
 */
export { OrdersModule } from "./orders.module";
// OrdersHttpModule is deliberately not re-exported here: it imports
// PaymentsModule, and PaymentsModule imports this barrel for OrdersModule.
// Re-exporting it too would turn that into a circular import at the file
// level. Import it directly from "./orders/orders-http.module" instead.
export { CheckoutService } from "./checkout.service";
export { OrdersService } from "./orders.service";
export { toOrderResponse, type OrderRow } from "./order.mapper";
// The shared read shape, so the admin detail view cannot assemble an order
// differently from the way checkout and guest lookup assemble theirs.
export { findOrder } from "./order.query";
export { generateOrderNumber, ORDER_NUMBER_ATTEMPTS } from "./order-number";
export { ORDER_STATUS_CHANGED, type OrderStatusChangedEvent } from "./order.events";
export {
  ORDER_STATUS_TRANSITIONS,
  STOCK_HELD_STATUSES,
  canTransition,
  isTerminal,
  releasesStock,
  type OrderStatus,
} from "./order-status.machine";
export {
  CartNotOrderableError,
  CouponNotApplicableError,
  InvalidStatusTransitionError,
  OrderNumberExhaustedError,
} from "./order.errors";
