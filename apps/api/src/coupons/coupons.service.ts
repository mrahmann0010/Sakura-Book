import { Injectable } from "@nestjs/common";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import type { Executor, Transaction } from "../db/db.types";
import { coupons } from "../db/schema";
import { CouponUnavailableError } from "./coupon.errors";
import { CouponRejection, type Coupon, type CouponEvaluation } from "./coupon.types";

@Injectable()
export class CouponsService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Codes are stored uppercase and compared exactly; uppercasing the input is
   * what makes the match case-insensitive. Enforced in the DB by the
   * coupons_code_uppercase check constraint.
   */
  normalizeCode(rawCode: string): string {
    return rawCode.trim().toUpperCase();
  }

  /**
   * Compute the discount a coupon yields on a given subtotal.
   *
   * Shipping is deliberately excluded — the discount applies to the subtotal
   * only, so "free shipping" is not expressible as a coupon in this model.
   */
  computeDiscountCents(coupon: Coupon, subtotalCents: number): number {
    let discount: number;

    if (coupon.discountType === "PERCENTAGE") {
      // Floor, so rounding always favours the shop by at most 1 cent rather
      // than letting a discount exceed the advertised percentage.
      discount = Math.floor((subtotalCents * coupon.discountValue) / 100);
      if (coupon.maxDiscountCents !== null) {
        discount = Math.min(discount, coupon.maxDiscountCents);
      }
    } else {
      discount = coupon.discountValue;
    }

    // Never below zero, and never more than the subtotal — a discount must not
    // be able to drive the total negative or eat into shipping.
    return Math.max(0, Math.min(discount, subtotalCents));
  }

  /**
   * Validate a code against a subtotal and compute the discount, without
   * consuming it. Safe to call repeatedly (e.g. live "apply coupon" in the cart).
   *
   * This is an advisory check: the authoritative usage-limit enforcement happens
   * in redeem(), which re-checks atomically. A coupon that passes here can still
   * fail at redemption if it runs out in between.
   */
  async evaluate(
    rawCode: string,
    subtotalCents: number,
    executor: Executor = this.dbService.db,
    now: Date = new Date(),
  ): Promise<CouponEvaluation> {
    const code = this.normalizeCode(rawCode);
    if (code.length === 0) {
      return { ok: false, reason: CouponRejection.NOT_FOUND };
    }

    const coupon = await executor.query.coupons.findFirst({
      where: eq(coupons.code, code),
    });

    if (!coupon) return { ok: false, reason: CouponRejection.NOT_FOUND };
    if (!coupon.isActive) return { ok: false, reason: CouponRejection.INACTIVE };
    if (coupon.startsAt && now < coupon.startsAt) {
      return { ok: false, reason: CouponRejection.NOT_STARTED };
    }
    if (coupon.expiresAt && now > coupon.expiresAt) {
      return { ok: false, reason: CouponRejection.EXPIRED };
    }
    if (coupon.maxUses !== null && coupon.timesUsed >= coupon.maxUses) {
      return { ok: false, reason: CouponRejection.USAGE_LIMIT_REACHED };
    }
    if (coupon.minOrderCents !== null && subtotalCents < coupon.minOrderCents) {
      return {
        ok: false,
        reason: CouponRejection.MIN_ORDER_NOT_MET,
        minOrderCents: coupon.minOrderCents,
      };
    }

    return { ok: true, coupon, discountCents: this.computeDiscountCents(coupon, subtotalCents) };
  }

  /**
   * Consume one use of a coupon. MUST be called inside the same transaction as
   * the order insert — unlike books.unitsSold (which is reconciled async), a
   * coupon's usage count has to be immediately consistent to block the next
   * checkout once maxUses is hit.
   *
   * The limit is re-checked in the UPDATE's WHERE clause rather than read first
   * and checked in JS: a read-then-write would let two concurrent checkouts both
   * observe timesUsed = maxUses - 1 and both succeed. Here the database
   * serialises them and the loser matches zero rows.
   *
   * `Transaction`, not `Executor`: the paragraph above is a correctness
   * requirement, not advice, so it is enforced by the type rather than left to
   * whoever reads the comment. Passing the root db does not compile.
   */
  async redeem(couponId: string, tx: Transaction): Promise<number> {
    const [updated] = await tx
      .update(coupons)
      .set({ timesUsed: sql`${coupons.timesUsed} + 1` })
      .where(
        and(
          eq(coupons.id, couponId),
          eq(coupons.isActive, true),
          or(isNull(coupons.maxUses), lt(coupons.timesUsed, coupons.maxUses)),
        ),
      )
      .returning({ timesUsed: coupons.timesUsed });

    if (!updated) {
      // Either the coupon was exhausted or deactivated between evaluate() and
      // here. Throwing rolls back the enclosing transaction, so the order is
      // never created with a discount that was not actually granted.
      throw new CouponUnavailableError(couponId);
    }

    return updated.timesUsed;
  }
}
