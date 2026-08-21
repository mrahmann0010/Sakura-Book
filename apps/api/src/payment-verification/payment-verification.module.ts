import { Global, Module } from "@nestjs/common";
import { MongoPaymentsClient } from "./mongo-payments.client";
import { PaymentVerificationService } from "./payment-verification.service";

/**
 * Global, like DbModule, and for the same reason: this is infrastructure that
 * several unrelated features reach for, and threading an import through every
 * one of them adds a line per module and decides nothing. The connection is a
 * process-wide singleton either way.
 */
@Global()
@Module({
  providers: [MongoPaymentsClient, PaymentVerificationService],
  exports: [PaymentVerificationService],
})
export class PaymentVerificationModule {}
