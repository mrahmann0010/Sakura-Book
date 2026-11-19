# Indexing priority — which pages to push, and in what order

*Measured against production on 18 November 2026, after the category-pages
release shipped. Re-measure before acting on this if the catalogue has changed.*

---

## What production looks like

Verified live: `/sitemap.xml` returns **63 URLs**, the facet pages carry no
`robots` meta (so `index, follow`), and `/` returns **308** to `/bn`.

| Book | Price | Stock | Pages |
| --- | --- | --- | --- |
| `kanji-redical-guide-book` | ৳349 | **In stock** | 194 |
| `listening-n4` | ৳330 | **In stock** | 214 |
| `listening-n5` | ৳320 | **In stock** | 216 |
| `nihonova-jlpt-n5-grammer` | ৳299 | Out of stock | 180 |
| `nihonova-spoken-japanese` | ৳199 | Out of stock | 100 |

Books returned per facet:

```
n5          4        kanji       2  ← same two books
n4          3        grammar     2
n3          2  ←     listening   3
n2          2  ←     vocabulary  1  (out of stock)
n1          2  ←     reading     1  (out of stock)
```

**The three in-stock titles are also the three pages the owner reports as
currently receiving traffic.** That alignment is the basis of the ordering
below: push what people already want and can actually buy.

## Do this first — it is not a Search Console task

**Fix the category tagging (TEC-23) before submitting anything in rows 6–10.**

`nihonova-spoken-japanese` is tagged into every level *and* every skill;
`kanji-redical-guide-book` into all five levels. That is why N3, N2, N1 and
kanji return an identical pair of books. Asking Google to index four
near-identical URLs invites "Duplicate without user-selected canonical" and
wastes the work the category release was for.

It is admin data. No deploy.

---

## The top 10

URL Inspection → Request Indexing is rate-limited to roughly ten URLs a day per
property, so this is one day's quota, spent deliberately.

| # | URL | Why it earns the slot |
| --- | --- | --- |
| 1 | `/bn/books/kanji-redical-guide-book` | Flagship title, in stock, confirmed traffic, and the only book on the market teaching radicals in Bangla |
| 2 | `/bn/books/listening-n5` | In stock, confirmed traffic |
| 3 | `/bn/books/listening-n4` | In stock, confirmed traffic |
| 4 | `/bn/catalog?genre=n5` | The highest-value commercial query in the market, and the **largest unique book set** (4) |
| 5 | `/bn` | Home — now carries `Organization` + `WebSite` JSON-LD that did not exist before; the page brand search and sitelinks attach to |
| 6 | `/bn/catalog?genre=kanji` | Direct match for the flagship. **Fix tagging first** — currently a duplicate of N3/N2/N1 |
| 7 | `/bn/catalog?genre=listening` | **Promoted from P1.** 3 books, a genuinely unique set, and both confirmed traffic drivers live here |
| 8 | `/bn/catalog` | The shelf, and the canonical every non-indexable slice points at |
| 9 | `/bn/catalog?genre=n4` | 3 books, unique set |
| 10 | `/bn/catalog?genre=grammar` | 2 books, unique set |

### Next tier, when quota refreshes

`/en`, `/en/catalog?genre=n5`, `/en/catalog?genre=kanji` — English is a real
Bangladeshi segment (`jlpt n5 book` and `japanese book price in bangladesh`
both rank 1 in autocomplete), it is simply second to Bangla, which is the
default locale and the `x-default`.

Then the two out-of-stock book pages. **Index them** — `OutOfStock` is honest
markup, the titles will return, and an unindexed page restocks with no
history. They just do not deserve a priority slot today.

### Do not submit yet

| URL | Why |
| --- | --- |
| `?genre=n3`, `?genre=n2`, `?genre=n1` | Identical to each other and to `?genre=kanji` until the tagging is fixed |
| `?genre=vocabulary`, `?genre=reading` | One book each, and it is out of stock — thin by any measure |
| Any `/ja` URL | Pending the TEC-02 decision; submitting would entrench a duplicate |

## Why not just submit all 63?

Because the quota is the constraint and the sitemap already handles breadth.
`/sitemap.xml` is declared in `robots.txt` and lists every URL; Google will
work through it on its own schedule. Request Indexing is for **jumping the
queue on pages where it matters**, which is a shortlist by definition. Spending
it on `?genre=n1` — a duplicate of three other pages, holding two books, one of
them unbuyable — buys nothing.

## What to watch afterwards

- **Sitemaps report**: discovered URLs climbing toward 63.
- **Pages report**: "Duplicate without user-selected canonical". If the
  over-tagged facets appear there, that is Google confirming TEC-23.
- **Enhancements → Breadcrumbs**, and **Product snippets** — both markup types
  are new as of this release and should register for the first time.
- **Performance → Queries**: any impression at all on a level or skill term is
  the first evidence the category pages worked.

Nothing here should be read as a claim that any page *is* indexed. None of this
has been verified in Search Console, because no access to it was available.
