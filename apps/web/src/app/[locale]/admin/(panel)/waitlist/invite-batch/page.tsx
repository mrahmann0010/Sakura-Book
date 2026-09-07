"use client";

import { useState } from "react";
import { MAX_PAGE_SIZE, type AdminWaitlistEntry, type AdminWaitlistQuery } from "@sakura/contracts";

import { AdminTableRows } from "@/components/admin/skeletons";
import { Button, Input } from "@/components/ui";
import { AdminApiError, inviteAdminWaitlist, listAdminWaitlist } from "@/lib/api/admin";

const DEFAULT_COUNT = 20;

/* The two questions this page answers, as one switch over the query. Kept as
   data rather than as branches inside `loadBatch` so the difference between
   the tabs is readable in one place — it is only ever the filter. */
const TABS = [
  {
    key: "new",
    label: "First-time",
    heading: "Invite the first N",
    blurb:
      "Pull the earliest pending sign-ups, in the order they joined, and text them the order link.",
    countHint: "earliest sign-ups first",
    empty: "No pending sign-ups.",
    query: { status: ["PENDING"] },
  },
  {
    key: "reinvite",
    label: "Re-invite",
    heading: "Re-invite the ones who never ordered",
    blurb:
      "Everyone who was already sent a link and has not used it. Sending again mints a fresh token and retires the old one. Expired links are pre-selected; anyone whose link is still live is listed but left unchecked.",
    countHint: "longest-waiting first",
    empty: "Nobody is holding an unused invite.",
    /* PENDING as well as NOTIFIED: a first send whose SMS failed leaves the
       token issued but the status untouched, and that person is every bit as
       much "invited, never ordered" as the ones we did reach. */
    query: { status: ["PENDING", "NOTIFIED"], inviteState: "unused" },
  },
] as const satisfies readonly {
  key: string;
  label: string;
  heading: string;
  blurb: string;
  countHint: string;
  empty: string;
  query: Partial<AdminWaitlistQuery>;
}[];

type TabKey = (typeof TABS)[number]["key"];

/** A link whose window has already closed. The server has its own `expired`
 *  filter for this; here it only decides what a row *says* and whether it
 *  starts out checked, so a clock skew of seconds is immaterial. */
function isExpired(entry: AdminWaitlistEntry): boolean {
  return entry.invite !== null && new Date(entry.invite.expiresAt).getTime() <= Date.now();
}

/* --------------------------------------------------------------------------
   Invite the first N.

   The main Waitlist page filters and pages through everyone; this page
   answers one narrower question a restock morning actually asks — "give me
   the first 20 people who signed up and let me send them the link". Oldest
   first, unfiltered by search or book, because the promise this batch
   fulfills was made in signup order, not in whatever order the search box
   happens to return.

   Selection defaults to everyone in the fetched batch (checked), staff can
   uncheck the odd one, and Send reuses the same invite endpoint the main
   page's row-level "Invite" button already calls.

   ## The second tab: re-inviting

   The same morning has a second half. Most people who are texted a link never
   use it, and their entries sit at NOTIFIED — reached, but not converted —
   with a token that quietly lapses. The Waitlist page's Notified tab is close
   to that list but not equal to it: it counts by whether we made contact, not
   by what became of the link, so it mixes in anyone whose invite is still
   live and would happily let staff text a second link over a working first
   one.

   The `inviteState=unused` filter is the exact question instead — a token was
   issued and has not been spent — and "expired" narrows it to the ones where
   re-inviting is the only way back in. Both tabs post to the same endpoint;
   only the query above them differs.

   Selection on this tab defaults to the *expired* rows rather than to
   everything shown, which is the one place the two tabs behave differently.
   Someone holding a link that still works has not declined anything yet, and
   a second SMS to them is a nag rather than a rescue. They are still listed,
   and still checkable by hand.

   Issuing a new token silently invalidates the old one (see
   `WaitlistInviteService.issue`), so nobody ends up holding two live links —
   a re-invite replaces, it does not add.

   ## Recovering a partial send

   A successful send moves its entry to NOTIFIED, so it drops out of this
   PENDING-only list; a failed one stays put and reappears on the next
   refresh. That alone makes "click Send again" roughly right — but only
   roughly, because the refreshed list backfills to N with people who were
   never attempted. The `inviteSms` column is what makes it exact: it records
   each attempt in the database rather than only in the response, so after a
   dropped connection or a closed tab the failures are still identifiable,
   and "Select failed" re-sends to precisely those. Nobody who already got
   their link gets a second one as the price of retrying.
   -------------------------------------------------------------------------- */

