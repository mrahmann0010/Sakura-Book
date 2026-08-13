import { Injectable } from "@nestjs/common";
import { HealthIndicatorResult, HealthIndicatorService } from "@nestjs/terminus";
import { sql } from "drizzle-orm";
import { DbService } from "../db/db.service";

@Injectable()
export class DbHealthIndicator {
  constructor(
    private readonly dbService: DbService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      await this.dbService.db.execute(sql`SELECT 1`);
      return indicator.up();
    } catch (error) {
      return indicator.down({
        message: error instanceof Error ? error.message : "Database unreachable",
      });
    }
  }
}
