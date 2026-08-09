# Marginalia — Design System

> Extracted from the four Claude Design reference pages (project `d4f85f12-3297-44fb-a351-a59ebd7b18f0`):
> **Design System Doc** (primary spec) · **Foundations** (raw tokens) · **Domain Components** · **Page Skeletons**.
> Version 1.0 · dated 9 August 2026 in the source doc.

The visual language of a small hand-picked bookshop: **Lora** for titles, **Public Sans** for interface,
**one clay accent**, and nothing that moves without reason.

---

## 1. Principles

The doc states four rules the system keeps. These drive every token decision below.

| # | Rule | Consequence |
|---|------|-------------|
| 01 | **The book leads** | Covers, titles and prices come first; interface chrome stays quiet. Covers are the only place the palette opens up. |
| 02 | **One accent, used sparingly** | Clay marks the primary action and live status only. *If two things on a screen are clay, one of them is wrong.* |
| 03 | **State is stated, not implied** | Status, availability and errors carry **words** as well as colour — survives touch screens and colour-blind readers. |
| 04 | **Motion only as confirmation** | Navigation is instant. Only a 150ms press state and a 1400ms loading shimmer. |

**In practice:** white cards on cream, 1px rules instead of shadows, 8px radius on controls and 12px on
containers. No gradients, no drop shadows, no second accent colour.

---

## 2. Colour

Light mode only. **No dark mode exists in any of the four reference pages** — see §11 Open Questions.

### 2.1 Accent

| Token | Hex | RGB | Use |
|---|---|---|---|
| `clay` | `#C96442` | `rgb(201,100,66)` | Primary buttons, cart badge, live status, links on hover, focus/error borders |
| `clay-deep` | `#B0553A` | `rgb(176,85,58)` | Hover / pressed state of clay. Also clay text on cream (AA at 14px+) |

### 2.2 Neutrals

| Token | Hex | Use |
|---|---|---|
| `page` | `#FAF9F5` | App background (cream) |
| `surface` | `#FFFFFF` | Cards, inputs, modals |
| `tint` | `#F0ECE2` | Alternating sections, pills, footer, summaries, skeletons, disabled input fill |
| `rule` | `#E6E2D7` | 1px borders, dividers, disabled fills |
| `muted` | `#8F8A7E` | Mono eyebrow labels, disabled text, icons at rest |
| `secondary` | `#6B665C` | Caption text, inactive nav, helper copy |
| `body` | `#3D3A34` | Default paragraph text |
| `ink` | `#141413` | Titles, active nav, toasts, focus border, completed status |

Text ramp, darkest → lightest: `ink #141413` → `body #3D3A34` → `secondary #6B665C` → `muted #8F8A7E`.

### 2.3 Semantic

Deliberately **not** a conventional traffic-light palette. Semantic colour never appears alone —
every state carries a word.

| Role | Colour | Note |
|---|---|---|
| Success | `#141413` (ink) | Delivered, confirmed. **Ink, not green.** |
| Error | `#C96442` (clay) | Field borders, declined payments, error helper text |
| Warning | `#B0553A` (clay-deep) | Last copy, low stock, cut-off times |
| Info | `#F0ECE2` bg / `#6B665C` text | Neutral notices, pending states |

### 2.4 Support values

| Token | Value | Use |
|---|---|---|
| `overlay` | `rgba(20,20,19,0.28)` | Modal scrim |
| `clay-ring` | `rgba(201,100,66,0.18)` | 4px halo on the live timeline dot |
| `hatch` | `#E8E3D7` | Placeholder/cover-hatch stripe only — **not a UI surface** |
| `skeleton-canvas` | `#EFECE4` | Background of the Page Skeletons sheet itself, not an app token |

---

## 3. Typography

### 3.1 Families

| Family | Stack | Weights | Use |
|---|---|---|---|
| **Lora** | `'Lora', Georgia, serif` | 400, 500, *400 italic* | Titles and book names. Italic for authors. |
| **Public Sans** | `'Public Sans', Helvetica, Arial, sans-serif` | 400, 500, 600 | All interface text |
| **System mono** | `ui-monospace, Menlo, monospace` | 400 | Eyebrow labels, order IDs, metadata |

Google Fonts request used in the references:
`family=Lora:ital,wght@0,400;0,500;1,400&family=Public+Sans:wght@400;500;600`

### 3.2 Named scale (canonical, from the Doc)

