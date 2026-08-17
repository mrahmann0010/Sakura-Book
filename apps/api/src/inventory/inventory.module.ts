import { Module } from "@nestjs/common";
import { InventoryService } from "./inventory.service";

/**
 * Deliberately has no controller. Stock is never adjusted by an anonymous
 * request — it moves as a side effect of checkout, or through an audited
 * admin action, and both of those are other modules' endpoints calling in.
 */
@Module({
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
