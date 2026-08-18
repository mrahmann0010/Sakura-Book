import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_PIPE } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { GlobalExceptionFilter } from "./errors/global-exception.filter";
import type { Env } from "../config/env.schema";
import { loggerConfig } from "./logging/logger.config";
import { throttlerConfig } from "./throttling/throttler.config";
import { ZodValidationPipe } from "./pipes/zod-validation.pipe";

/**
 * Cross-cutting infrastructure every feature module can assume is present.
 *
 * The filter is registered as an APP_FILTER provider rather than through
 * `app.useGlobalFilters()` in main.ts, because that form is instantiated by the
 * DI container: the day it needs a ConfigService (to redact differently in
 * production) or a logger, it can just inject it. The main.ts form is
 * constructed by hand and can inject nothing.
 *
 * The pipe is registered the same way and for the same reason. It is global
 * so that validation is opt-out rather than opt-in: a controller that forgets
 * `@Body(new ZodValidationPipe(schema))` should not silently accept unchecked
 * input. With a createZodDto body type, this pipe validates it automatically.
 */
@Global()
@Module({
  /**
   * The in-process event bus. Registered here rather than in the module that
   * emits, because both the emitter (orders) and the listener (inventory) need
   * it and neither may depend on the other.
   */
  imports: [
    /**
     * Structured logging, with a request id that the error envelope reuses.
     * Registered here rather than in main.ts so the config can be built from
     * ConfigService instead of reading process.env a second time behind the
     * validated schema's back.
     */
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        loggerConfig(config.get("NODE_ENV", { infer: true }) === "development"),
    }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        throttlerConfig(config.get("REDIS_URL", { infer: true })),
    }),
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    /**
     * The throttler guard is global so limits are opt-out, matching the pipe
     * and the filter. A route that needs a tighter bucket says so with
     * @StrictThrottle; a route that needs no limit at all has to say that
     * explicitly too, which is the right way round — forgetting to rate-limit
     * a new order-lookup-shaped endpoint should not be the silent default.
     */
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class CommonModule {}
