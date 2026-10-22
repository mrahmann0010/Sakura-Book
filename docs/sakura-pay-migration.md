# Moving to `@project-sakura/pay`

sakura-book talks to the Nihonova payment gateway through its own hand-written client:
`apps/api/src/payment-gateway/` plus helpers in `orders/`. That code was extracted into a
published package, [`@project-sakura/pay`](https://www.npmjs.com/package/@project-sakura/pay).
This guide **deletes sakura-book's copy entirely** and uses the package directly. No wrapper
module, no copied helpers, no translation layer.

Do it as one change. The old client and the package must never both be live.

Read [payment-gateway-claims.md](payment-gateway-claims.md) first if you haven't. It explains the
order flow, which this guide keeps.

---

## 1. The boundary

After this change, the line between the two is strict.

**The package owns everything about the gateway.** sakura-book never reimplements any of it:

| Concern | Package export |
|---|---|
| HTTP, auth header, URL, timeouts, in-call retry | `createGatewayClient()` → `gateway.claims.claim()` |
| Reason codes → outcomes, the second underpayment check | inside `claim()` |
| Request validation, wallet-hint retry on `ambiguous_trx` | inside `claim()` |
| Money on the wire (poisha ⇄ taka) | inside `claim()` |
| Config rules (all-or-none, HTTPS, browser guard) | `createGatewayClient()` |
| Outcome types | `ClaimOutcome`, `ClaimOutcomeName`, `ClaimRejection`, `ClaimRequest`, `GatewayClient`, `Platform` |
| Claim-key format | `firstClaimKey`, `claimKeyFor`, `nextClaimKey` |
| Retry schedule | `nextRetryDelaySeconds`, `isRetryable`, `FAST_RETRY_DELAYS_SECONDS`, `LATE_RETRY_*` |
| Transaction-ID comparison form | `normaliseTrxId` |
| Test double | `@project-sakura/pay/testing`: `createFakeGatewayClient`, `claimedOutcome` |

**sakura-book owns its orders.** The package can't know about these, so they stay:

| Concern | Where it stays |
|---|---|
| Building the client from sakura-book's env | `orders/payment-gateway.provider.ts` (new, ~30 lines) |
| When to claim, which key is stored on the order, what an outcome does to an order | `OrderPaymentClaimService`, `OrderAutoVerifyService` |
| Running the retries (the job runner) | `ClaimRetryWorker`. The package computes the schedule; it never runs jobs |
| Granting an order | `PaymentsService` |
| The audit trail of every claim against an order | `PaymentVerificationLogService` + the `payment_verifications` table |
| The staff desk (Check & confirm, edit TrxID, release reminders) | `admin/orders/` |
| The env vars and their validation | `config/env.schema.ts` |

Rule of thumb: **if it would be the same for any business using the gateway, it belongs in the
package.** If it's about sakura-book's orders, it stays. Anything in the first group still written
in sakura-book after this change is a bug in the migration.

---

## 2. Install

```sh
cd apps/api
npm install @project-sakura/pay
```

It has no runtime dependencies and ships CommonJS with types, so it works with the API's
`"module": "commonjs"` / `"moduleResolution": "node"` setup as is. Check the version with
`npm view @project-sakura/pay version`.

---

## 3. Delete

```
apps/api/src/payment-gateway/                 ← the whole folder (6 files)
apps/api/src/orders/payment-claim-key.ts
apps/api/src/orders/payment-claim-retry.ts
apps/api/src/orders/receipt.ts                ← its only export is normaliseTransactionId
apps/api/test/unit/payment-gateway.spec.ts    ← after moving the env test out, see §8
```

And in `src/app.module.ts`, remove the `PaymentGatewayModule` import and its entry in `imports`.

---

## 4. Units and names

The package says **poisha** where sakura-book says **cents**. They're the same number (1/100 of a
taka), so **no value is converted, only names**:

| Old | Package | On |
|---|---|---|
| `expectedCents` | `expectedPoisha` | `ClaimRequest`, `UNDERPAID` |
| `provider` | `platform` | `ClaimRequest`, `CLAIMED` |
| `paidCents` | `paidPoisha` | `CLAIMED`, `UNDERPAID` |
| `overpaidCents` | `overpaidPoisha` | `CLAIMED` |
| — | `releasedAt: Date \| null` | `RELEASED` (new) |

