import { VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { AppModule } from "./app.module";
import type { Env } from "./config/env.schema";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  app.use(helmet());
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

  console.log(`API listening on http://localhost:${port} (docs at /docs)`);
}

void bootstrap();
