# Backend architecture

How `apps/api` is built, and why. Companion to [state-management.md](./state-management.md),
which covers the same question on the web side.

---

## 1. Current condition

The storefront surface is complete. `apps/web` can be pointed at this API and
drop `lib/books.ts` entirely; what remains unbuilt is payments and admin.

### What is built

| Area          | State                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| Bootstrap     | Nest 11, helmet, CORS pinned to `WEB_ORIGIN`, `/api/v1` via URI versioning, Swagger at `/docs`, pino logging |
| Config        | Zod env schema validated at boot, `apps/api/.env` shared with docker compose                                |
| Database      | Supabase (managed Postgres), Drizzle + postgres-js over Supavisor, `DbService` in a `@Global()` module, `Executor` for tx composition |
| Schema        | 15 tables across catalog / marketing / shipping / orders, four migrations, `public` revoked from `anon`/`authenticated` |
| Errors        | `DomainError` hierarchy, one dispatching global filter, Postgres constraint mapper, `ErrorResponseDto`       |
| Validation    | `nestjs-zod` pipe registered as `APP_PIPE`, rethrowing raw `ZodError` so field paths survive                 |
| Catalog       | Browse with trigram search / category facets / sort / pagination, book detail, category rail, author pages   |
| Pricing       | `POST /cart/quote` — server-authoritative lines, discount, postage, total                                    |
| Shipping      | Regions table with per-region postage overrides, `GET /shipping/regions`                                     |
| Coupons       | `evaluate()` (advisory, rejections as values) and `redeem()` (atomic, throws), behind `/coupons/validate`     |
| Orders        | Idempotent checkout in one transaction, guest lookup, status machine with `transition()` as the single write path |
| Inventory     | Guarded stock decrement, plus an async `units_sold` rollup on `PAYMENT_CONFIRMED`                            |
| Rate limiting | Global `ThrottlerGuard`, 300/min default, 10/min on the three enumerable endpoints, Redis-backed when configured |
| Health        | `/health`, `/health/live` (process only), `/health/ready` (DB reachable)                                     |
| Tests / CI    | Vitest unit suite over the pure money and lifecycle logic; GitHub Actions running lint, typecheck, test, migration-drift |

The error layer remains the strongest thing here and should be treated as
settled: services throw domain errors, never `HttpException`; one filter owns
the transport mapping; 4xx logs at debug, 5xx logs with a stack.

`CouponsService` is still the reference implementation for the guarded-update
concurrency idiom (`UPDATE … WHERE still_available`, zero rows means you lost
the race) and the `executor: Executor = this.dbService.db` parameter that lets a
service run standalone or inside someone else's transaction.
`InventoryService.decrement` and `OrdersService.transition` both follow it.

### What is not built

**Payments and admin.** There is no `PaymentProvider` port, no
cash-on-delivery or manual-transfer adapter, and no webhook route — the unique
index those depend on (`payments (provider, provider_reference_id)`) is in place,
so the handler can rely on the 23505 rather than a check-then-insert. There are
no `admin_users`, no JWT, no roles guard, and no admin endpoints; `/api/v1/admin`
is unclaimed.

**An e2e suite.** The unit tests cover pure logic only. The concurrency and
constraint behaviour — idempotency replay, out-of-stock at decrement, an
exhausted coupon — needs supertest against a disposable Postgres (§3.18) and is
the highest-value thing still missing from CI.

**Review data, deliberately.** `book_reviews` exists and is empty. Every book's
rating comes back null and the card renders its no-reviews state. PRODUCT.md
forbids showing an invented average as real, so the seed does not write any.

### Defects since resolved

Each of these was listed here as a numbered trap and is now closed. The
original numbering is kept so an old reference still resolves — 4 (no tests),
5 (no CI) and 6 (Redis unused) are covered in the table above:

1. **Validation pipe** — registered as `APP_PIPE` in `CommonModule`, built with
   `createZodValidationPipe` rethrowing the raw `ZodError` (§3.4).
2. **Logging** — `LoggerModule` is wired with a `genReqId` that reuses an
   inbound `x-request-id`, and `app.useLogger` is called in `main.ts`. Verified
   end to end: a request sent with `x-request-id: trace-me-12345` comes back with
   that exact value in the error envelope's `requestId` and in the response
   header, so the field now joins a response to its log lines.
3. **Versioning** — `/api/v1` via `enableVersioning`, settled before the first
   endpoint shipped.
