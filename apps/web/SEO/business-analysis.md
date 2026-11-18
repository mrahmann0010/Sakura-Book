# Business & audience analysis

*Written 18 November 2026. Evidence is either repository code, a live HTTP
response, or a search result — each is labelled. Anything not verifiable is
marked **Hypothesis**.*

---

## 1. What this application is

**Nihonova Books** (`books.nihonovaacademy.com`) is a single-brand, print-only
bookshop for Japanese-language study material written in Bangla. It is not a
general bookstore and not a digital-content platform.

| Fact | Evidence |
| --- | --- |
| Next.js 16 App Router, server-rendered, three locales under `/[locale]` | `apps/web/next.config.ts`, `src/app/[locale]/` |
| Sells **printed** copies only; a free PDF sample is offered per title | `bookDetailSchema.pdfUrl` doc comment, `components/domain/cover-preview.tsx` |
| **No customer accounts.** Orders are looked up by order number | no auth route outside `/admin`; `src/app/[locale]/orders/` |
| Bangladesh-only fulfilment | `src/lib/bd-geo.ts` is the whole address vocabulary |
| bKash / Rocket / Nagad payment | `components/domain/mobile-money-payment.tsx` |
| Catalogue is **five titles** as of this writing | live `/sitemap.xml`, 21 URLs = 7 pages × 3 locales |

Live catalogue, measured from production JSON-LD on 18 November 2026:

| Slug | Title | Price | Stock | Pages |
| --- | --- | --- | --- | --- |
| `kanji-redical-guide-book` | কাঞ্জি মুখস্থ নয় | ৳349 | **In stock** | 194 |
| `listening-n4` | নিহোনোভা লিসেনিং - N4 | ৳330 | **In stock** | 214 |
| `listening-n5` | নিহোনোভা লিসেনিং - N5 | ৳320 | **In stock** | 216 |
| `nihonova-jlpt-n5-grammer` | Nihonova JLPT N5 Grammer | ৳299 | Out of stock | 180 |
| `nihonova-spoken-japanese` | Nihonova Spoken Japanese | ৳199 | Out of stock | 100 |

**Three of five titles are buyable**, and those three are also the pages the
owner reports as currently receiving traffic — which is what you would expect,
and what makes them the right place to spend indexing effort
(`indexing-priority.md`).

**Price positioning: mid-market.** ৳199–৳349 sits between Rokomari's N5 titles
(৳150–৳300) and BooKVandar's Sharif's N5 Bangla (৳480). An earlier draft of
this analysis assumed a premium position and advised defending it; the numbers
say otherwise. See `technical-seo-audit.md` TEC-25.

**No title carries an ISBN** (TEC-24).

> **Two of those five slugs are misspelled**: `redical` (radical) and `grammer`
> (grammar). See `technical-seo-audit.md` — this is a ranking problem, not only
> a tidiness one.

The data model already supports more structure than the shop exposes:
`categories` carries a **`level`** group (N5–N1) and a **`skill`** group
(grammar, kanji, vocabulary, reading, listening) — see
`apps/api/src/db/seed/reset-and-seed-jlpt.ts`. Until this pass, the storefront
rendered the skill group only and indexed neither.

## 2. Business model

Direct-to-consumer retail of **its own** titles. Nihonova Academy teaches
Japanese; Nihonova Books sells the textbooks the academy authors. Revenue is
unit sales of printed books, nationwide delivery, mobile-money payment, with a
waitlist/invite mechanism for print runs smaller than demand
(`stockQuantity` doc comment in `packages/contracts/src/catalog.ts`).

This makes it a **publisher-retailer**, not a reseller — the single most
important fact for SEO strategy, because it means the shop is the only possible
source for its inventory and competes on *demand capture*, not on price.

## 3. Relationship with Nihonova Academy

`www.nihonovaacademy.com` is the parent: a Japanese-language school for
Bangladeshi students. The shop is its publishing arm.

**Before this pass, nothing in the markup said so.** There was no
`Organization` node, no `sameAs`, no `parentOrganization`. Two domains under one
brand were, to a crawler, two unrelated sites — so none of the academy's brand
authority reached the shop. Fixed; see `implementation-report.md`.

