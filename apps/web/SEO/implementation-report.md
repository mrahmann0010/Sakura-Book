# Implementation report

Everything in this document is in the working tree on branch
`feat/restore-add-to-cart`, type-checked, linted, production-built and verified
against a running server. **Nothing was deployed.**

---

## 1. Files changed

### New

| File | Purpose |
| --- | --- |
| `src/lib/structured-data.ts` | `Organization`, `WebSite` + `SearchAction`, `BreadcrumbList`, `ItemList`, and the `@graph` wrapper |
| `src/components/seo/json-ld.tsx` | The one place JSON-LD is written into the document; escapes `<` so a `</script>` in any string value cannot break out |
| `src/components/seo/index.ts` | Barrel |
| `src/app/[locale]/opengraph-image.tsx` | 1200×630 default share card |
| `apps/web/SEO/*.md`, `keyword-research.csv` | These deliverables |

### Modified

| File | Change |
| --- | --- |
| `src/lib/seo.ts` | `metaDescription`, `bookFacets`, `bookSeoTitle`, `FACET_SEO` (10 facets × 2 languages), `facetSeo`, `indexableFacet`, `indexableFacets`, `LEVEL_GROUP`/`SKILL_GROUP` |
| `src/app/[locale]/catalog/page.tsx` | Facet views indexable + self-canonical; facet `<h1>` and lede; `level` facets restored to the rail; `BreadcrumbList` + `ItemList`; localized footer |
| `src/app/[locale]/books/[slug]/page.tsx` | `bookSeoTitle` + `metaDescription`; `Book`→`["Book","Product"]`; `BreadcrumbList` from the same array the visible trail uses; localized footer |
| `src/app/[locale]/page.tsx` | `Organization` + `WebSite` graph; localized footer |
| `src/app/sitemap.ts` | Facet pages, contact + policy pages, honest `changeFrequency`, `lastModified` removed |
| `src/app/robots.ts` | `Disallow: /*/invite` |
| `src/proxy.ts` | Locale redirect `307` → `308` |
| `src/lib/books.ts` | `localizedFooterColumns()`; "By level" footer column |
| `src/lib/site.ts` | `localeAlternates` doc updated for the single-facet query-string case |
| `src/lib/storage-url.ts` | `absoluteFileUrl` now genuinely absolute for every input shape |
| `src/components/layout/site-footer.tsx` | Grid tracks derived from column count instead of hardcoded at four |

`git diff --stat`: **11 files changed, 616 insertions(+), 74 deletions(-)**, plus 4 new source files.

## 2. SEO improvements, by what they buy

| # | Improvement | Business effect |
| --- | --- | --- |
| 1 | **10 indexable category pages** (5 JLPT levels + 5 skills), each with its own title, description, `<h1>`, lede, canonical, hreflang set and sitemap entry | The shop can now rank for `JLPT N5 বই`, `জাপানি কানজি শেখার বই` etc. **Before this, no page on the site targeted any of them.** |
| 2 | Site-wide footer **"By level"** crawl path | Those pages are reachable by a crawler at all — previously only by clicking a client-side filter |
| 3 | `Organization` + `parentOrganization` + `sameAs` | Ties the shop to Nihonova Academy; knowledge-panel and brand-search eligibility |
| 4 | `WebSite` + `SearchAction` | Sitelinks search box eligibility, pointed at the catalogue's real `?q=` |
| 5 | `["Book","Product"]` + `Offer` | Price and availability in the result, not just a blue link |
| 6 | `BreadcrumbList` on books and facets | Readable trail instead of a raw URL in the result |
| 7 | `ItemList` on the catalogue | Declares the page as a listing of its books |
| 8 | Default `og:image` | Facebook/Messenger shares stop rendering blank — the dominant referral surface in this market |
| 9 | Keyword-bearing book titles from real category tags | "কাঞ্জি মুখস্থ নয়" alone contained no searchable term |
| 10 | Word-boundary meta descriptions | Snippets stop ending mid-syllable |
| 11 | Footer links locale-prefixed on the 3 indexed pages | Removes a redirect hop per link **and fixes a real user bug** — an English visitor was sent to the Bangla policy page |
| 12 | `308` instead of `307` | Consolidates signals onto the canonical prefixed URLs, starting with the origin itself |
| 13 | Sitemap **21 → 63 URLs**, honest freshness | Stops training crawlers to ignore `lastmod` |
| 14 | `Disallow: /*/invite` | Single-use waitlist tokens stay out of crawl logs |

## 3. Validation

All run locally, 18 November 2026.

