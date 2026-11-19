# Technical SEO audit

*Audited 18 November 2026 against commit `d643c57` and the live site. Every
finding below was reproduced — the evidence column is a command you can re-run.
Status `FIXED` means implemented and verified in this pass (see
`implementation-report.md`); `OPEN` means it needs a decision or work beyond
this pass's remit.*

---

## What was already right

Worth stating plainly, because it shaped the priorities: **this codebase had a
better SEO baseline than most production e-commerce apps.** Before this pass it
already had server-rendered pages, per-locale canonicals, a complete hreflang
set with `x-default`, a dynamic sitemap, a reasoned `robots.txt`, `noindex` on
every transactional surface, `Book` + `Offer` structured data, correct
`metadataBase`, and `next/image` with 100% alt coverage on the home page. The
findings below are therefore mostly about **missing surface area and a few
specific defects**, not about neglect.

---

## Severity: Critical

### TEC-01 · No category pages existed at all — `FIXED`

**The single highest-impact finding.** The `categories` table carries a `level`
group (N5–N1) and a `skill` group, but:

- `catalog/page.tsx` filtered the rail to `group === "skill"`, so **the level
  facets were not rendered at all** — the shop's most-searched filter was the
  one it did not offer.
- Every filtered view was `robots: { index: false }` with a canonical pointing
  at bare `/catalog`.
- The filter rail is a client component that calls `router.push()`, so there
  were **no `<a href>` elements** into any filtered view for a crawler to follow.

Net effect: **zero indexable, zero crawlable pages targeting `JLPT N5 বই`,
`জাপানি কানজি শেখার বই`, or any level or skill term** — the terms the business
exists to serve.

> Evidence: `curl -s https://books.nihonovaacademy.com/en/catalog | grep -o 'href="/en/catalog?[^"]*"'` → no output.

**Fix:** single-facet page-1 views are now self-canonical, indexed, carry their
own title/description/`<h1>`/lede, are listed in the sitemap, and are linked
site-wide from a footer "By level" column. Levels restored to the filter rail.

### TEC-02 · The `ja` locale is an indexed duplicate — `OPEN (needs your decision)`

`/ja` serves `<html lang="ja">` with **English** `<title>`, description and
Open Graph copy, because `lib/seo.ts` falls back `ja → en` by design. The
page body *is* translated, so the declared language, the metadata language and
the body language are three different answers.

It is a third of every sitemap entry, a third of the crawl budget, and a
hreflang cluster member — for a market the shop **cannot ship to**
(`lib/bd-geo.ts` is Bangladesh-only).

> Evidence: `curl -s https://books.nihonovaacademy.com/ja | grep -o '<title>[^<]*'` → the English title.

**Options, in order of my recommendation:**

1. **Keep `ja` for users, remove it from search** — add `robots: { index: false, follow: true }` for `ja`, drop it from the sitemap and from the hreflang set. Japanese-speaking staff and partners keep the UI; the index stops holding a duplicate.
2. Write genuine Japanese metadata. Only worth it if there is a real Japanese-reading audience — there is no evidence of one.
3. Remove the locale.

**Not implemented unilaterally**: it removes pages from the index and that is
the owner's call, not an auditor's.

### TEC-03 · Two product slugs are misspelled — `OPEN (needs a migration)`

| Live URL | Problem |
| --- | --- |
| `/books/kanji-redical-guide-book` | `redical` → **radical** |
| `/books/nihonova-jlpt-n5-grammer` | `grammer` → **grammar** |

The misspelling is in the slug *and* in the displayed title
("Nihonova JLPT N5 Grammer"). The keyword lost in each case is the one the
product is about. It also reads as carelessness on a page asking for ৳550.

**Not fixed here** — a slug is a URL, the slug is the API's lookup key
(`GET /books/:slug`), and both titles are database rows, not code. The
migration needs: a `slug_aliases` table or a redirect map, a `308` from old to
new, the admin title corrected, and the sitemap left to regenerate. **Renaming
without the redirect would 404 every existing link and share.**

---

## Severity: High

### TEC-04 · Footer links on the three indexable pages were not locale-prefixed — `FIXED`

`footerColumns` holds bare paths (`/catalog`, `/terms`). Eleven of the fourteen
pages that render a footer mapped `localizeLinks` over it. **Three did not —
home, catalog and book detail**, i.e. exactly the three indexed pages.

