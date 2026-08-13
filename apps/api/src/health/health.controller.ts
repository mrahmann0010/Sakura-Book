import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { DbHealthIndicator } from "./db.health";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DbHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: "Liveness and dependency health check" })
  check() {
    return this.health.check([() => this.db.pingCheck("database")]);
  }
}
