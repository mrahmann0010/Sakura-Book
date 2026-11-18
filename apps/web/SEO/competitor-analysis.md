# Competitor analysis

*All competitors below were found by running real queries in November 2026. No
competitor is listed because it is famous; each appeared in results for a query
this shop needs to win. **No search volumes, difficulty scores, CPC figures or
ranking positions appear in this document**, because no keyword tool was
available in this environment — inventing them would be worse than omitting
them. What is recorded is SERP presence, which was observed directly.*

---

## 1. The finding that matters most

> **Nihonova Books does not appear in results for any commercial query this
> shop exists to serve — including brand-adjacent ones.**

A search for `Nihonova Academy books JLPT Bangla` returned Sharif's titles,
Othoba listings, Axia Books and international JLPT guides. It did not return
`books.nihonovaacademy.com`. Searches for `JLPT N5 preparation books Bangladesh`
and `জাপানি ভাষা শেখার বই কিনুন অনলাইন বাংলাদেশ` returned nine distinct sellers
between them; Nihonova was in neither set.

The technical baseline of the site is good (see `technical-seo-audit.md` — it
had canonicals, hreflang, a sitemap and Book/Offer markup before this pass).
The reason it is invisible is **surface area**: seven unique pages, no category
pages, no content, and no site on earth links to it. That is the problem the
strategy addresses, and it is not primarily a technical one.

## 2. Direct competitors — Bangladesh, Bangla-medium JLPT books

| Competitor | URL | Model | What they sell | SEO posture |
| --- | --- | --- | --- | --- |
| **Rokomari** | rokomari.com | Marketplace, national | Third-party Bangla Japanese titles; has a dedicated `/list/83265/Japanese` category | **Strongest local player.** Huge domain authority, mature category pages, Bangla-first. Owns generic "জাপানি ভাষা শিক্ষা" queries. |
| **Daraz Bangladesh** | daraz.com.bd | Marketplace | Sharif's Nihongo Matome N5, Minna no Nihongo Bangla | Enormous authority; product pages rank on long-tail title queries. Thin, templated copy. |
| **Othoba** | othoba.com | Marketplace | Sharif's N5/N3 Bangla, resold from Book Vandar | Ranks, but with **severe duplicate-URL problems** — the same Sharif's N5 title appeared at four distinct Othoba URLs (`/…-522232`, `/…-522318`, a `vendor.` subdomain copy). Self-inflicted cannibalisation. |
| **BooKVandar** | bookvandar.com | Independent online bookshop | Sharif's series, N5 three-book sets | Focused, real category structure, genuinely competes. The closest analogue to Nihonova's own shape. |
| **Vashashikhi** ("ভাষা শিখি") | vashashikhi.com | Niche language-book shop | Irodori, Sharif's, Mokbul Hosain Aladin JLPT N5/N3 | **The sharpest direct competitor.** Niche-focused exactly as Nihonova is, with more titles and a head start. |
| **Dhaka Language** | dhakalanguage.com | School + bookshop | Bangla Japanese books, N5–N2 sets (~৳2,900) | Same school-plus-books model as Nihonova. Dedicated `/japaneselangaugebanglabook` page — note it ranks *despite* a typo in its own URL. |
| **e-Samama (Sayeed Publications)** | sp.e-samama.com | Publisher-retailer | Own-brand JLPT N5–N2 books (N5 Premium ৳1,550) | **The closest business-model match: a publisher selling its own Bangla JLPT books.** Weak site (query-string URLs, `?id=24`), strong product fit. |
| **Boiboiboi** | boiboiboi.com | Dhaka online bookshop | JLPT N5 Complete Mock Exam (৳270) | Clean product URLs; competes on mock-test queries. |
| **Majumder Shop** | mshopbd.com | Nilkhet shop online | Minna no Nihongo N5 Bangla Grammar (৳350) | Low authority, but ranks on exact-title queries. |
| **Axia Books** | axiabooks.com | Online bookshop | "Foreign Language Skill" category incl. Minna no Nihongo Bangla | Category-led structure. |

