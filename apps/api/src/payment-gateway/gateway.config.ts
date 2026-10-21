import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env.schema";

/**
 * The three SAKURA_PAYMENT_GATEWAY_* values, read once.
 *
 * The env schema has already checked them at boot — all three or none, and
 * all three in production — so the only question left here is whether this
 * environment has a gateway at all. When it does not, every claim comes back
 * UNAVAILABLE and orders wait for a person. It never means "assume paid".
 */
@Injectable()
export class PaymentGatewayConfig {
  readonly baseUrl: string | undefined;
  readonly clientId: string | undefined;
  readonly secret: string | undefined;
  readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get("SAKURA_PAYMENT_GATEWAY_URL", { infer: true })?.replace(/\/+$/, "");
    this.clientId = config.get("SAKURA_PAYMENT_GATEWAY_CLIENT_ID", { infer: true });
    this.secret = config.get("SAKURA_PAYMENT_GATEWAY_SECRET", { infer: true });
    this.timeoutMs = config.get("SAKURA_PAYMENT_GATEWAY_TIMEOUT_MS", { infer: true });
  }

  get enabled(): boolean {
    return Boolean(this.baseUrl && this.clientId && this.secret);
  }

  /** `Bearer {CLIENT_ID}.{SECRET}`, as the gateway expects. Server-side only. */
  get authorization(): string {
    return `Bearer ${this.clientId}.${this.secret}`;
  }
}
