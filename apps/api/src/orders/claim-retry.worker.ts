import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq, inArray, lte, sql } from "drizzle-orm";
import type { Env } from "../config/env.schema";
import { DbService } from "../db/db.service";
import { orders } from "../db/schema";
import { PaymentClaimService } from "../payment-gateway";
import { OrderAutoVerifyService } from "./order-auto-verify.service";
import { findOrder } from "./order.query";

/** How often the worker looks for orders whose next try is due. */
const TICK_MS = 5_000;

/** Orders handled per tick. Each is one gateway call of at most ~5s. */
const BATCH_SIZE = 10;

/**
 * How long a picked-up order is hidden from other instances while this one
 * works on it. Longer than a whole batch could take; the claim then sets the
 * real next time (or clears it).
 */
const LEASE = sql`now() + interval '2 minutes'`;

/**
 * Re-claims payments whose SMS had not reached the gateway yet.
 *
 * Lives with orders rather than inside the payment-gateway module because
 * its job ends in granting an order, and the gateway module never touches
 * orders. Each due order goes through `OrderAutoVerifyService.settle` — the
 * same code checkout uses — with the order's stored claim key, so a retry
 * gets our own earlier claim back rather than colliding with it.
 *
 * In-process, on a timer. Several API instances can run it at once: due
 * orders are taken with `FOR UPDATE SKIP LOCKED` and leased forward in the
 * same statement, so no two instances claim the same order in one window.
 */
@Injectable()
export class ClaimRetryWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ClaimRetryWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly dbService: DbService,
    private readonly claims: PaymentClaimService,
    private readonly autoVerify: OrderAutoVerifyService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get("NODE_ENV", { infer: true }) === "test") return;

    if (!this.claims.enabled) {
      this.logger.warn("Payment gateway not configured; claim retries are off.");
      return;
    }

    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // Never the reason the process stays alive.
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. Public so tests and scripts can drive it without the timer. */
  async tick(): Promise<number> {
    // A slow gateway can make one pass outlast the interval; never overlap.
    if (this.running) return 0;
    this.running = true;

    try {
      const due = await this.takeDue();

      for (const { id } of due) {
        const row = await findOrder(this.dbService.db, eq(orders.id, id));
        if (row) await this.autoVerify.settle(row);
      }

      return due.length;
    } catch (error) {
      this.logger.error(`Claim retry pass failed: ${String(error)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async takeDue(): Promise<{ id: string }[]> {
    const due = this.dbService.db
      .select({ id: orders.id })
      .from(orders)
      .where(lte(orders.paymentClaimRetryAt, sql`now()`))
      .orderBy(orders.paymentClaimRetryAt)
      .limit(BATCH_SIZE)
      .for("update", { skipLocked: true });

    return this.dbService.db
      .update(orders)
      .set({ paymentClaimRetryAt: LEASE })
      .where(inArray(orders.id, due))
      .returning({ id: orders.id });
  }
}
