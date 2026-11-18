# Content roadmap

**The premise.** A search for `জাপানি কানজি শেখার নিয়ম বাংলা গাইড` returns
Migaku, Coto Academy, Busuu and Guide to Japanese — all in English — plus
exactly one Bangla blog. For a country with a large and growing population of
Japanese learners, **Bangla-language instruction in Japanese is close to an
empty search results page.**

Nihonova Academy teaches this subject and writes the textbooks. It is the one
business in this market that can fill that gap credibly.

**The constraint.** Do not mass-produce articles. Twenty genuinely useful
pieces, written by people who teach this, will outperform two hundred generated
ones — and Google's helpful-content systems are specifically built to punish
the latter. Every piece below must be worth reading on its own, with the book
as the natural next step rather than the point.

**Not built in this pass.** There is no blog route, no content model and no
editorial process. This is the specification; building it is a project. See
`seo-roadmap.md` for sequencing.

---

## Architecture

Four pillars, each a substantial guide, each supported by shorter articles and
each linking down into a level or skill page and a specific book.

```
Pillar: JLPT N5 সম্পূর্ণ গাইড ──► /catalog?genre=n5 ──► N5 titles
Pillar: কাঞ্জি শেখার পদ্ধতি    ──► /catalog?genre=kanji ──► কাঞ্জি মুখস্থ নয়
Pillar: হিরাগানা ও কাতাকানা   ──► /catalog?genre=n5
Pillar: জাপানে পড়াশোনা ও চাকরি ──► home ──► /catalog?genre=n5
```

Proposed URL shape: `/{locale}/blog/{slug}`, Bangla-first. Write `bn` first;
translate to `en` only where the English query has distinct demand (e.g. the
comparison pieces). **Do not auto-translate into `ja`.**

---

## The twenty

Priority: **P0** = first wave, **P1** = second, **P2** = once the first two land.

### Pillar 1 — JLPT N5

**1. `JLPT N5 সম্পূর্ণ গাইড: সিলেবাস, প্রস্তুতি ও পরীক্ষার দিন` — P0 (pillar)**
Primary `JLPT N5 সিলেবাস` · Secondary `JLPT N5 কি`, `N5 প্রস্তুতি`, `JLPT N5 পরীক্ষার ফরম্যাট` · Informational · Absolute beginners
*Outline:* what N5 certifies → the four sections and their marks → vocabulary/kanji/grammar scope → realistic study timeline → registration in Bangladesh → exam-day practicalities → what comes after.
*Products:* all N5 titles, `?genre=n5`.

**2. `JLPT N5 এর জন্য কোন বই কিনবেন` — P0**
Primary `JLPT N5 বই কোনটা ভালো` · Secondary `best JLPT N5 book Bangladesh`, `Sharifs N5 বই` · Commercial investigation
*Outline:* what an N5 book must cover → Japanese-medium vs English-medium vs Bangla-medium, honestly → what each widely-sold option does well → where a Bangla-medium book helps most → how to choose for *your* study mode.
*Products:* N5 titles. **Must be an honest comparison that names competitors fairly — a disguised advert will not rank and will not be trusted.**

**3. `JLPT N5 ভোকাবুলারি: ৮০০ শব্দ কীভাবে মনে রাখবেন` — P1**
Primary `JLPT N5 ভোকাবুলারি` · Informational
*Outline:* the scope → grouping by theme not alphabet → spaced repetition in practice → a worked set of 20 → common traps.

**4. `JLPT N5 গ্রামার পয়েন্ট তালিকা` — P1**
Primary `JLPT N5 গ্রামার লিস্ট` · Informational
*Outline:* the full pattern list, each with a Bangla gloss and one example → which are tested most → ordering for study.
*Products:* the N5 grammar title, `?genre=grammar`.

**5. `JLPT N5 লিসেনিং কীভাবে অনুশীলন করবেন` — P2**
Primary `JLPT চোকাই অনুশীলন` · Informational · *Products:* the two listening titles, `?genre=listening`.

### Pillar 2 — Kanji

**6. `কানজি কীভাবে শিখবেন: মুখস্থ না করে বোঝার পদ্ধতি` — P0 (pillar)**
Primary `কানজি কীভাবে শিখব` · Secondary `kanji radicals Bangla`, `কানজি শেখার সহজ উপায়` · Informational
*Outline:* why rote memorisation fails → radicals as meaning units → on'yomi/kun'yomi without panic → stroke order and why it matters → building from 20 radicals to 100 kanji → a study routine.
*Products:* the flagship kanji title, `?genre=kanji`. **This article is the single best content-to-product fit the shop has** — the book's whole method is its subject.

