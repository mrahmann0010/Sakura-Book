/**
 * @sakura/contracts — the shared source of truth between @sakura/web and
 * @sakura/api.
 *
 * Zod schemas, the types inferred from them, and the error-code union. Both
 * apps import from here, so the checkout payload, the catalog query params and
 * every `code` a client branches on have exactly one definition and cannot
 * drift into two that almost agree.
 *
 * Schemas, not generated types: OpenAPI codegen from the Nest app would give
 * the client types only, and the forms need runtime validators. One zod schema
 * is both, and it is the same object the server validates with.
 *
 * What belongs here: anything that crosses the wire. What does not: view
 * models, database row types, and anything either app can derive for itself.
 * A type that only one side uses is not a contract, and putting it here makes
 * a package release the price of a local refactor.
 */
export * from "./errors";
export * from "./pagination";
export * from "./catalog";
export * from "./coupon";
export * from "./cart";
export * from "./checkout";
export * from "./order";
export * from "./shipping";
export * from "./admin-auth";
export * from "./admin-order";
export * from "./admin-settings";
export * from "./payment-verification";
export * from "./pre-order-book";
export * from "./pre-order";
export * from "./admin-pre-order-book";
export * from "./admin-pre-order";
