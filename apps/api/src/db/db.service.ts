import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private client!: Sql;
  db!: PostgresJsDatabase<typeof schema>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.client = postgres(this.config.getOrThrow<string>("DATABASE_URL"));
    this.db = drizzle(this.client, { schema });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.end();
  }
}
