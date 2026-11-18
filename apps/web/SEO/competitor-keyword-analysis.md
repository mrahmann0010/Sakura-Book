# Competitor keyword analysis

What each competitor's ranking pages **actually target**, extracted from their
live HTML on 18 November 2026 (`<title>`, meta description, `<h1>`, `<h2>`),
and matched against the Bangladesh demand data in
`bangladesh-keyword-demand.md`.

`competitor-analysis.md` establishes *who* the competitors are. This document
is the keyword layer: what they aim at, how well, and where the gaps are.

> **No ranking positions, traffic estimates or backlink counts appear here.**
> No rank-tracking or backlink tool was available. What is recorded is on-page
> targeting, which was read directly from each page.

---

## 1. Dhaka Language / Shield Language Academy — **the one to beat**

`dhakalanguage.com/japeneselangaugebanglabook`

```
<title>  জাপানি ভাষা শিক্ষা বই | SHIELD LANGUAGE ACADEMY DHAKA
<h1>     জাপানি ভাষা শিক্ষা বই — হিরাগানা থেকে N2 পর্যায়ের পাঠ ও শ্রবণ,
         বাংলা সহায়তায় জাপানি শেখার একটি পরিষ্কার স্তরভিত্তিক পথ
<h2>     …জাপানি লিপি দেখে ভয় পাওয়ার আগে ধ্বনি, শব্দ ও ছোট বাক্য চিনতে…
         …নিজের স্তর বেছে নিয়ে পরের শেখার ধাপ দেখুন…
         …হিরাগানা, কাটাকানা ও কানজি — তিনটিকেই আলাদা কাজ বুঝে শিখুন…
         …জাপানি ভাষা শেখার সহজ উপায় — লিপি, ধ্বনি, বাক্য ও ব্যবহারকে এক…
         …কেনার আগে জাপানি বইটি কাছ থেকে দেখে নিন…
```

**Assessment: the strongest SEO operator in this market, and the closest
analogue to Nihonova's own model (a school that sells its books).**

| What they target | Demand evidence |
| --- | --- |
| `জাপানি ভাষা শিক্ষা বই` — **exact-match title** | AC rank 1 |
| `জাপানি ভাষা শেখার সহজ উপায়` — in an `<h2>` | **AC rank 1 under 2 seeds — the strongest signal in the dataset** |
| `হিরাগানা` / `কাতাকানা` / `কানজি` — one `<h2>` each | AC 1–3 |
| Level progression "হিরাগানা থেকে N2" | Level intent |

**Strengths:** exact-match title on the top Bangla book query; a keyword-rich
`<h1>` that is still readable; `<h2>`s that each take a distinct high-demand
query rather than repeating the `<h1>`; a level-structured narrative; a
"see the book before buying" section answering the same intent as Nihonova's
sample reader. They also rank a separate *course* page, capturing both intents.
They rank despite a **typo in their own URL** (`japeneselangauge`), which says
how little competition there is for on-page quality here.

**Weaknesses:** one monolithic page carrying every level and skill at once —
no per-level URLs, so nothing targets `JLPT N5 বই` specifically. Unverified
structured data. Brand is a language academy, not a publisher.

**How Nihonova beats them:** with the thing they do not have — **ten separate
level and skill pages**, each with its own canonical, title and lede. Their one
page cannot rank for five level queries as well as five pages can. That is
exactly what this pass built. The gap to close is their `<h2>` coverage of
`জাপানি ভাষা শেখার সহজ উপায়` and the script terms, which belongs to the blog.

## 2. BooKVandar — best product-page SEO

`bookvandar.com/sharifs-jlpt-nihongo-matome-n5-bangla-4th-edition/`

```
<title> Sharifs JLPT Nihongo Matome N5 Bangla (4th Edition) By Shariful Islam - BooKVandar
<desc>  …/ শরীফ'স মিন্না না নিহোঙ্গো N5 এর বাংলা উচ্চারণ, শব্দার্থ ও অর্থ সহ ব্যাকরণ…
        JLPT N5 প্রস্তুতির জন্য বাংলা উচ্চারণ, শব্দার্থ ও Grammar সমৃদ্ধ…
<h2>    Related Books | পাঠক রিভিউ | Reviews (1)
```

And their own-brand set page:

```
<title> N5 Japanese Language Learning Book - জাপানী ভাষা শিক্ষা
<h1>    N5 Japanese Language Learning Book – জাপানি ভাষা শিক্ষা ইংরেজিতে (৩টি বই সেট)
<h2>    Why Choose This Japanese Language Learning Book?
```

**The technique worth stealing: bilingual targeting inside one tag.** Latin and
Bangla in the same `<title>` and description, so one page answers both
`N5 Japanese Language Learning Book` and `জাপানি ভাষা শিক্ষা`. Bangladeshi
learners genuinely search both ways — the autocomplete harvest shows the same
intent in both scripts — and this captures both without a second URL.

They also run **real reviews** (`পাঠক রিভিউ`, `Reviews (1)`), which is both a
conversion asset and `AggregateRating` eligibility. Nihonova collects reviews
at `/yourexperience` but has no table and no markup — see `seo-roadmap.md`
item 23.

**Weakness:** they resell other publishers' books, so their pages can never be
authoritative about the content. Nihonova's can.

## 3. Rokomari — authority without on-page work

`rokomari.com/list/83265/Japanese`

```
<title> Japanese | Rokomari.com
<desc>  Japanese Rokomari.com is the largest online bookstore in Bangladesh. Buy Novel,
        Story, Islamic, Computer Programming, Children, West Bengal, Fiction… (boilerplate)
<h1>    — none —
<h2>    হোম | পণ্যসমূহ | আমাদের সম্পর্কে জানুন | শপ বাই | সাপোর্ট | পলিসি  (nav chrome)
```

