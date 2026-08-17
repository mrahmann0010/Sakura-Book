import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { GlobalExceptionFilter } from "./errors/global-exception.filter";
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
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class CommonModule {}