7. **`paths: {"@/*"}`** — deleted from `tsconfig.json`. `nest build` emits plain
   tsc output, so the first `@/` import would have compiled and failed at runtime.
8. **`packages/`** — `@sakura/contracts` is built and consumed by both apps.
9. **Seed** — `npm run db:seed` loads reference data always; `--sample` adds the
   placeholder catalog and refuses to run outside `NODE_ENV=development`.
10. **Pool** — `max` and `idle_timeout` set from env, so the per-instance
    connection budget is visible rather than an invisible default of 10.

Redis is now used, for throttler storage, and remains optional.

**One trap worth recording because it is silent.** Configuring a second *named*
throttler ("strict") alongside the default does not scope it to the routes whose
decorator names it — `ThrottlerGuard` applies every configured throttler to
every route, so the catalog was rate-limited to 10 requests a minute. Caught by
hitting `GET /books` thirteen times and getting three 429s. There is one global
bucket, and `@StrictThrottle` narrows *it* per route.

### Schema gaps: closed and remaining

| Frontend expects                                    | State                                                     |
| --------------------------------------------------- | --------------------------------------------------------- |
| `rating` + `ratingCount` on every book card          | `book_reviews` table, aggregated at read time; empty       |
| 8-char human order id (`MG-40718`)                   | `orders.order_number`, unique, minted with a retry         |
| 5 Bangladesh delivery regions in a `<select>`        | `delivery_regions` table, seeded, with postage overrides   |
| Payment method chosen at checkout (COD / transfer)   | `orders.payment_method` enum                               |
| Replay-safe payment webhooks                         | unique index on `payments (provider, provider_reference_id)` |
| Free-text catalog search                             | `pg_trgm` + GIN indexes on `books.title` and `authors.name` |
| Any admin at all                                     | still nothing — no users, no roles, no auth tables         |

---

## 2. Scope and purpose

Read off the frontend, the schema comments, and the i18n bundles:

**A small single-vendor online bookstore, guest-checkout only, serving
Bangladesh, in three languages (en / bn / ja).**

The defining constraints, all of which are deliberate and visible in the code:

- **No customer accounts.** There is no users table and no login in the UI.
  Order tracking is by order id plus email or phone. The idempotency key on
  `orders` exists precisely because there is no order history for a customer to
  check before clicking Place Order twice.
- **Cart is client-owned.** Redux + persist in the browser, resolved against the
  catalog at render time. There is no cart table and should not be one.
- **Payment is manual-first.** Cash on delivery and manual bank/bKash transfer
  ship now; card is drawn in the wireframe and explicitly deferred.
- **Small catalog.** Nine placeholder titles, `PAGE_SIZE = 6`, "when a title
  sells out we take it down rather than order more." This should calibrate every
  performance decision downward.
- **Snapshot-heavy order model.** Book title, author names, unit price, and
  coupon code are all frozen onto the order. Historical orders never join back
  to live catalog rows.

What is *not* in scope: multi-vendor, subscriptions, customer accounts,
wishlists, returns automation, warehouse/fulfilment integration.

---

## 3. Architecture decisions

Each is a recommendation, the reason, and the alternative rejected.

### 3.1 Modular monolith, organised by feature

One deployable Nest app. Modules follow bounded contexts (`catalog`, `pricing`,
`checkout`, `orders`, `payments`, `coupons`, `admin`), not technical layers
(`controllers/`, `services/`, `dtos/`).

*Why:* one team, one database, a catalog measured in dozens of titles. Feature
folders keep a change to coupon rules in one directory instead of spread across
four. *Rejected:* microservices (nothing here justifies a network hop);
layer-first folders (they scale with the number of technical concepts, not the
number of features).

Directory names are the easy half. Three rules make the boundaries hold:

**Every module has exactly one public surface: its `index.ts`.** It exports the
Nest module class, the services other modules may call, and the types those
signatures mention. Nothing outside the directory imports a deep path.
Enforced, not merely documented — `no-restricted-imports` in
`apps/api/eslint.config.mjs` fails the build on `../coupons/coupons.service`
while leaving `../coupons` alone. `src/db/**` is exempt: the schema tree's
`catalog/` and `orders/` folders share names with modules but are namespaces
inside one deliberate barrel, and their cross-references are foreign keys.

**The dependency graph is acyclic and flows one way.**

```
common · config · db     global infrastructure — anyone may use
catalog     → —
coupons     → —
inventory   → —
orders      → —                         owns the status machine
pricing     → catalog, coupons
checkout    → pricing, inventory, coupons, orders
payments    → orders
admin       → everything
```