| Name | Family / weight | Size / line-height | Tracking | Use |
|---|---|---|---|---|
| `display` | Lora 400 | 56 / 1.06 | −0.01em | Page openers only |
| `h1` | Lora 400 | 44 / 1.1 | — | Section titles |
| `h2` | Lora 400 | 28 / 1.2 | — | Card and modal titles |
| `h3` | Lora 400 | 22 / 1.25 | — | Book titles in lists |
| `h4` | Public Sans 600 | 16 / 1.4 | — | Sub-heads, table heads |
| `body` | Public Sans 400 | 14 / 1.7 | — | Default. **Max 66ch measure** |
| `caption` | Public Sans 400 | 12.5 / 1.6 | — | Secondary detail, helper text, prices in lists |
| `eyebrow` | Mono 400 | 10–11 / 1.6 | 0.10–0.14em | Uppercase, `muted` |

### 3.3 Sizes observed in real layouts

The skeletons use several intermediate sizes not in the named scale. Kept as a raw px ramp:

`10 · 10.5 · 11 · 11.5 · 12 · 12.5 · 13 · 13.5 · 14 · 14.5 · 15 · 16 · 17 · 18 · 19 · 20 · 21 · 22 · 24 · 26 · 28 · 30 · 32 · 34 · 36 · 40 · 42 · 44 · 48 · 52 · 56 · 64 · 68`

Notable applications:
- Hero headline (Home): Lora **64 / 1.04**
- Page title (Catalog, Track order): Lora **52 / 1.06** and **44 / 1.08**
- Book detail title: Lora **40 / 1.12**
- Confirmation headline: Lora **48 / 1.08**
- BookCard title: Lora **18 / 1.28**; in a 4-up grid **17**
- CartItem title: Lora **19 / 1.25**
- Button label: **13–13.5**, weight 600
- Input text: **14**
- Status pill: **12**, weight 600
- Metadata badge: mono **10**, tracking 0.1em
- Wordmark: **13**, tracking **0.18em**, uppercase, weight 600
- Order ID display: mono **20**, tracking 0.08em

### 3.4 Measure

- Body copy: `max-width: 66ch`
- Book description: `50ch`
- Intro / lede paragraphs: `34–46ch`
- Footer blurb: `26–28ch`
- Book detail description uses `text-wrap: pretty`

---

## 4. Spacing

**Base unit: 8px.** Everything sits on it.

| Value | Named | Use |
|---|---|---|
| 8 | `1` | Icon gaps, pill padding |
| 16 | `2` | Label to field, list rows |
| 24 | `3` | Card padding (compact), mobile page margin |
| 32 | `4` | Card padding, stacked groups |
| 40 | `5` | Grid gutter, tablet page margin |
| 56 | `7` | Block spacing within a section |
| 88 | `11` | Desktop page margin |
| 112 | `14` | Section to section |

Off-scale values appear inside components (13px button padding, 6px pill padding, 22/26/28px card
padding) — these are component-internal and intentionally not part of the layout rhythm.

---

## 5. Layout

### 5.1 Container

| Property | Value |
|---|---|
| Max width | **1280px**, centred |
| Grid | **12 columns** |
| Gutter | **40px** |
| Section gap | **112px** |
| Book grid cell | 4 columns per cover (→ 3-up) on the doc's 12-col diagram; **4-up** in every real skeleton |

### 5.2 Breakpoints and page padding

| Breakpoint | Range | Page padding | Book grid |
|---|---|---|---|
| Mobile | `< 640px` | 24px | 2 cols |
| Tablet | `640–1023px` | 40px | 3 cols |
| Desktop | `≥ 1024px` | 88px | 4 cols |

Maps cleanly onto Tailwind's default `sm: 640px` / `lg: 1024px`.

### 5.3 Recurring page structures (from Page Skeletons)

Seven pages: **Home · Catalog · Book detail · Cart · Checkout · Order confirmation · Track order.**