| Check | Result |
| --- | --- |
| `npm run typecheck` (`next typegen` + `tsc --noEmit`) | ✅ clean |
| `npm run lint` (eslint) | ✅ clean |
| `npm run build` | ✅ 119 static pages generated, no warnings |
| Production server + stub API serving the real contract shapes | ✅ |

### Verified on rendered output

```
GET /                       → 308 → /bn                       ✅ (was 307)
GET /bn/catalog?genre=n5    → 200
  <title>   JLPT N5 বই — বাংলায় জাপানি ভাষার প্রথম ধাপ · Nihonova Books   ✅ unique
  <h1>      JLPT N5 বই                                                    ✅ keyword-bearing
  canonical https://…/bn/catalog?genre=n5                                 ✅ self-referencing
  hreflang  en / bn / ja / x-default, all carrying the query string        ✅
  robots    (absent → index,follow)                                        ✅
  ld+json   BreadcrumbList + ItemList(2)                                   ✅
GET /bn/books/kanji-redical-guide-book
  <title>   কাঞ্জি মুখস্থ নয় — JLPT N5 Kanji বই · Nihonova Books          ✅
  desc      …ভালোভাবে শেখা সম্ভব নয়…                                      ✅ whole word + ellipsis
  ld+json   ["Book","Product"] + Offer(InStock, 550.00 BDT) + BreadcrumbList ✅
GET /bn
  og:image  …/bn/opengraph-image  (1200×630 PNG, 39,666 bytes)             ✅
  ld+json   Organization(@id, parentOrganization, areaServed) + WebSite(SearchAction) ✅
  footer    only bare path remaining is /bn                                ✅ was /catalog, /terms, …
GET /sitemap.xml            → 63 URLs (21 before), 10 facet pages × 3 locales present ✅
GET /bn/opengraph-image     → 200 image/png 1200×630                       ✅
```

### Not validated, and why

- **Google Rich Results Test / PageSpeed Insights / Lighthouse** — all require a
  public URL. The changes are not deployed, so they can only be run after
  release. The structured data was instead validated by parsing the rendered
  JSON-LD and checking it against schema.org's expected shapes.
- **Indexing and rankings** — no Search Console access. **No claim is made
  anywhere in these documents that any page is indexed or ranking.**
- **Core Web Vitals** — needs field data; lab numbers from this machine would
  not represent a Dhaka mobile connection.

## 4. Deliberately not done

| Item | Why |
| --- | --- |
| Renaming `kanji-redical-guide-book` / `nihonova-jlpt-n5-grammer` | Changing a slug changes a URL and the slug is the API's lookup key. Needs a redirect map first — see `technical-seo-audit.md` TEC-03. Renaming without it 404s every existing link. |
| De-indexing the `ja` locale | Removes pages from the index. That is the owner's decision; recommendation and options are in TEC-02. |
| Rewriting the home/catalog `<h1>` | They are deliberate brand copy in an editorial design system. Recommendation is an added `<h2>`, not a replacement — TEC-09. |
| Changing the Cloudflare managed `robots.txt` | Live infrastructure. Not touched without authorisation — TEC-18. |
| Adding a blog | A route, a data source and an editorial process. `content-roadmap.md` specifies it; building it is a project, not a pass. |
| `AggregateRating` markup | The code emits it only when `book.rating` is non-null, and there is no reviews table — the contract calls this an open decision. Correct as-is: **no rating is ever fabricated.** |

## 5. Outstanding issues

Ordered by impact. Full detail in `technical-seo-audit.md`.

1. **TEC-03** Misspelled slugs — needs a redirect migration. *High.*
2. **TEC-02** `ja` locale duplicate — needs your decision. *High.*
3. **TEC-23** Over-tagging makes `?genre=n3`, `?genre=n2`, `?genre=n1` and `?genre=kanji` return the same two books. Admin data, no deploy. *High.* (This supersedes **TEC-21**, which predicted empty shelves and was wrong — see the audit.)
3b. **TEC-24** No title carries an ISBN. *Medium.*
4. **No content.** Still the largest gap by far — `content-roadmap.md`. *High, long-lead.*
5. **No `updatedAt` on the book contract**, so the sitemap cannot send a real `lastmod`. *Low.*
6. **TEC-20** Formulaic image alt text. *Low.*
7. **TEC-22** Footer headings untranslated. *Low, and an i18n issue rather than an SEO one.*
8. Eleven pages still inline `footerColumns.map(localizeLinks)`; they are correct but could migrate to `localizedFooterColumns`. *Cosmetic.*
