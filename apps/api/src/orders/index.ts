/**
 * The orders module's public surface.
 *
 * The lifecycle pieces were here before CheckoutService was, because they are
 * pure and decided, and payments and admin need them regardless of how orders
 * end up being written.
 */
export { OrdersModule } from "./orders.module";
export { CheckoutService } from "./checkout.service";
export { OrdersService } from "./orders.service";
export { toOrderResponse, type OrderRow } from "./order.mapper";
export { generateOrderNumber } from "./order-number";
export { ORDER_STATUS_CHANGED, type OrderStatusChangedEvent } from "./order.events";
export {
  ORDER_STATUS_TRANSITIONS,
  STOCK_HELD_STATUSES,
  canTransition,
  isTerminal,
  type OrderStatus,
} from "./order-status.machine";
export {
  CartNotOrderableError,
  CouponNotApplicableError,
  InvalidStatusTransitionError,
  OrderNumberExhaustedError,
} from "./order.errors";