## 4. Competitive advantage

1. **Original Bangla-medium content.** Competitors resell Japanese or
   English-medium books, or third-party Bangla adaptations (Sharif's, Mokbul
   Hosain Aladin). Nihonova writes its own. *Evidence: search results in
   `competitor-analysis.md`; no competitor found publishing under its own name.*
2. **Teaching institution behind the books.** Authorship by a school is an
   E-E-A-T signal no marketplace listing can match.
3. **Brand-owned shop, not a marketplace stall.** Competitors sell mainly
   through Daraz / Rokomari / Othoba, where they cannot control metadata,
   structured data or internal linking. Nihonova owns its stack entirely.
4. **Free readable sample per title.** A genuine conversion asset; most
   competitors show a cover and a price.

**The weakness that cancels much of this:** five products. Topical authority
cannot be built from five product pages, which is why the content strategy in
`content-roadmap.md` is not optional garnish — it is the growth mechanism.

## 5. Target audience

### Confirmed from the product

- Bangladeshi learners who need **Bangla explanations** of Japanese. The books
  exist for exactly this; `language: "bn"` on the catalogue rows.
- **JLPT candidates**, N5 and N4 above all — four of five titles are N5/N4.
- Buyers who pay by **mobile money** and receive by **courier**, countrywide.

### Hypothesis (reasonable, not verified)

- **Self-learners and academy students**, split roughly between those preparing
  for the JLPT/JFT-Basic/NAT exams as a route to **work or study in Japan**, and
  those learning out of interest. The Bangladesh→Japan labour and student
  corridor is the commercial engine behind JLPT demand in the country; this
  should be confirmed from the shop's own order data, not assumed.
- **Price-sensitive, mobile-first, Facebook-referred.** Bangladesh e-commerce
  skews heavily to Android and to Facebook/Messenger link-sharing. This is why
  a missing `og:image` on the home page (fixed in this pass) was costly.

### Search behaviour

| Segment | Types | Language | Intent |
| --- | --- | --- | --- |
| Absolute beginner | "জাপানি ভাষা শেখার বই", "how to learn Japanese" | Bangla | Informational → commercial |
| JLPT candidate | "JLPT N5 বই", "JLPT N4 preparation book" | Mixed Bangla/Latin | Commercial investigation |
| Skill-specific | "জাপানি কানজি শেখার বই", "Japanese grammar book Bangla" | Bangla | Commercial |
| Comparison shopper | "Sharifs N5 vs ...", "best JLPT N5 book Bangladesh" | English | Commercial investigation |
| Brand | "Nihonova", "Nihonova Academy books" | Either | Navigational |

**Observed, not assumed:** Bangladeshi learners type JLPT level codes in Latin
script inside otherwise-Bangla queries ("JLPT N5 বই"). Every search result
surfaced for these queries mixes scripts the same way. The facet page copy
written in this pass follows that pattern deliberately.

## 6. What this shop should rank for, and why

Ranked by commercial value, not by volume:

1. **`JLPT N5 বই` / `JLPT N5 books Bangladesh`** — the entry point. N5 is where
   every learner starts, so it is the largest buyer cohort and the start of a
   five-level repeat-purchase relationship.
2. **`জাপানি কানজি শেখার বই`** — the shop's flagship title addresses exactly
   this, and the query carries clear purchase intent.
3. **`বাংলায় জাপানি শেখার বই`** — the category-defining phrase, and the one the
   brand's differentiator ("in Bangla") is literally about.
4. **N4 / N3 level terms** — repeat purchase from the N5 cohort.
5. **Informational Bangla queries** ("কানজি কীভাবে শিখব", "JLPT N5 সিলেবাস") —
   near-zero competition in Bangla (see `competitor-analysis.md` §5), and they
   feed the commercial terms above.

What it should **not** chase: generic "Japanese textbooks", international
JLPT-book queries, or anything served by Amazon/OMGJapan. The shop cannot ship
there and does not sell those books.