`checkout` is the only orchestrator, which is the same statement as §3.3's
"the use-case service owns the transaction" seen from the module graph. If a
second module ever needs three others, that is the signal a boundary is wrong,
not that the graph needs another edge.

**Table ownership is per-module, and `books` is the acknowledged exception.**
`inventory` writes `stock_quantity` and `units_sold`; `catalog` owns everything
else on the row. A separate stock table would buy a tidier diagram in exchange
for a join and a consistency problem, on a shop with dozens of titles. The rule
that keeps the exception honest is directional: **catalog reads stock and never
writes it; inventory writes stock and never reads catalog columns.** This is
the first boundary that will be crossed by accident, so it is worth stating
before there is anything to cross it.

HTTP lives *inside* the module it belongs to — `catalog/books/books.controller.ts`,
not a top-level `controllers/`. Within a module the file names are
`<name>.{module,controller,service,errors,types,mapper}.ts`, the convention
`coupons/` already follows.

### 3.2 Service + Drizzle directly. No repository layer.

Services call Drizzle. There is no `BooksRepository`.

*Why:* Drizzle already *is* the data-access abstraction, and it is a query
builder — a repository over it either exposes a leaky pass-through or blocks the
composability that makes conditional catalog filtering readable. The
swap-the-database argument does not apply: the schema uses Postgres enums,
`jsonb`, partial constraints, and `tsvector` search. *Keep:* the `Executor`
parameter convention, which is what a repository would have been introduced to
provide anyway.

An absence does not survive contact with a contributor who reaches for the
pattern out of habit, so it has a guard: any file named `*.repository.ts` or
placed under `repositories/` fails lint with this reasoning attached. Cheaper
than finding it in review once a second file has been written against it.

### 3.3 The use-case service owns the transaction; collaborators accept `Executor`

`CheckoutService` opens `db.transaction()`. `CouponsService.redeem`,
`InventoryService.decrement`, and `OrdersService.create` all take a `tx` and
know nothing about who opened it.

*Why:* it is already the established pattern (`db.types.ts`, `coupons.service.ts`)
and it is the only way "reserve stock, redeem coupon, write order, write status
history" is atomic. *Rejected:* transaction-per-request middleware or
CLS/AsyncLocalStorage — implicit transaction scope makes it invisible at the
call site whether you are inside one, which is precisely what you need to know
when writing a guarded update.

**Which handle a method accepts is a correctness statement, not a style
choice.** `Executor` is a union, so it permits the root db — fine for a read,
wrong for a write whose whole failure mode is "the caller needs to roll this
back". The convention splits on that:

| Signature                                | Use for                                              |
| ---------------------------------------- | ---------------------------------------------------- |
| `executor: Executor = this.dbService.db` | reads, and writes that stand alone                   |
| `tx: Transaction` (no default)           | writes that are only correct alongside another write |

The second form is enforced by the compiler, not by comment: Drizzle's
transaction handle carries `rollback`/`setTransaction`, so `Database` is not
assignable to `Transaction` and a caller who forgot to open one gets a type
error. `CouponsService.redeem` and `InventoryService.decrement`/`increment`
take `Transaction` for this reason — a partial checkout that auto-commits half
its writes is not a scenario worth leaving representable. `evaluate` and
`availability` are reads and keep the defaulted `Executor`.

Rule of thumb: **if rolling this write back is part of how a caller recovers
from a later failure, it takes a `Transaction`.**

### 3.4 Zod for validation, shared with the frontend, via `nestjs-zod`

Adopt `nestjs-zod`'s `createZodDto` + `ZodValidationPipe`, registered globally.

*Why:* zod is already a dependency on both sides, the global filter already
maps `ZodError` to field-level errors with dotted paths, and the frontend's
`checkoutSchema` is already written in zod. `nestjs-zod` is preferred over a
hand-rolled pipe only because Swagger is already set up and a bare pipe would
produce an undocumented API. *Rejected:* class-validator — a second schema
language, duplicated on the client, and it cannot express `checkoutSchema`'s
cross-field refinement as cleanly.

**One trap, and it is silent.** nestjs-zod's stock `ZodValidationPipe` throws
`ZodValidationException`, which extends `BadRequestException` — an
`HttpException`. That falls straight past the filter's `ZodError` branch into
the generic `HttpException` branch, producing `code: "BAD_REQUEST"` with a
stringified message and **no `fields` array**. Every dotted path the form binds
to an input disappears, while the response still looks like a plausible 400.