| Layout | Columns | Where |
|---|---|---|
| Content + summary rail | `7fr 5fr`, gap 56–64px | Cart, Checkout, Confirmation, Home hero |
| Book detail | `320px 1fr 300px`, gap 64px | Book detail (right rail `position: sticky; top: 24px`) |
| Uniform book grid | `repeat(4, 1fr)`, gap 40px | Catalog, search, "recently added" |
| Curated shelf | 12-col, gap 28–32px; items at `1/span 5`, `7/span 3`, `10/span 3` with the third offset `margin-top: 88–96px` | Home only — **reserved for curated shelves**, never catalog |
| Footer | `2fr 1fr 1fr 1fr`, gap 40px, tint bg, 48–56px padding | All pages |
| Cart line | `72px 1fr auto`, gap 24px, 24px vertical padding, hairline between | Cart |
| Order summary line | `40px 1fr auto`, gap 14px | Checkout rail |
| Timeline | `repeat(4, 1fr)` | Order status |

Header: `display:flex; justify-content:space-between`, wordmark / nav / actions, 22–26px vertical padding,
bottom hairline `#E6E2D7`. Transactional pages (Cart, Checkout, Confirmation) replace the nav with a
step indicator ("Step 2 of 3 · Details and payment").

---

## 6. Radius

| Token | Value | Use |
|---|---|---|
| `xs` | 4px | Skeleton bars, tiny cover thumbnails (40–56px) |
| `sm` | 5px | Checkbox |
| `md` | 6px | Metadata badges, menu items, 72px cart thumbnails |
| `control` | **8px** | Buttons, inputs, selects, covers, quantity steppers |
| `container` | **12px** | Cards, modals, tinted blocks, notices (10px on toasts/notices) |
| `notice` | 10px | Toasts, inline notices, small info cards |
| `sheet` | 16px | Full page-skeleton frames |
| `pill` | **999px** | Status pills, filter chips, cart count badge |
| `full` | 50% | Radio, timeline dots |

Doc summary: *Controls 8px · containers 12px · pills 999px.*

---

## 7. Elevation & borders

**There are no shadows in this system.** Depth comes from 1px rules and the tint layer.

| Token | Value | Use |
|---|---|---|
| Border | `1px solid #E6E2D7` | Default rule — cards, inputs, dividers |
| Border, active | `1px solid #141413` | Input focus/filled, secondary button hover, open menu, scrolled header |
| Border, error | `1px solid #C96442` | Invalid field, error notice |
| Modal scrim | `rgba(20,20,19,0.28)` | Behind modals; the modal itself is a plain 12px-radius card |
| Live status halo | `0 0 0 4px rgba(201,100,66,0.18)` | Timeline dot only — the **one** box-shadow in the system |
| Hover outline | `outline: 1px solid #141413; outline-offset: 6px` | BookCard hover |
| Scrolled header | Bottom border switches `#E6E2D7` → `#141413` | "gains a single ink hairline instead of a shadow" |

---

## 8. Iconography

| Rule | Value |
|---|---|
| Stroke | 1.5px, square caps |
| Box | 20px |
| Colour | `muted #8F8A7E`; `ink #141413` when active |
| Accent | Never clay unless it sits inside a primary button |
| Labelling | **Always paired with a text label** |

### Imagery — covers

- Aspect ratio **2:3**, 8px radius, 1px rule so pale covers still hold an edge on cream
- No overlays, no duotone, no drop shadows
- No-cover fallback: tint block with mono `MARGINALIA` eyebrow top-left, Lora title + author bottom-left
- Sold out: whole card at `opacity: 0.55`

---

## 9. Motion

The doc calls it a **motion budget**:

| Motion | Duration | Easing | Notes |
|---|---|---|---|
| Press feedback | **150ms** | — | scale + opacity |
| Skeleton shimmer | **1400ms** loop | `ease-in-out` | opacity 55% → 100% → 55%, staggered 120ms per item |
| Spinner | **700ms** | `linear` | 22px, 2px `rule` ring with `clay` top edge; inside a primary button the ring is `rgba(255,255,255,0.4)` with white top |
| Page transitions | **none** | — | Navigation is instant |

Skeletons hold the exact shape of what is coming — nothing shifts when content lands.

---

## 10. Component patterns

### 10.1 Button

Three variants × states. One primary per view. Min touch target **44px**.
Padding `13px 24px` (primary/secondary), `13px 12px` (ghost); label 13.5px / 600; radius 8px.

| Variant | Default | Hover / pressed | Disabled |
|---|---|---|---|
| **Primary** | bg `clay`, text `#FFF` | bg `clay-deep` | bg `rule`, text `muted`, `cursor: not-allowed` |
| **Secondary** | bg `surface`, text `ink`, border `rule` | border `ink` | bg `page`, text `muted`, border `rule` |
| **Ghost / text** | transparent, text `secondary` | text `ink`, bg `tint` | — |
| **Ghost destructive** | transparent, text `clay` | bg `tint` | — |

