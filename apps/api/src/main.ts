import { VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Logger as PinoLogger } from "nestjs-pino";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { AppModule } from "./app.module";
import type { Env } from "./config/env.schema";

async function bootstrap(): Promise<void> {
  // `bufferLogs` holds startup output until the pino logger is installed a few
  // lines down; without it, everything Nest logs while wiring modules goes out
  // through the default console logger in a different format, and the very
  // first lines of a boot — the ones you read when a boot fails — are the ones
  // that miss the structured output.
  /**
   * `rawBody` keeps the unparsed request bytes on `request.rawBody`, which the
   * payment webhook route needs: a signature covers the exact bytes that were
   * sent, and `JSON.parse` followed by re-serialisation does not reproduce
   * them — verification against re-serialised JSON passes or fails on key
   * order. Enabled app-wide because Nest only exposes it as a factory option;
   * the cost is one retained buffer per request, and the alternative is a
   * bespoke body parser mounted on one path.
   */
  // Typed as the Express application because `app.set("trust proxy", ...)`
  // below is an Express escape hatch that the platform-agnostic
  // INestApplication interface does not expose.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const config = app.get(ConfigService<Env, true>);

  app.useLogger(app.get(PinoLogger));

  app.use(helmet());

  /**
   * Admin sessions are httpOnly cookies, and without this `request.cookies` is
   * undefined — which AdminJwtGuard reads as "no token" and turns into a 401
   * on every admin request. Registered before the routes and after helmet,
   * which sets headers and reads nothing.
   */
  app.use(cookieParser());

  /**
   * Trust the first proxy hop, so `request.ip` is the client's address rather
   * than the load balancer's. Admin session rows and audit entries both record
   * it, and a column that uniformly holds `10.0.0.1` is worse than an empty
   * one — it looks like data.
   *
   * `1`, not `true`. Trusting every hop lets a client forge `X-Forwarded-For`
   * and write whatever address it likes into the audit trail; trusting exactly
   * the number of proxies actually in front of the app is what makes the value
   * mean something. Raise it if another hop is added.
   */
  app.set("trust proxy", 1);
  app.enableCors({
    origin: config.get("WEB_ORIGIN", { infer: true }),
    credentials: true,
  });
  app.setGlobalPrefix("api");

  /**
   * URI versioning → /api/v1/..., which is the shape ErrorResponseDto already
   * documents and the frontend has yet to hardcode anywhere. Settled now
   * rather than later: retrofitting a version segment once clients exist means
   * either breaking them or running two prefixes.
   *
   * `defaultVersion` means controllers get v1 without annotating for it, so
   * the version only appears in code on the day something actually forks.
   */
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Sakura Book API")
    .setDescription("REST API for the Sakura Book platform")
    .setVersion("0.1.0")
    .build();
  // cleanupOpenApiDoc resolves the JSON-schema fragments createZodDto attaches
  // into the document. Without it, zod-derived bodies appear in /docs as empty
  // objects — which is the whole reason nestjs-zod was chosen over a
  // hand-rolled pipe, so it is not optional dressing.
  SwaggerModule.setup(
    "docs",
    app,
    cleanupOpenApiDoc(SwaggerModule.createDocument(app, swaggerConfig)),
  );

  const port = config.get("PORT", { infer: true });
  await app.listen(port);

  const logger = app.get(PinoLogger);

  // Warned rather than enforced: without Redis the throttler falls back to
  // per-instance counters, which weakens the enumeration limits on coupon
  // validation and order lookup but does not make the shop incorrect. Failing
  // the boot over it would take the shop down to protect a rate limit.
  if (!config.get("REDIS_URL", { infer: true }) && process.env.NODE_ENV !== "development") {
    logger.warn("REDIS_URL is unset — rate limits are per-instance and will not hold across pods.");
  }

  /**
   * The one Supabase misconfiguration that fails intermittently instead of at
   * boot, so it is checked at boot instead.
   *
   * Port 6543 is Supavisor's transaction pooler, which gives consecutive
   * statements different backends. With prepared statements on, that surfaces
   * as `prepared statement "sN" does not exist` — under concurrency only, in
   * production only, hours after the deploy that caused it.
   */
  if (config.get("DATABASE_PREPARE", { infer: true })) {
    const databaseUrl = config.get("DATABASE_URL", { infer: true });

    if (databaseUrl.includes(":6543")) {
      logger.warn(
        "DATABASE_PREPARE is on while DATABASE_URL points at the transaction pooler (:6543). " +
          "Prepared statements do not survive it — expect intermittent " +
          '`prepared statement "sN" does not exist` under load.',
      );
    }
  }

  logger.log(`API listening on http://localhost:${port} (docs at /docs)`);
}

void bootstrap();
