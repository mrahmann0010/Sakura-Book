import { NotFoundError } from "../common/errors";

/**
 * A token that isn't redeemable — wrong, expired, or already spent.
 *
 * One code and one message for all three causes, on purpose: telling a caller
 * *why* a token failed (expired vs. used vs. fake) would let a script probe
 * for which tokens exist, the same reasoning `order.errors.ts` applies to a
 * wrong email on order lookup. `NotFoundError` (404) rather than a "gone"
 * status for the same reason — a spent or expired token should look exactly
 * like one that was never issued.
 */
export class WaitlistInviteInvalidError extends NotFoundError {
  readonly code = "WAITLIST_INVITE_INVALID";

  constructor() {
    super("Waitlist invite is invalid, expired, or already used.");
  }
}
