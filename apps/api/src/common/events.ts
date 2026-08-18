/**
 * Event names for the in-process emitter.
 *
 * The *names* live in common rather than with the module that emits them, and
 * that is a dependency decision rather than tidiness. `inventory` listens for
 * an order event, while `orders` imports `inventory` to decrement stock — so
 * if the channel identifier lived in `orders`, the listener would need a
 * runtime import back into it and the two module barrels would form an import
 * cycle. The payload *types* stay with the emitter and are imported as types,
 * which erase at compile time and therefore cannot close the loop.
 *
 * A string constant, not an enum: EventEmitter2 matches on strings, and a
 * misspelled subscription fails silently either way — the constant is what
 * makes that impossible, and it needs nothing else.
 */
export const ORDER_STATUS_CHANGED = "order.status-changed";