export default function AdminWaitlistInviteBatchPage() {
  const [tab, setTab] = useState<TabKey>("new");
  const [count, setCount] = useState(String(DEFAULT_COUNT));
  const [items, setItems] = useState<AdminWaitlistEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  const activeTab = TABS.find((entry) => entry.key === tab)!;

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /* Takes the tab rather than reading it from state: switching tabs loads in
     the same click, and a `setTab` queued alongside would not have landed yet. */
  async function loadBatch(key: TabKey = tab) {
    const target = TABS.find((entry) => entry.key === key)!;
    const requested = Math.min(Math.max(Number(count) || DEFAULT_COUNT, 1), MAX_PAGE_SIZE);
    setCount(String(requested));

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const list = await listAdminWaitlist({
        ...target.query,
        sort: "oldest",
        page: 1,
        pageSize: requested,
      });

      setItems(list.items);
      /* The one behavioural difference between the tabs, and the reason it is
         a difference: on the re-invite tab a still-live link means the
         customer has not declined anything yet, so texting them again is a
         nag. They stay listed and stay checkable — just not by default. */
      const preselect = key === "reinvite" ? list.items.filter(isExpired) : list.items;

      setSelected(new Set(preselect.map((entry) => entry.id)));
      setLoaded(true);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not load the waitlist.");
    } finally {
      setLoading(false);
    }
  }

  function switchTab(key: TabKey) {
    if (key === tab) return;

    setTab(key);
    /* Cleared rather than carried across: the two tabs list different people,
       and a selection surviving the switch would be a set of ids the table
       below no longer shows — invisible rows in a bulk send. */
    setItems([]);
    setSelected(new Set());
    setLoaded(false);
    setError(null);
    setNotice(null);
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedBookCount = items
    .filter((entry) => selected.has(entry.id))
    .reduce((total, entry) => total + entry.quantity, 0);

  const allSelected = items.length > 0 && items.every((entry) => selected.has(entry.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((entry) => entry.id)));
  }

  /* The precise retry. Reads the database's record of the last attempt, not
     the last response, so it still works after a reload — which is the case
     it exists for. */
  const failed = items.filter((entry) => entry.inviteSms?.status === "FAILED");

  function selectFailed() {
    setSelected(new Set(failed.map((entry) => entry.id)));
  }

  /* The re-invite tab's equivalent shortcut: back to just the lapsed links
     after staff have hand-checked a few live ones and changed their mind. */
  const expired = items.filter(isExpired);

  function selectExpired() {
    setSelected(new Set(expired.map((entry) => entry.id)));
  }

  async function sendInvites() {
    if (selected.size === 0) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await inviteAdminWaitlist({ ids: [...selected] });
      const sent = result.results.filter((row) => row.sent).length;
      const failedCount = result.results.length - sent;

      setNotice(
        failedCount === 0
          ? `Sent ${sent} invite${sent === 1 ? "" : "s"}.`
          : `Sent ${sent} invite${sent === 1 ? "" : "s"}, ${failedCount} failed — use "Select failed" to retry just those.`,
      );

      /* On the re-invite tab the rows do not disappear the way a first send's
         do: the entry is still "invited and not yet ordered", now holding a
         fresh token instead of a lapsed one. The refresh is what makes that
         visible — the link column flips to "Still live" and the selection
         empties, since nothing shown is expired any more. */
      await loadBatch();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not send those invites.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h2 text-ink font-serif">{activeTab.heading}</h1>
        <p className="text-13.5 text-secondary mt-2 max-w-2xl">{activeTab.blurb}</p>
      </div>

      <div className="border-rule flex gap-1 border-b" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={entry.key === tab}
            onClick={() => switchTab(entry.key)}
            className={
              entry.key === tab
                ? "text-13.5 text-ink border-ink -mb-px border-b-2 px-4 py-2 font-medium"
                : "text-13.5 text-secondary hover:text-ink -mb-px border-b-2 border-transparent px-4 py-2"
            }
          >
            {entry.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void loadBatch();
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <Input
          type="number"
          min={1}
          max={MAX_PAGE_SIZE}
          label="Number of customers"
          hint={`1–${MAX_PAGE_SIZE}, ${activeTab.countHint}.`}
          value={count}
          onChange={(event) => setCount(event.target.value)}
          className="w-48"
        />
        <Button type="submit" variant="secondary" loading={loading}>
          {loaded ? "Refresh list" : "Show customers"}
        </Button>
      </form>

      {error ? <p className="text-13.5 text-clay-deep">{error}</p> : null}
      {notice ? <p className="text-13.5 text-secondary">{notice}</p> : null}

      {loaded ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-13.5 text-secondary">
              {items.length} shown · {selected.size} selected · {selectedBookCount} book
              {selectedBookCount === 1 ? "" : "s"} to deliver
            </span>
            <div className="flex items-center gap-2">
              {tab === "reinvite" && expired.length > 0 ? (
                <Button type="button" variant="secondary" onClick={selectExpired}>
                  {`Select ${expired.length} expired`}
                </Button>
              ) : null}
              {failed.length > 0 ? (
                <Button type="button" variant="secondary" onClick={selectFailed}>
                  {`Select ${failed.length} failed`}
                </Button>
              ) : null}
              <Button
                type="button"
                loading={busy}
                disabled={selected.size === 0}
                onClick={() => void sendInvites()}
              >
                {`Send ${selected.size} invite${selected.size === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>

          <div className="rounded-container border-rule bg-surface overflow-x-auto border">
            <table className="text-13.5 w-full min-w-[840px] text-left">
              <thead>
                <tr className="border-rule-strong text-caption text-muted border-b uppercase">
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all shown"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Signed up</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Qty</th>
                  <th className="px-4 py-3 font-medium">Lang</th>
                  <th className="px-4 py-3 font-medium">Waiting on</th>
                  {tab === "reinvite" ? (
                    <th className="px-4 py-3 font-medium">Invite link</th>
                  ) : null}
                  <th className="px-4 py-3 font-medium">Last invite SMS</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <AdminTableRows columns={10} /> : null}
                {items.map((entry, index) => (
                  <tr key={entry.id} className="border-rule border-b align-top last:border-0">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(entry.id)}
                        onChange={() => toggle(entry.id)}
                        aria-label={`Select ${entry.customerName}`}
                      />
                    </td>
                    <td className="text-muted px-4 py-3">{index + 1}</td>
                    <td className="text-secondary px-4 py-3">
                      {new Date(entry.signedUpAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-ink block">{entry.customerName}</span>
                      <span className="text-caption text-muted">{entry.customerEmail}</span>
                    </td>
                    <td className="text-ink px-4 py-3 font-mono">{entry.customerPhone}</td>
                    <td className="text-ink px-4 py-3">{entry.quantity}</td>
                    <td className="text-secondary px-4 py-3 uppercase">{entry.locale}</td>
                    <td className="text-secondary px-4 py-3">
                      {entry.bookTitle ?? <span className="text-muted">General</span>}
                    </td>
                    {tab === "reinvite" ? (
                      <td className="px-4 py-3">
                        {entry.invite ? (
                          <>
                            <span
                              className={
                                isExpired(entry) ? "text-clay-deep block" : "text-secondary block"
                              }
                            >
                              {isExpired(entry) ? "Expired" : "Still live"}
                            </span>
                            {/* The date either way: "expired" is only
                                  actionable next to how long ago, and a live
                                  link's remaining window is what decides
                                  whether overriding the default is fair. */}
                            <span className="text-caption text-muted">
                              {new Date(entry.invite.expiresAt).toLocaleString()}
                            </span>
                            {/* LOCKED reserved stock against this entry;
                                  OPEN did not. Re-inviting a LOCKED entry
                                  re-promises those copies. */}
                            <span className="text-caption text-muted block">
                              {entry.invite.mode}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      {entry.inviteSms ? (
                        <>
                          <span
                            className={
                              entry.inviteSms.status === "FAILED"
                                ? "text-clay-deep block"
                                : "text-secondary block"
                            }
                          >
                            {entry.inviteSms.status === "FAILED" ? "Failed" : "Sent"}
                            {" · "}
                            {new Date(entry.inviteSms.at).toLocaleTimeString()}
                          </span>
                          {/* The gateway's own words. "Phone asleep" and
                                "bad credentials" need opposite responses and
                                are indistinguishable without them. */}
                          {entry.inviteSms.error ? (
                            <span className="text-caption text-muted block">
                              {entry.inviteSms.error}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={tab === "reinvite" ? 10 : 9}
                      className="text-muted px-4 py-6 text-center"
                    >
                      {activeTab.empty}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