Outcome names and rejection kinds are identical. `Platform` is the same union as `PaymentProvider`
in `@sakura/contracts`, so `order.provider ?? undefined` passes straight through.

**Stored data keeps sakura-book's names.** The `paid_cents` / `expected_cents` columns,
`PaymentVerificationRecord`, and the `raw` JSON passed to `confirmManually` stay `…Cents`. Map at
the point of writing (`paidCents: outcome.paidPoisha`). Renaming stored keys would break reading
old rows.

---

## 5. Add the client provider

The one piece of wiring sakura-book needs. It lives in `orders/` because orders is the only
feature that claims; admin reaches it through `OrderPaymentClaimService`.

`src/orders/payment-gateway.provider.ts`:

```ts
import { Logger, type Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createGatewayClient, type GatewayClient } from "@project-sakura/pay";
import type { Env } from "../config/env.schema";

/** Injection token for the shared @project-sakura/pay client. */
export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");

/**
 * The payment gateway client, built once from SAKURA_PAYMENT_GATEWAY_*.
 *
 * Everything about the gateway itself lives in @project-sakura/pay. This only
 * hands it our config. The env schema has already enforced all-three-or-none
 * (and all three in production); with none set, `enabled` is false and every
 * claim is UNAVAILABLE, so orders wait for a person rather than being
 * assumed paid.
 */
export const paymentGatewayProvider: Provider = {
  provide: PAYMENT_GATEWAY,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): GatewayClient =>
    createGatewayClient({
      baseUrl: config.get("SAKURA_PAYMENT_GATEWAY_URL", { infer: true }),
      clientId: config.get("SAKURA_PAYMENT_GATEWAY_CLIENT_ID", { infer: true }),
      secret: config.get("SAKURA_PAYMENT_GATEWAY_SECRET", { infer: true }),
      timeoutMs: config.get("SAKURA_PAYMENT_GATEWAY_TIMEOUT_MS", { infer: true }),
      logger: new Logger("PaymentGateway"),
    }),
};
```

Register it in `src/orders/orders.module.ts`, and export the token so `OrdersHttpModule` (the
retry worker) can inject it:

```ts
providers: [
  CheckoutService,
  OrdersService,
  PaymentVerificationLogService,
  OrderPaymentClaimService,
  paymentGatewayProvider,
],
exports: [
  CheckoutService,
  OrdersService,
  PaymentVerificationLogService,
  OrderPaymentClaimService,
  PAYMENT_GATEWAY,
],
```

---

## 6. Update the orders side

### `src/orders/order-payment-claim.service.ts`

It injects the package's client in place of the old `PaymentClaimService`.

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  claimKeyFor,
  nextClaimKey,
  nextRetryDelaySeconds,
  normaliseTrxId,
  type ClaimOutcome,
  type GatewayClient,
} from "@project-sakura/pay";
import { PAYMENT_GATEWAY } from "./payment-gateway.provider";
// …other imports unchanged, minus ../payment-gateway, ./receipt,
//    ./payment-claim-key and ./payment-claim-retry

constructor(
  private readonly dbService: DbService,
  @Inject(PAYMENT_GATEWAY) private readonly gateway: GatewayClient,
  private readonly verificationLog: PaymentVerificationLogService,
) {}
```

Then, inside the class:

| Where | Change |
|---|---|
| `isClaimable` | `normaliseTransactionId(…)` → `normaliseTrxId(…)` |
| `claim()` | `claimKeyFor(order)` → `claimKeyFor(order.orderNumber, order.paymentClaimKey)` |
| `attempt()` | `this.claims.claim({ … })` → `this.gateway.claims.claim({ … })`, with `expectedCents:` → `expectedPoisha:` and `provider:` → `platform:` |
| `retryAtFor()` | `this.claims.enabled` → `this.gateway.enabled`. Optionally replace the two-outcome check with `if (!isRetryable(outcome)) return null;` |

The old `PaymentClaimService` also logged one line per claim. Every claim is already written to
the verification log, so that line is optional. If you want it, add it in `attempt()` right after
the claim, e.g. `this.logger.log(...)` on `CLAIMED` and `this.logger.warn(...)` on anything other
than `PENDING_ARRIVAL`. The package logs contract problems (bad credential, malformed request, an
answer outside the contract) on its own, through the `PaymentGateway` logger.

### `src/orders/claim-retry.worker.ts`

```ts
import { Inject } from "@nestjs/common";
import type { GatewayClient } from "@project-sakura/pay";
import { PAYMENT_GATEWAY } from "./payment-gateway.provider";