So the pipe is built with `createZodValidationPipe({ createValidationException })`
rethrowing the raw `ZodError`, which puts it back on the branch written for it.
Registered as an `APP_PIPE` provider in `CommonModule`, matching how the filter
is registered and for the same DI reason. Verified end to end:

```
POST /api/v1/coupons/validate  {"code":"","subtotalCents":-5}
{ "error": { "code": "VALIDATION_FAILED", "fields": [
    { "path": "code", "code": "too_small", "message": "Enter a discount code." },
    { "path": "subtotalCents", "code": "too_small", "message": "…>=0" } ] },
  "requestId": "…", "timestamp": "…", "path": "/api/v1/coupons/validate" }
```

Note the message: it comes from the contract schema, so the API enforces the
same rule, with the same wording, that the form does.

### 3.5 `packages/contracts` is the shared source of truth

The empty `packages/` gets one workspace: zod schemas, inferred types, and the
error-code union, imported by both `@sakura/web` and `@sakura/api`.

*Why:* this is the single highest-leverage structural move available. It makes
the checkout payload, the catalog query params, and every `code` a client
branches on into one definition that cannot drift. `lib/checkout.ts`'s schema
moves here; `components/domain/types.ts` becomes a view model derived from a
contract type. *Rejected:* OpenAPI codegen from the Nest app — a heavier
pipeline, and it generates types only, not the runtime validators the forms need.

Built, as CommonJS + `.d.ts` — the Nest app is plain tsc/CJS and Next consumes
CJS from `node_modules` without complaint, so one artifact serves both. Modules:
`errors`, `pagination`, `catalog`, `coupon`, `cart`, `checkout`, `order`,
`shipping`.

Two consumers already prove it is load-bearing rather than decorative:
`CouponsService`'s rejection union is derived from
`COUPON_REJECTION_REASONS` instead of being a second hand-maintained copy, and
`apps/web/src/lib/checkout.ts` is now a re-export.

**Adopting it immediately found a bug.** The web `checkoutSchema` validated
`method` against all three payment methods including `card` — which §2 says is
deferred and the UI ships disabled. So the form's own validation would have
accepted an unorderable payment method; only the `disabled` attribute stopped
it. The contract splits `paymentMethods` (everything the shop will offer, for
rendering) from `acceptedPaymentMethods` (what the schema permits), and the
narrower type propagated out through `PaymentSection` as a typecheck failure.
That is the package working exactly as intended on day one.

Deliberately *not* in the package: view models, database row types, and the
delivery-region list. The regions table owns that vocabulary (Phase 1), and
freezing today's five values into a shared package would make adding a sixth a
package release. `region` is a slug string, validated server-side.

### 3.6 REST, URI-versioned, page-based pagination, error envelope only on errors

`app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" })` →
`/api/v1/...`. Success responses are the bare resource; only errors carry the
`{ error, requestId, timestamp, path }` envelope, exactly as `ErrorResponseDto`
already defines. Lists return `{ items, total, page, totalPages }` — matching
`CatalogResult`, which the pagination component already consumes.

*Rejected:* GraphQL (one client, fixed screens); cursor pagination (the UI draws
numbered pages, and the catalog is tiny).

Versioning is wired in `main.ts` with `defaultVersion: "1"`, so controllers get
v1 without annotating for it and the version only appears in code the day
something actually forks. `/api/coupons/validate` now 404s; `/api/v1/...`
serves. Settled before the first endpoint rather than after, because
retrofitting a version segment once clients exist means breaking them or
running two prefixes.

Pagination lives in `contracts/pagination.ts`: `pageQuerySchema()` coerces
query strings and caps `pageSize` at 100 — a cap rather than a 400, since the
point is bounding server work, and an unbounded page size is the cheapest
denial of service in any list API.

**One behavioural difference worth knowing.** The web app's
`parseSearchParams` deliberately degrades junk input to the default view, so a
hand-edited `?page=banana` renders page 1. The API's schema rejects it with
`VALIDATION_FAILED`. Both are right for their side — a shareable URL should
not error, an API should not guess — but they are no longer the same parse,
and the lenient one must stay on the web side.

### 3.7 Money: integer minor units, one currency, formatting is the client's job

The API returns `priceCents: 1400`. It never returns `"£14.00"`.

*Why:* the schema is already cents throughout, and a trilingual frontend must
format per locale anyway. **This is a breaking change to the frontend** —
`BookSummary.price` is a preformatted string today and `lib/catalog.ts` parses
the number back out of it to sort.

