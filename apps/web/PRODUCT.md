# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Readers buying a specific book from a small, hand-picked shop. They arrive either
browsing with no title in mind — open to being recommended something — or looking
for one title they already heard about. The job is the same in both cases: judge
whether this shelf is worth trusting, find the book, and complete a purchase with
a physical object arriving afterward.

The audience is genuinely trilingual. English, Bengali (`bn`), and Japanese (`ja`)
are all first-class: each is a real market with real readers, not a demonstration
of i18n plumbing. Nothing may be designed such that it only works in English —
this constrains line lengths, typography, numeral and currency formatting, and
any copy that assumes English word order or length.

## Product Purpose

An online bookshop where a person can browse a curated catalog, read about a
title, add it to a cart, and check out. Success is a completed order for a book
the reader is glad to receive — not catalog page views, and not breadth of
selection.

## Positioning

Human curation over a small catalog. Someone chose every title on this shelf and
can say why. The differentiator a large retailer cannot truthfully copy is that
the selection is small enough to be personally vouched for: taste and scarcity
are the offer, not selection breadth or price. This is why the catalog carries
per-title distinctions like editor's pick, signed, and last copy — they are
statements about specific objects, not merchandising badges.

## Operating Context

The shopping path is: home → catalog (with genre facets, sorting, pagination) →
book detail → cart → checkout (shipping, then payment) → order confirmation, and
an order history. Every route is locale-prefixed (`/en/cart`); `lib/routes.ts` is
the single authority for path construction.

Money is handled as integer cents throughout, and pricing is authoritative on the
server — the client displays what it is told and never computes a total it then
trusts. Checkout is idempotent. Coupons are evaluated advisory-first (rejections
come back as values, not exceptions) and redeemed atomically.

## Capabilities and Constraints

**Built:** the full web surface for catalog, cart, and checkout; a UI component
set (`components/ui`), layout shell, and domain components; RTK + redux-persist
for the cart, React Query for server state, React Hook Form + Zod for forms;
i18n across three locales; shared request/response contracts in
`packages/contracts`.

**Not built:** the API's product surface. `apps/api` has infrastructure — Nest,
Drizzle, the schema, the error hierarchy, coupons, health — but `HealthController`
is its only controller. The web app currently makes zero network calls and reads
a hardcoded array in `lib/books.ts`.

**Undecided, and not to be invented:**

- The product name. The package is `sakura-book`; `DESIGN_SYSTEM.md` says
  "Marginalia". Neither is confirmed. Do not settle this in passing, and do not
  put a name in user-facing copy as though it were decided.
- The payment processor. Checkout must not be designed around a specific
  provider's hosted flow until one is chosen.

## Brand Commitments

An incumbent visual system exists and is documented in `DESIGN_SYSTEM.md` at the
repo root, with wireframe references in `reference/claude-design/`. Its four
stated principles: the book leads; one accent used sparingly; state is stated in
words, not implied by color alone; motion only as confirmation.

Recorded here as product truth rather than visual direction: **state must carry
words, not color alone** — this is an accessibility commitment, not a style
choice. Visual decisions belong in DESIGN.md, not this file.

## Evidence on Hand

- **Real inventory exists** — actual titles, authors, prices, and stock are
  available to load in. The six books in `lib/books.ts` are placeholder and must
  not be presented as the real shelf.
- **Real cover imagery exists or can be sourced.** Designs may assume genuine
  covers rather than placeholder blocks.
- **No reviews or testimonials exist.** The `rating` and `ratingCount` fields in
  `lib/books.ts` are invented placeholder values. No customer quote, star
  average, review count, sales figure, or press mention may be shown as real
  until real data backs it.
- No payment processor is connected. No live orders have been placed.

## Product Principles

1. **The shelf is vouched for.** Every title is here because someone chose it.
   Design decisions that make the catalog feel machine-generated or infinite work
   against the only thing this shop has.
2. **Small catalog, specific objects.** A listing describes a particular book —
   possibly the last copy — not an SKU with unlimited depth.
3. **Three languages, no second-class one.** Anything that only reads well in
   English is unfinished.
4. **The server owns the money.** Prices and totals are displayed, never derived
   client-side; integer cents end to end.
5. **Say the state.** Availability, errors, and order status are communicated in
   words that survive a monochrome screen.

## Accessibility & Inclusion

No formal standard has been set by the user. The existing system's commitment
that every state carries a word — not only a color — is treated as binding, and
covers color-blind readers and touch contexts where hover cannot disambiguate.
Multilingual support (including Bengali and Japanese script rendering) is an
inclusion requirement, not an enhancement.
