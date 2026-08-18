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

  /**
   * The original check, kept as the default: process plus dependencies.
   */
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: "Liveness and dependency health check" })
  check() {
    return this.health.check([() => this.db.pingCheck("database")]);
  }

  /**
   * Liveness: is this process able to answer at all?
   *
   * Deliberately checks nothing else. A liveness probe that pings the database
   * is a restart loop waiting to happen — Postgres goes briefly unreachable,
   * every pod fails its probe, the orchestrator kills them all, and none of
   * the restarts help because the process was never the problem.
   */
  @Get("live")
  @ApiOperation({ summary: "Liveness: the process is up" })
  live(): { status: string } {
    return { status: "ok" };
  }

  /**
   * Readiness: should this instance receive traffic?
   *
   * This is the one that checks the database, because an instance that cannot
   * reach Postgres can serve nothing useful and should be taken out of the
   * load balancer — without being restarted.
   */
  @Get("ready")
  @HealthCheck()
  @ApiOperation({ summary: "Readiness: dependencies are reachable" })
  ready() {
    return this.health.check([() => this.db.pingCheck("database")]);
  }
}