**DECIDED: BDT.** It follows the delivery regions and the cash-on-delivery /
bKash payment methods; the `£` prices and the "posted from Bristol" copy are
leftovers from the placeholder data, not evidence of a second market. Set as
`CURRENCY` in `config/env.schema.ts`.

Two consequences worth stating, because both are easy to get wrong later:

- **Minor units are poisha.** The columns are named `*_cents` and stay integers
  of 1/100 taka for consistency with the schema, but poisha are not used in
  practice — every real price is a multiple of 100. Clients format with
  `maximumFractionDigits: 0`; rendering `৳450.00` is wrong in a way a customer
  notices.
- **The shipping figures are not a units conversion.** `DELIVERY_FLAT` and
  `FREE_DELIVERY_THRESHOLD` in `apps/web/src/lib/cart.ts` are 350 and 3000 —
  £3.50 and £30. Reinterpreting those as taka gives ৳3.50 postage. The
  server-side values are set independently at ৳60 and ৳1,500, and the frontend
  constants are now wrong rather than merely duplicated.

A flat national rate also cannot express the usual inside/outside-Dhaka split.
If the shop charges differently by region, the rate belongs on the regions
table (Phase 1) as a per-region column, not as a bigger flat number.

### 3.8 The server is the pricing authority

The cart's *contents* are client state. The cart's *price* is not.

Add `POST /v1/cart/quote`, taking `[{ bookId, quantity }]` plus an optional
coupon code and region, returning resolved lines, subtotal, shipping, discount,
and total. `FREE_DELIVERY_THRESHOLD` and `DELIVERY_FLAT` move out of
`apps/web/src/lib/cart.ts` into a server-side shipping policy.

*Why:* those constants are shop policy sitting in a bundle a customer can edit.
Checkout must re-price from scratch and ignore any total the client sends —
which it must do regardless, so having two implementations of the ladder
guarantees they eventually disagree. `priceCart()` was written to be reusable
by exactly this endpoint.

### 3.9 Idempotent order creation

Client generates a UUID at checkout start and sends it as `Idempotency-Key`.
`orders.idempotency_key` is already unique. On a duplicate, the checkout service
catches the `23505` **before it reaches the global filter** and returns the
existing order with `200` instead of a new one.

*Note the interaction:* the Postgres mapper would otherwise turn that into
`ALREADY_EXISTS` / 409, which is wrong for this specific constraint. The catch
must be local to checkout and keyed on the constraint name.

### 3.10 Inventory: guarded decrement inside the checkout transaction

`UPDATE books SET stock_quantity = stock_quantity - $qty WHERE id = $id AND
stock_quantity >= $qty RETURNING stock_quantity`. Zero rows → `OutOfStockError`
(a `ConflictError`), which rolls the transaction back.

*Why:* identical idiom to `CouponsService.redeem`, and correct under concurrency
without any explicit locking. *Rejected:* a reservation/hold system — that is a
high-traffic-drop mechanism, and this shop takes a title down when it sells out.

`books.units_sold` is denormalised and, per its own schema comment, must be
updated **asynchronously** on `PAYMENT_CONFIRMED`, never inline. Use Nest's
`EventEmitter2` now; a queue is not warranted. Add a reconciliation job later.

### 3.11 Order status is a state machine, and every transition is logged

An explicit `Record<OrderStatus, OrderStatus[]>` transition map in
`orders/order-status.machine.ts`. All status changes go through
`OrdersService.transition(orderId, next, note, tx)`, which updates
`orders.status` and appends to `order_status_history` in one transaction.
No controller ever writes `status` directly.

*Why:* the schema is explicit that history is the source of truth and `status`
is a denormalised read cache. The only way to keep that true is a single write
path. It also makes "you cannot cancel a shipped order" a data structure rather
than a scattering of `if`s.

### 3.12 Payments: a provider port with adapters

```
interface PaymentProvider {
  readonly name: string;
  initiate(order, ctx): Promise<PaymentIntent>;
  verifyWebhook(raw: Buffer, headers): WebhookEvent;   // signature check
}
```

`CashOnDelivery` and `ManualTransfer` implement it now; `SslCommerz` / `Stripe`
later without touching checkout. Webhooks are signature-verified, need raw-body
access configured on those routes, and are made idempotent by the unique index
on `(provider, provider_reference_id)`.

*Why:* `payments.provider` is already a free-text column commented "abstracted,
swappable" — this is the code shape that comment implies.

### 3.13 Auth: none for the storefront, real auth for admin

