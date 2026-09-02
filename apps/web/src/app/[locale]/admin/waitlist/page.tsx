"use client";

import { useEffect, useState } from "react";
import type { AdminWaitlistCounts, AdminWaitlistEntry, WaitlistStatus } from "@sakura/contracts";

import { AdminShell } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui";
import {
  AdminApiError,
  downloadAdminWaitlistCsv,
  listAdminWaitlist,
  notifyAdminWaitlist,
  updateAdminWaitlistEntry,
} from "@/lib/api/admin";
import { useAdminGate } from "@/lib/use-admin-gate";

/* --------------------------------------------------------------------------
   The waitlist desk.

   Four tabs over one `status[]` filter, the same shape as the order queue —
   marking someone notified moves their status, and they stop matching the
   Pending tab on the next load. There is no separate bookkeeping and no
   detail page: a waitlist entry is one row of contact details, so the row is
   the whole record and everything you can do to it is done from the table.

   The screen is built around the one morning it exists for — stock lands,
   and someone has to work down a list of people who were promised first
   refusal. Hence: oldest first by default (that promise, in sort order),
   checkboxes with a select-all, and an export that hands the list to whatever
   bulk SMS tool is actually going to send it. "Mark notified" records what
   was sent elsewhere; it does not send. See the API service for why.
   -------------------------------------------------------------------------- */

const TABS = [
  { key: "PENDING", label: "Pending" },
  { key: "NOTIFIED", label: "Notified" },
  { key: "CONVERTED", label: "Converted" },
  { key: "CANCELLED", label: "Cancelled" },
] as const satisfies readonly { key: WaitlistStatus; label: string }[];

const EMPTY_COUNTS: AdminWaitlistCounts = {
  PENDING: 0,
  NOTIFIED: 0,
  CONVERTED: 0,
  CANCELLED: 0,
};

export default function AdminWaitlistPage() {
  const { checking } = useAdminGate();

  const [tab, setTab] = useState<WaitlistStatus>("PENDING");
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

  // The checked rows, by id. Cleared whenever the underlying list changes —
  // keeping a selection across a tab switch would mean the "Mark 12 notified"
  // button counts rows that are no longer on screen.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (checking) return;
    void load(tab, 1);
    // Filters are applied by the Search button rather than on every keystroke,
    // so they are deliberately not dependencies here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, tab]);

  async function load(activeTab: WaitlistStatus, pageNumber: number) {
    setError(null);
    try {
      const list = await listAdminWaitlist({
        status: [activeTab],
        q: q || undefined,
        source: source || undefined,
        locale: locale || undefined,
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
        status: [tab],
        q: q || undefined,
        source: source || undefined,
        locale: locale || undefined,
      });
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not export the waitlist.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell checking={checking}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-h2 text-ink font-serif">Waitlist</h1>
            <p className="text-13.5 text-secondary mt-1">
              {counts.PENDING} pending · {counts.NOTIFIED} notified · {counts.CONVERTED} converted
              {counts.CANCELLED > 0 ? ` · ${counts.CANCELLED} cancelled` : null}
              {` · ${totalQuantity} book${totalQuantity === 1 ? "" : "s"} wanted`}
            </p>
          </div>

          <div className="flex gap-2">
            {selected.size > 0 ? (
              <Button type="button" loading={busy} onClick={() => void markNotified()}>
                {`Mark ${selected.size} notified`}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void exportCsv()}>
              Export CSV
            </Button>
          </div>
        </div>

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
              <tr className="border-rule text-caption text-muted border-b uppercase">
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
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id} className="border-rule/60 border-b align-top">
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
                      <span className="text-caption text-clay mt-1 block">
                        {entry.internalNote}
                      </span>
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
                    <span className="block">{entry.status}</span>
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
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void editNote(entry)}
                      className="text-clay hover:text-clay-deep"
                    >
                      Note
                    </button>
                    {entry.status !== "CANCELLED" ? (
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
              {items.length === 0 ? (
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
    </AdminShell>
  );
}
