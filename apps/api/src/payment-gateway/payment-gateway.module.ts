import { Global, Module } from "@nestjs/common";
import { GatewayHttpClient } from "./gateway-http.client";
import { PaymentGatewayConfig } from "./gateway.config";
import { PaymentClaimService } from "./payment-claim.service";

/**
 * Everything about confirming a bKash / Nagad / Rocket payment through the
 * shop's payment gateway.
 *
 * Only `PaymentClaimService` is exported. Orders, admin and background jobs
 * call `claim()` and never see HTTP, env vars or the gateway's reason codes,
 * so this can later move into its own service without touching them.
 *
 * Global for the same reason DbModule is: several unrelated features need it,
 * and the HTTP client is a process-wide singleton either way.
 */
@Global()
@Module({
  providers: [PaymentGatewayConfig, GatewayHttpClient, PaymentClaimService],
  exports: [PaymentClaimService],
})
export class PaymentGatewayModule {}