Loading: primary with a 13px inline spinner + changed label ("Adding"), `cursor: wait`.

### 10.2 Input / Select

Label in **mono caps** above the field (10px, 0.1em, `muted`, 10px gap).
Field: bg `surface`, border 1px `rule`, radius 8px, padding `13px 14px`, 14px text, `outline: none`.

| State | Treatment |
|---|---|
| Default | border `rule` |
| Focus | border `ink` |
| Filled | border `ink` |
| Error | border `clay` + helper below in `clay`, 12.5px |
| Disabled | bg `tint`, border `rule`, text `muted` |
| Select | same as input, `appearance: none` |
| Open menu | container border `ink`, 6px padding; items 10px padding, 6px radius; selected item bg `tint` |

Errors state the fix, never just the fault: *"Order IDs are eight characters, like MG-40718."*

### 10.3 Choice controls

- Checkbox: 18px, radius 5px, border 1px `rule`, bg `surface`; **checked** = bg `clay` + white ✓ (11px/600); **disabled** = bg `tint`, label `muted`
- Radio: 18px circle; **selected** = `border: 5px solid clay` on white; unselected = 1px `rule`
- Gap to label 12px, label 14px

### 10.4 Card / Modal / Notice

- **Card**: bg `surface`, 1px `rule`, radius 12px, padding 20–28px (24px typical). Internal divider = top hairline with 20px above/below.
- **Tinted card**: bg `tint`, radius 12px, no border. Sections and summaries. **Never stacked inside another tinted block.**
- **Modal**: the same card centred on `rgba(20,20,19,0.28)`; modal surface is `page` cream, radius 12px, 28px padding. Actions: primary + ghost, 12px gap, 26px above.
- **Toast**: bg `ink`, text `page`, radius 10px, padding `14px 18px`, 13.5px, with a mono meta on the right in `muted`.
- **Info notice**: bg `tint`, radius 10px, padding `16px 18px`.
- **Error notice**: bg `surface`, 1px `clay` border, radius 10px; leading clause in `clay` at 600 weight, rest in `body`.

### 10.5 Badges

**Status pill** — radius 999px, padding `6px 13px`, 12px / 600:

| Status | Background | Text |
|---|---|---|
| Pending | `tint` | `secondary` |
| Paid | `tint` | `clay` |
| Shipped | `tint` | `clay` |
| Delivered | `ink` | `page` |
| Cancelled | `surface` + 1px `rule` | `muted` |

**Metadata badge** — radius 6px, padding `5px 10px`, mono 10px, tracking 0.1em:
`EDITOR'S PICK` = bg `clay` / white · `LAST COPY`, `SIGNED` = bg `tint` / `secondary`.

**Filter chip** — radius 999px, padding `7px 14px`, 12.5px / 600. Active = bg `ink` / `page`; rest = bg `tint` / `secondary`.

**Cart count** — bg `clay`, white, radius 999px, min-width 20px, height 20px, 11.5px / 600.

### 10.6 Header / nav / footer

- Wordmark: 13px, `letter-spacing: 0.18em`, uppercase, weight 600
- Nav links: 13.5px `secondary`; **active = `ink` + weight 600**; gap 32px
- Link hover globally: `color: #C96442`
- On scroll the header gains an **ink hairline**, not a shadow
- Footer: bg `tint`, radius 12px, padding 48–56px, grid `2fr 1fr 1fr 1fr` gap 40px, column heads as mono eyebrows

### 10.7 Domain components

- **BookCard** — cover 2:3 / 8px radius; title Lora 18/1.28 at 18px above; author `secondary` 12.5px; price `body` 12.5px. Hover: `outline 1px ink, offset 6px` — *nothing else moves*. Flagged variant inserts a metadata badge between cover and title. Sold out: `opacity 0.55` and price replaced by the words "Out of stock".
- **BookGrid** — uniform `repeat(4,1fr)` gap 40px everywhere; asymmetric 12-col shelf reserved for the home page.
- **CartItem** — `72px 1fr auto` grid, hairline separated. Quantity stepper: bordered pill, `− n +`, border goes `ink` when engaged. Remove is a ghost button, `secondary` → `clay` on hover. Removing state: row at `opacity 0.5` with an inline **Undo** in `clay`/600.
- **CartSummary** — tinted card, Lora 24 title, 13.5px rows, hairline above the total, full-width primary, reassurance caption below.
- **OrderStatusTimeline** — four fixed steps: Pending · Paid · Shipped · Delivered. Dot 11px. **Completed = ink dot + ink connector; live = clay dot + `0 0 0 4px rgba(201,100,66,0.18)` halo + clay 600 label + `rule` connector; ahead = 1px `rule` ring on `page` fill + `muted` label.**
- **EmptyState** — tinted card, 40px×32px padding, mono eyebrow, Lora 26/1.2 line, one sentence of help (13.5/1.7), one button. **No illustrations.**

