import { Injectable } from "@nestjs/common";
import type { PaymentProvider } from "./payment-provider.port";

/**
 * The adapters, by name, resolved from the `:provider` path segment.
 *
 * A tiny injectable rather than a plain object built in the module, so a
 * provider can take its own dependencies — ManualTransferProvider needs
 * ConfigService for the webhook secret — and still be looked up per request.
 *
 * Its own file rather than living beside PaymentsService, and not by taste: a
 * class used in another class's constructor must be *initialised* before that
 * class's decorator metadata is emitted, and `class` declarations do not hoist
 * as values. Declared second in a shared file, this failed at import time with
 * `Cannot access 'PaymentProviderRegistry' before initialization` — a runtime
 * error tsc cannot see, and one that only appears when the app actually boots.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly byName = new Map<string, PaymentProvider>();

  register(provider: PaymentProvider): void {
    this.byName.set(provider.name, provider);
  }

  get(name: string): PaymentProvider | undefined {
    return this.byName.get(name);
  }
}
