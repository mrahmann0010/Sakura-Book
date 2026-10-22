import { describe, expect, it } from "vitest";
import { envSchemaChecked } from "../../src/config/env.schema";

/**
 * SAKURA_PAYMENT_GATEWAY_*: all three or none, and all three in production.
 * The package enforces the same at boot; this is our own env contract.
 */
describe("payment gateway env", () => {
  const base = { NODE_ENV: "development", DATABASE_URL: "postgres://localhost/db" };
  const gateway = {
    SAKURA_PAYMENT_GATEWAY_URL: "https://gateway.example",
    SAKURA_PAYMENT_GATEWAY_CLIENT_ID: "sakura-book",
    SAKURA_PAYMENT_GATEWAY_SECRET: "s3cret",
  };
  const gatewayIssues = (env: Record<string, unknown>) => {
    const parsed = envSchemaChecked.safeParse(env);
    return parsed.success
      ? []
      : parsed.error.issues.filter((issue) =>
          String(issue.path[0]).startsWith("SAKURA_PAYMENT_GATEWAY_"),
        );
  };

  it("is optional outside production", () => {
    expect(gatewayIssues(base)).toEqual([]);
  });

  it("refuses half a config", () => {
    const { SAKURA_PAYMENT_GATEWAY_SECRET: _secret, ...partial } = gateway;
    expect(gatewayIssues({ ...base, ...partial }).map((issue) => issue.path[0])).toEqual([
      "SAKURA_PAYMENT_GATEWAY_SECRET",
    ]);
  });

  it("is required in production", () => {
    expect(gatewayIssues({ ...base, NODE_ENV: "production" })).toHaveLength(3);
    expect(gatewayIssues({ ...base, ...gateway, NODE_ENV: "production" })).toEqual([]);
  });
});
