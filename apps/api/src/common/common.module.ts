import { Global, Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { GlobalExceptionFilter } from "./errors/global-exception.filter";

/**
 * Cross-cutting infrastructure every feature module can assume is present.
 *
 * The filter is registered as an APP_FILTER provider rather than through
 * `app.useGlobalFilters()` in main.ts, because that form is instantiated by the
 * DI container: the day it needs a ConfigService (to redact differently in
 * production) or a logger, it can just inject it. The main.ts form is
 * constructed by hand and can inject nothing.
 */
@Global()
@Module({
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class CommonModule {}
