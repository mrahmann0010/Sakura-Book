import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
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
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Sakura Book API")
    .setDescription("REST API for the Sakura Book platform")
    .setVersion("0.1.0")
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = config.get("PORT", { infer: true });
  await app.listen(port);

  console.log(`API listening on http://localhost:${port} (docs at /docs)`);
}

void bootstrap();