Two audiences with opposite needs.

- **Storefront: no authentication.** Guest checkout is the product. Order lookup
  is authenticated by possession of the order id *plus* a matching email — and
  a mismatch must return `NOT_FOUND`, not `403`, which `domain.error.ts` already
  spells out: a "wrong email" response confirms the order id is real.
- **Admin: JWT in an httpOnly cookie**, `admin_users` table (new migration),
  a `@Roles()` guard, all routes under `/api/v1/admin`.

*Rejected:* building customer accounts (contradicts the entire design);
session-in-Redis for admin (a handful of staff users; JWT with a short TTL and
a rotation endpoint is less machinery).

### 3.14 Rate limiting on the three abusable endpoints

`@nestjs/throttler` with the Redis storage adapter (Redis is already in compose).
Tight limits on: coupon validation (code enumeration), order lookup (order-id
enumeration), and order creation. Generous everywhere else.

### 3.15 Caching: HTTP first, Redis only when measured

`Cache-Control` + `ETag` on catalog and book-detail responses. No application
cache layer until there is a number showing one is needed.

*Why:* dozens of titles in Postgres with correct indexes is sub-millisecond. A
Redis cache in front of it buys nothing and adds an invalidation bug surface.

### 3.16 Search: `pg_trgm`, not full-text, not Elasticsearch

A GIN trigram index over title and author name, queried with `ILIKE`/similarity.
Revisit `tsvector` if the catalog reaches thousands of titles.

### 3.17 Logging: finish the pino wiring that is already paid for

Import `LoggerModule.forRoot` with a `genReqId` that reuses an inbound
`x-request-id` or mints one, `redact` on authorization and cookie headers,
pretty transport in dev only, and `app.useLogger(app.get(Logger))` in `main.ts`.

*Why:* it turns the filter's existing `requestId` field from a decorative UUID
into a value that actually joins a response to its log lines — which is the
whole point of the field.

### 3.18 Testing: Vitest for units, supertest + a real Postgres for e2e

High-value unit targets, all pure or near-pure: discount computation, the
shipping/pricing ladder, the status transition map, coupon evaluation rejection
paths. E2e covers checkout end to end — idempotency replay, out-of-stock,
exhausted coupon — against a disposable Postgres with migrations applied.

*Rejected:* mocking Drizzle. The interesting bugs here are concurrency and
constraint bugs, and a mock cannot have a unique index.

### 3.18a Supabase is the database host, and nothing more

**DECIDED: Supabase**, in every environment including local development and CI.

*Why this changes almost nothing:* Supabase **is** Postgres. The schema, the
Drizzle query builder, the `Executor` convention, the guarded updates, the
transaction ownership rules and all four migrations are unaffected — the engine
under them is the same engine. What Supabase adds is a connection topology, a
platform-level exposure to close, and one extension convention.

*What it is explicitly not:* a backend. The web app talks to the Nest API and
only to the Nest API. `supabase-js`, PostgREST, RLS-as-authorization and
Supabase Auth are all unused, because the rules that matter here cannot be
expressed as row policies — server-authoritative pricing, the checkout
transaction, the guarded stock decrement and atomic coupon redemption are
procedural invariants spanning several tables, not per-row read predicates.
*Rejected:* letting the browser read the catalog directly through PostgREST. It
would be faster to write and would put a second, unversioned read path next to
the contract-typed one, with its own pagination and its own idea of what
"active" means.

**Three connection strings, two of them used.**

| Connection          | Port   | Used by                          |
| ------------------- | ------ | -------------------------------- |
| Transaction pooler  | `6543` | the API (`DATABASE_URL`)         |
| Session pooler      | `5432` | drizzle-kit, seed (`DIRECT_DATABASE_URL`) |
| Direct              | `5432` | nothing — IPv6-only on newer projects, which fails on IPv4 CI runners |

The split is a correctness requirement, not tuning. Transaction-mode pooling
hands consecutive statements different backend connections, so anything relying
on session state breaks: `drizzle-kit migrate` is such a client, and it fails
*intermittently* under pooling rather than loudly. The same property forces
`prepare: false` on the application connection — a statement prepared on one
backend is absent from the next, surfacing as `prepared statement "sN" does not
exist` under concurrency only. `main.ts` warns at boot if `DATABASE_PREPARE` is
on against a `:6543` URL, because that is the one misconfiguration here that
would otherwise be discovered in production, under load, hours after deploy.

**The exposure, and why migration `0003` exists.**

