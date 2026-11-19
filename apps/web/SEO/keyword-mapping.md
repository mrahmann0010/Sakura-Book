# Keyword → URL mapping

One primary keyword per URL. Where two pages could plausibly target the same
term, the cannibalisation note says which one wins and why.

**No search volumes appear here.** None were obtainable; see
`competitor-analysis.md` §6.

---

## Cluster 1 — Brand & category entry (Home)

| | |
| --- | --- |
| **URL** | `/bn` (canonical), `/en`, `/ja` |
| **Primary** | `জাপানি ভাষা শেখার বই` |
| **Secondary** | `বাংলায় জাপানি শেখার বই`, `Nihonova`, `Nihonova Books`, `Japanese learning books Bangladesh` |
| **Long-tail** | `বাংলায় লেখা জাপানি ভাষার বই`, `Nihonova Academy book` |
| **Intent** | Commercial investigation + Navigational |
| **Audience** | All segments; first touch |
| **Content needs** | ⚠️ The `<h1>` is `পাতা উল্টালেই শুরু হোক…` — an editorial line with no search signal. The `<title>` carries the keywords; the `<h1>` does not. See `technical-seo-audit.md` TEC-09. |
| **Priority** | P0 |

**Cannibalisation:** Home targets the *category-defining* phrase; `/catalog`
targets the *browse* phrase. They must not both chase `JLPT বই` — the level
facet pages own level terms.

## Cluster 2 — The shelf (Catalog)

| | |
| --- | --- |
| **URL** | `/bn/catalog` |
| **Primary** | `JLPT বই` / `JLPT books` |
| **Secondary** | `জাপানি বই হোম ডেলিভারি`, `JLPT N5–N1 books` |
| **Intent** | Commercial investigation → Transactional |
| **Content needs** | ⚠️ `<h1>` is "Every book on the shelves" / "তাকের সব বই" — zero keyword signal, same issue as the home page. |
| **Priority** | P0 |

**Cannibalisation — resolved in this pass.** `/catalog` previously tried to
rank for every level and skill term at once while all filtered views were
`noindex`. Now: `/catalog` owns the *unfiltered* term only; each single-facet
view owns its own. Multi-facet, `?q=` and page-2+ views remain
`noindex, follow` with a canonical to `/catalog`, so they add no competitors.

## Cluster 3 — JLPT level pages ★ the growth cluster

Each is `/{locale}/catalog?genre={level}`, self-canonical, in the sitemap,
linked site-wide from the footer "By level" column. **All five were built in
this pass; before it the shop had no page targeting any level term.**

| URL | Primary | Secondary | Priority | Inventory |
| --- | --- | --- | --- | --- |
| `?genre=n5` | `JLPT N5 বই` | `JLPT N5 books Bangladesh`, `N5 প্রস্তুতি বই`, `hiragana katakana বই` | **P0** | 3 titles |
| `?genre=n4` | `JLPT N4 বই` | `JLPT N4 preparation books`, `N4 গ্রামার বই` | **P1** | 1 title |
| `?genre=n3` | `JLPT N3 বই` | `N3 কাঞ্জি বই` | P2 | 2 — *both over-tagged, see below* |
| `?genre=n2` | `JLPT N2 বই` | `N2 রিডিং বই` | P3 | 2 — *same two books as N3* |
| `?genre=n1` | `JLPT N1 বই` | `N1 গ্রামার বই` | P3 | 2 — *same two books as N3* |

> **Open risk — revised after measuring production.** These pages are *not*
> empty, as the first draft of this document predicted. They are near-duplicates:
> `?genre=n3`, `?genre=n2`, `?genre=n1` and `?genre=kanji` all return the **same
> two books**, because `kanji-redical-guide-book` is tagged into all five levels
> and `nihonova-spoken-japanese` into every level and skill. The fix is the
> tagging, in the admin — see `technical-seo-audit.md` TEC-23. Only if a facet
> still returns nothing buyable afterwards should it come out of
> `indexableFacets` in `src/lib/seo.ts`.

## Cluster 4 — Skill pages

