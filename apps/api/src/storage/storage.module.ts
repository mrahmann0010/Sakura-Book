import { Module } from "@nestjs/common";
import { StorageService } from "./storage.service";

/**
 * File storage for admin uploads — the shop's covers and sample PDFs, written
 * to the shared Garage bucket. See StorageService for why this is `fetch` and
 * a small signer rather than the AWS SDK.
 */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
