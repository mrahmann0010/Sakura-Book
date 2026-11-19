# SEO roadmap

*Starting point: 18 November 2026. Phases are ordered by dependency, not by
calendar — "30 days" means the first working month after this branch ships.*

---

## Immediate — before or with this branch's release

| # | Action | Owner | Why now |
| --- | --- | --- | --- |
| 1 | **Set `NEXT_PUBLIC_SITE_URL`** on every deploy target | Dev | Everything — canonicals, hreflang, sitemap, OG image URLs, JSON-LD `@id` — resolves against it. It falls back to `localhost:3000`, which would publish a sitemap full of localhost URLs. |
| 2 | **Review this branch and ship it** | Dev | The 14 fixes in `implementation-report.md` do nothing until deployed. |
| 3 | **Verify Googlebot is not blocked** in the Cloudflare managed `robots.txt` | Owner | TEC-18. A managed block sits ahead of the app's rules. Confirm `Googlebot` and `Googlebot-Image` are unaffected. |
| 4 | **Decide the `ja` locale** | Owner | TEC-02. A third of the crawl budget for a market that cannot be shipped to. Recommendation: keep the UI, remove it from the index. |
| 5 | **Fix the category tagging** | Owner / admin | **TEC-23, now the top data task.** `nihonova-spoken-japanese` is tagged into every level *and* every skill; `kanji-redical-guide-book` into all five levels. Result: `?genre=n3`, `?genre=n2`, `?genre=n1` and `?genre=kanji` return the **same two books**. Admin data, no deploy. **Do it before requesting indexing for those pages.** |
| 5b | **Add ISBNs** | Owner / admin | TEC-24. All five titles return `isbn: None`. Strongest entity signal a book has, and a Merchant Center requirement. |

## 30 days — foundations and measurement

| # | Action | Effort | Impact |
| --- | --- | --- | --- |
| 6 | **Set up Google Search Console**, verify the domain, submit `/sitemap.xml` | S | **Prerequisite for every claim in these documents.** Nothing about rankings can be stated without it. |
| 7 | Set up **Bing Webmaster Tools** | S | Free, and it feeds other surfaces. |
| 8 | Run **Rich Results Test** on a book page and a facet page, now that they are live | S | Confirms the structured data in the wild. |
| 9 | **Fix the misspelled slugs with a redirect map** (TEC-03) | M | `redical`→`radical`, `grammer`→`grammar`, in slug *and* title. Needs `308`s from the old URLs. **Do not rename without them.** |
| 10 | Run **PageSpeed Insights** on home, catalogue and a book page | S | Lab baseline; field data follows once there is traffic. |
| 10b | **Frame price on the commercial pages.** Four price queries sit in the top 50. Production prices are ৳199–৳349 against Rokomari's ৳150–৳300 and BooKVandar's ৳480 — **mid-market, not a premium** (TEC-25). Lead with what the book teaches; state the Bangla-medium and academy-authorship advantage as the reason to choose it, not as a defence of the price. | S | Transactional intent, currently unanswered. |
| 11 | **Get the first links.** Nothing links to this domain. Start with the obvious and legitimate: a prominent link from `nihonovaacademy.com`, the academy's Facebook page, and any BD study-abroad or JLPT community the academy already belongs to. | M | The single biggest non-content constraint. **No paid links, no directories-for-links.** |
| 12 | **Improve image alt text** to include level and skill (TEC-20) | S | Google Images is a real channel for covers. |
| 13 | **Enrich the five product descriptions** with level, audience, coverage and outcomes | M | Staff work in the admin, not code. Thin product copy is the one on-page weakness the code cannot fix. **Never state a claim the book does not support.** |

## 60 days — content begins