Supabase serves the `public` schema over PostgREST to anyone holding the anon
key — which is published in browser bundles by design. It also grants `anon` and
`authenticated` access to objects in `public` via `ALTER DEFAULT PRIVILEGES`,
and tables created by a migration (rather than through the dashboard) have no
RLS enabled. Composed: every table in this schema would be world-readable and
world-writable over HTTP without touching the API. `orders` alone carries
customer names, emails, phone numbers and addresses.

`0003_lock_down_public_schema` revokes those grants, revokes `USAGE` on the
schema so the roles cannot even enumerate it, revokes the *default* privileges
so the next table added is not silently republished, and enables RLS on every
table as a backstop. RLS with no policies is deny-all for those roles and a
no-op for ours: the owning role bypasses RLS unless `FORCE ROW LEVEL SECURITY`
is set, and it deliberately is not. The whole thing is guarded on the roles
existing, so it also applies cleanly to a plain Postgres.

**Extensions live in `extensions`, not `public`.** That is the Supabase
convention, and `0002` follows it — which is why the trigram indexes name
`extensions.gin_trgm_ops` rather than relying on `search_path`, a per-role
setting that would make the migration succeed or fail depending on who ran it.
Operator-class resolution happens once at `CREATE INDEX`; no query names it, so
nothing at runtime depends on the schema being on the path.

**What is lost by not running Postgres locally:** offline work, and a free
throwaway database per test run. The e2e suite (§3.18) will need a Supabase
branch rather than a container, and must never point at the shared project — a
suite that truncates between tests must not be able to reach real orders.
Redis stays in docker compose: it backs the rate limiter, holds nothing that
must survive a restart, and is not worth a managed instance.

### 3.19 Migrations run as a deploy step, never at boot

`drizzle-kit migrate` as its own command in the release pipeline, over
`DIRECT_DATABASE_URL` (the session pooler — see §3.18a). Two app instances
booting simultaneously must not both try to migrate, and CI never holds
credentials that could reach the database: the migration job diffs the schema
against the committed snapshots and opens no connection.

---

## 4. Target repository structure

```
packages/
  contracts/                    NEW — shared zod schemas + types + error codes
    src/{catalog,cart,checkout,order,coupon,errors}.ts

apps/api/src/
  main.ts                       + versioning, pino, validation pipe, raw body for webhooks
  app.module.ts
  config/
    env.schema.ts               EXISTS — extend
    shipping.config.ts          NEW — flat rate, free-delivery threshold, currency
  common/
    errors/                     EXISTS — leave alone
    pipes/zod-validation.pipe.ts
    decorators/{roles,public}.ts
    pagination/{page-query,paginated}.ts
  db/
    db.{module,service,types}.ts   EXISTS — Supavisor-aware (ssl, prepare, pool)
    schema/                        EXISTS — plus new migrations (§1 gaps)
    seed/seed.ts                   NEW
  catalog/
    books/{books.controller,books.service,book.query,book.mapper,book.errors}.ts
    categories/  authors/  publishers/
  pricing/
    pricing.service.ts          cart quote — the server-side priceCart()
    shipping.policy.ts
  coupons/                      EXISTS — add coupons.controller.ts
  inventory/
    inventory.service.ts        guarded stock decrement
    sales-rollup.listener.ts    async units_sold on PAYMENT_CONFIRMED
  checkout/
    checkout.controller.ts
    checkout.service.ts         the transaction owner
  orders/
    orders.service.ts
    order-status.machine.ts
    order-lookup.controller.ts
    order.errors.ts
  payments/
    payment-provider.port.ts
    providers/{cash-on-delivery,manual-transfer}.provider.ts
    webhooks.controller.ts
  admin/
    auth/{admin-auth.controller,admin-auth.service,jwt.guard,roles.guard}.ts
    {books,orders,coupons,media}/
  health/                       EXISTS

apps/api/test/e2e/
.github/workflows/ci.yml        NEW
```

---

## 5. Endpoint surface

All under `/api/v1`. `→` marks the frontend code each one replaces.

### Catalog (public, cacheable)

| Method | Path                | Notes                                                        |
| ------ | ------------------- | ------------------------------------------------------------ |
| GET    | `/books`            | `q, category, genre, sort, page, pageSize` → `queryCatalog()` |
| GET    | `/books/:slug`      | full detail with authors, categories, publisher               |
| GET    | `/categories`       | grouped by `categories.group` for the filter rail             |
| GET    | `/authors/:slug`    | author + their books                                          |

