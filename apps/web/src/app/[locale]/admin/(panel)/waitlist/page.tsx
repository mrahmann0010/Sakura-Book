"use client";

import { useEffect, useState } from "react";
import { BellRing, BookMarked, CircleX, Clock3, PackageCheck, TimerOff } from "lucide-react";
import type {
  AdminWaitlistAllocationView,
  AdminWaitlistBook,
  AdminWaitlistCounts,
  AdminWaitlistEntry,
  AdminWaitlistWavePlan,
  WaitlistLane,
  WaitlistStatus,
} from "@sakura/contracts";

import { AdminTableRows } from "@/components/admin/skeletons";
import { Button } from "@/components/ui";
import {
  AdminApiError,
  closeAdminWaitlistAllocation,
  downloadAdminWaitlistCsv,
  getAdminWaitlistAllocations,
  getAdminWaitlistBooks,
  getAdminWaitlistWavePlan,
  inviteAdminWaitlist,
  listAdminWaitlist,
  notifyAdminWaitlist,
  openAdminWaitlistAllocation,
  sendAdminWaitlistWave,
  updateAdminWaitlistEntry,
} from "@/lib/api/admin";

/* --------------------------------------------------------------------------
   The waitlist desk.

   Five tabs over one `lane[]` filter. A lane is where an entry stands right
   now rather than what was last written to it — see `waitlistLanes` — and the
   difference is the Expired tab: every entry on it is `NOTIFIED`, so tabs
   built on status could not show it at all, and the people whose window
   lapsed were invisible between the Notified and Converted tabs. There is no
   separate bookkeeping and no detail page: a waitlist entry is one row of
   contact details, so the row is the whole record and everything you can do
   to it is done from the table.

   The screen is built around the one morning it exists for — stock lands,
   and someone has to work down a list of people who were promised first
   refusal. Hence: oldest first by default (that promise, in sort order),
   checkboxes with a select-all, and an export that hands the list to whatever
   bulk SMS tool is actually going to send it. "Mark notified" records what
   was sent elsewhere; it does not send. See the API service for why.
   -------------------------------------------------------------------------- */

const TABS = [
  { key: "WAITING", label: "Waiting" },
  { key: "INVITED", label: "Invited" },
  { key: "EXPIRED", label: "Expired" },
  { key: "CONVERTED", label: "Converted" },
  { key: "CANCELLED", label: "Cancelled" },
] as const satisfies readonly { key: WaitlistLane; label: string }[];

const EMPTY_COUNTS: AdminWaitlistCounts = {
  WAITING: 0,
  INVITED: 0,
  EXPIRED: 0,
  CONVERTED: 0,
  CANCELLED: 0,
};

/** Sentence case for the cell, so a row reads as a state rather than as an
 *  enum member leaking through. `Holding a copy` says what INVITED costs the
 *  shop, which is the thing staff are deciding about. */
const LANE_LABELS: Record<WaitlistLane, string> = {
  WAITING: "Waiting",
  INVITED: "Holding a copy",
  EXPIRED: "Lapsed",
  CONVERTED: "Ordered",
  CANCELLED: "Removed",
};

