# Waitlist invites

How a waitlist signup becomes an order: staff pick who gets a slot, the API mints a
single-use token, the customer gets it as an SMS link, and checkout spends it in the
same transaction that writes the order. Companion to
[backend-architecture.md](./backend-architecture.md).

---

## 1. Components

```mermaid
flowchart LR
  subgraph web["apps/web"]
    AdminList["/admin/waitlist<br/>list · book filter · Invite"]
    AdminTtl["/admin/settings/waitlist-invite<br/>TTL hours"]
    Landing["/[locale]/waitlist/invite/[token]<br/>server component"]
    LockedView["InviteCheckoutView<br/>(LOCKED: fixed book + qty)"]
    OpenView["CheckoutView<br/>(OPEN: shopper's own cart)"]
  end

  subgraph api["apps/api"]
    AdminCtl["AdminWaitlistController<br/>POST /admin/waitlist/invite"]
    SettingsCtl["AdminSettingsController<br/>GET·PATCH /admin/settings/waitlist-invite"]
    InviteSvc["AdminWaitlistInviteService<br/>pick mode · issue · send · mark NOTIFIED"]
    TokenSvc["WaitlistInviteService<br/>issue · redeem · consume"]
    TtlSvc["WaitlistInviteSettingsService<br/>ttlHours (default 48)"]
    Sms["SmsService → Android SMS Gateway"]
    PublicCtl["WaitlistController<br/>GET /waitlist/invite/:token"]
    Checkout["CheckoutService.writeOrder"]
    Audit["AuditService"]
  end

  DB[("waitlist_entries<br/>invite_token · invite_mode<br/>invite_expires_at · invite_used_at")]

  AdminList --> AdminCtl --> InviteSvc
  AdminTtl --> SettingsCtl --> TtlSvc
  InviteSvc --> TtlSvc
  InviteSvc --> TokenSvc
  InviteSvc --> Sms
  InviteSvc --> Audit
  TokenSvc --> DB
  TtlSvc --> DB
  Landing --> PublicCtl --> TokenSvc
  Landing --> LockedView
  Landing --> OpenView
  LockedView --> Checkout
  OpenView --> Checkout
  Checkout --> TokenSvc
```

---

## 2. Issue → redeem → spend

```mermaid
sequenceDiagram
  autonumber
  actor Staff
  participant Panel as /admin/waitlist
  participant Api as AdminWaitlistInviteService
  participant Db as waitlist_entries
  participant Gw as SMS gateway
  actor Cust as Customer
  participant Page as invite/[token] page
  participant Co as CheckoutService

  Staff->>Panel: filter by book, select rows, "Invite N"
  Panel->>Api: POST /admin/waitlist/invite { ids }
  loop per id, 5 in flight at a time
    Api->>Api: skip CANCELLED / CONVERTED
    Api->>Api: mode = bookId ? LOCKED : OPEN
    Api->>Db: issue() — token, mode, expiresAt, used_at = null
    Api->>Gw: sendInviteLink(...), abandoned after SMS_GATEWAY_TIMEOUT_MS
    alt gateway accepted
      Api->>Db: invite_sms_status = SENT, invite_sms_at
      Api->>Db: PENDING → NOTIFIED (notified_at kept if already set)
    else send failed or gateway unreachable
      Api->>Db: invite_sms_status = FAILED, invite_sms_error
      Api-->>Panel: sent:false, token still issued, entry stays PENDING
    end
  end
  Api->>Api: audit "invited" with the ids that sent
  Api-->>Panel: results[] + invitedAt

  Cust->>Page: opens SMS link
  Page->>Db: redeem(token) — unused AND unexpired, read-only
  alt no match
    Page-->>Cust: 404
  else LOCKED
    Page-->>Cust: InviteCheckoutView, book + qty fixed, contact prefilled
  else OPEN
    Page-->>Cust: CheckoutView, cart is the shopper's own, contact prefilled
  end

  Cust->>Co: POST /orders { items, customer, inviteToken }
  activate Co
  Note over Co,Db: one transaction
  Co->>Co: reject reused transaction ID
  Co->>Db: consume(token) — guarded UPDATE sets used_at
  alt zero rows
    Co-->>Cust: 404 WAITLIST_INVITE_INVALID
  else LOCKED and cart ≠ reservation
    Co-->>Cust: 422 WAITLIST_INVITE_MISMATCH (rolls back)
  else
    Co->>Db: reprice, decrement stock, redeem coupon, insert order
    Co->>Db: markConverted(entryId, orderId) — status CONVERTED, converted_order_id
    Co-->>Cust: 201 order (token spend + conversion commit with it)
  end
  deactivate Co
```

