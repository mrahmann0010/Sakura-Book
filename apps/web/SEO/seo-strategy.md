# SEO strategy

---

## 1. The positioning

> **Nihonova Books is the Bangla-language source for Japanese study — the
> publisher, not a reseller.**

Everything below follows from one structural fact: the shop **writes** the
books it sells. No competitor found in this research does. That has three
consequences:

- It cannot be undercut on its own inventory, because nobody else has it.
- It can write authoritatively about its subject, which no marketplace stall can.
- But it has **five products**, so it cannot win on catalogue size and must win
  on *depth per query* and on *owning the question before the purchase*.

### What not to do

Do not fight Rokomari and Daraz on generic category terms. They have the
authority and the breadth; the ROI is poor and the traffic is unqualified.
Equally, do not chase international JLPT-book queries — the shop ships within
Bangladesh only, so that traffic cannot convert.

### The three battlegrounds, in order

1. **Level and skill terms** (`JLPT N5 বই`, `জাপানি কানজি শেখার বই`) — high
   commercial intent, own-brand pages now exist, incumbents are thin.
2. **Bangla informational search** — an almost empty SERP (the only Bangla
   result found for a Bangla kanji query was a single blog; everything else was
   English). This is the largest unclaimed territory in the market.
3. **Brand search** — "Nihonova" must return the shop with sitelinks. Cheapest
   win available, and the markup for it is now in place.

## 2. Technical SEO strategy

### Principles this codebase already follows, and should keep

- **Server-render anything a crawler must read.** Filters live in the URL and
  the catalogue is a server component — this is why facet pages were possible
  at all.
- **One canonical per locale, with a complete hreflang set.** Already correct.
- **`noindex` every per-shopper surface, and `Disallow` it too.** The existing
  comment in `robots.ts` has the reasoning exactly right: neither implies the
  other.

### The rule introduced by this pass

> **A filtered view is a page when it is a category, and a slice otherwise.**

Concretely: one facet, page 1, no search term, and on an editorial allowlist
→ self-canonical and indexed. Anything else → `noindex, follow` with a
canonical to `/catalog`. This keeps the index small and intentional while
giving the business the ~10 landing pages it actually needs, and it prevents
the combinatorial explosion that makes faceted navigation a crawl-budget sink.

The allowlist (`indexableFacets` in `src/lib/seo.ts`) is deliberately a code
constant, not a database flag: whether a shelf deserves a landing page is an
editorial judgement, not a consequence of a row being inserted.

### Ongoing technical priorities

1. Resolve the misspelled slugs **with** a redirect map (TEC-03).
2. Decide the `ja` locale (TEC-02) — it is a third of the crawl budget.
3. Add `updatedAt` to the book contract so the sitemap can send a real `lastmod`.
4. Keep structured data generated from rendered data only. The existing rule —
   "it can never claim a price the page does not show" — is the one rule
   structured data has.

## 3. On-page SEO strategy

| Surface | Rule |
| --- | --- |
| **Title tags** | Written for the query, not as a restatement of the `<h1>`. `lib/seo.ts` holds search-intent copy separately from the i18n files that hold human-facing copy. **This separation is a strength — keep it.** |
| **Meta descriptions** | Unique per page, word-boundary truncated, and they should *sell* (delivery, payment, Bangla explanation) rather than summarise. |
| **`<h1>`** | One per page, and it should contain the primary keyword where the page's job is search. Facet pages now do; the home and catalogue headings are brand copy and should gain a keyword-bearing `<h2>` instead of losing their `<h1>`. |
| **Product copy** | Each book page should answer: what it teaches, who it is for, its JLPT level, the language of explanation, what it covers, and what the reader can do afterwards. The level and skill are in the title now; the rest is description-field work by staff — **and must never state a fact the book does not support.** |
| **URL slugs** | Lowercase, hyphenated, keyword-bearing, spelled correctly. Two currently are not. |
| **Alt text** | Currently `"{title} — cover"` at 100% coverage. Upgrade to include level and skill for Google Images, which is a real discovery channel for book covers. |

## 4. Structured data strategy

