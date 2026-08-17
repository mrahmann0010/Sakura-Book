import { createZodValidationPipe } from "nestjs-zod";

/**
 * The global validation pipe.
 *
 * `createZodValidationPipe` rather than nestjs-zod's stock `ZodValidationPipe`
 * for one reason, and it matters: the stock pipe throws its own
 * `ZodValidationException`, which extends `BadRequestException`. That is an
 * HttpException, so it would fall through the global filter's ladder past the
 * `ZodError` branch and land in the generic `HttpException` branch — emitting
 * `code: "BAD_REQUEST"` with a stringified message and **no `fields` array**.
 *
 * Every field-level error the frontend binds to an input (`items.0.quantity`)
 * would be lost, silently, while still returning a plausible-looking 400.
 *
 * Rethrowing the raw `ZodError` puts it back on the branch that was written
 * for it. The error layer stays settled: one filter owns transport mapping,
 * and this pipe does not get to invent a second error shape.
 */
export const ZodValidationPipe = createZodValidationPipe({
  createValidationException: (error: unknown) => error as Error,
});
