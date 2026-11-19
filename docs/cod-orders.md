# Cash on delivery (COD) orders

Status: **planning** · Last updated: 2026-11-19

How Sakura Book takes COD orders with no advance payment, with every COD order
confirmed by an admin before it is packed.

---

## 1. The process

1. **Customer checks out with COD.** Before they can place the order they must tick:
   > আমি অর্ডারের বই ও মোট মূল্য (৳X, ডেলিভারি চার্জসহ) দেখেছি এবং ডেলিভারির সময় পরিশোধ করতে প্রস্তুত।

   The total is shown next to the tick box. The tick is saved on the order with a timestamp.
2. **The order is created as `PENDING`.** Stock is taken at this point (that is how checkout already works).
3. **The customer sees a COD thank-you page**, not the normal one:
   - order number and total
   - "অর্ডারটি নিশ্চিত করতে আমাদের Facebook পেজে মেসেজ দিন" (to confirm the order, message our Facebook page)
   - a large **Message us on Facebook** button (m.me link with the order number pre-filled)
   - a note that unconfirmed orders are cancelled after N hours
4. **The customer messages the page.** Confirmation is the customer's job. The shop does not chase.
5. **The admin checks the order:**
   - the order matches the conversation (books, phone, address)
   - the Facebook profile looks genuine
6. **The admin decides:**
   - **Confirm** → `CONFIRMED` → goes to the packer as usual (`PROCESSING` → `SHIPPED`)
   - **Deny** → `CANCELLED` with a reason (suspicious, duplicate, customer declined) → stock returns
7. **No contact before the deadline** → the order is cancelled automatically and the stock returns.
8. **Delivered** → Pathao collects the cash → the payment is recorded as collected → later marked remitted when Pathao pays out.

## 2. Decisions

| # | Question | Decision | Who |
|---|---|---|---|
| 1 | Advance delivery charge? | **No.** COD with no advance for now. Can be added later for flagged customers. | Owner |
| 2 | Who starts the confirmation? | **The customer**, via the Facebook page. The shop does not call. | Owner |
| 3 | How is an order vetted? | The order details plus the customer's social profile. Suspicious orders are denied. | Owner |
| 4 | Commitment step | A required tick box with the exact total, saved with a timestamp. | Owner |
| 5 | Who approves? | The **admin** for now. Built as a permission so it can be handed to a support role later. | Owner |
| 6 | Record how/why | **Yes.** Save the confirmation channel, the note, and the cancel reason. | Owner |
| 7 | Customer sees the waiting state | **Yes.** Tracking page shows "নিশ্চিতকরণের অপেক্ষায়" (waiting for confirmation). An SMS goes out on confirm. | Owner |
| 8 | When is stock taken? | **At order placement** (current behaviour). It is returned on deny or expiry. Can be changed later. | Recommended |
| 9 | Order states | Split order status (where the parcel is) from payment status (where the money is). See §2a. | Recommended |
| 10 | Unconfirmed order expiry | Auto-cancel after **48 h** (configurable in shop settings). | Owner |
| 11 | Customer can cancel a waiting COD order? | **No**, not for now. Only the admin or the 48 h expiry cancels. | Owner |

### 2a. The state problem: one status answers two questions

`orders.status` currently tracks two separate lifecycles in one field:

- **Fulfilment:** where is the order? (waiting, approved, packing, shipped, delivered)
- **Payment:** where is the money? (unpaid, paid, refunded)

For prepaid orders the two move in step: money arrives, then packing starts,
so `PAYMENT_CONFIRMED` was a good name. **COD breaks this.** The order is
approved and shipped while unpaid, and the money arrives *after* `DELIVERED`
and then again when Pathao pays out. One field can't say "shipped but
unpaid" or "delivered, cash still with Pathao".

Every new payment option would make it worse:
- card
- partial advance (delivery charge prepaid, rest COD)
- refusal after shipping
- refund of an advance

Each would need more mixed statuses (`SHIPPED_UNPAID`, `DELIVERED_AWAITING_REMITTANCE`, ...).