**7. `জাপানি কানজি রেডিক্যাল: শুরু করার ৫০টি` — P1**
Primary `kanji radical তালিকা` · Informational · *Note:* strong Google Images candidate — publish the chart as a properly named, alt-described image.

**8. `একই রকম দেখতে কানজি যেগুলো গুলিয়ে যায়` — P1**
Primary `কানজি পার্থক্য` · Informational · High shareability.

**9. `JLPT লেভেল অনুযায়ী কানজি সংখ্যা` — P2**
Primary `JLPT কানজি কয়টা` · Informational · Links to every level page — a good internal-linking hub.

### Pillar 3 — Hiragana & Katakana

**10. `হিরাগানা শেখার নিয়ম: এক সপ্তাহে` — P0 (pillar)**
Primary `হিরাগানা শেখার নিয়ম` · Secondary `হিরাগানা চার্ট`, `হিরাগানা বাংলা উচ্চারণ` · Informational
*Outline:* the 46 characters by row → Bangla pronunciation notes where they genuinely differ → stroke order → a seven-day plan → dakuten/handakuten → where learners stall.
*Note:* near-zero Bangla competition observed. **Best first article to publish.**

**11. `কাতাকানা চার্ট ও ব্যবহার` — P1**
Primary `কাতাকানা চার্ট` · Informational · Images opportunity.

**12. `হিরাগানা না কাতাকানা — কোনটা আগে?` — P2**
Primary `হিরাগানা কাতাকানা পার্থক্য` · Informational · Short, high-intent, easy win.

### Pillar 4 — Japan: study and work

**13. `জাপানি ভাষা শিখে জাপানে চাকরি: বাস্তব রাস্তা` — P0 (pillar)**
Primary `জাপানে চাকরি জাপানি ভাষা` · Secondary `SSW ভিসা ভাষা`, `জাপানে যেতে কোন লেভেল লাগে` · Informational · Career-motivated learners
*Outline:* which routes exist → the language level each actually requires → JLPT vs JFT-Basic for which route → realistic timeline from zero → what to study first.
> **Verify before publishing.** This touches visa and employment rules that change. It must be checked against current official sources and dated, or it becomes a liability. **Do not publish speculation about immigration.**

**14. `JFT-Basic কী এবং কাদের জন্য` — P1**
Primary `JFT-Basic কি` · Informational · The site's own metadata already names JFT-Basic; no Bangla explainer was found anywhere.

**15. `NAT-Test ও JLPT এর পার্থক্য` — P2**
Primary `NAT test কি` · Informational.

**16. `শূন্য থেকে N5: ছয় মাসের স্টাডি প্ল্যান` — P1**
Primary `জাপানি ভাষা শেখার রুটিন` · Informational · Week-by-week, with the books slotted in where they genuinely fit.

### Cross-cutting

**17. `N5 থেকে N4: কী বদলায়` — P1** · Primary `JLPT N4 প্রস্তুতি` · The repeat-purchase bridge. Links N5 → N4 pages.

**18. `বাংলায় লেখা জাপানি বই কেন ভালো কাজ করে` — P2** · Primary `বাংলায় জাপানি শেখার বই` · Commercial investigation. The brand-differentiator piece — argue it honestly, including when a Japanese-medium book is the better choice.

**19. `জাপানি ভাষায় সংখ্যা ও গণনা` — P2** · Primary `জাপানি সংখ্যা` · Informational. Classic high-demand beginner topic; counters (〜つ, 〜本, 〜枚) are where learners get stuck.

**20. `জাপানি ভাষা শেখার ভুল যা বেশিরভাগ শিক্ষার্থী করে` — P1** · Primary `জাপানি ভাষা শেখার ভুল` · Informational. Links naturally to every pillar; strong social distribution.

---

## Content-to-product rule

Every article links to **at most two** products, in body copy, where the
recommendation is genuinely earned — not in a banner, and never more than once
per section. The article must still be worth reading by someone who buys
nothing. If it is not, it will not rank, and it will not earn the links the
domain needs.

## Publishing cadence

Quality over volume: **two articles a month, written or reviewed by an academy
instructor.** Twenty pieces is therefore a ten-month programme, front-loaded
with the four P0 pillars in the first two months.

## What would make this fail

- Generating all twenty with AI and publishing them unreviewed.
- Writing for the keyword instead of the learner.
- Publishing immigration or exam-rule claims without checking them.
- Letting articles sit unlinked from the level and skill pages.
