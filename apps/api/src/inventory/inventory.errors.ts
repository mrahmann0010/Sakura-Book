import { ConflictError } from "../common/errors";

/**
 * A line could not be reserved because the stock was not there.
 *
 * A ConflictError rather than a BusinessRuleError, matching the distinction in
 * domain.error.ts: this is transient. The customer's request was fine and the
 * same request may well succeed later, or after they reduce the quantity —
 * which is why `available` travels in details. The frontend needs it to say
 * "only 2 left" and to clamp the quantity stepper, and it cannot get that from
 * the message without parsing English.
 */
export class OutOfStockError extends ConflictError {
  readonly code = "OUT_OF_STOCK";

  constructor(bookId: string, requested: number, available: number) {
    super(`Book ${bookId}: requested ${requested}, ${available} available`, {
      bookId,
      requested,
      available,
      retryable: true,
    });
  }
}
