import { Injectable } from "@nestjs/common";
import {
  ADMIN_COUPON_STATES,
  type AdminCoupon,
  type AdminCouponCounts,
  type AdminCouponCreateRequest,
  type AdminCouponList,
  type AdminCouponQuery,
  type AdminCouponState,
  type AdminCouponUpdateRequest,
} from "@sakura/contracts";
import { and, desc, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { AuditService } from "../../audit";
import {
  DuplicateResourceError,
  InvalidInputError,
  ResourceConflictError,
  ResourceNotFoundError,
} from "../../common/errors";
import { DbService } from "../../db/db.service";
import { coupons, orders } from "../../db/schema";
import type { AdminContext } from "../orders";

type CouponRow = typeof coupons.$inferSelect;

/**
 * Where a coupon stands now, in the same order CouponsService.evaluate checks
 * it — so the tab a code sits under is the answer a customer typing it gets.
 */
export function couponState(row: CouponRow, now: Date = new Date()): AdminCouponState {
  if (!row.isActive) return "DISABLED";
  if (row.startsAt && now < row.startsAt) return "SCHEDULED";
  if (row.expiresAt && now > row.expiresAt) return "EXPIRED";
  if (row.maxUses !== null && row.timesUsed >= row.maxUses) return "USED_UP";
  return "ACTIVE";
}

/**
 * The coupon desk: issue codes, change their terms, switch them off.
 *
 * Writes go straight to the table rather than through CouponsService, which
 * owns the customer's half (evaluate, redeem). The one rule both halves share
 * — codes are stored uppercase — is enforced by the contract's code schema
 * here and by a check constraint underneath.
 */
@Injectable()
export class AdminCouponsService {
  constructor(
    private readonly dbService: DbService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: AdminCouponQuery): Promise<AdminCouponList> {
    const [rows, totals] = await Promise.all([
      this.dbService.db.select().from(coupons).orderBy(desc(coupons.createdAt)),
      this.discountTotals(),
    ]);

    const now = new Date();
    const needle = query.q?.toUpperCase();
    const searched = needle ? rows.filter((row) => row.code.includes(needle)) : rows;

    /* Counted over the search but before the state filter, so the tabs count
       what the search found rather than the whole table. */
    const counts = Object.fromEntries(ADMIN_COUPON_STATES.map((state) => [state, 0])) as AdminCouponCounts;
    const items: AdminCoupon[] = [];

    for (const row of searched) {
      const coupon = toAdminCoupon(row, totals.get(row.id) ?? 0, now);
      counts[coupon.state] += 1;
      if (!query.state || coupon.state === query.state) items.push(coupon);
    }

    return { items, counts };
  }

  async create(request: AdminCouponCreateRequest, context: AdminContext): Promise<AdminCoupon> {
    /* Checked up front for a friendly message; the unique constraint is still
       what actually holds if two owners create the same code at once. */
    const taken = await this.dbService.db.query.coupons.findFirst({
      where: eq(coupons.code, request.code),
      columns: { id: true },
    });
    if (taken) throw new DuplicateResourceError(`Coupon ${request.code}`, "coupons_code_unique");

    const [row] = await this.dbService.db
      .insert(coupons)
      .values({
        code: request.code,
        ...normaliseTerms(request),
      })
      .returning();

    await this.auditService.recordDetached({
      actor: { sub: context.actor.sub, email: context.actor.email },
      action: "CREATE",
      entityType: "coupons",
      entityId: row.id,
      after: auditView(row),
      note: `Coupon ${row.code} issued.`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return toAdminCoupon(row, 0);
  }

  async update(
    id: string,
    request: AdminCouponUpdateRequest,
    context: AdminContext,
  ): Promise<AdminCoupon> {
    const existing = await this.require(id);

    /* Merged first, then normalised and re-checked as a whole: a request that
       changes only the end date cannot know the stored start date, and one
       that flips a percentage to a fixed amount must drop the cap with it. */
    const merged = normaliseTerms({
      discountType: request.discountType ?? existing.discountType,
      discountValue: request.discountValue ?? existing.discountValue,
      minOrderCents: request.minOrderCents !== undefined ? request.minOrderCents : existing.minOrderCents,
      maxDiscountCents:
        request.maxDiscountCents !== undefined ? request.maxDiscountCents : existing.maxDiscountCents,
      maxUses: request.maxUses !== undefined ? request.maxUses : existing.maxUses,
      startsAt: request.startsAt !== undefined ? request.startsAt : iso(existing.startsAt),
      expiresAt: request.expiresAt !== undefined ? request.expiresAt : iso(existing.expiresAt),
      isActive: request.isActive ?? existing.isActive,
    });

    if (merged.discountType === "PERCENTAGE" && merged.discountValue > 100) {
      throw new InvalidInputError("A percentage discount is at most 100.", { field: "discountValue" });
    }
    if (merged.startsAt && merged.expiresAt && merged.startsAt >= merged.expiresAt) {
      throw new InvalidInputError("The end date must be after the start date.", { field: "expiresAt" });
    }
    /* Lowering the limit below what has already been used would not undo
       those uses; it would just make the number on screen a lie. */
    if (merged.maxUses !== null && merged.maxUses < existing.timesUsed) {
      throw new InvalidInputError(
        `This code has already been used ${existing.timesUsed} times — the limit cannot go below that.`,
        { field: "maxUses", timesUsed: existing.timesUsed },
      );
    }

    const [row] = await this.dbService.db
      .update(coupons)
      .set({ ...merged, updatedAt: new Date() })
      .where(eq(coupons.id, id))
      .returning();

    await this.auditService.recordDetached({
      actor: { sub: context.actor.sub, email: context.actor.email },
      action: "UPDATE",
      entityType: "coupons",
      entityId: id,
      before: auditView(existing),
      after: auditView(row),
      note:
        request.isActive !== undefined && request.isActive !== existing.isActive
          ? `Coupon ${row.code} ${request.isActive ? "switched on" : "switched off"}.`
          : undefined,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const totals = await this.discountTotals(id);
    return toAdminCoupon(row, totals.get(id) ?? 0);
  }

  /**
   * Delete a code that was never used — a typo, a test.
   *
   * A used code is refused rather than deleted. Orders would survive it (the
   * FK is `set null` and they keep a snapshot of the code), but "which orders
   * used EID2026" stops being answerable, and switching it off already does
   * everything a customer-facing delete would.
   */
  async remove(id: string, context: AdminContext): Promise<void> {
    const existing = await this.require(id);

    if (existing.timesUsed > 0) {
      throw new ResourceConflictError(
        "This code has been used on orders, so it can only be switched off, not deleted.",
        { timesUsed: existing.timesUsed },
      );
    }

    const [deleted] = await this.dbService.db
      .delete(coupons)
      .where(sql`${coupons.id} = ${id} AND ${coupons.timesUsed} = 0`)
      .returning({ id: coupons.id });

    /* Lost a race with a checkout that redeemed it between the read and here. */
    if (!deleted) {
      throw new ResourceConflictError(
        "This code was just used on an order, so it can only be switched off now.",
      );
    }

    await this.auditService.recordDetached({
      actor: { sub: context.actor.sub, email: context.actor.email },
      action: "DELETE",
      entityType: "coupons",
      entityId: id,
      before: auditView(existing),
      note: `Coupon ${existing.code} deleted.`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  private async require(id: string): Promise<CouponRow> {
    const row = await this.dbService.db.query.coupons.findFirst({ where: eq(coupons.id, id) });
    if (!row) throw new ResourceNotFoundError("Coupon");
    return row;
  }

  /** Discount handed out per coupon, from the order snapshots of live orders. */
  private async discountTotals(couponId?: string): Promise<Map<string, number>> {
    const rows = await this.dbService.db
      .select({
        couponId: orders.couponId,
        total: sql<number>`coalesce(sum(${orders.discountCents}), 0)::int`,
      })
      .from(orders)
      .where(
        and(
          couponId ? eq(orders.couponId, couponId) : isNotNull(orders.couponId),
          /* Same exclusion as the revenue screen: a cancelled or refunded
             order discounted nothing anyone paid. `timesUsed` still counts
             them — cancelling deliberately does not give a use back (see
             OrdersService.cancel) — so the two figures can differ. */
          notInArray(orders.status, ["CANCELLED", "REFUNDED"]),
        ),
      )
      .groupBy(orders.couponId);

    return new Map(rows.map((row) => [row.couponId as string, row.total]));
  }
}

type Terms = Omit<AdminCouponCreateRequest, "code">;

/** Terms as columns: dates parsed, and the cap dropped where it means nothing. */
function normaliseTerms(terms: Terms) {
  return {
    discountType: terms.discountType,
    discountValue: terms.discountValue,
    minOrderCents: terms.minOrderCents,
    maxDiscountCents: terms.discountType === "PERCENTAGE" ? terms.maxDiscountCents : null,
    maxUses: terms.maxUses,
    startsAt: terms.startsAt ? new Date(terms.startsAt) : null,
    expiresAt: terms.expiresAt ? new Date(terms.expiresAt) : null,
    isActive: terms.isActive,
  };
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function toAdminCoupon(row: CouponRow, totalDiscountCents: number, now = new Date()): AdminCoupon {
  return {
    id: row.id,
    code: row.code,
    discountType: row.discountType,
    discountValue: row.discountValue,
    minOrderCents: row.minOrderCents,
    maxDiscountCents: row.maxDiscountCents,
    maxUses: row.maxUses,
    timesUsed: row.timesUsed,
    startsAt: iso(row.startsAt),
    expiresAt: iso(row.expiresAt),
    isActive: row.isActive,
    state: couponState(row, now),
    totalDiscountCents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function auditView(row: CouponRow) {
  return {
    code: row.code,
    discountType: row.discountType,
    discountValue: row.discountValue,
    minOrderCents: row.minOrderCents,
    maxDiscountCents: row.maxDiscountCents,
    maxUses: row.maxUses,
    timesUsed: row.timesUsed,
    startsAt: iso(row.startsAt),
    expiresAt: iso(row.expiresAt),
    isActive: row.isActive,
  };
}
