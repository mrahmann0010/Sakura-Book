export { InventoryModule } from "./inventory.module";
export { InventoryService } from "./inventory.service";
/**
 * Exported because the definition of "spoken for" cannot live in one module
 * and be re-derived in the others. Catalog renders from it, pricing quotes
 * from it, the waitlist rations invites by it and checkout enforces it — and
 * if any two of those computed it separately the shop would oversell the
 * moment they drifted. These are `sql` fragments with no Nest wiring behind
 * them: importing them does not require importing InventoryModule.
 */
export {
  chargedQuantitySql,
  publicAvailableSql,
  reservedQuantitySql,
  ringfencedQuantitySql,
} from "./reservations";
export { OutOfStockError } from "./inventory.errors";
export { UnitsSoldReconciler, COUNTED_STATUSES } from "./units-sold-reconciler";