| Type | Where | Status |
| --- | --- | --- |
| `Organization` (+`parentOrganization`, `sameAs`, `areaServed`) | Home | ✅ added |
| `WebSite` + `SearchAction` | Home | ✅ added |
| `BreadcrumbList` | Book, facet pages | ✅ added |
| `["Book","Product"]` + `Offer` | Book | ✅ upgraded |
| `ItemList` | Catalogue | ✅ added |
| `AggregateRating` / `Review` | Book | ⛔ **only when a real reviews table exists.** The code already gates on non-null data. Never fabricate this. |
| `Article` / `BlogPosting` | Future content | ◻ when the blog exists |
| `FAQPage` | Facet pages | ◻ considered and **rejected for now** — Google heavily restricted FAQ rich results, and adding Q&A blocks purely for markup would be writing for the crawler, not the learner. |

## 5. Internal linking strategy

The site's weakest dimension before this pass: the home page linked to 5 books
and the catalogue, the catalogue linked to the same 5 books, and nothing linked
to anything else. A flat graph with no topical structure.

The target shape:

```
Home ──► Catalogue ──► Book page
 │           │             ▲
 │           ▼             │
 └──► Level pages (N5…N1) ─┤   ◄── footer, site-wide
      Skill pages          │
             ▲             │
             │             │
      Blog article ────────┘   ◄── contextual, in-body
```

Rules:

1. **Every page is one hop from every level page** (the footer column).
2. **Book pages link up** to their level via the breadcrumb — now a link to an
   indexable page rather than into a `noindex` slice.
3. **Blog articles link down** into the level page *and* the specific book, in
   body copy, with descriptive anchor text — never "click here", never a naked
   URL.
4. **Level pages will link out** to their pillar article once content exists.
5. **No link schemes, no footer keyword stuffing.** The "By level" column is
   five navigational links a human uses, which is the test.

## 6. International / multilingual strategy

| Locale | Verdict |
| --- | --- |
| **`bn`** | ✅ The strategic centre. Default, `x-default`, full Bangla metadata. Correct. |
| **`en`** | ✅ Keep. Bangladeshi learners who search in English are a real segment, and the shop can serve them. |
| **`ja`** | ❌ **Recommend removing from the index** (keep the UI). English metadata under `<html lang="ja">` is a duplicate of `/en`, for a market the shop cannot ship to, consuming a third of the crawl budget. See TEC-02. |

Do **not** add more locales. Three trees over seven pages was already more URL
than content; the fix is depth, not breadth.

## 7. Beyond conventional search

| Channel | Assessment |
| --- | --- |
| **Google organic** | The core. Everything above. |
| **Google Images** | Genuinely worth effort — book covers and, later, kanji/hiragana charts. Needs better alt text and descriptive filenames. |
| **Google Shopping / Merchant Center** | **Eligible and worth pursuing.** Physical goods, real prices, real stock, BDT, domestic delivery. The `Product` markup added here is the precondition. A feed is a separate project. |
| **Rich results** | Price + availability (shipped), breadcrumbs (shipped), sitelinks search box (shipped). |
| **AI search** | **Still open to the shop** — the Cloudflare block covers *training* crawlers, not retrieval agents, so AI assistants can still read and cite these pages. Clear structure, factual product pages and genuine Bangla content are exactly what gets cited. The `ai-train=no` signal protects the content while leaving citation intact; that is the right trade. |
| **Brand search** | `Organization` + `sameAs` to the academy is the lever. |
| **Facebook / Messenger** | Not SEO, but it is this market's dominant referral surface and a blank share card was costing every share. Now fixed. |

## 8. How to tell whether this worked

Measure these, not raw sessions:

1. **Indexed page count** → should go from ~21 toward ~63 (Search Console).
2. **Impressions on level and skill queries** → currently ~0.
3. **Brand query impressions** and whether sitelinks appear.
4. **Click-through rate on book pages** — the title and description changes are
   a direct CTR intervention.
5. **Organic → add-to-cart rate**, segmented by landing page type. Level pages
   should convert better than the generic catalogue; if they do not, the copy is
   wrong, not the strategy.

The objective is not traffic. It is **qualified Bangladeshi learners landing on
a page that answers the thing they typed and sells them the book that solves
it.**