| # | Action | Effort | Impact |
| --- | --- | --- | --- |
| 14 | **Build the blog route** — `/{locale}/blog/{slug}`, `BlogPosting` markup, sitemap entries, breadcrumbs | L | The vehicle for everything in `content-roadmap.md`. |
| 15 | Publish the **four P0 pillars**. **Revised order after the demand harvest:** (1) `জাপানি ভাষা শেখার সহজ উপায়` — the strongest signal in the dataset, currently held only by Dhaka Language's `<h2>`; (2) hiragana; (3) the career/migration pillar — the motive is now confirmed, not hypothesised; (4) kanji method. | L | The empty-SERP opportunity. |
| 15b | **Build a free sample-chapter landing page** answering the `…pdf` intent honestly | M | The pdf family ranks 1–3 in autocomplete. The shop already has sample PDFs; it has no page that offers them to a searcher. |
| 16 | **Link pillars ↔ level and skill pages** both ways | S | Turns a flat link graph into a topic cluster. |
| 17 | Add a keyword-bearing `<h2>` under the home and catalogue `<h1>` (TEC-09) | S | Keeps the brand headline, adds the signal. |
| 18 | Add **`updatedAt`** to the book contract and feed a real `lastmod` | M | Lets the sitemap tell the truth about freshness. |
| 19 | Review the **first Search Console data** — impressions by query, indexed count | S | First evidence of whether any of this is working. |

## 90 days — compound and expand

| # | Action | Effort | Impact |
| --- | --- | --- | --- |
| 20 | Publish **six more articles** (the P1 set) | L | Depth across all four pillars. |
| 21 | **Google Merchant Center feed** | M | Physical goods, real prices, BDT, domestic delivery — eligible. `Product` markup is already in place. |
| 22 | **Localised OG card with a bundled Bangla font** | S | The current card is Latin-only because Satori ships no Bengali font; bundling Noto Sans Bengali as a build asset fixes it without a runtime fetch. |
| 23 | **Reviews** — a real table, then `AggregateRating` markup | L | `/yourexperience` already collects them. Star ratings in results are among the strongest CTR levers available. **Only with genuine data.** |
| 24 | Expand inventory toward **N3**, then re-prioritise its facet page | L | Business decision, but it is what makes the N3/N2/N1 pages worth having. |
| 25 | Re-run competitor SERPs **from a Bangladesh IP** | S | All observations in these documents were US-routed. Local results will differ. |

## Long-term growth

1. **Own Bangla Japanese-learning search outright.** Twenty articles is a
   beginning, not a finish. The territory is unclaimed and the brand is the one
   credible claimant.
2. **Level-to-level lifecycle.** A buyer entering at N5 is a four-book
   relationship over several years. Content at each level bridge (N5→N4→N3) is
   both SEO and retention.
3. **Become the citable Bangla reference.** Charts, grammar lists and syllabus
   breakdowns get cited and linked. Links are the one thing this domain cannot
   manufacture and most needs.
4. **Parent-brand synergy.** Two domains, one brand. The `Organization` markup
   declares it; cross-linking and shared content should make it real.
5. **Seasonality.** JLPT runs in July and December. Content and stock planning
   should anticipate the registration windows that precede them.
6. **Consider dropping `ja`** entirely once the decision in item 4 is made and
   observed.

## Risks

| Risk | Mitigation |
| --- | --- |
| **No links.** A domain nothing points to will not rank regardless of on-page quality. | Items 11 and 23; genuinely linkable content. |
| **Content quality collapse** under volume pressure. | Two pieces a month, instructor-reviewed. Twenty good articles beat two hundred generated ones, and Google's systems specifically target the latter. |
| **Near-duplicate facet pages** from over-tagging (TEC-23). | Item 5 — admin data. Any facet still returning only out-of-stock titles afterwards comes out of `indexableFacets`. |
| **Misspelled slugs become permanent** because the redirect work looks tedious. | Item 9. It gets harder, not easier, the more links accumulate. |
| **Claiming results without data.** | Search Console first (item 6). Nothing in these documents claims a ranking, and nothing should until it is measured. |
