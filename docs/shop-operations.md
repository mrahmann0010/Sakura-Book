# Running the shop

The operator's manual: how stock, the waitlist and invites actually behave when
you press the buttons, in the order a restock morning happens.

The other waitlist documents in this folder explain how the machine is built.
This one assumes you never want to read those. It is written for whoever is
sitting at the admin panel with sixty copies in a box and three hundred people
waiting.

Companions, if you do want the reasoning:
[waitlist-queue-system.md](./waitlist-queue-system.md) (the design),
[waitlist-invite-flow.md](./waitlist-invite-flow.md) (the token mechanism),
[waitlist-multi-book-invites.md](./waitlist-multi-book-invites.md) (what an
invited customer may put in one basket).

---

## 1. The one idea everything else follows from

There are two different numbers for every title, and confusing them is the only
way to get into real trouble:

```
stock_quantity     the copies in the box.        Admin panel → Books.
available          what a stranger may buy.      stock − live invite holds.
```

The storefront, the cart, the "2 left" badge and the checkout guard all read
**available**, never stock. So the moment you send fifty invites for a
sixty-copy book, the website shows ten. That is not a bug and there is nothing
to switch on — it is the whole point. An invited customer must not be beaten to
their own copy by whoever happened to be browsing.

A hold ends in exactly one of three ways, and all three release the copies by
themselves:

| The customer…                      | What happens                                        |
| ---------------------------------- | --------------------------------------------------- |
| buys with the link                 | copies leave the shop, entry goes to **Converted**  |
| ignores it until the window closes | copies return to the shelf **the second it lapses** |
| is withdrawn by staff (Cancel)     | copies return immediately                           |

There is no fourth outcome, and **there is no job to run**. Expiry is not a
sweep that might fail overnight; the copies come back because the clock passed,
which the database checks on every read. Nobody has to remember anything.

---

## 2. Can I start sending invitations now?

Yes — the system is complete and the code is in place. Work down this list
once, in order. Nothing here needs a developer.

**1. The book must exist and be sellable.**
Admin → Stock → **Manage** → **Books arrived**, and type how many came in — it
adds to the count rather than replacing it. Then check the title's
**availability** is `in_stock` on its Books page. A `coming_soon` book can never
be ordered, invite or no invite, however many copies it has — so if the title
has been sitting as "coming soon" while people joined the list, flip it to
`in_stock` as well. Either order is fine: the copies you recorded are kept.

**2. The title must be on the waitlist picker** (only matters for new signups).
Admin → Settings → Notify books.

**3. Check the invite window.**
Admin → Settings → Waitlist invite. Default is **48 hours**. This is how long a
customer's link works and therefore how long their copies sit idle if they
never answer. 48 is right when the queue is short; 24 is the right answer to a
long queue, not overbooking. You can also pin the SMS language here, or leave
it as "customer" so each person is texted in the language they signed up in.

**4. Check the SMS gateway is awake.**
The gateway is one Android phone with one SIM. Send one invite by hand first —
per-row **Invite** on a single entry — and confirm the row's delivery column
says SENT before you fire a wave of fifty. A wave that goes out to a dead
gateway still issues fifty tokens and still takes fifty copies off the shelf;
the copies come back at expiry, but you will have lost the window.

**5. Open a release** (§3). Until you do, **every invite is refused** with
"No open stock release for this book." That refusal is deliberate. Without a
release the queue's budget would be the entire print run.

**6. Press "Invite next N"** (§4).

That is the whole sequence. The database side is already migrated — releases,
waves and the invite columns are live on the server the site actually talks to.

---

## 3. Setting up a release

> **What a release is:** of the copies that just landed, how many are the
> waitlist's to spend. Sixty came in, fifty go to the queue, ten stay for
> whoever walks in or calls.

Everything for one title happens in one place: **Admin → Stock → Manage**.

Press **Set the share**. The dialog splits what is on hand into three:

```
Held by invites · Kept for the queue · On the shelf
```

You choose the middle one — how many of the copies _nobody is holding_ the
queue may be promised. Held copies belong to people with a live link, so they
are shown but are not yours to move. Add a note — _"Sept restock, 10 held for
the counter"_ — because in four months the number alone will not tell you why.

**Setting the share requires the ADMIN role.** Working the queue does not. That
split is on purpose: sending texts is staff work, deciding how much of the
shop's stock is given away through the queue is the owner's.

### The queue's copies leave the website the moment you save

Before a single text goes out. Keep 8 of 10 for the queue and the storefront
shows 2, straight away — otherwise walk-ins could buy the queue's copies before
the wave was sent. So **On the shelf** in the dialog is exactly what the public
will see.

### Reading the Stock row

```
On hand  Promised  Reserved         On shelf
10       1         7 of 10 alloc.   2
```

- **Promised** — copies held by live invites.
- **Reserved** — copies kept for the queue that nobody has been texted about yet.
- **of 10 allocated** — the release's running total. It _includes copies
  already sold through it_, which have left the building. That is why it can
  read higher than what the queue actually has on the shelf today, and why the
  dialog asks about free copies instead of this number.

