import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service";

/**
 * The audit trail, hoisted out of AdminModule to the top level and made
 * global.
 *
 * It started as an admin concern because only staff actions were worth
 * recording. Automatic payment verification broke that assumption: a machine
 * can now accept money, and that acceptance needs the same accountable trace
 * as a person's — which put PreOrdersModule in the position of needing
 * AuditService while AdminModule already imports PreOrdersModule.
 *
 * Importing AdminModule back would be a cycle, and forwardRef() around a cycle
 * that only exists because a shared service is filed under the wrong module is
 * a workaround rather than a fix. Global, like DbModule: writing the audit log
 * is infrastructure, and the log's own guarantee — one entry per change,
 * committed together — lives in the service, not in who may reach it.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
