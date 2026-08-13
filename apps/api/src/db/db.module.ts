import { Global, Module } from "@nestjs/common";
import { DbService } from "./db.service";

/**
 * Global so feature modules can inject DbService without re-importing
 * this module everywhere.
 */
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