### Changing the share, or starting over

- **Change share** — raise or lower how many free copies the queue keeps. Works
  any time, with invites out. Lowering puts copies back on the shelf; nothing
  already texted is touched.
- **Close release** — stops new invites being charged to it. Anyone holding an
  invite keeps it, with their copy and their window. The copies it was keeping
  go back on the shelf, and the button beside it becomes **Set the share**, so
  the next release opens in the same place.
- **Start a new release** — appears instead of Change share once a release has
  handed out everything it had and new stock is sitting on the shelf. It closes
  the old one and opens the next in one step.

**New stock arrived?** Record it with **Books arrived**, then **Change share**
(or **Start a new release**, if that is what the button says). You never need
to withdraw anyone's invite to release more.

### One open release per book, ever

The database enforces it. Two open budgets for one title is two people spending
the same copies.

---

## 4. Sending a wave

Press **Invite next N**. The number on the button is what the release can fund
right now.

**You do not choose who.** The server does, from the whole queue, in this order:

1. **People who have never been invited, before anyone getting a second turn.**
2. Among equals, **whoever signed up first**.

That is the only fairness rule that doesn't need defending, and it is why the
selection is not made from the rows on your screen — a page of the list is not
the queue.

**Somebody who asks for more copies than remain is skipped, not stopped on.** A
person wanting five copies with three left should not block the four people
behind them who want one each. The panel says so — _"3 skipped — they want more
copies than remain"_ — with the names. Invite them by hand against the next
release, or allocate more.

**We do not overbook.** Fifty copies means fifty invites, never seventy on the
assumption some won't show. An airline overbooks because the failure case is a
stranger it compensates at a published rate. Here the failure case is a
customer who got an SMS saying a copy was theirs, filled in the checkout form,
and was told no — and who will say so publicly, to an audience that overlaps
almost entirely with the next hundred customers.

**Keep a wave under about fifty.** The texts go out inside the request that
asked for them, five at a time. Fifty is comfortable; several hundred would sit
long enough for a proxy to give up on the response — the texts still send, but
you lose the per-row report.

**A human presses the button, always.** There is no cron and that is
deliberate: every message is billed, the gateway is one phone, and a restock
morning is already a moment someone is watching. An automatic wave should never
be the thing that discovers the gateway is offline.

### After the wave

Nineteen of fifty will not answer. You do nothing. When their windows close,
their copies return to the release's budget by themselves and the button
re-labels itself **Invite next 19**. Those nineteen people are now in the
**Expired** lane, and the next wave puts them _behind_ anyone who has still not
had a first turn.

Repeat until the queue empties or the release is spent.

---

## 5. Reading the panel

The five tabs are **lanes** — where someone stands _right now_, not what was
last written about them:

| Lane          | Meaning                                                      |
| ------------- | ------------------------------------------------------------ |
| **Waiting**   | in line, holding nothing                                     |
| **Invited**   | holding a live link. **These are the copies off the shelf.** |
| **Expired**   | their window closed unused. Copies already came back.        |
| **Converted** | they bought                                                  |
| **Cancelled** | taken off the list by staff                                  |

The Invited tab and the storefront's availability number are computed from the
same expression, so they cannot disagree about who is holding what.

### Actions on a row

- **Invite / Re-invite** — mints a fresh link and retires the old one. Costs
  the release again, because it is a new promise on a real copy. Re-inviting
  someone who is _still_ holding a live link does not double-charge; the system
  knows it is renewing rather than adding.
- **Cancel** — takes them off the list _and_ takes their unspent link back in
  the same breath. Use this rather than just noting it somewhere: an entry
  moved off the list without revoking its invite leaves that person a working
  link and leaves the shop holding copies for someone it has removed.

### Two columns worth watching

**Delivery.** SENT or FAILED, with the gateway's complaint. A failed send still
issued the token — so the customer holds copies and does not know it. Those
rows are pre-ticked on the **Re-invite** batch screen for exactly this reason.
Check this after every wave.

**The window.** On Invited rows it reads _"until…"_, on Expired _"lapsed…"_.

### The batch screen

Admin → Waitlist → Invite batch, for the two bulk jobs the tabs don't cover:
**First-time** (the earliest sign-ups holding no link) and **Re-invite**
(everyone holding an unused link — lapsed ones and failed sends pre-ticked,
live ones listed but left unchecked). Both go through the same release budget
as everything else. Nothing anywhere can spend past it.

---

## 6. What an invited customer can actually buy

Their link opens a checkout with their book and quantity filled in. Two rules:

- The order **must** include the book they were invited for, at **no more than**
  the copies held. Fewer is fine — someone invited for two who takes one has
  returned a copy to the shop, and the release is credited back for it.
- **They may add anything else that is in stock**, at ordinary prices and
  ordinary availability. One order, one delivery fee, one bKash transfer to
  reconcile — instead of the customer placing a second order or, more often,
  forgetting the second book.