export default function AdminWaitlistPage() {
  const [tab, setTab] = useState<WaitlistLane>("WAITING");
  const [items, setItems] = useState<AdminWaitlistEntry[]>([]);
  const [counts, setCounts] = useState<AdminWaitlistCounts>(EMPTY_COUNTS);
  const [totalQuantity, setTotalQuantity] = useState(0);
  const [sources, setSources] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [locale, setLocale] = useState("");
  const [bookId, setBookId] = useState("");
  const [books, setBooks] = useState<AdminWaitlistBook[]>([]);

  // The checked rows, by id. Cleared whenever the underlying list changes —
  // keeping a selection across a tab switch would mean the "Mark 12 notified"
  // button counts rows that are no longer on screen.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /* The open release for whichever book is filtered, or null. Only ever
     fetched when a book *is* filtered: a release is a per-title decision, and
     "All books" has no single answer to show. */
  const [allocation, setAllocation] = useState<AdminWaitlistAllocationView | null>(null);

  /* What the next wave would do. Fetched rather than derived from the release,
     because "19 copies left" and "the next 19 people" stop being the same
     number as soon as anybody in line wants two. */
  const [wavePlan, setWavePlan] = useState<AdminWaitlistWavePlan | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Starts true: a load fires on mount, and the first thing this screen
     shows should be the shape of a table, not an empty one. */
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void load(tab, 1);
    // Filters are applied by the Search button rather than on every keystroke,
    // so they are deliberately not dependencies here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // The book filter's options — fetched once, not per tab switch.
  useEffect(() => {
    getAdminWaitlistBooks()
      .then(setBooks)
      .catch(() => undefined);
  }, []);

  async function load(activeTab: WaitlistLane, pageNumber: number) {
    setError(null);
    setLoading(true);
    /* Cleared so a refetch shows the skeleton rather than the previous tab's
       rows with a spinner somewhere near them. */
    setItems([]);
    try {
      const list = await listAdminWaitlist({
        lane: [activeTab],
        q: q || undefined,
        source: source || undefined,
        locale: locale || undefined,
        bookId: bookId || undefined,
        page: pageNumber,
      });

      setItems(list.items);
      setCounts(list.counts);
      setTotalQuantity(list.totalQuantity);
      setSources(list.sources);
      setTotal(list.total);
      setTotalPages(list.totalPages);
      setPage(list.page);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not load the waitlist.");
    } finally {
      setLoading(false);
    }

    /* After the list, not alongside it, and deliberately not fatal. The
       release header is context for a decision; the list is the work. A
       release lookup that fails should not blank the table staff came for.

       The plan is fetched here too rather than derived from the release,
       because "19 copies left" and "the next 19 people" are not the same
       number the moment anybody in line wants more than one copy. */
    if (bookId) {
      const [nextAllocation, nextPlan] = await Promise.all([
        getAdminWaitlistAllocations(bookId).catch(() => null),
        getAdminWaitlistWavePlan(bookId).catch(() => null),
      ]);
      setAllocation(nextAllocation);
      setWavePlan(nextPlan);
    } else {
      setAllocation(null);
      setWavePlan(null);
    }
  }

  /**
   * Send the next wave.
   *
   * Posts a book, not a list of ids: who goes is decided on the server, in the
   * fairness order, against the release's budget. A page of rows on screen is
   * not enough to honour a queue's promise, and the browser should not be the
   * thing that tries.
   */
  async function sendWave() {
    if (!wavePlan || wavePlan.count === 0) return;

    if (
      !window.confirm(
        `Text the next ${wavePlan.count} in line?\n\nThey hold ${wavePlan.quantity} cop${wavePlan.quantity === 1 ? "y" : "ies"} until their window closes. Nobody is invited beyond what this release can fund.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await sendAdminWaitlistWave({ bookId });
      const sent = result.results.filter((row) => row.sent).length;
      const failed = result.results.length - sent;

      setNotice(
        failed === 0
          ? `Wave sent — ${sent} invite${sent === 1 ? "" : "s"}.`
          : `Wave sent — ${sent} out, ${failed} failed. The failures are on the Invited tab, marked.`,
      );

      await load(tab, 1);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not send that wave.");
    } finally {
      setBusy(false);
    }
  }

  async function openRelease() {
    const answer = window.prompt(
      "How many copies of this restock go to the waitlist?\n\nThe rest stay on the shelf for walk-in customers.",
      "",
    );
    if (answer === null) return;

    const copies = Number(answer.trim());
    if (!Number.isInteger(copies) || copies < 1) {
      setError("Enter a whole number of copies, at least one.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      setAllocation(await openAdminWaitlistAllocation({ bookId, copies }));
      setNotice(`Allocated ${copies} cop${copies === 1 ? "y" : "ies"} to the waitlist.`);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not open that release.");
    } finally {
      setBusy(false);
    }
  }

  async function closeRelease(id: string) {
    /* Spelled out because it is the most common misreading of this button:
       closing stops new invites and leaves live ones alone. */
    if (
      !window.confirm(
        "Close this release?\n\nNo new invites will be charged to it. Invites already sent keep their windows and their copies.",
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      setAllocation(await closeAdminWaitlistAllocation(id, bookId));
      setNotice("Release closed.");
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not close that release.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allOnPageSelected = items.length > 0 && items.every((entry) => selected.has(entry.id));

  function toggleAll() {
    setSelected(allOnPageSelected ? new Set() : new Set(items.map((entry) => entry.id)));
  }

  async function markNotified() {
    if (selected.size === 0) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await notifyAdminWaitlist({ ids: [...selected] });

      /* Reports what actually moved rather than what was selected. The two
         differ when a row was already notified, and saying "40 marked" for 6
         is how a list gets worked twice. */
      setNotice(
        result.updated === 0
          ? "Nothing changed — those entries were already notified."
          : `Marked ${result.updated} ${result.updated === 1 ? "entry" : "entries"} as notified.`,
      );

      await load(tab, page);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not mark those as notified.");
    } finally {
      setBusy(false);
    }
  }

  /** Shared by the bulk "Invite" button and the per-row one — a single id is
   *  exactly what a per-row send is. */
  async function invite(ids: string[]) {
    if (ids.length === 0) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await inviteAdminWaitlist({ ids });
      const sent = result.results.filter((row) => row.sent).length;
      const failed = result.results.length - sent;

      setNotice(
        failed === 0
          ? `Sent ${sent} invite${sent === 1 ? "" : "s"}.`
          : `Sent ${sent} invite${sent === 1 ? "" : "s"}, ${failed} failed — see the entries.`,
      );

      await load(tab, page);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not send those invites.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(entry: AdminWaitlistEntry, status: WaitlistStatus) {
    setBusy(true);
    setError(null);
    try {
      await updateAdminWaitlistEntry(entry.id, { status });
      await load(tab, page);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not update that entry.");
    } finally {
      setBusy(false);
    }
  }

  async function editNote(entry: AdminWaitlistEntry) {
    const next = window.prompt("Internal note (staff only)", entry.internalNote ?? "");
    if (next === null) return;

    setBusy(true);
    setError(null);
    try {
      await updateAdminWaitlistEntry(entry.id, { internalNote: next });
      await load(tab, page);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not save that note.");
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setBusy(true);
    setError(null);
    try {
      await downloadAdminWaitlistCsv({
        lane: [tab],
        q: q || undefined,
        source: source || undefined,
        locale: locale || undefined,
        bookId: bookId || undefined,
      });
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not export the waitlist.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h2 text-ink font-serif">Waitlist</h1>
          <div className="text-13.5 text-secondary mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" aria-hidden />
              {counts.WAITING} waiting
            </span>
            <span className="inline-flex items-center gap-1.5">
              <BellRing className="h-3.5 w-3.5" aria-hidden />
              {counts.INVITED} holding a copy
            </span>
            {/* Only when there are any. A permanent "0 lapsed" is noise on
                every morning except the one after a window closes, which is
                the morning it needs to be impossible to miss. */}
            {counts.EXPIRED > 0 ? (
              <span className="text-clay inline-flex items-center gap-1.5 font-medium">
                <TimerOff className="h-3.5 w-3.5" aria-hidden />
                {counts.EXPIRED} lapsed
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <PackageCheck className="h-3.5 w-3.5" aria-hidden />
              {counts.CONVERTED} converted
            </span>
            {counts.CANCELLED > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <CircleX className="h-3.5 w-3.5" aria-hidden />
                {counts.CANCELLED} cancelled
              </span>
            ) : null}
            <span className="text-clay inline-flex items-center gap-1.5 font-medium">
              <BookMarked className="h-3.5 w-3.5" aria-hidden />
              {totalQuantity} book{totalQuantity === 1 ? "" : "s"} wanted
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          {selected.size > 0 ? (
            <>
              {/* Same endpoint either way — issuing a token over a dead one is
                  what re-inviting *is* — but the word matters on the Expired
                  tab, where "Invite" would read as first contact for people
                  the shop has already texted once. */}
              <Button type="button" loading={busy} onClick={() => void invite([...selected])}>
                {tab === "EXPIRED" ? `Re-invite ${selected.size}` : `Invite ${selected.size}`}
              </Button>
              <Button
                type="button"
                variant="secondary"
                loading={busy}
                onClick={() => void markNotified()}
              >
                {`Mark ${selected.size} notified`}
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void exportCsv()}
          >
            Export CSV
          </Button>
        </div>
      </div>

      {/* The release, shown only with a book filtered — a release is a
          per-title decision and "All books" has no single answer. */}
      {bookId ? (
        <div className="rounded-control border-rule bg-surface border px-4 py-3">
          {allocation?.open ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-13.5">
                <span className="text-ink font-medium">
                  {allocation.open.copies} of {allocation.open.stockSnapshot} to the waitlist
                </span>
                <span className="text-secondary ml-3">
                  {allocation.open.committed} spoken for · {allocation.open.spendable} to give out
                  {/* The two limits can differ, and which one is biting changes
                      what staff should do about it — print more, or allocate
                      more. Say so only when they disagree. */}
                  {allocation.open.remaining > allocation.open.spendable
                    ? ` (held down by ${allocation.open.stockQuantity} in stock)`
                    : null}
                </span>
                {allocation.open.overIssued ? (
                  <span className="text-clay-deep mt-1 block font-medium">
                    More copies are promised than this book has. Print more, or withdraw an invite
                    — the storefront is refusing to sell it meanwhile.
                  </span>
                ) : null}
                {/* Never silent. An entry that keeps being passed over waits
                    forever while every wave reports success. */}
                {wavePlan && wavePlan.skipped.length > 0 ? (
                  <span className="text-secondary mt-1 block">
                    {wavePlan.skipped.length} skipped — they want more copies than remain (
                    {wavePlan.skipped
                      .slice(0, 3)
                      .map((row) => `${row.name} ×${row.quantity}`)
                      .join(", ")}
                    {wavePlan.skipped.length > 3 ? "…" : ""}). Invite them by hand, or allocate
                    more.
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {/* The whole flow in one button. Labelled with what it will
                    actually do rather than "Send wave", because the number is
                    the thing staff are deciding about. */}
                {wavePlan && wavePlan.count > 0 ? (
                  <Button type="button" loading={busy} onClick={() => void sendWave()}>
                    {`Invite next ${wavePlan.count}`}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void closeRelease(allocation.open!.id)}
                >
                  Close release
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Not a warning about a missing setting — it is the step that
                  has to happen before any invite for this book will send, so
                  it says what it blocks. */}
              <p className="text-13.5 text-secondary">
                No open release for this book, so invites will not send. Decide how many copies of
                the restock the waitlist gets.
              </p>
              <Button type="button" size="sm" loading={busy} onClick={() => void openRelease()}>
                Allocate copies
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <div className="border-rule flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`text-13.5 -mb-px border-b-2 px-4 py-2 transition-colors ${
              tab === t.key
                ? "border-clay text-ink font-medium"
                : "text-secondary hover:text-ink border-transparent"
            }`}
          >
            {t.label}
            <span className="text-muted ml-2">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load(tab, 1);
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search by name, email, phone…"
          className="rounded-control border-rule bg-surface text-13.5 text-ink w-full max-w-sm border px-3 py-2"
        />

        <select
          value={locale}
          onChange={(event) => setLocale(event.target.value)}
          className="rounded-control border-rule bg-surface text-13.5 text-ink border px-3 py-2"
          aria-label="Language"
        >
          <option value="">All languages</option>
          <option value="bn">Bangla</option>
          <option value="en">English</option>
          <option value="ja">Japanese</option>
        </select>

        {/* Narrows to one title's queue — the "first in line for this book"
              view the Invite action is meant to be used from, since the list
              is already oldest-first by default. */}
        <select
          value={bookId}
          onChange={(event) => setBookId(event.target.value)}
          className="rounded-control border-rule bg-surface text-13.5 text-ink border px-3 py-2"
          aria-label="Book"
        >
          <option value="">All books</option>
          {books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.title}
            </option>
          ))}
        </select>

        {/* Populated from the data, not a constant — `source` is free text so
              a new entry point is filterable the day it starts writing rows. */}
        <select
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className="rounded-control border-rule bg-surface text-13.5 text-ink border px-3 py-2"
          aria-label="Source"
        >
          <option value="">All sources</option>
          {sources.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {error ? <p className="text-13.5 text-clay-deep">{error}</p> : null}
      {notice ? <p className="text-13.5 text-secondary">{notice}</p> : null}

      <div className="rounded-container border-rule bg-surface overflow-x-auto border">
        <table className="text-13.5 w-full min-w-[1040px] text-left">
          <thead>
            <tr className="border-rule-strong text-caption text-muted border-b uppercase">
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleAll}
                  aria-label="Select all on this page"
                />
              </th>
              <th className="px-4 py-3 font-medium">Signed up</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Qty</th>
              <th className="px-4 py-3 font-medium">Lang</th>
              <th className="px-4 py-3 font-medium">Waiting on</th>
              <th className="px-4 py-3 font-medium">State</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? <AdminTableRows columns={9} /> : null}
            {items.map((entry) => (
              <tr key={entry.id} className="border-rule border-b align-top last:border-0">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(entry.id)}
                    onChange={() => toggle(entry.id)}
                    aria-label={`Select ${entry.customerName}`}
                  />
                </td>
                <td className="text-secondary px-4 py-3">
                  {new Date(entry.signedUpAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <span className="text-ink block">{entry.customerName}</span>
                  <span className="text-caption text-muted">{entry.customerEmail}</span>
                  {entry.internalNote ? (
                    <span className="text-caption text-clay mt-1 block">{entry.internalNote}</span>
                  ) : null}
                </td>
                {/* Monospace because this column is read digit by digit and
                      then typed into a phone. */}
                <td className="text-ink px-4 py-3 font-mono">{entry.customerPhone}</td>
                <td className="text-ink px-4 py-3">{entry.quantity}</td>
                <td className="text-secondary px-4 py-3 uppercase">{entry.locale}</td>
                <td className="text-secondary px-4 py-3">
                  {entry.bookTitle ?? <span className="text-muted">General</span>}
                </td>
                <td className="text-secondary px-4 py-3">
                  <span className="text-ink block">{LANE_LABELS[entry.lane]}</span>
                  {/* The window, on the two lanes where it is the point: how
                      long an INVITED customer still has, and how long ago an
                      EXPIRED one ran out. */}
                  {entry.invite && (entry.lane === "INVITED" || entry.lane === "EXPIRED") ? (
                    <span className="text-caption text-muted block">
                      {entry.lane === "INVITED" ? "until " : "lapsed "}
                      {new Date(entry.invite.expiresAt).toLocaleString()}
                    </span>
                  ) : null}
                  {entry.notifiedAt ? (
                    <span className="text-caption text-muted">
                      {new Date(entry.notifiedAt).toLocaleDateString()}
                    </span>
                  ) : null}
                  {entry.convertedOrderNumber ? (
                    <span className="text-caption text-muted font-mono">
                      {entry.convertedOrderNumber}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {/* Lane, not status: an INVITED entry is still eligible —
                      re-issuing replaces a link a customer says never
                      arrived — and the two lanes with nothing left to offer
                      are the terminal ones. */}
                  {entry.lane !== "CANCELLED" && entry.lane !== "CONVERTED" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void invite([entry.id])}
                      className="text-clay hover:text-clay-deep"
                    >
                      {entry.lane === "WAITING" ? "Invite" : "Re-invite"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void editNote(entry)}
                    className="text-clay hover:text-clay-deep ml-3"
                  >
                    Note
                  </button>
                  {entry.lane !== "CANCELLED" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setStatus(entry, "CANCELLED")}
                      className="text-muted hover:text-clay-deep ml-3"
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setStatus(entry, "PENDING")}
                      className="text-muted hover:text-ink ml-3"
                    >
                      Restore
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-muted px-4 py-6 text-center">
                  Nobody in this view.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => void load(tab, page - 1)}
          >
            Previous
          </Button>
          <span className="text-13.5 text-secondary">
            Page {page} of {totalPages} · {total} in this view
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => void load(tab, page + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