constructor(
  private readonly dbService: DbService,
  @Inject(PAYMENT_GATEWAY) private readonly gateway: GatewayClient,
  private readonly autoVerify: OrderAutoVerifyService,
  private readonly config: ConfigService<Env, true>,
) {}
```

`this.claims.enabled` → `this.gateway.enabled`. Nothing else changes; the worker never calls
`claim()` itself.

### `src/orders/payment-verification-log.service.ts`

`toClaimRecord` moves into this file as a module-private function. Turning a gateway answer into a
row against an order is the log's job. Paste it below the imports and import `ClaimOutcome` from
the package:

```ts
import type { ClaimOutcome } from "@project-sakura/pay";
import { normaliseTrxId } from "@project-sakura/pay";

/**
 * Flatten a claim for the log: what we concluded, when, and enough of the
 * evidence to explain it later without asking the gateway again — which is
 * not possible anyway, since it has no read endpoint. The package says
 * poisha; the log says cents. Same number, only the names differ.
 */
function toClaimRecord(
  outcome: ClaimOutcome,
  context: { transactionId: string; expectedCents: number; claimKey: string },
): PaymentVerificationRecord {
  const base = {
    outcome: outcome.outcome,
    checkedAt: new Date().toISOString(),
    transactionId: context.transactionId,
    expectedCents: context.expectedCents,
    claimKey: context.claimKey,
  };

  switch (outcome.outcome) {
    case "CLAIMED":
      return {
        ...base,
        provider: outcome.platform,
        paidCents: outcome.paidPoisha,
        overpaidCents: outcome.overpaidPoisha,
        claimedAt: outcome.claimedAt.toISOString(),
      };
    case "UNDERPAID":
      return { ...base, paidCents: outcome.paidPoisha ?? undefined };
    case "ALREADY_CLAIMED":
      return { ...base, claimedAt: outcome.claimedAt?.toISOString() };
    case "REJECTED":
    case "MISCONFIGURED":
    case "UNAVAILABLE":
      return { ...base, reason: outcome.reason };
    case "PENDING_ARRIVAL":
    case "RELEASED":
      return base;
  }
}
```

`normaliseTransactionId(record.transactionId)` → `normaliseTrxId(record.transactionId)`. Update the
header comment: the boundary it describes is now the package, not `payment-gateway/`.

### Everything else

| File | Change |
|---|---|
| `src/orders/order-auto-verify.service.ts` | `ClaimOutcome` from `@project-sakura/pay`. In the `raw` object: `paidCents: outcome.paidPoisha`, `overpaidCents: outcome.overpaidPoisha` |
| `src/orders/checkout.service.ts` | `firstClaimKey` from `@project-sakura/pay` |
| `src/orders/transaction-id-claim.ts` | `normaliseTransactionId` → `normaliseTrxId` from `@project-sakura/pay` |
| `src/orders/index.ts` | delete the `claimKeyFor` / `nextClaimKey` and `normaliseTransactionId` re-exports. Callers import from the package |
| `src/admin/orders/admin-orders.service.ts` | import `claimKeyFor`, `nextClaimKey`, `normaliseTrxId`, `ClaimOutcome` from `@project-sakura/pay`. `raw` object as above. `summarizeClaim`: `paidCents` → `paidPoisha`, `overpaidCents` → `overpaidPoisha`, `outcome.provider` → `outcome.platform`. Around line 1106: `claimKeyFor(order)` → `claimKeyFor(order.orderNumber, order.paymentClaimKey)`. Around line 1080: `normaliseTransactionId` → `normaliseTrxId` |
| `src/db/schema/orders/order.ts` | comment on `transactionIdNormalised`: "Mirrored in `normaliseTransactionId`" → "Mirrored in `normaliseTrxId` from `@project-sakura/pay`" |
| `src/config/env.schema.ts` | comment: "See `src/payment-gateway/`" → "See `src/orders/payment-gateway.provider.ts` and `@project-sakura/pay`" |

### Confirm nothing is left

```sh
cd apps/api
grep -rnE "payment-gateway\"|payment-gateway/|PaymentClaimService|PaymentGatewayModule|payment-claim-key|payment-claim-retry|normaliseTransactionId|from \"\./receipt\"|outcome\.(paidCents|overpaidCents|provider)|expectedCents: order" src test
```

This should find nothing. The only `…Cents` names left on gateway data should be in stored-row
code (§4). Then run `npm run typecheck`. Outcomes are discriminated unions, so a missed rename
fails to compile.

---

## 7. Why `normaliseTrxId` replaces sakura-book's own

`normaliseTransactionId` mirrored the `transaction_id_normalised` generated column, which backs
sakura-book's "TrxID already used by another of our orders" check. The package's `normaliseTrxId`
is the gateway's own comparison form, and today it's identical: strip everything except
`A-Z a-z 0-9`, then uppercase. Using it means sakura-book's duplicate check and the gateway's
can't disagree about whether two IDs are the same.

**Keep the agreement test** from `test/unit/receipt-normalise.spec.ts` ("matches the SQL the
generated column uses"), pointed at `normaliseTrxId`. Rename the file to `trx-id-normalise.spec.ts`.
It's now the guard that fails if a package upgrade ever changes normalisation, which would need
a matching migration of the generated column.

---

## 8. Tests

### `test/unit/payment-gateway.spec.ts` → delete

Almost all of it tested code the package now owns (`toGatewayBody`, `interpretClaimResponse`,
`GatewayHttpClient`, `PaymentClaimService`, claim keys). The package covers those with 84 unit
tests and 26 end-to-end tests against a real gateway.

Two blocks are still sakura-book's and must survive:

- **`payment gateway env`:** the all-three-or-none env check. Move it to
  `test/unit/env-payment-gateway.spec.ts`.
- **`toClaimRecord`:** it's now private to the log service, so test it through
  `PaymentVerificationLogService.recordClaim` with a fake db (assert on the inserted row), or
  export it from the log service file and test it directly. Fixtures use poisha names.

### `test/unit/payment-claim-flow.spec.ts` → keep, adapt

This tests sakura-book's order logic, so all of it stays. Changes:

- **The fake gateway is the package's test double**, passed where the old `PaymentClaimService`
  fake went:

  ```ts
  import { claimedOutcome, createFakeGatewayClient } from "@project-sakura/pay/testing";
  import type { ClaimOutcome } from "@project-sakura/pay";

  function claimsWith(answers: ClaimOutcome[], options: { enabled?: boolean } = {}) {
    const gateway = createFakeGatewayClient(answers, { enabled: options.enabled ?? true });
    // …db and log fakes unchanged…
    const service = new OrderPaymentClaimService(db as never, gateway, log as never);
    return { service, gateway, /* … */ };
  }
  ```

  Assertions on what was sent read `gateway.calls[n]`, e.g.
  `expect(gateway.calls[0]).toMatchObject({ expectedPoisha: 125_000, platform: "bkash", idempotencyKey: "SB-10482:1" })`.
- **Fixtures:** `CLAIMED` becomes `claimedOutcome({ platform: "bkash", paidPoisha: 130_000, overpaidPoisha: 5_000 })`.
  `UNDERPAID` uses `expectedPoisha` / `paidPoisha`. `RELEASED` gets `releasedAt: null`.
- **Imports:** retry constants from `@project-sakura/pay`. Delete the
  `describe("nextRetryDelaySeconds")` block, which now tests the package.

Then:

```sh
npm run typecheck && npm test && npm run lint
```

---

## 9. Behaviour differences

1. **One automatic retry inside a call.** On a network error, timeout or 5xx, the package retries
   once with the same key before answering `UNAVAILABLE`. This is safe: the same key replays our
   own claim. The whole call is capped at 8s (`totalBudgetMs`); before, it was a single 5s attempt.
   Checkout waits on the first claim, so the worst case goes from 5s to 8s. Keep it: most network
   blips now become an answer instead of a background retry. For the old behaviour exactly, add
   `maxRetries: 0` to the provider.
2. **`RELEASED` carries `releasedAt`.** Nothing uses it yet. It's there for the "release reminder
   never clears" gap in payment-gateway-claims.md §11.
3. **The URL must be HTTPS, except `localhost` / `127.0.0.1` / `[::1]`.** `createGatewayClient`
   throws at boot otherwise. From inside the `api` Docker container, a gateway on the host is
   `http://host.docker.internal:3001`, which is refused. Locally, either leave the three vars
   unset (claims are `UNAVAILABLE`, the current default) or run the API on the host to test
   against the gateway.