The link is single-use and dies the moment it is spent. Two tabs, a
double-click, a shared screenshot — Postgres decides which one wins and the
loser is told the link is no longer valid.

**Known gap:** somebody invited for two _different_ books gets two links and
can only spend one per order. Putting both in one basket needs work that has
not been done. Today the answer is two orders.

---

## 7. Stock: the rules that bite

**Setting stock overwrites, it does not add.** The Books form takes the new
total, not the delta. Do it when the shop is quiet: it is a straight write, so
setting "60" while orders are landing can undo a decrement that just happened.

**Never lower stock below what is being held.** If forty copies are held on
live invites and you set stock to thirty, the shop has promised copies it does
not own. The storefront handles it correctly — it reads sold-out rather than a
negative — and the release header shows a loud **over-issued** warning. But
only a person can resolve it: either print more, or withdraw someone's invite
and apologise. Nothing in the software will make that choice.

**`coming_soon` forces stock to zero.** Flipping a title to coming-soon wipes
its stock count, and a coming-soon book is never orderable no matter what the
count says. If people are waiting on a title in that state, set it to
`in_stock` _and_ enter the stock in the same edit.

**Cancelling a customer's order returns the copies to the shelf.** Automatically
— but see the gap in §8.

---

## 8. Known gaps — read these once

Not bugs to file. Deliberate limits, or things the design has not reached yet.
Each one has an operator workaround.

**A cancelled invited order does not return its copies to the release budget.**
The physical copies come back to the shelf correctly and can be sold. But the
release goes on counting them as spent, so its "to give out" number reads low
by that amount for the rest of the restock. _Workaround:_ if you cancel several
invited orders, close the release and open a new one for the copies actually
left.

**Someone who was cancelled cannot rejoin that book's waitlist.** This one is
deliberate: Cancel is the only do-not-contact tool the shop has, so being taken
off a list is meant to stick. _If they ask to come back:_ have a developer clear
the old entry, or add them by hand. (A customer who **bought** is a different
case and is no longer blocked — see §9.)

**"Sent" means the gateway accepted it, not that anyone read it.** A carrier
dropping the message is invisible to us. This is the strongest practical
argument for a 48-hour window over a 24-hour one.

**Somebody who ignores the link and walks into the shop stays in Expired.**
Only an order placed _through the link_ closes the loop. Matching a walk-in
back to their entry would need a rule, and phone equality is wrong for a
household sharing a number. Cancel the entry by hand once you have sold to
them, so their copies go back.

**Nobody is told their position in the queue.** Computable, but it becomes a
promise the moment it is shown, and it moves _backwards_ whenever somebody
ahead lapses and is re-queued. Deliberately out of scope.

**No automatic next wave.** By design, for now — see §4.

---

## 9. Repeat customers and reprints

**One phone number, one live entry per book.** That is the whole rule. Signing
up twice for the same title is refused — kindly: the customer is told they are
already on the list, not shown an error.

The number is matched after normalising, so `01712345678`, `+880 1712-345678`
and Bangla digits all count as the same person. **Name and email are not
checked at all**, so somebody with two SIMs can hold two places. If that
matters on a small print run, scan the list for repeated names before a wave.

**Buying frees the slot.** Once an entry converts, that person can join the
same book's list again for the next print run. A waitlist is a queue for one
restock, not a lifetime register — and the alternative locked out precisely the
customers who had already proved they wanted the book.

Three things follow, and they are the ones to know at the desk:

- **They rejoin at the back.** A rejoin is a brand-new entry with today's date,
  so they queue behind everyone who signed up while they were away, and they
  count as a first-timer again for the fairness order. Their earlier purchase
  is not a claim on the next run.
- **You will see the same person twice in the list**, once as Converted and
  once as Waiting. That is the history working, not a duplicate to clean up.
  Do not delete the converted row — it is what the release's sales figures are
  counted from.
- **Cancelled is different and still blocks** (§8).

---

## 10. Restock morning, on one card

```
1.  Stock → Manage → Books arrived; confirm availability = in_stock
2.  Settings → Waitlist invite → confirm the window (48h default)
3.  Send ONE invite by hand → confirm delivery says SENT
4.  Stock → Manage → Set the share (how many free copies the queue gets)
5.  Invite next N
6.  Read the skipped list. Note anyone wanting more copies than remain.
7.  Check the delivery column. Re-invite every FAILED row.
8.  Wait out the window. Do nothing — copies come back on their own.
9.  Invite next N again. Repeat.
10. More books arrive → Stock → Books arrived → Change share. No need to close.
```

If an invite is ever refused, the message says which of the two limits stopped
it, because they call for different actions:

| Message                               | What to do                        |
| ------------------------------------- | --------------------------------- |
| "No open stock release for this book" | open one (§3)                     |
| "This release is fully spoken for"    | wait for lapses, or allocate more |
| "Only N copies left in this release"  | that entry wants more than N      |