## 3. Indirect competitors — international, mostly not a threat

| Competitor | Why it appears | Real threat? |
| --- | --- | --- |
| **Ubuy Bangladesh** (ubuy.com.bd) | Imports English-medium JLPT grammar books into BD results | **Yes, partially** — it owns the `…Bangladesh` modifier on English queries without stocking anything Bangla-medium. |
| **OMGJapan**, **Nipponrama**, **White Rabbit Japan** | Ship worldwide; rank on `JLPT N5 books` globally | **No** — priced in USD/JPY, no Bangla, shipping cost makes them irrelevant to the buyer. |
| **3A Corporation** (3anet.co.jp) | Publisher of the Japanese-medium originals | **No** — a potential *reference*, not a rival. |
| **Tofugu / Coto / Migaku / Busuu / FluentU / Tanos** | Dominate English informational Japanese-learning queries | **No, directly — but they define the content bar**, and they are what a Bangla searcher currently falls back to. |
| **jlpt.jp**, **tanos.co.uk** | Official and quasi-official JLPT reference | **No** — these are **link and citation targets**, see `seo-strategy.md`. |

## 4. Competitor strengths and weaknesses

### What the field does well
- Marketplaces (Rokomari, Daraz, Othoba) hold the authority and the generic
  category queries. **Nihonova will not beat them on those terms and should not
  try.**
- Vashashikhi and BooKVandar have the title breadth Nihonova lacks.

### Where the whole field is weak — and these are the openings
1. **Nobody owns Bangla informational content.** A search for
   `জাপানি কানজি শেখার নিয়ম বাংলা গাইড` returned Migaku, Coto, Busuu and
   Guide to Japanese — all English — plus exactly **one** Bangla blog
   (univext.com). For a country with a large and growing Japanese-learning
   population, Bangla-language Japanese instruction is close to an empty SERP.
2. **Competitors resell; they do not author.** Not one of the Bangladeshi
   retailers can write authoritatively about the books they sell. Nihonova can,
   because it wrote them.
3. **Marketplace listings carry thin, duplicated copy** and no real structured
   data. A well-built own-domain product page can out-detail them.
4. **Othoba actively cannibalises itself** — four URLs for one book.
5. **e-Samama, the nearest model match, is on `sp.e-samama.com/?id=24`.** A
   query-string identity with no slug, no category pages, and a subdomain. The
   business is a real competitor; the website is not.
6. **No competitor found running structured data for price/availability.** The
   Book+Product markup added in this pass is a differentiator today.

## 5. How Nihonova outperforms them

| Lever | The play |
| --- | --- |
| **Own the level terms** | Nobody has clean, well-written `JLPT N5 বই` landing pages on an own-brand domain. Built in this pass. |
| **Own Bangla informational search** | Near-empty SERP, zero competition, directly feeds the commercial terms. The single largest opportunity on the table. See `content-roadmap.md`. |
| **Out-detail the marketplace product page** | Level, skill, who it is for, what it covers, sample chapter — all data the shop already holds. |
| **Be the citable Bangla source** | Academy authorship + original content is how you earn links from BD study-abroad, JLPT and career sites, which is the only durable fix for a domain nothing links to. |
| **Brand search** | "Nihonova" should return the shop, the academy, and sitelinks. The Organization/WebSite markup added in this pass is the precondition. |

## 6. Honest limits of this analysis

- **No keyword tool, Search Console or backlink data** was available. Domain
  authority comparisons, traffic estimates and keyword difficulty are therefore
  **absent, not estimated**.
- SERP observations are from US-routed searches in November 2026. Results seen
  from inside Bangladesh will differ, and local-market rank checks should be
  re-run from a BD IP before any ranking claim is made.
- Competitor prices quoted above are as listed at the time of the search and
  were not independently verified.
