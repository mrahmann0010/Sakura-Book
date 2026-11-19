# SEO — Nihonova Books

Research, strategy and implementation from the SEO pass of 18 November 2026,
carried out against commit `d643c57` and the live site.

| Document | What it holds |
| --- | --- |
| [`business-analysis.md`](business-analysis.md) | What this shop is, its model, its audience, what it should rank for |
| [`competitor-analysis.md`](competitor-analysis.md) | Ten real competitors found via live SERPs, their weaknesses, the openings |
| [`competitor-keyword-analysis.md`](competitor-keyword-analysis.md) | What each competitor's ranking pages actually target, read from their live HTML, and the gap map |
| [`bangladesh-keyword-demand.md`](bangladesh-keyword-demand.md) | **Top 50 most-searched queries**, from geo-targeted Google Autocomplete (`gl=bd`) |
| [`keyword-research.csv`](keyword-research.csv) | 70 keywords with intent, autocomplete rank, target URL, priority and source |
| [`keyword-mapping.md`](keyword-mapping.md) | Keyword → URL allocation, with cannibalisation rulings |
| [`seo-strategy.md`](seo-strategy.md) | Positioning, technical / on-page / structured-data / linking / i18n strategy |
| [`content-roadmap.md`](content-roadmap.md) | Twenty researched content opportunities with outlines |
| [`technical-seo-audit.md`](technical-seo-audit.md) | 22 findings with severity, reproducible evidence and status |
| [`implementation-report.md`](implementation-report.md) | Every code change, with validation output |
| [`indexing-priority.md`](indexing-priority.md) | **The 10 URLs to push in Search Console**, measured against production, and what to fix first |
| [`seo-roadmap.md`](seo-roadmap.md) | Immediate / 30 / 60 / 90-day plan and long-term growth |
| [`initial-guide.md`](initial-guide.md) | The original brief this pass answers |

## The short version

**The site's technical SEO was already good.** Canonicals, hreflang, a dynamic
sitemap, a reasoned robots.txt, noindex on transactional pages and Book/Offer
markup were all in place before this pass.

**What it had almost none of was surface area.** Seven unique pages across three
locales — and not one page targeting `JLPT N5 বই`, `জাপানি কানজি শেখার বই` or
any other term the business exists to serve. The level facets were not even
rendered in the filter rail, and every filtered view was `noindex` and
unreachable without JavaScript.

This pass added **10 indexable category pages**, full organisation and
breadcrumb structured data, a default share card, keyword-bearing product
titles, and fixed a handful of real defects — including footer links that sent
English and Japanese visitors to the Bangla policy pages.

**Sitemap: 21 → 63 URLs.** Build, typecheck and lint clean; all output verified
against a running server. **Nothing was deployed.**

## Four things the demand data changed

1. **"PDF" dominates the market.** `জাপানি ভাষা শিক্ষা বই pdf`, `jlpt n5 books pdf`,
   `minna no nihongo n5 bangla pdf` all rank 1–3 in autocomplete. A large share of
   this audience wants the book free. Answer it with the sample reader, not a
   product page.
2. **The Japan migration motive is confirmed**, not hypothesised —
   `জাপানে যাওয়ার সহজ উপায়`, `জাপানি ভাষা শিখে জাপান যাওয়ার উপায়` both rank 1.
3. **Course demand dwarfs book demand** and belongs to `nihonovaacademy.com`.
   Cross-link; do not compete with your own parent brand.
4. **Price queries are top-tier and unowned by you.** Four of them in the top 50.
   Expect to be compared against Rokomari at ৳150–৳300.

**The competitor to beat is Dhaka Language / Shield Language Academy** — a school
selling its own books, with an exact-match title on the top Bangla query. Their
weakness: one monolithic page for every level. Yours: ten separate level and
skill pages. Rokomari's category page, by contrast, has **no `<h1>` at all**.

## Decisions waiting on the owner

1. The `ja` locale — an indexed duplicate of `/en` for a market that cannot be
   shipped to (TEC-02).
2. The two misspelled product slugs, which need a redirect migration (TEC-03).
3. The category tagging (TEC-23) — two books are tagged into nearly every level and skill, so four facet pages return the same two titles. Admin data, no deploy. **This is now the highest-value open item.**
4. Missing ISBNs on all five titles (TEC-24).
5. Whether the Cloudflare managed robots.txt block is intended (TEC-18).

Start with [`seo-roadmap.md`](seo-roadmap.md).
