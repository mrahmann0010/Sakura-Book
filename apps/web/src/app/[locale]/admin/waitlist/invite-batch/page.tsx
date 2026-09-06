"use client";

import { useState } from "react";
import { MAX_PAGE_SIZE, type AdminWaitlistEntry } from "@sakura/contracts";

import { AdminShell } from "@/components/admin/admin-shell";
import { Button, Input } from "@/components/ui";
import { AdminApiError, inviteAdminWaitlist, listAdminWaitlist } from "@/lib/api/admin";
import { useAdminGate } from "@/lib/use-admin-gate";

const DEFAULT_COUNT = 20;

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
   -------------------------------------------------------------------------- */

export default function AdminWaitlistInviteBatchPage() {
  const { checking } = useAdminGate();

  const [count, setCount] = useState(String(DEFAULT_COUNT));
  const [items, setItems] = useState<AdminWaitlistEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadBatch() {
    const requested = Math.min(Math.max(Number(count) || DEFAULT_COUNT, 1), MAX_PAGE_SIZE);
    setCount(String(requested));

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const list = await listAdminWaitlist({
        status: ["PENDING"],
        sort: "oldest",
        page: 1,
        pageSize: requested,
      });

      setItems(list.items);
      setSelected(new Set(list.items.map((entry) => entry.id)));
      setLoaded(true);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not load the waitlist.");
    } finally {
      setLoading(false);
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

  const selectedBookCount = items
    .filter((entry) => selected.has(entry.id))
    .reduce((total, entry) => total + entry.quantity, 0);

  const allSelected = items.length > 0 && items.every((entry) => selected.has(entry.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((entry) => entry.id)));
  }

  async function sendInvites() {
    if (selected.size === 0) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await inviteAdminWaitlist({ ids: [...selected] });
      const sent = result.results.filter((row) => row.sent).length;
      const failed = result.results.length - sent;

      setNotice(
        failed === 0
          ? `Sent ${sent} invite${sent === 1 ? "" : "s"}.`
          : `Sent ${sent} invite${sent === 1 ? "" : "s"}, ${failed} failed — see the entries.`,
      );

      await loadBatch();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not send those invites.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell checking={checking}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-h2 text-ink font-serif">Invite the first N</h1>
          <p className="text-13.5 text-secondary mt-2">
            Pull the earliest pending sign-ups, in the order they joined, and text them the
            order link.
          </p>
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
            hint={`1–${MAX_PAGE_SIZE}, earliest sign-ups first.`}
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
              <Button type="button" loading={busy} disabled={selected.size === 0} onClick={() => void sendInvites()}>
                {`Send ${selected.size} invite${selected.size === 1 ? "" : "s"}`}
              </Button>
            </div>

            <div className="rounded-container border-rule bg-surface overflow-x-auto border">
              <table className="text-13.5 w-full min-w-[840px] text-left">
                <thead>
                  <tr className="border-rule text-caption text-muted border-b uppercase">
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
                  </tr>
                </thead>
                <tbody>
                  {items.map((entry, index) => (
                    <tr key={entry.id} className="border-rule/60 border-b align-top">
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
                    </tr>
                  ))}
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-muted px-4 py-6 text-center">
                        No pending sign-ups.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