The ordering inside the transaction is deliberate: the token is spent before pricing
and before any stock moves, so a bad token costs nothing — and because it is one
transaction, a later failure (out of stock, coupon exhausted) rolls the spend back and
leaves the link usable.

---

## 3. Entry lifecycle

```mermaid
stateDiagram-v2
  [*] --> PENDING: POST /waitlist
  PENDING --> NOTIFIED: invite SMS sent<br/>(or "Mark notified")
  NOTIFIED --> NOTIFIED: re-invite — new token,<br/>old link dies, notified_at unchanged
  PENDING --> CANCELLED: staff
  NOTIFIED --> CANCELLED: staff
  NOTIFIED --> CONVERTED: invite redeemed —<br/>order placed with the token
  NOTIFIED --> CONVERTED: staff, manually
  CANCELLED --> [*]
  CONVERTED --> [*]

  note right of CONVERTED
    Automatic for an order placed
    through an invite: checkout writes
    converted_order_id and the status
    in the order's own transaction.
    An order from someone who never
    used their link is still manual.
  end note
```

Token state lives on the same row, independent of `status`:

| Column              | Set by                | Meaning                                          |
| ------------------- | --------------------- | ------------------------------------------------ |
| `invite_token`      | `issue()`             | The magic-link credential; unique partial index  |
| `invite_mode`       | `issue()`             | `LOCKED` (book + qty fixed) or `OPEN` (any cart) |
| `invite_expires_at` | `issue()`             | `now + ttlHours`, TTL from shop settings         |
| `invite_used_at`    | `consume()`, in-order | Non-null = spent; re-issuing clears it           |
| `invite_sms_status` | `recordSmsOutcome()`  | `SENT` / `FAILED` for the **last** attempt       |
| `invite_sms_error`  | `recordSmsOutcome()`  | The gateway's reason, truncated. Null on success |
| `invite_sms_at`     | `recordSmsOutcome()`  | When that attempt ran — not `notified_at`        |

The three `invite_sms_*` columns are the recovery mechanism for a partial batch. Every
attempt writes one, success or failure, **before** the HTTP response is built — so a
closed tab or a timed-out request no longer takes the list of who to retry with it. The
invite-batch page reads them back as a "Select N failed" button, which re-sends to
exactly the failures rather than to everyone selected.

They are deliberately distinct from `status` / `notified_at`, which answer "has this
person ever been reached" and only move forward. These answer the retryable question:
did *this* send get through. Overwritten per attempt — the audit log keeps history.

`status` and `converted_order_id` are written by `markConverted()` in the same
transaction, right after the order row exists.

---

## 4. Known gaps

- **Conversion only closes for invited orders.** An order placed through a token links
  itself; an order from someone on the list who never used their link is still invisible
  as a conversion, because matching it back would need a rule (phone equality is wrong
  for a shared household number).
- **An invite reserves nothing.** `LOCKED` constrains what the order may contain, not
  whether stock exists — inviting more people than copies is first-come-first-served.
- **Re-issuing resets `invite_used_at`**, so it would hand a second usable slot to
  someone who already ordered — in practice the eligibility check refuses them, since
  redeeming an invite now moves the entry to `CONVERTED`.
- **The SMS is English only**, though `locale` is on the row and used to build the URL.
- **Bulk invites still send inside the request**, five at a time, up to 500 ids. Bounded
  now rather than open-ended — each gateway call is abandoned after
  `SMS_GATEWAY_TIMEOUT_MS` (5s by default), so a batch's worst case is
  `ceil(n / 5) × timeout` rather than unbounded. At the ~20 per click a restock morning
  actually sends that is comfortably inside any proxy cutoff; at several hundred it
  would not be, and the answer there is a job table plus a worker, not a bigger loop.
- **Delivery means "the gateway accepted it"**, not that it arrived. `invite_sms_status`
  records what the Android gateway said; a carrier dropping the message afterwards is
  invisible here, so a customer reporting a missing link is still re-invited by hand.
