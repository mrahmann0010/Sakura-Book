import { ConflictError } from "../common/errors";

/**
 * This transaction ID has already been used to pay for something else.
 *
 * The counterpart to the gateway's unique `trxId` index, on our side of the
 * line: one payment SMS is one payment, so quoting the same receipt on a
 * second order is either a customer mistake — a resubmitted form, a
 * misremembered ID — or someone trying to get a second book for one payment.
 * Both want the same answer, and both want it *before* the row is written,
 * because a duplicate that reaches the queue is a duplicate a member of staff
 * has to spot by eye.
 *
 * ConflictError (409) rather than a business rule, because this is a clash
 * with existing state rather than a rule about this request: the same
 * submission would have succeeded had the other order not existed.
 *
 * The `details` deliberately do not name the other order. The person hitting
 * this is not necessarily the person who placed it, and confirming that
 * "order PO-xxxx used this ID" would turn the pre-order endpoint into a way
 * to test transaction IDs against the shop's books.
 */
export class TransactionIdAlreadyUsedError extends ConflictError {
  readonly code = "TRANSACTION_ID_ALREADY_USED";

  constructor(transactionId: string) {
    super(`Transaction ID ${transactionId} has already been submitted against another order.`, {
      transactionId,
    });
  }
}
