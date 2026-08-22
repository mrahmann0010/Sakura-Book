import { Module } from "@nestjs/common";
import { StorageService } from "./storage.service";

/**
 * File storage for admin uploads. See StorageService for why this is a plain
 * REST client rather than the Supabase SDK.
 */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