4. **Fractional taka is verified.** `expectedPoisha: 125_050` goes out as `1250.5`, and the
   package's end-to-end tests confirm the gateway accepts and returns it exactly. That closes the
   "check that the gateway accepts fractional taka" item in payment-gateway-claims.md §11.

Same endpoint, same auth, same reason-code mapping, same never-throw guarantee.

---

## 10. Out of scope, on purpose

- **The verification log, the `payment_verifications` table, and the admin desk stay.** They're
  sakura-book's record of what happened to its own orders. The gateway has no read endpoint, so
  nothing else can answer "what did we conclude about order SB-10482, and who asked?"
- **`MATCHED` / `NOT_FOUND` stay in `paymentVerificationOutcomes`** and the
  `payment_verification_outcome` Postgres enum. They're history from before claims, when the shop
  read the gateway's database directly. Postgres can't drop an enum value without recreating the
  type, and old rows would have to be rewritten to an outcome that never happened. The values
  cost nothing and nothing produces them anymore. Leave them.
- **The env var names don't change.** `SAKURA_PAYMENT_GATEWAY_URL`, `_CLIENT_ID`, `_SECRET`,
  `_TIMEOUT_MS` are what production is configured with.

---

## 11. Verify end to end

1. Start the gateway locally on `:3001` (see the gateway repo's CLAUDE.md) and register a test
   business on its Businesses page.
2. Run sakura-book's API **on the host** (§9.3) with:
   ```env
   SAKURA_PAYMENT_GATEWAY_URL=http://127.0.0.1:3001
   SAKURA_PAYMENT_GATEWAY_CLIENT_ID=<test business id>
   SAKURA_PAYMENT_GATEWAY_SECRET=<its secret>
   ```
3. One check per outcome:
   - a paid order confirms automatically
   - an order paid after placing confirms within a minute (retry worker)
   - a TrxID already claimed by another business → `ALREADY_CLAIMED`
   - an underpayment → `UNDERPAID`
   - gateway vars unset → order stays `PENDING`, and the worker logs that retries are off
   - the same request retried → `CLAIMED` with `replay: true`
4. The gateway dashboard's Claims page shows the order numbers.

---

## 12. Done when

- [ ] `src/payment-gateway/`, `payment-claim-key.ts`, `payment-claim-retry.ts`, `receipt.ts` and
      `payment-gateway.spec.ts` are gone
- [ ] `src/orders/payment-gateway.provider.ts` is the only file that calls `createGatewayClient`
- [ ] The grep in §6 finds nothing
- [ ] `npm run typecheck && npm test && npm run lint` pass
- [ ] §11 passes
- [ ] [payment-gateway-claims.md](payment-gateway-claims.md) updated: the diagram's
      `payment-gateway/` box becomes `@project-sakura/pay`, the file links in §2, §3, §4, §6 and §12
      point at the package or the new provider file, and the fractional-taka item in §11 is checked
      off
- [ ] One commit: "Replace the in-house gateway client with @project-sakura/pay"

## Upgrading later

The package follows semver. Patch and minor versions are drop-in (`npm update @project-sakura/pay`).
**A major version means a new outcome was added.** The compiler then points at every `switch`
that needs a case for it, and `toClaimRecord` is one of them. If `normaliseTrxId` ever changes,
the agreement test from §7 fails, and the `transaction_id_normalised` column needs a matching
migration before upgrading.