**Recommended (scalable) model: two independent fields.**

`orders.status`: fulfilment only, the same for every payment method

```
PENDING ──▶ CONFIRMED ──▶ PROCESSING ──▶ SHIPPED ──▶ DELIVERED
   │            │              │            │
   └────────────┴──────────────┴──▶ CANCELLED     └──▶ RETURNED (refused / failed delivery, later)
```

- `CONFIRMED` replaces `PAYMENT_CONFIRMED`. It means "approved to pack", and what causes it depends on the payment method:
  - prepaid: the payment is verified (today's behaviour, renamed)
  - COD: the admin approves after the customer messages the page
- `REFUNDED` moves out of order status, because a refund is a money event.

`orders.paymentStatus`: money only (new field, kept in sync with the existing `payments` table)

| Value | Prepaid | COD |
|---|---|---|
| `UNPAID` | at checkout | checkout → delivery |
| `PAID` | payment verified | — |
| `COLLECTED` | — | Pathao delivered and collected the cash |
| `REMITTED` | — | Pathao paid the shop |
| `REFUNDED` | money returned | (an advance returned, later) |

The `payments` table already has its own status (`PENDING / SUCCEEDED /
FAILED / REFUNDED / VOIDED`) and stays the detailed record of each payment.
For COD, a payment row is written on delivery (provider `pathao`, amount =
cash collected) and marked succeeded on remittance. `orders.paymentStatus`
is the summary for quick filtering.

**What this gives:**
- The packer queue is the same for everyone: `CONFIRMED`.
- The admin COD queue is `PENDING` + method COD.
- Reports read money from `paymentStatus`, never from order status. "Cash still with Pathao" = `COLLECTED`.
- New payment methods add *payment* values or rules, not new order states.

**Cost:** `PAYMENT_CONFIRMED` is used in about 240 places, including:
- the state machine
- sales counting and the dashboard
- the "revert confirmation" flow
- the packer view
- tracking labels
- tests

Any code that reads "paid" from the order status has to move to
`paymentStatus`. That is a real refactor, so it gets its own phase (Phase 0
below) and should land **before** COD goes live.

**Shortcut, if COD must ship first:** add `CONFIRMED` next to
`PAYMENT_CONFIRMED` (COD-only path, described below) and do the split
later. It works, but it leaves two "approved" statuses and still no place
to record COD money. Use it only if time forces it.

### Why `CONFIRMED` (and not just keep `PENDING`)

The order *waits* in `PENDING`, so no new state is needed for waiting. The
problem is what comes **after** approval:

- In today's state machine (`apps/api/src/orders/order-status.machine.ts`),
  `PENDING` can only go to `PAYMENT_CONFIRMED` or `CANCELLED`. The packer only
  picks up orders after `PAYMENT_CONFIRMED`.
- An approved COD order has **not** been paid. Marking it `PAYMENT_CONFIRMED`
  would be false. Sales figures, the payment rows and the "revert confirmation"
  logic all treat that status as "money received".
- `CONFIRMED` means "verified, will be paid on delivery". It gives:
  - a clear admin queue (`PENDING` + COD = needs action)
  - a clear packer queue (`PAYMENT_CONFIRMED` or `CONFIRMED`)
  - an honest tracking page for the customer
  - a place for the state machine to enforce the rule. A COD order cannot be packed without approval.

Transitions:

```
PENDING ──confirm──▶ CONFIRMED ──▶ PROCESSING ──▶ SHIPPED ──▶ DELIVERED (cash collected)
   │                     │
   └──deny / expire──▶ CANCELLED ◀──┘
```

`PENDING → CONFIRMED` is allowed only for COD orders. Prepaid orders keep their current path.

### Stock timing

Stock is already taken when the order is placed, and `PENDING` is in
`STOCK_HELD_STATUSES`. This is the safer choice: two people cannot both be
approved for the last copy while waiting. The cost is that unconfirmed orders
hold stock, and the 48 h auto-cancel handles that. Moving stock to "taken on
confirm" later is possible but needs a stock check at approval time.

## 3. Recommendations (beyond the decisions)

- **Duplicate flag:** in the queue, highlight a second open COD order from the same phone number.
- **History badge per phone:** delivered / refused / denied counts, shown in the queue.
- **Queue badge:** a count of COD orders awaiting confirmation in the admin nav, so orders don't go stale.
- **Copy consistency:** the checkout tick, the thank-you page, the tracking page and the SMS should all say the same thing.
- **Later (when volume grows):**
  - automatic approval for returning customers with good history
  - advance delivery charge only for risky numbers
  - Pathao payout reconciliation (`collected → remitted`)

## 4. Implementation steps

Each step can ship on its own.

### Phase 0: split order and payment status (before COD goes live)
- [ ] **DB:** add `orders.paymentStatus` (`UNPAID / PAID / COLLECTED / REMITTED / REFUNDED`) and backfill it from existing orders and payments
- [ ] **DB:**
  - rename `PAYMENT_CONFIRMED` → `CONFIRMED` in the order status enum
  - move `REFUNDED` to the payment status (keep the old value readable until the data has migrated)
- [ ] **State machine:** fulfilment transitions only. The payment-verify flow sets `paymentStatus = PAID` and moves the order to `CONFIRMED`.
- [ ] **Revert confirmation:** voids the payment, sets `paymentStatus = UNPAID`, returns the order to `PENDING`
- [ ] **Sales/dashboard:** count revenue from `paymentStatus` / `payments`, not from order status
- [ ] **Packer view, tracking labels, admin filters:** switch to `CONFIRMED`
- [ ] **Contracts package:** update the shared status types
- [ ] Update the tests (all ~240 references reviewed)

### Phase 1: core flow
- [ ] **DB:** order fields
  - `codAcknowledgedAt`
  - `confirmedAt`, `confirmedBy`
  - `confirmationChannel` (facebook / phone / other)
  - `confirmationNote`
  - `cancelReason` (check whether this already exists)
- [ ] **State machine:**
  - `PENDING → CONFIRMED` (COD only)
  - `CONFIRMED → PROCESSING | CANCELLED`
  - add `CONFIRMED` to `STOCK_HELD_STATUSES`
- [ ] **Checkout API:** reject a COD order without the acknowledgement. Store the timestamp.
- [ ] **Checkout UI:** a required tick box with the live total, shown only for COD
- [ ] **Thank-you page:** a COD variant with the Facebook button (order number pre-filled) and the deadline
- [ ] **Admin:** an "Awaiting confirmation" queue (filter `PENDING` + COD) with Confirm / Deny actions, channel, note and reason
- [ ] **Packer view:** include `CONFIRMED` orders
- [ ] **Tracking page:** labels for `PENDING` (COD) and `CONFIRMED`
- [ ] **SMS on confirm:** short Bangla copy within one 70-character segment
- [ ] **Shop settings:** Facebook page link, expiry hours

### Phase 2: housekeeping
- [ ] Auto-cancel job for unconfirmed COD orders after the expiry. Returns stock and records the reason "expired".
- [ ] Queue badge count in the admin nav
- [ ] Duplicate-phone and history badges in the queue
- [ ] Approval as its own permission, so it can go to a support role

### Phase 3: money tracking
- [ ] COD payment state: `pending → collected (on DELIVERED) → remitted`
- [ ] Admin "mark remitted" action, then Pathao payout import and matching
- [ ] Owner report: cash still with Pathao, refusal and deny rates

## 5. Tracking log

| Date | Change | PR |
|---|---|---|
| 2026-11-19 | Process and decisions written | — |
| 2026-11-19 | 48 h expiry and no customer cancel decided; order/payment status split proposed | — |

## 6. Open questions

- Phase 0 first (recommended), or the shortcut so COD ships sooner?
- What happens to the stock on a refused delivery? Return it to stock only when the parcel is back in hand (recommended).