### Pricing (public)

| Method | Path                 | Notes                                                          |
| ------ | -------------------- | -------------------------------------------------------------- |
| POST   | `/cart/quote`        | items + optional coupon + region → priced cart → `buildCart()`  |
| POST   | `/coupons/validate`  | `{ code, subtotalCents }` → `CouponsService.evaluate()`; throttled |
| GET    | `/shipping/regions`  | replaces the hardcoded `regions` in `lib/checkout.ts`           |

### Orders (public)

| Method | Path                 | Notes                                                                  |
| ------ | -------------------- | ---------------------------------------------------------------------- |
| POST   | `/orders`            | `Idempotency-Key` header; re-prices server-side; one transaction         |
| POST   | `/orders/lookup`     | `{ orderNumber, email }` → order + status timeline. POST so the email    |
|        |                      | stays out of URLs and logs. Mismatch → `NOT_FOUND`. Throttled hard.      |

### Payments

| Method | Path                          | Notes                                     |
| ------ | ----------------------------- | ----------------------------------------- |
| POST   | `/payments/:provider/webhook` | raw body, signature-verified, idempotent   |

### Admin (`/api/v1/admin`, JWT + roles)

| Method                | Path                        |
| --------------------- | --------------------------- |
| POST                  | `/auth/login`, `/auth/logout` |
| GET                   | `/auth/me`                  |
| GET/POST/PATCH/DELETE | `/books`, `/authors`, `/categories`, `/publishers`, `/coupons` |
| GET                   | `/orders?status&q&page`, `/orders/:id` |
| POST                  | `/orders/:id/transition` — `{ status, note }`, through the state machine |
| POST                  | `/books/:id/stock` — audited adjustment |
| POST                  | `/media` — presigned upload |

### Health

`GET /health` exists. Add `/health/ready` (DB reachable) vs `/health/live`
(process up) if you deploy to anything with probes.

---

## 6. Build order

**Phase 0 — close the foundation gaps.** Global Zod validation pipe; wire
nestjs-pino; enable URI versioning; add throttler + Redis; create
`packages/contracts`; add Vitest and a first unit test over
`computeDiscountCents`; delete or properly wire the `@/*` tsconfig path; write
a seed script; add `.github/workflows/ci.yml` running lint, typecheck, test,
build. Nothing product-facing, and everything after it is faster.

**Phase 1 — schema catch-up.** Migrations for the §1 gaps: `admin_users`,
`orders.order_number` (unique, human-readable) and `orders.payment_method`,
a shipping regions table, the unique index on
`payments (provider, provider_reference_id)`, catalog indexes plus the pg_trgm
index. Decide reviews/ratings now — either add the table or strip
`rating`/`ratingCount` from `BookSummary`; shipping a card that renders a rating
no endpoint can supply is the worse outcome.

**Phase 2 — catalog reads.** Books, categories, authors. Seed real data.
Swap `lib/books.ts` and `queryCatalog` for React Query against these. First
end-to-end vertical slice, and it de-risks the contract package.

**Phase 3 — pricing.** `/cart/quote` and `/coupons/validate`; move the shipping
policy server-side; `CouponsService` finally gets a controller.

**Phase 4 — checkout.** The hard one. `POST /orders`: server-side re-price,
guarded stock decrement, coupon redemption, order + items + initial status
history, all in one transaction, behind idempotency. Then `/orders/lookup` and
the status timeline. E2e tests for replay, out-of-stock, and exhausted-coupon
are part of this phase, not after it.

**Phase 5 — payments.** Provider port, COD and manual-transfer adapters,
webhook endpoint with signature verification.

**Phase 6 — admin.** Auth, CRUD, order transitions, media upload.

**Phase 7 — hardening.** ETag/Cache-Control, the `units_sold` reconciliation
job, structured metrics, load-check the catalog query.

---

## 7. Decisions still needed from you

1. ~~**Currency.**~~ Decided: BDT — see §3.7. What it leaves open is content,
   not architecture: the nine placeholder titles need taka prices, and the
   Bristol copy needs rewriting.
2. **Ratings.** Real reviews table, imported/static ratings, or drop the feature?
3. **Order number format.** The UI promises "eight characters, like MG-40718".
   Confirm, then it becomes a DB-generated unique column.
4. **Payment gateway** for the card path — SSLCommerz and Stripe imply very
   different webhook and settlement work.
5. **Admin UI location** — a route group inside `apps/web`, or a separate app?
   Affects whether admin auth uses cookies or bearer tokens.