---

## 11. Open questions / inconsistencies

Flagged for confirmation before component work begins.

1. **Clay vs clay-deep for status and error text.** The *Design System Doc* renders Paid/Shipped pills, the input error helper, and the ghost-destructive label in **`#B0553A`**. *Foundations*, *Domain Components* and *Page Skeletons* all render the same elements in **`#C96442`**. Implemented as `#C96442` (three pages beat one, and clay-deep is defined as the *hover* state). Contrast note: `#C96442` on `#F0ECE2` is ~3.3:1 — passes AA for the 12px/600 pill text only as "large-ish bold" at best; `#B0553A` (~4.2:1) is safer. **Decide: correctness vs. contrast.**
2. **"No transitions" vs the 150ms press state.** The Foundations header says *"8px radius, 1px rules, no transitions."* The Doc's motion budget specifies *"Press feedback · 150ms scale + opacity."* Implemented per the Doc (150ms on colour/press only, no transitions on layout).
3. **No dark mode.** Nothing in the four pages defines one. Tokens are wired through CSS custom properties so a dark theme can be layered in later, but no dark palette is shipped.
4. **No visible keyboard focus ring.** Every field in the references uses `outline: none` and signals focus only by switching the border to ink — that is not a sufficient focus indicator for keyboard users on buttons, links, chips or checkboxes. I added a `:focus-visible` ring (2px ink, 2px offset) as a baseline. **Confirm this is acceptable or supply the intended treatment.**
5. **Book grid width conflict.** The Doc's 12-column diagram says *"book grid takes 4 columns per cover"* (= 3 covers per row), but every actual layout in Page Skeletons and Domain Components uses **4 covers per row**. Implemented as 4-up, per the layouts.
6. **Card padding varies** across pages: 20, 22, 24, 26, 28px. Standardised on **24px** (`space-3`) with 20/28 as the documented compact/roomy ends.
7. **Fractional type sizes** (12.5, 13.5, 14.5px) come straight from the references and are preserved verbatim rather than rounded to an 8px-derived ramp.
8. **Semantic "success = ink"** is deliberate and unusual. There is no green anywhere. Confirm this holds for any future non-order success messaging.
9. **`#E8E3D7`** appears only inside `repeating-linear-gradient` cover placeholders, and `#EFECE4` only as the Page Skeletons sheet background. Treated as artefacts of the reference documents, **not** app tokens.
10. **Mobile behaviour is undocumented.** All skeletons are drawn at 1440px. Breakpoint columns and padding are specified, but header collapse, the cart/summary rail stack order, and the book-detail three-column reflow are not. Assumed: rails stack below content, header nav collapses to a menu.

---

## 12. Where the tokens live

| Concern | File |
|---|---|
| Raw values + `@theme` token declarations | [apps/web/src/styles/theme.css](apps/web/src/styles/theme.css) |
| Base styles, element defaults, component utility classes | [apps/web/src/app/globals.css](apps/web/src/app/globals.css) |
| Font loading (Lora, Public Sans) | [apps/web/src/app/layout.tsx](apps/web/src/app/layout.tsx) |
| `cn()` class merger | [apps/web/src/lib/utils.ts](apps/web/src/lib/utils.ts) |
| `cva` primitive variants | [apps/web/src/lib/variants.ts](apps/web/src/lib/variants.ts) |
| UI primitives | [apps/web/src/components/ui/](apps/web/src/components/ui/) |
| Domain components (+ reuse notes) | [apps/web/src/components/domain/](apps/web/src/components/domain/) |
| Layout shells | [apps/web/src/components/layout/](apps/web/src/components/layout/) |
| Internal component playground | [apps/web/src/app/playground/page.tsx](apps/web/src/app/playground/page.tsx) |
