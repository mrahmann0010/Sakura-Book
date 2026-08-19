# Domain components

Book, cart and order pieces. Sourced from **Domain Components** (sheet 03) with
composition checked against **Page Skeletons** (sheet 04).

Everything here is presentational and controlled. No component fetches, owns
mutable state, or knows a route — pages wire those in. That is what lets the
same `CartItem` serve the cart page, a drawer and an optimistic list.

---

## Reuse reasoning

These are the contexts each component was designed against, so the next person
does not have to re-derive the API.

### BookCover

Used at five sizes across the references: 320px (detail), full-bleed in a grid
cell, 72px (cart line), 56px (confirmation line), 44px (list row), 40px (order
summary line). Radius steps with size — 8px on a real cover, 6px at 72px, 4px
below that — so `radius` is a prop, not derived, and the caller sizes the cover
with `className`.

Two fallbacks, both from the reference: `wordmark` (tint panel, mono
`MARGINALIA` top-left, Lora title and author at the foot) for a card where the
book must still be identifiable, and `hatch` for a placeholder where the title
is already visible beside it.

### BookCard

Contexts: catalog grid, home "recently added" grid, curated shelf (feature and
supporting slots), search results, horizontal shelf scroller, compact list row.

**One component, two props.** `layout` picks stack (everything grid-shaped) or
row (the compact list). `size` scales the title — 15 / 17 / 18 / 26px — which
is the only thing that actually differs between a catalog cell and the feature
slot of a curated shelf. A separate `<FeatureCard>` would have been the same
markup with one number changed.

**What is deliberately _not_ a BookCard variant:** cart lines and order summary
lines. They look adjacent but carry quantity, line totals and remove actions —
different data, different interaction, different component (`CartItem`,
`OrderLine`). Forcing them into BookCard would mean a `mode` prop that switches
half the markup, which is two components wearing one name.

States handled: `flag` (metadata badge between cover and title), `soldOut`
(whole card to 55% and the price replaced by the words "Out of stock" —
principle 03), hover (`outline 1px ink, offset 6px`, nothing else moves).

### BookGrid / CuratedShelf / BookScroller

Three genuinely different layouts, not variants of one:

- `BookGrid` — uniform 2/3/4-up. Catalog, search, recently added, related.
- `CuratedShelf` — the asymmetric 12-column arrangement at `1/span 5`,
  `7/span 3`, `10/span 3` with the third offset. The doc reserves this for
  hand-curated shelves and explicitly forbids it in the catalog, so it takes
  exactly three children and says so in its types.
- `BookScroller` — horizontal snap rail. Not in the references (they are all
  drawn at 1440px) but needed for the mobile behaviour §11.10 leaves open.

### ProgressIndicator — see `OrderStatusTimeline`

The only progress indicator specified anywhere in the four pages is the
four-step order lifecycle (Pending · Paid · Shipped · Delivered). It is a fixed
sequence with fixed labels, so it takes a `status` and derives every step's
state rather than accepting arbitrary steps. Reading progress bars, rating
stars and goal rings do not appear in any reference page — see the wrap-up
notes before inventing them.

### EmptyState

Three instances in the references (cart, search, order lookup) that differ only
in eyebrow, line, sentence and button — so it is one component with slots, and
the action is a `ReactNode` rather than `label` + `onClick`, because two of the
three are links and one is a button.

### HowItWorks

One context so far — the landing page, closing it after `ProofPoints`. It takes
props rather than hardcoding its copy because every string is translated, but
the three illustrations are _not_ props: they are one drawn set (shared
viewBox, one stroke weight, one optical scale) and swapping one in isolation
would break the set. That is also why `stages` is a fixed three-tuple: the
thread runs between exactly two gaps, and a fourth stage would have no drawing.

`number` is displayed rather than derived from the index, so a locale can
number the stages in its own digits.