| URL | Primary | Secondary | Priority | Inventory |
| --- | --- | --- | --- | --- |
| `?genre=kanji` | `জাপানি কানজি শেখার বই` | `kanji radicals বই`, `Japanese kanji book Bangla` | **P0** | 2 — *same two books as N3; fix tagging first* |
| `?genre=grammar` | `জাপানি ব্যাকরণ বই` | `Japanese grammar book Bangla`, `JLPT গ্রামার` | **P1** | 2 |
| `?genre=listening` | `জাপানি লিসেনিং বই` | `JLPT choukai practice` | **P0 — promoted** | 3 · both in-stock listening titles are confirmed traffic drivers |
| `?genre=vocabulary` | `জাপানি শব্দভান্ডার বই` | `Japanese vocabulary Bangla meaning` | P2 | 1 — *out of stock* |
| `?genre=reading` | `জাপানি রিডিং বই` | `JLPT dokkai practice` | P3 | 1 — *out of stock* |

**Cannibalisation — watch this one.** `?genre=n5` and `?genre=kanji` both
plausibly answer "JLPT N5 kanji book". The split: **level pages own level
intent, skill pages own skill intent**, and the *combination* (`?genre=n5,kanji`)
is deliberately `noindex` so it cannot become a third competitor. Combination
queries should be won by the **book page**, which names both.

## Cluster 5 — Book pages

| | |
| --- | --- |
| **URL** | `/{locale}/books/{slug}` |
| **Primary** | The book's own title |
| **Secondary** | `{title} + JLPT {level} {skill} বই` — now in the `<title>` tag, generated from the book's own category tags (`bookSeoTitle`, `src/lib/seo.ts`) |
| **Intent** | Transactional |
| **Priority** | P0 for the three titles with stock |

**Two slugs are misspelled and this costs rankings:**

| Live slug | Should be | Keyword lost |
| --- | --- | --- |
| `kanji-redical-guide-book` | `kanji-radical-guide-book` | "radical" — the method the book is *about* |
| `nihonova-jlpt-n5-grammer` | `nihonova-jlpt-n5-grammar` | "grammar" — the category term |

Changing a slug changes a URL. See `technical-seo-audit.md` TEC-03 for the
migration this needs; **do not rename without the redirect.**

## Cluster 6 — Informational content (does not exist yet)

No blog, guides or resources exist anywhere in the app. This is the whole of
`content-roadmap.md`. Mapping summary:

| Pillar | URL shape | Feeds |
| --- | --- | --- |
| JLPT N5 complete guide | `/bn/blog/jlpt-n5-guide` | `?genre=n5` |
| Kanji learning method | `/bn/blog/kanji-kivabe-shikhbo` | `?genre=kanji` + flagship title |
| Hiragana & katakana | `/bn/blog/hiragana-katakana` | `?genre=n5` |
| Japan study/work route | `/bn/blog/japane-poralekha-chakri` | Home + `?genre=n5` |

## Cluster 7 — Trust & support pages

`/contact`, `/refund-policy`, `/privacy-policy`, `/terms`. **No keyword
targets.** They exist for conversion trust and E-E-A-T, and were added to the
sitemap in this pass because a shop whose policy pages are not crawlable looks
less trustworthy to both a buyer and an algorithm.

## Cluster 8 — Excluded from search entirely

`/cart`, `/checkout`, `/checkout/coupon`, `/orders`, `/orders/{n}`, `/invite/{token}`,
`/admin/*`, `/playground`. All `noindex`; all `Disallow:` in robots.txt.
Correct as-is.

---

## Locale allocation

| Locale | Role | Verdict |
| --- | --- | --- |
| **`bn`** (default, `x-default`) | The real audience. Bangla metadata throughout. | ✅ Correct |
| **`en`** | Bangladeshi learners who search in English — a genuine segment. | ✅ Correct |
| **`ja`** | ⚠️ **Serves English metadata under `<html lang="ja">`.** The on-page UI is Japanese but the `<title>`, description and OG tags are the English copy, because `lib/seo.ts` falls back `ja → en`. | ❌ **Needs a decision — see `technical-seo-audit.md` TEC-02** |

The `ja` tree is 1/3 of every sitemap entry and 1/3 of the crawl budget, for a
market the shop cannot ship to.
