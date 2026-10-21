import { Injectable, Logger } from "@nestjs/common";
import type { ClaimOutcome, ClaimRequest } from "./claim.types";
import { GatewayHttpClient } from "./gateway-http.client";
import { PaymentGatewayConfig } from "./gateway.config";

/**
 * The one door into the payment gateway: "let me spend this payment for this
 * order."
 *
 * Claiming *is* checking. There is no "is it paid?" read to call first, and
 * no caller should build one: a read-then-decide check is the race this
 * gateway exists to remove.
 *
 * ## What it does not do
 *
 * It never changes an order. It returns a verdict, and the orders side
 * decides what that verdict means — grant, hold, or refuse.
 *
 * ## Never throws
 *
 * Every failure comes back as an outcome. Gateway trouble is UNAVAILABLE;
 * our own bugs and config mistakes are MISCONFIGURED and are logged loudly.
 * A bad deploy or a gateway outage must never fail a checkout where the
 * customer has already paid.
 */
@Injectable()
export class PaymentClaimService {
  private readonly logger = new Logger(PaymentClaimService.name);

  constructor(
    private readonly config: PaymentGatewayConfig,
    private readonly http: GatewayHttpClient,
  ) {}

  /** Whether this environment can claim at all. */
  get enabled(): boolean {
    return this.config.enabled;
  }

  async claim(request: ClaimRequest): Promise<ClaimOutcome> {
    if (!this.enabled) {
      return {
        outcome: "UNAVAILABLE",
        reason: "The payment gateway is not configured (SAKURA_PAYMENT_GATEWAY_*).",
      };
    }

    const problem = requestProblem(request);

    if (problem) {
      this.logger.error(`Refusing to send a bad claim for ${request.orderRef ?? "?"}: ${problem}`);

      return { outcome: "MISCONFIGURED", reason: problem };
    }

    /* Asked without the wallet first. The customer picks a wallet on the form
       and can pick the wrong one; naming it up front would turn that slip
       into a payment that is "not found" forever. Only when the gateway says
       the ID exists on two wallets is the customer's choice used to decide. */
    let outcome = await this.send({ ...request, provider: undefined });

    if (outcome.outcome === "REJECTED" && outcome.rejection === "AMBIGUOUS" && request.provider) {
      outcome = await this.send(request);
    }

    this.report(request, outcome);

    return outcome;
  }

  private async send(request: ClaimRequest): Promise<ClaimOutcome> {
    try {
      return await this.http.claim(request);
    } catch (error) {
      // The client already turns every failure into an outcome; this catches
      // anything it missed, so the promise above still holds.
      return { outcome: "UNAVAILABLE", reason: `Unexpected error: ${String(error)}` };
    }
  }

  private report(request: ClaimRequest, outcome: ClaimOutcome): void {
    const subject = `claim ${request.trxId} for ${request.orderRef ?? "?"} (key ${request.idempotencyKey})`;

    switch (outcome.outcome) {
      case "CLAIMED":
        this.logger.log(
          `${outcome.replay ? "Replayed" : "Made"} ${subject}` +
            (outcome.overpaidCents > 0 ? `; overpaid by ${outcome.overpaidCents} cents` : ""),
        );
        return;
      case "MISCONFIGURED":
        this.logger.error(`Could not ${subject}: ${outcome.reason}`);
        return;
      case "UNAVAILABLE":
      case "ALREADY_CLAIMED":
      case "REJECTED":
      case "RELEASED":
      case "UNDERPAID":
        this.logger.warn(
          `Could not ${subject}: ${outcome.outcome}${"reason" in outcome ? ` — ${outcome.reason}` : ""}`,
        );
        return;
      case "PENDING_ARRIVAL":
        return;
    }
  }
}

/** A claim this module would refuse to send. These are bugs in the caller. */
function requestProblem(request: ClaimRequest): string | null {
  if (!/[A-Za-z0-9]/.test(request.trxId)) return "The transaction ID is empty.";
  if (!Number.isInteger(request.expectedCents) || request.expectedCents <= 0) {
    return `The expected amount (${request.expectedCents} cents) is not a positive whole number.`;
  }
  if (!request.idempotencyKey.trim()) return "The claim key is empty.";
  return null;
}