Consequences, both real:
- **Crawl:** every footer link on every book page was a `307` hop.
- **Users:** an English or Japanese visitor clicking "Terms & conditions"
  landed on the **Bangla** page, because `proxy.ts` sends unprefixed paths to
  `defaultLocale`.

> Evidence: `curl -s https://books.nihonovaacademy.com/bn | grep -o 'href="/[a-z-]*"'` → `/catalog`, `/contact`, `/orders`, `/terms`, …

**Fix:** `localizedFooterColumns(locale)` in `lib/books.ts`, used by the three
pages. Verified: the only bare path left in the rendered home page is `/bn`.

### TEC-05 · Root and every bare path redirected with `307` — `FIXED`

`proxy.ts` used `NextResponse.redirect(url)`, which defaults to **307
Temporary**. The locale prefix is a permanent structural fact, so a crawler was
being told the bare URL might come back — it keeps re-requesting it and holds
ranking signals there instead of consolidating onto the prefixed URL. This hit
`https://books.nihonovaacademy.com/` itself, the most-linked URL on the site.

> Before: `curl -o /dev/null -w "%{http_code}" https://books.nihonovaacademy.com/` → `307`
> After (verified locally): `308`

### TEC-06 · No `Organization` or `WebSite` structured data — `FIXED`

Nothing anywhere declared who runs the shop or that it belongs to Nihonova
Academy. No knowledge-panel eligibility, no sitelinks search box, and **no
connection between the two brand domains**.

