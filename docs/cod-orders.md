# Cash on delivery (COD) orders

Status: **Steps 0A, 0B, 1 in review (PR #100)** · Last updated: 2026-11-19 · Base branch: `deployment`

How Sakura Book takes COD orders with no advance payment, with every COD order
approved by staff before it is packed. This file has seven parts:

- §0 where things stand (read this first)
- §1 the process
- §2 the decisions
- §3 the state design
- §4 the implementation plan, step by step, with checkboxes
- §5 the progress log
- §6 open questions

Update §0, the checkboxes and the log as work lands.

---

## 0. Where things stand

### Built (PR #100 → `deployment`, not merged yet)

One PR, 9 commits, branch `feat/cod-approval-flow`. Branches `feat/cod-payment-status` (0A) and `feat/cod-revenue-by-payment` (0B) are folded into it.

| Step | What it does | Key files |
|---|---|---|
| 0A | `orders.payment_status` (`UNPAID / PAID / COLLECTED / REMITTED / REFUNDED`), written only by `OrdersService.transition`. Migration **0047** adds and backfills it. | `apps/api/src/orders/payment-status.ts`, `orders.service.ts` |
| 0B | Dashboard "collected" and the Payments page count money received (`MONEY_RECEIVED_STATUSES`), COD dated by delivery. Payment badge in admin. | `admin-dashboard.service.ts`, `admin-payments.service.ts`, `components/admin/payment-safety.tsx` |
| 1 | COD back in checkout (after bKash/Rocket/Nagad) with a required tick; Messenger confirmation card with a copyable Bangla message; approve/deny in admin; SMS on approve. Migration **0048**. | `admin/orders/admin-cod.service.ts`, `admin/orders/cod-approval.ts`, `components/checkout/payment-section.tsx`, `components/orders/confirm-cod-order.tsx`, `lib/contact.ts` |

**Merging PR #100 turns COD on for every customer.** Deploy steps:
- run migrations 0047 and 0048
- make sure the `SMS_GATEWAY_*` settings are set in production

### Running COD now (manual parts until Step 2/3)

| Not built yet | Do this meanwhile |
|---|---|
| 48 h auto-cancel | Check **Orders → COD to confirm** daily. Deny orders older than 48 h with no message (reason: "No confirmation within 48 hours"). Stock returns. Until then they hold stock. |
| Waiting-order badge | The count shows on the COD tab itself. |
| Duplicate / repeat-refuser flags | Search the order list by phone before approving. |
| Recording Pathao payouts | Track outside the app as today. Delivered COD orders show "With courier". |

### Still to check after deploy (couldn't be tested locally)
- [ ] On a real phone, tap **Confirm on Messenger**: it opens the Nihonova chat; note whether the draft message is filled in.
- [ ] With the SMS gateway on, approve an order and check the text arrives.

### Remaining work, in order

1. **Step 2: housekeeping** (§4)
   - 48 h expiry worker (the important one: checkout already promises it)
   - make 48 h a shop setting
   - queue badge
   - duplicate-phone flag
   - per-phone history badge
2. **Step 3: COD money tracking** (§4)
   - mark remitted (single/bulk)
   - COD payment row on remittance
   - cash-with-Pathao report
   - later: Pathao payout import
3. **Step 0C: cleanup** (§4): rename `PAYMENT_CONFIRMED` → `CONFIRMED`, move refunds into payment status. Nothing user-visible.
4. **Returns (needs a decision, §6):** a `RETURNED` status for refused parcels, with stock back only when the parcel is in hand.

### Decisions waiting on the owner
- **Who approves:** currently STAFF + ADMIN. Owner originally said "admin". ADMIN-only is a one-line `@Roles("ADMIN")` on the two routes in `admin-orders.controller.ts`.
- **Refused parcels:** see §6.
- **COD confirmation email:** see §6.

### Testing locally (how Step 1 was verified)
A throwaway Postgres 18, so nothing touches the real database:
1. `initdb --locale=C`; start with `LC_ALL=en_US.UTF-8` on port 55432.
2. Apply `apps/api/drizzle/*.sql` with `psql`.
3. In the worktree, create `apps/api/.env` with only `DATABASE_URL=postgres://postgres@localhost:55432/t`, `DATABASE_SSL=disable`, `PORT=4100`, `WEB_ORIGIN=http://localhost:3100`. Delete it afterwards.
4. Seed: `npx tsx src/db/seed/seed.ts --sample --admin-email=…` (with `ADMIN_BOOTSTRAP_PASSWORD`).
5. Run `npx nest start` and `NEXT_PUBLIC_API_URL=http://localhost:4100 npx next dev -p 3100`.

API routes are under `/api/v1`.

---

## 1. The process

1. **The customer chooses COD at checkout** and must tick:
   > আমি অর্ডারের বই ও মোট মূল্য (৳X, ডেলিভারি চার্জসহ) দেখেছি এবং ডেলিভারির সময় পরিশোধ করতে প্রস্তুত।

   The live total sits next to the box. The order can't be placed without the tick, and the tick is saved with a timestamp.
2. **The order is created as `PENDING`.** Stock is taken now (current checkout behaviour).
3. **The customer sees a COD confirmation screen**, not the bKash payment modal:
   - "One more step: message us to confirm your order", with the order number and the 48 h deadline
   - a copyable Bangla message: "আমি আমার ক্যাশ অন ডেলিভারি অর্ডার {order} নিশ্চিত করতে চাই। অনুগ্রহ করে অনুমোদন দিন।"
   - a **Confirm on Messenger** button (`m.me/nihonovaacademy`, the same message pre-typed)
   - the tracking page shows the same card until the order is approved or denied
4. **The customer messages the page.** Confirmation is the customer's job. The shop does not chase.
5. **The admin checks the order:**
   - the order matches the conversation (books, phone, address)
   - the Facebook profile looks genuine
6. **The admin decides:**
   - **Approve** → the order moves to the packer as usual.
   - **Deny** → cancelled, with a reason (suspicious / duplicate / customer declined). Stock returns.
7. **No contact within 48 h** → cancelled with the reason "expired". Stock returns. *(Manual Deny until the Step 2 worker exists.)*
8. **Delivered** → payment status `COLLECTED` (Pathao has the cash) → `REMITTED` when Pathao pays the shop.

## 2. Decisions

| # | Question | Decision | By |
|---|---|---|---|
| 1 | Advance delivery charge? | **No.** COD with no advance for now. Can be added later for flagged customers. | Owner |
| 2 | Who starts the confirmation? | **The customer**, via the Facebook page. The shop does not call. | Owner |
| 3 | How is an order vetted? | Order details plus the customer's social profile. Suspicious orders are denied. | Owner |
| 4 | Commitment step | A required tick box with the exact total, saved with a timestamp. | Owner |
| 5 | Who approves? | Owner said "admin". **Built as STAFF + ADMIN** (same as confirming bKash); packers can't. ADMIN-only is a one-line change. | Owner to confirm |
| 6 | Record how/why | **Yes.** Confirmation channel and note on approve, reason on deny. | Owner |
| 7 | Customer sees the waiting state | **Yes.** Tracking page shows "নিশ্চিতকরণের অপেক্ষায়" (waiting for confirmation). SMS on approve. | Owner |
| 8 | When is stock taken? | **At order placement** (unchanged). Returned on deny or expiry. Can be revisited later. | Owner |
| 9 | Unconfirmed order expiry | **48 h**. A code constant (`COD_CONFIRMATION_HOURS`) for now; becomes a shop setting in Step 2. | Owner |
| 10 | Customer can cancel a waiting COD order? | **No**, not for now. Only the admin or the expiry cancels. | Owner |
| 11 | Order state model | **Separate payment status from order status** (§3). Done in the expand → migrate → contract order. | Owner |
| 12 | Payment option order | **bKash, Rocket, Nagad, Cash on delivery**, then Card (disabled). | Owner |
| 13 | Confirmation message | A fixed **Bangla** message with a Copy button, also pre-typed in Messenger. Bangla on every site language. | Owner |

## 3. State design

### 3.1 The problem: one field answers two questions

`orders.status` tracks two lifecycles in one field:

- **Fulfilment:** where is the order? (waiting, approved, packing, shipped, delivered)
- **Payment:** where is the money? (unpaid, paid, refunded)

For prepaid orders the two move together, so `PAYMENT_CONFIRMED` was a fine
name. COD breaks that: an approved COD order is packed and shipped while
unpaid, and its money arrives after `DELIVERED`, and again when Pathao pays
out.

**What the code does today** (found while planning, checked by reading the code):

- A COD order reaches `PROCESSING` only by passing through `PAYMENT_CONFIRMED`.
  `CashOnDeliveryProvider` documents this as "accepted for fulfilment".
- Everything that listens for `PAYMENT_CONFIRMED` treats it as "money arrived":
  - dashboard revenue and its `recognisedAt` date
  - `units_sold`
  - the order confirmation email
  - waitlist settlement
- So **a COD order is counted as revenue when it is accepted for packing, not when the cash arrives.**
  The dashboard's own comment says COD revenue appears on delivery, which no longer matches the code.
- **No payment row is ever written for a COD order.** `CashOnDeliveryProvider.initiate` describes one being created at checkout, but nothing calls it.
  The app has no record of COD cash being collected.

This is why the split comes before COD goes live: turning on COD at volume
with today's model would put unpaid orders into the revenue figures.

### 3.2 Target model: two fields

**`orders.status`** tracks fulfilment only, the same path for every payment method:

```text
PENDING ──▶ CONFIRMED ──▶ PROCESSING ──▶ SHIPPED ──▶ DELIVERED
   │            │              │
   └────────────┴──────────────┴──▶ CANCELLED
```

- `CONFIRMED` (today's `PAYMENT_CONFIRMED`, renamed in step 0C) means **approved to pack**. What causes it depends on the method:
  - prepaid: the payment is verified
  - COD: the admin approves
- `REFUNDED` moves to payment status (step 0C). A refund is a money event, not a place in the order's journey.
- A `RETURNED` status for refused parcels is a later addition, out of scope here.

**`orders.payment_status`** is new and tracks money only:

| Value | Prepaid | COD |
|---|---|---|
| `UNPAID` | from checkout until verified | from checkout until delivery |
| `PAID` | payment verified | — |
| `COLLECTED` | — | delivered; Pathao holds the cash |
| `REMITTED` | — | Pathao paid the shop |
| `REFUNDED` | money returned | (a returned advance, later) |

The existing `payments` table (`PENDING / SUCCEEDED / FAILED / REFUNDED /
VOIDED`) stays the detailed record of each payment. `orders.payment_status`
is the summary used for filters and reports.

How it is written (as built in 0A):
- Only `OrdersService.transition` writes it, in the same guarded update as the status change.
- The rule is the pure function `nextPaymentStatus` in `apps/api/src/orders/payment-status.ts`:
  - into `REFUNDED` → `REFUNDED`
  - `PAYMENT_CONFIRMED → PENDING` (revert) → `UNPAID`
  - prepaid into `PAYMENT_CONFIRMED` → `PAID`
  - COD into `DELIVERED` → `COLLECTED`
  - anything else → unchanged
- A prepaid order cancelled after payment stays `PAID`, because a refund is still owed.
- Money events that are not status changes (remittance in Step 3) will write the field directly.
- COD payment rows will be recorded in Step 3, when the actual remitted amount is known.

**Rules that follow from this:**
- Revenue = orders whose payment status is `PAID`, `COLLECTED` or `REMITTED`. It is dated by when money arrived, never by order status.
- Packer queue = `CONFIRMED` + `PROCESSING`, whatever the payment method.
- COD approval queue = `PENDING` + method `cash-on-delivery`.
- "Cash still with Pathao" = `COLLECTED`.

### 3.3 Industry practice

- **Shopify:** separate *financial status* and *fulfillment status*. COD shows "Payment pending" while being fulfilled.
- **Magento / Adobe Commerce:** invoices (money) are kept apart from shipments.
- **Marketplaces (Amazon, Daraz):** payment, fulfilment and returns are separate processes.
- **WooCommerce:** one status field. It's the usual example of the problem, with "processing" meaning different things for COD and prepaid orders.

### 3.4 Why expand → migrate → contract

`PAYMENT_CONFIRMED` is referenced about 240 times. Those references are in:

- the state machine
- revenue and dashboard
- `units_sold`
- email
- waitlist
- packer scope
- revert/refund flows
- web labels
- tests

Changing all of them in one go risks quietly miscounting revenue or hiding
orders from the packer. Instead:

1. **Expand (0A):** add `payment_status` and keep it correct on every write. Nothing reads it yet, so nothing can break.
2. **Migrate (0B):** move the money readers (revenue, payments page) to `payment_status`, one area at a time, and compare against the old numbers.
3. **Contract (0C):** rename `PAYMENT_CONFIRMED` → `CONFIRMED`, move `REFUNDED` out of order status, and remove the leftovers.

COD goes live after 0A and 0B. 0C is a cleanup that can follow at any pace.

## 4. Implementation plan

Each step is one PR unless noted. Every PR ships with its tests.

### Step 0A: expand: add `payment_status`
Goal: every order carries a correct payment status. No behaviour changes.

- [x] **Enum + column:** `order_payment_status` (`UNPAID, PAID, COLLECTED, REMITTED, REFUNDED`) and `orders.payment_status NOT NULL DEFAULT 'UNPAID'`. Migration `0047_order_payment_status`.
- [x] **Backfill** in the same migration:
  - order status `REFUNDED` → `REFUNDED`
  - COD + `DELIVERED` → `COLLECTED`
  - prepaid at or past `PAYMENT_CONFIRMED` → `PAID`
  - prepaid `CANCELLED` whose last live status was `PAYMENT_CONFIRMED`/`PROCESSING` → `PAID`
  - everything else → `UNPAID`

  Verified on a throwaway Postgres 18: migrations 0000–0046 applied, then 11 sample orders, then 0047. All 11 matched.
- [x] **Contracts:** `orderPaymentStatuses` in `@sakura/contracts`. `paymentStatus` on `Order` (customer + admin detail) and `AdminOrderSummary`.
- [x] **Write path:** one place, `OrdersService.transition`, using `nextPaymentStatus` (see §3.2). This covers every confirm route (webhook, manual, gateway claim, admin advance), revert and refund, because they all go through it.
- [x] **Not in 0A, moved to Step 3:** writing a COD payment row. No such row exists today, and the real amount is only known at remittance.
- [x] **Tests:** `test/unit/payment-status.spec.ts`
  - enum ↔ contract agreement
  - every rule
  - the same 11 histories replayed through the rule, so the backfill and the code agree
- [x] **Checks:**
  - API: 718 tests pass, typecheck and lint clean
  - web: typecheck clean

### Step 0B: migrate: money readers use `payment_status`
Goal: revenue means money, for every method.

- [x] **Shared definition:** `MONEY_RECEIVED_STATUSES` = `PAID`, `COLLECTED`, `REMITTED` (`apps/api/src/orders/payment-status.ts`). Both screens import it.
- [x] **Dashboard revenue** (`admin-dashboard.service.ts`):
  - "collected" counts only money received
  - dated by when the money arrived: prepaid on `PAYMENT_CONFIRMED`, COD on `DELIVERED`
  - "ordered" is unchanged (accepted orders, by placement date)
  - covers today / 7 days / 30 days, the 12-month trend and the monthly drill-down, all through the one shared base query
- [x] **Payments page** (`admin-payments.service.ts`): the collected/expected split reads `payment_status` instead of "not COD, or delivered". Same numbers today, one rule instead of two.
- [x] **Admin payment badge:** Unpaid / Paid / With courier / Remitted / Refunded
  - order list: under the status
  - order detail: "Money" row in the Payment card
- [x] **Stays on order status, on purpose** (fulfilment events, not money):
  - `units_sold`
  - the confirmation email
  - waitlist settlement
  - packer scope
- [x] **Copy:** dashboard chart caption and service comments now describe the real behaviour.
- [x] **Check:** ran the real `AdminDashboardService` and `AdminPaymentsService` on a throwaway Postgres with 6 known orders. All figures matched by hand. The 0A version of the dashboard, run on the same data, showed an accepted-but-undelivered COD order as collected (3,000 vs the correct 5,000 today), confirming the bug.

**Effect after deploy:**
- COD revenue on the dashboard moves from the day an order was accepted to the day it was delivered.
- Accepted COD orders not yet delivered leave "collected" but stay in "ordered".
- Prepaid figures and the Payments page totals do not change.

### Step 1: COD approval flow (COD goes live)
Goal: the process in §1, end to end.

- [x] **COD back in checkout.** It had been removed from the payment form in August (`c4a3ed6`); the API still accepted it. Restored as the first payment option. **Deploying this makes COD visible to every customer.**
- [x] **Commitment tick box:** shown when COD is selected, with the "how it works" text (message us on Facebook, 48 h) and the exact total. Required by the shared checkout schema (`codAcknowledged`), so the API refuses a COD order without it. Stored as `cod_acknowledged_at`.
- [x] **No payment modal for COD:** both checkouts (cart and waitlist invite) go straight to the thank-you screen.
- [x] **Thank-you screen:** "One more step: message us to confirm" card above the receipt:
  - (COD is now listed after bKash, Rocket and Nagad, before Card)
  - a fixed Bangla message to send, with a **Copy** button: "আমি আমার ক্যাশ অন ডেলিভারি অর্ডার {order} নিশ্চিত করতে চাই। অনুগ্রহ করে অনুমোদন দিন।" (Bangla in every site language, because it's addressed to the shop's team)
  - a **Confirm on Messenger** button that opens a chat with the page (`m.me/nihonovaacademy`) with the same message pre-typed. The pre-typed draft isn't guaranteed in every Messenger version, which is why the copy box exists.
- [x] **Tracking page:** while waiting, it shows "Waiting for you to confirm on Facebook" and the same Messenger card. COD orders use "Order confirmed" instead of "Payment verified" in the progress bar and headline.
- [x] **DB (migration `0048`):**
  - `cod_acknowledged_at`, `cod_confirmed_at`, `cod_confirmed_by`, `cod_confirmation_channel` (`FACEBOOK | PHONE | OTHER`), `cod_confirmation_note`
  - audit actions `COD_APPROVED`, `COD_DENIED`
  - no cancel-reason column: the existing status-history note and audit note are used
- [x] **Admin API** (`AdminCodService`):
  - `POST /admin/orders/:n/cod/approve` (channel + optional note) → `PAYMENT_CONFIRMED`, payment status stays `UNPAID`, SMS to the customer after commit (one Bangla segment, best effort)
  - `POST /admin/orders/:n/cod/deny` (reason, at least 10 characters) → `CANCELLED`, stock returns. The customer sees only "Order could not be confirmed"; the reason goes to the audit log
  - both refused for non-COD orders, non-`PENDING` orders and packers
- [x] **One door:** the generic transition refuses to move a pending COD order out of `PENDING` in either direction, including by an `advance` walk.
- [x] **Reopen:** a denied COD order can be reopened like any desk rejection (`COD_DENIED` counts as a desk cancellation).
- [x] **Undo approval:** the existing revert (ADMIN only) works for COD and also clears the approval details. Panel wording says "Undo approval" for COD.
- [x] **Admin UI:**
  - "COD to confirm" tab on the orders list (pending + COD)
  - "Confirm cash on delivery" card on the order: channel, note, Approve, Deny (reason required)
  - Payment card shows when the customer agreed, who approved, how, and what was checked
  - the status reads "Approved (cash on delivery)" instead of "Payment confirmed"
- [x] **Copy:** English, Bangla, Japanese.
- [x] **Tests:** `test/unit/cod-approval.spec.ts` (18 tests: schema, checkout stamp, guard, SMS length, reopen, approve/deny service); two existing tests updated for the new behaviour. 736 API tests pass.
- [x] **Checked for real:** API and web run locally against a throwaway Postgres with seed data:
  - placed COD orders through the actual checkout (with and without the tick)
  - approved, denied, reopened and undid approval through the panel and the API
  - confirmed stock, audit rows, the customer timeline, the Messenger link and the Bangla screens

**Where this differs from the plan:**
- **Facebook link:** a shared constant (`apps/web/src/lib/contact.ts`), reused from the contact page, not a shop setting. Moving it to settings only matters if the page changes often.
- **48 hours:** a shared constant (`COD_CONFIRMATION_HOURS`) for now. It becomes a shop setting in Step 2, together with the expiry job that enforces it.
- **Who approves:** STAFF and ADMIN, not ADMIN only. Approving is the same job as confirming a bKash transfer, which STAFF already do. Packers can't. A one-line change makes it ADMIN-only if you prefer.

### Step 2: housekeeping
- [ ] **Expiry worker:** cancels COD orders still `PENDING` after `codConfirmationHours`, with the reason "expired". Stock returns.
  - Same pattern as `claim-retry.worker.ts` (lease with `FOR UPDATE SKIP LOCKED`), so it is idempotent and safe on more than one instance.
  - Go through `OrdersService.transition(…, "CANCELLED")` so stock and the waitlist are handled.
  - Write an audit entry (e.g. a new `COD_EXPIRED` action), and decide whether an expired order may be reopened.
- [ ] **Setting:** `codConfirmationHours` on `shop_settings` (default 48), shown in admin settings. Replaces the `COD_CONFIRMATION_HOURS` constant in the customer copy (it must come from the API then).
- [ ] **Queue badge:** count of COD orders awaiting confirmation, in the admin nav
- [ ] **Duplicate flag:** another open COD order from the same phone number
- [ ] **History badge per phone:** delivered / cancelled / denied counts

### Step 3: COD money tracking
- [ ] **Mark remitted:** an admin action, single or bulk, `COLLECTED` → `REMITTED`, recording the Pathao invoice reference and the amount received
- [ ] **COD payment row:** written on remittance (provider `cash-on-delivery`, reference = order number, amount = what Pathao actually paid), so `payments` finally holds COD money too. Fix the `CashOnDeliveryProvider` comment, which says a row is created at checkout.
- [ ] **Report:**
  - cash still with Pathao (sum of `COLLECTED`)
  - remitted per period
  - deny and expiry rates
- [ ] **Later:** import Pathao payout CSV/API and match by consignment ID

### Step 0C: contract: cleanup (any time after Step 1)
- [ ] Rename enum value `PAYMENT_CONFIRMED` → `CONFIRMED`. Postgres `ALTER TYPE ... RENAME VALUE` keeps the existing rows.
- [ ] Update the state machine, listeners, packer scope, web labels, i18n and tests
- [ ] Move refunds fully to payment status:
  - stop writing order status `REFUNDED`
  - migrate existing rows (fulfilment status = last status before the refund)
  - then remove the value
- [ ] Rename `revertPaymentConfirmation` and related wording where it now means "undo approval"

## 5. Progress log

| Date | Step | What happened | PR |
|---|---|---|---|
| 2026-11-19 | — | Process, decisions and state design agreed | — |
| 2026-11-19 | — | Code survey: COD revenue counted at acceptance; COD payment row never settled. Order set to 0A → 0B → 1 → 2 → 3 → 0C | — |
| 2026-11-19 | 0A | `payment_status` column, backfill (verified on Postgres), rule in `transition`, contracts, tests. Branch `feat/cod-payment-status` off `deployment` | #100 |
| 2026-11-19 | 0B | Dashboard + payments page read `payment_status`; admin payment badge. Branch `feat/cod-revenue-by-payment`, stacked on 0A | #100 |
| 2026-11-19 | 1 | COD back in checkout with tick box; Messenger confirmation step; approve/deny API + panel; migration 0048. Branch `feat/cod-approval-flow`, stacked on 0B | #100 |

## 6. Open questions

- What happens to stock on a refused delivery? Recommended: return it only when the parcel is physically back in hand (part of the later `RETURNED` work).
- Should the confirmation email for COD go out on approval (planned) or at checkout?