**Assessment: ranks on domain authority alone.** A two-word title, a
site-wide boilerplate description that never mentions Japanese books, **no
`<h1>` at all**, and `<h2>`s that are navigation furniture.

**This is the most encouraging finding in the document.** The market leader's
category page is unoptimised. Nihonova cannot beat Rokomari's authority on
generic terms, but on *specific* terms — `JLPT N5 বই`, `জাপানি কানজি শেখার বই`
— a page with a real title, a real `<h1>`, a real lede and structured data can
and should out-rank a page with none of those.

Their individual book pages are better (`japanese n5 text book`,
`japanij n5 basic o shobdobhartho boi`) and do compete at ৳150–৳300. **Expect
to be compared on price** — the answer belongs on the page: written in Bangla,
by the academy that teaches it.

## 4. e-Samama / Sayeed Publications — the closest model, no SEO at all

`sp.e-samama.com/?id=24`

```
<title> Book Details                      ← no keyword, identical across the site
<h1>    SayeedPublications                ← brand name as the page heading
<desc>  জাপানি ভাষা শেখার যাত্রায় JLPT N5 স্তরটি হলো প্রথম এবং সবচেয়ে গুরুত্বপূর্ণ ধাপ…
<h2>    বইটি সম্পর্কে | বইটির অংশ বিশেষ পড়ুন | About the Author | আপনার কপিটি আজই সংগ্রহ করুন
```

A publisher selling its own Bangla JLPT books — the same business as
Nihonova — with `<title>Book Details</title>` on every product, a brand name
where the `<h1>` should be, and a query-string URL (`?id=24`) with no slug.

The **description is actually well written** and the `<h2>` structure is
sensible ("about this book", "read an excerpt", "about the author"). The
content is there; the SEO scaffolding is absent.

**This is a free win.** The most directly comparable competitor is invisible
for structural reasons. Nihonova's book pages — real slugs, keyword-bearing
titles, Book+Product markup — already beat these outright.

*Worth copying from them:* "বইটির অংশ বিশেষ পড়ুন" (read an excerpt) as a
labelled section, and "About the Author". Nihonova has both the sample and the
academy authorship and surfaces neither as a named section.

## 5. The rest

| Competitor | Targeting | Verdict |
| --- | --- | --- |
| **Boiboiboi** | `<title>` = `<h1>` = exact product name; description is bare metadata ("Author: J Research Shuppan. Pages: 220") | Clean but minimal. Competes on exact-title queries only. |
| **mshopbd** | Good English `<title>`/`<h1>`, decent description, **no `<h2>`s at all** — no document structure | English-only in a Bangla market. Ranks on title match. |
| **Vashashikhi** | Homepage `<h1>`: "ভাষা শেখার জন্য বাংলাদেশের প্রথম প্ল্যাটফর্ম"; `<h2>`s include *German* books | **Weaker than it first appeared.** A multi-language platform, not Japanese-focused. Its Japanese product pages rank; its brand does not own the category. |
| **Axia Books** | The category URL that appeared in search now returns **404** ("Oops!!! Something Went Wrong Here") | Broken. Discount as a competitor. |
| **Daraz / Othoba** | Marketplace templates; Othoba serves the same Sharif's title at 4+ URLs | Authority plays. Othoba cannibalises itself. |

---

## 6. The gap map

Demand from `bangladesh-keyword-demand.md` against who currently targets it.

| Keyword | AC | Who targets it on-page | Nihonova after this pass |
| --- | --- | --- | --- |
| `জাপানি ভাষা শিক্ষা বই` | 1 | **Dhaka Language** (exact title) | Home title — *partial* |
| `জাপানি ভাষা শেখার সহজ উপায়` | **1 ×2 seeds** | **Dhaka Language** (h2) only | ❌ **nothing — biggest open gap** |
| `JLPT N5 বই` / `jlpt n5 book` | 1 | **nobody** with a dedicated page | ✅ `?genre=n5` |
| `জাপানি কানজি শেখার বই` / `কানজি n5` | 2–3 | **nobody** | ✅ `?genre=kanji` |
| `জাপানি ব্যাকরণ` | 1 | **nobody** with a dedicated page | ✅ `?genre=grammar` |
| `japanese book price in bangladesh` | 1 | Rokomari, BooKVandar (product pages) | ⚠️ pages exist, price not framed |
| `হিরাগানা` / `কাতাকানা` | 1 | Dhaka Language (h2), else English sites | ❌ needs blog |
| `জাপানে যাওয়ার সহজ উপায়` + career cluster | 1 | **nobody in the book market** | ❌ needs blog |
| `…pdf` family | 1–3 | pirate/aggregator sites | ❌ needs a sample landing page |
| `japanese language course bangladesh` | 1 ×2 | Dhaka Language, Vashashikhi, Lead Academy | ➡️ **parent brand's** — cross-link |

### The three conclusions

1. **The level and skill pages built in this pass target queries no competitor
   has a dedicated page for.** That is the clearest opening in the market and
   it is now occupied.
2. **Dhaka Language is the real rival** and holds the top Bangla book query and
   the top method query. Beating them needs the blog, not more product pages —
   their advantage is `<h2>` coverage of informational intent.
3. **On-page quality is a differentiator here, not table stakes.** Rokomari has
   no `<h1>`; e-Samama's titles are all "Book Details"; Axia's category 404s.
   A correctly built page is genuinely competitive in this market.
