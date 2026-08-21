import { Module } from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import { SalesRollupListener } from "./sales-rollup.listener";
import { UnitsSoldReconciler } from "./units-sold-reconciler";

/**
 * Deliberately has no controller. Stock is never adjusted by an anonymous
 * request — it moves as a side effect of checkout, or through an audited
 * admin action, and both of those are other modules' endpoints calling in.
 *
 * SalesRollupListener is a provider with no exported surface at all — it is
 * reached only by the event emitter. It lives here because `units_sold` is a
 * column on the books row that inventory owns the write side of, and letting
 * orders update it directly would be the first crossing of the one boundary
 * this design bends on purpose.
 */
@Module({
  providers: [InventoryService, SalesRollupListener, UnitsSoldReconciler],
  exports: [InventoryService, UnitsSoldReconciler],
})
export class InventoryModule {}