**Fix:** `Organization` (with `parentOrganization` + `sameAs` →
`nihonovaacademy.com`, `areaServed: Bangladesh`) and `WebSite` (with a
`SearchAction` pointing at the catalogue's real `?q=`) on the home page, as one
`@graph`.

### TEC-07 · No default `og:image` — `FIXED`

`twitter: { card: "summary_large_image" }` was declared with **no image
anywhere outside book pages**. Every share of the home page or any shelf
rendered as a blank rectangle — on Facebook and Messenger above all, which is
the dominant referral surface in this market.

**Fix:** `src/app/[locale]/opengraph-image.tsx`, a 1200×630 card in the
project's own palette, inherited by every page that does not set its own. Book
pages keep their cover. Verified rendering: 39 KB PNG, 1200×630.

---

## Severity: Medium

### TEC-08 · Meta descriptions were cut mid-word — `FIXED`

`book.description.slice(0, 160)`. On the live kanji book this produced a
snippet ending `…একটি Kanji-এ` — stopped mid-syllable. It also passed the
description's `\n\n` paragraph breaks into a meta attribute.

**Fix:** `metaDescription()` collapses whitespace, cuts at the last word
boundary inside 155 characters, trims a trailing punctuation mark and appends a
single ellipsis.

### TEC-09 · `<h1>` on home and catalog carry no search signal — `PARTIALLY FIXED`

| Page | `<h1>` | `<title>` |
| --- | --- | --- |
| Home | "পাতা উল্টালেই শুরু হোক…" (*let it begin with a turn of the page*) | "Nihonova Books — বাংলায় জাপানি ভাষা শেখার JLPT বই" |
| Catalog | "Every book on the shelves" | "JLPT N5–N1 Books — Grammar, Kanji & Vocabulary" |

The title tags are well written; the headings share none of their vocabulary.

**Fixed for the facet pages** — they now take a keyword-bearing `<h1>`
("JLPT N5 বই") plus a descriptive lede. **Left alone for home and the
unfiltered catalogue**: those headings are deliberate brand copy in an
editorial design system, and rewriting the landing hero is a brand decision,
not an SEO patch. Recommendation in `seo-roadmap.md` is to add a keyword-
bearing `<h2>` beneath, not to replace the `<h1>`.

### TEC-10 · Book `<title>` carried no searchable terms — `FIXED`

"কাঞ্জি মুখস্থ নয়" is a cover line. The title tag contained no "JLPT", no "N5",
no "kanji". **Fix:** `bookSeoTitle()` appends the level and skill the book is
*tagged with* — real data, nothing invented — giving
"কাঞ্জি মুখস্থ নয় — JLPT N5 Kanji বই · Nihonova Books". `og:title` keeps the
bare title.

### TEC-11 · Sitemap sent `lastmod: now` on every URL, every hour — `FIXED`

`lastModified: new Date()` on all 21 entries, regenerated hourly — telling
crawlers the privacy policy changed within the hour, every hour. Google's
documented response is to stop trusting `lastmod` for the whole site.
`changeFrequency: "daily"` was claimed for policy pages too.

**Fix:** `lastModified` omitted (the contract has no `updatedAt` for a book, so
there is no honest date to send — adding that column is the real fix);
per-type `changeFrequency`; policy and contact pages added. Sitemap grew from
**21 → 63 URLs**.

### TEC-12 · No `BreadcrumbList` markup — `FIXED`

Breadcrumbs were *drawn* on book pages at `lg:` only, with no markup. Drawing
them is not what Google reads. **Fix:** `BreadcrumbList` on book pages (built
from the same array the visible trail uses, so they cannot drift) and on facet
pages. Emitted at every viewport — the trail is a fact about the page, not a
layout decision.

### TEC-13 · No `ItemList` on the catalogue — `FIXED`

**Fix:** `ItemList` of the rendered books, in render order, URLs only.

### TEC-14 · `Book` alone is not eligible for price rich results — `FIXED`

Google's product snippet reads `Product`. **Fix:** `"@type": ["Book", "Product"]`
— both accurate, which is exactly what multi-typing is for.

### TEC-15 · `absoluteFileUrl` was not reliably absolute — `FIXED`

It prefixed the origin only when the path began with `/`. A stored value like
`covers/a.png` returned relative, which `og:image` survives via `metadataBase`
but the JSON-LD `image` does not. No production row has that shape today; a
function whose contract is "absolute" should not depend on that. **Fix:**
resolved through `new URL(resolved, origin)`.

### TEC-16 · Footer grid had four hardcoded tracks — `FIXED`

`lg:grid-cols-[2fr_1fr_1fr_1fr]` while the prop documented "the grid takes any
number". Adding the fourth column would have wrapped it under the blurb at `lg:`
only. **Fix:** `repeat(var(--footer-columns), 1fr)`.

### TEC-17 · Waitlist invite tokens were crawlable — `FIXED`

`/{locale}/invite/{token}` was `noindex` on the page but absent from
`robots.txt`. **Fix:** `Disallow: /*/invite`.

---

## Severity: Low / informational

### TEC-18 · Cloudflare injects a managed `robots.txt` block — `OPEN (your call)`

The live `robots.txt` is **not** what `app/robots.ts` emits. Cloudflare prepends
a managed block before the app's rules, producing **two `User-agent: *`
groups** in one file and these directives:

```
Content-Signal: search=yes, ai-train=no, use=reference
User-agent: Google-Extended   Disallow: /
User-agent: GPTBot            Disallow: /
User-agent: ClaudeBot         Disallow: /
… (≈30 crawlers blocked)
```

Three things to know:

1. **Googlebot and the AI *retrieval* crawlers are not blocked.** `GoogleOther`
   and `Google-Extended` are, but normal search indexing and the retrieval
   agents that answer live questions (`OAI-SearchBot`, `ChatGPT-User`,
   `PerplexityBot`, `Claude-SearchBot`) are untouched. **Organic search and AI
   citation both still work.** This is a much better default than it first looks.
2. `Google-Extended: Disallow` does reduce eligibility for some Gemini-grounded
   surfaces. That is a legitimate choice — just make it knowingly.
3. Two `User-agent: *` groups is non-standard. Google merges same-agent groups,
   so it works, but it is fragile and makes the file hard to reason about.

**Recommendation:** keep the AI-training blocks (they protect original Bangla
content, which is the moat), but verify in Cloudflare that the managed block is
intended, and confirm `Googlebot` and `Googlebot-Image` are unblocked. **No
change made — this is Cloudflare dashboard configuration, i.e. live
infrastructure, which this pass does not touch without authorisation.**

### TEC-19 · Performance — `OPEN (no fix needed yet)`

Live TTFB measured 0.20–0.68 s from the US, home page HTML 88 KB. Fonts are
`next/font` with `display: swap`; `next/image` with correct `sizes` and
`priority` on the first cover. **No performance problem found worth fixing.**
Core Web Vitals should be confirmed with field data from Search Console once
traffic exists — lab numbers from here would not be representative.

### TEC-20 · Image alt text is formulaic — `OPEN (low priority)`

100% coverage (5/5 on the home page) but every alt is `"{title} — cover"`.
Correct and accessible; weak for Google Images, which is a real discovery
channel for book covers. Consider `"{title} — JLPT {level} {skill} book cover"`
from the same category data `bookSeoTitle` already uses.

### TEC-21 · ~~Facet pages can render an empty shelf~~ — `WITHDRAWN — the prediction was wrong`

**This finding was incorrect and is superseded by TEC-23.**

It predicted that `?genre=n3`, `?genre=n2`, `?genre=n1`, `?genre=vocabulary`
and `?genre=reading` would render empty shelves, and proposed trimming
`indexableFacets` to suit. It was written from the *sitemap* (five titles, four
of them N5/N4) without checking what each facet actually returns.

Measured against production on 18 November 2026, after the pass shipped:

```
n5          4 books
n4          3 books
n3          2 books
n2          2 books
n1          2 books
kanji       2 books
grammar     2 books
listening   3 books
vocabulary  1 book
reading     1 book
```

No facet is empty. The real defect is the opposite one, and it is worse — see
below. Recorded rather than deleted because a withdrawn finding is part of the
audit's record, and because the roadmap and the mapping document both acted on
it.

### TEC-23 · Over-tagging makes four facet pages near-duplicates — `OPEN (data, not code)` · **High**

The books are tagged into far more categories than they belong to:

| Book | Tagged into |
| --- | --- |
| `nihonova-spoken-japanese` | **every level (N5–N1) and every skill** (grammar, kanji, vocabulary, reading, listening) |
| `kanji-redical-guide-book` | **all five levels** N5, N4, N3, N2, N1 — plus kanji |

The consequence is visible in the counts above: **`?genre=n3`, `?genre=n2`,
`?genre=n1` and `?genre=kanji` all return the same two books.** Four indexable
URLs with identical membership, differing only in their heading and lede.
Google's likely response is to pick one canonical and report the rest as
"Duplicate without user-selected canonical" — which would undo a good part of
what TEC-01 was for.

`?genre=vocabulary` and `?genre=reading` are a second case of the same cause:
each returns exactly one book, `nihonova-spoken-japanese`, which is **out of
stock**. An indexable page whose entire inventory is one unbuyable title is a
thin page by any measure.

There is also a plain accuracy problem underneath the SEO one: a *Spoken
Japanese* book is not an N1 reading text, and a radicals guide is not an N1
title. The tags are claims about the books, and these ones are not true.

**Fix — admin data, no deploy required:**

1. Untag `nihonova-spoken-japanese` from every level and skill except the ones
   it genuinely teaches.
2. Untag `kanji-redical-guide-book` from N3/N2/N1 unless the radicals it covers
   really do span those levels.
3. Re-check the counts afterwards. Any facet still returning only out-of-stock
   titles should come **out** of `indexableFacets` until it has stock — which
   is the one part of the withdrawn TEC-21 that survives, now for a reason that
   was measured rather than assumed.

**Do this before requesting indexing for `?genre=kanji`**, or the first thing
Google sees of that page is three duplicates of it.

### TEC-24 · No book carries an ISBN — `OPEN (data, not code)` · **Medium**

All five titles return `isbn: None`. The field exists on the contract
(`bookDetailSchema.isbn13`) and the JSON-LD emits it when present, so this is
unfilled data rather than missing capability.

An ISBN is the strongest entity identifier a book has: it is what lets Google
tie this page to the same work elsewhere, it is a **Merchant Center
requirement** for book listings (see `seo-strategy.md` §7, where a feed is
already proposed), and it is a trust signal to a buyer comparing editions.

If the titles are registered with the Bangladesh ISBN agency, the numbers
should go into the admin. If they are not registered, that is worth doing
before the next print run.

### TEC-25 · Price positioning was misjudged in this audit — `CORRECTED`

The first pass advised preparing to defend a price premium. Production prices
say otherwise:

| | Price |
| --- | --- |
| Rokomari N5 titles | ৳150–৳300 |
| **Nihonova** | **৳199–৳349** |
| BooKVandar — Sharif's N5 Bangla | ৳480 |

Nihonova sits **mid-market**, not above it. The page copy should therefore lead
with what the book teaches, not with justifying its cost. The recommendation in
`seo-roadmap.md` item 10b is revised accordingly.

### TEC-22 · Footer headings are English in all three locales — `OPEN (i18n, not SEO)`

"Shop", "Orders", "Contact" are hardcoded English in `lib/books.ts` and render
untranslated on the Bangla site. Pre-existing; noted because the audit touched
this file. The new "By level" column deliberately uses Latin labels ("JLPT N5"),
which *are* locale-neutral proper nouns.
