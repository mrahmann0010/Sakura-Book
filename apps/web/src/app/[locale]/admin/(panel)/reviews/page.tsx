"use client";

import { useEffect, useState } from "react";
import type { AdminReview, AdminReviewCounts, ReviewStatus } from "@sakura/contracts";

import { AdminTableRows } from "@/components/admin/skeletons";
import { Button } from "@/components/ui";
import {
  AdminApiError,
  deleteAdminReview,
  listAdminReviews,
  updateAdminReview,
} from "@/lib/api/admin";

/* --------------------------------------------------------------------------
   The "your experience" queue.

   Every submission lands PENDING, so this is the one screen that decides
   whether a testimonial ever reaches the storefront. Tabs are the review's
   status, unlike the waitlist's lane split, because a testimonial's status
   *is* where it stands — there is no separate "lapsed" case hiding behind it.
   -------------------------------------------------------------------------- */

const TABS = [
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "SPAM", label: "Spam" },
] as const satisfies readonly { key: ReviewStatus; label: string }[];

const EMPTY_COUNTS: AdminReviewCounts = { PENDING: 0, APPROVED: 0, REJECTED: 0, SPAM: 0 };

export default function AdminReviewsPage() {
  const [tab, setTab] = useState<ReviewStatus>("PENDING");
  const [items, setItems] = useState<AdminReview[]>([]);
  const [counts, setCounts] = useState<AdminReviewCounts>(EMPTY_COUNTS);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [q, setQ] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void load(tab, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function load(activeTab: ReviewStatus, pageNumber: number) {
    setError(null);
    setLoading(true);
    setItems([]);
    try {
      const list = await listAdminReviews({
        status: [activeTab],
        q: q || undefined,
        page: pageNumber,
      });

      setItems(list.items);
      setCounts(list.counts);
      setTotal(list.total);
      setTotalPages(list.totalPages);
      setPage(list.page);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not load the reviews.");
    } finally {
      setLoading(false);
    }
  }

  async function setStatus(review: AdminReview, status: ReviewStatus) {
    setBusy(true);
    setError(null);
    try {
      await updateAdminReview(review.id, { status });
      await load(tab, page);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not update that review.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFeatured(review: AdminReview) {
    setBusy(true);
    setError(null);
    try {
      await updateAdminReview(review.id, { isFeatured: !review.isFeatured });
      await load(tab, page);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not update that review.");
    } finally {
      setBusy(false);
    }
  }

  async function editNote(review: AdminReview) {
    const next = window.prompt("Internal note (staff only)", review.moderatorNote ?? "");
    if (next === null) return;

    setBusy(true);
    setError(null);
    try {
      await updateAdminReview(review.id, { moderatorNote: next });
      await load(tab, page);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not save that note.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(review: AdminReview) {
    if (
      !window.confirm(
        "Delete this testimonial permanently?\n\nThis removes the author, email and IP hash from disk. Use Reject or Spam instead unless it genuinely must not remain.",
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deleteAdminReview(review.id);
      setNotice("Deleted.");
      await load(tab, page);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not delete that review.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h2 text-ink font-serif">Reviews</h1>
          <p className="text-13.5 text-secondary mt-2">
            What customers wrote on Your Experience.
          </p>
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
          placeholder="Search by name, email, title, body…"
          className="rounded-control border-rule bg-surface text-13.5 text-ink w-full max-w-sm border px-3 py-2"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {error ? <p className="text-13.5 text-clay-deep">{error}</p> : null}
      {notice ? <p className="text-13.5 text-secondary">{notice}</p> : null}

      <div className="rounded-container border-rule bg-surface overflow-x-auto border">
        <table className="text-13.5 w-full min-w-[960px] text-left">
          <thead>
            <tr className="border-rule-strong text-caption text-muted border-b uppercase">
              <th className="px-4 py-3 font-medium">Submitted</th>
              <th className="px-4 py-3 font-medium">Reviewer</th>
              <th className="px-4 py-3 font-medium">Rating</th>
              <th className="px-4 py-3 font-medium">Review</th>
              <th className="px-4 py-3 font-medium">Featured</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? <AdminTableRows columns={6} /> : null}
            {items.map((review) => (
              <tr key={review.id} className="border-rule border-b align-top last:border-0">
                <td className="text-secondary px-4 py-3">
                  {new Date(review.submittedAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <span className="text-ink block">{review.authorName ?? "Anonymous"}</span>
                  <span className="text-caption text-muted">{review.authorEmail}</span>
                  {review.orderNumber ? (
                    <span className="text-caption text-muted mt-1 block font-mono">
                      {review.orderNumber}
                    </span>
                  ) : null}
                  {review.moderatorNote ? (
                    <span className="text-caption text-clay mt-1 block">
                      {review.moderatorNote}
                    </span>
                  ) : null}
                </td>
                <td className="text-ink px-4 py-3">{review.rating ?? "—"}</td>
                <td className="px-4 py-3">
                  {review.title ? (
                    <span className="text-ink block font-medium">{review.title}</span>
                  ) : null}
                  <span className="text-secondary block whitespace-pre-wrap">{review.body}</span>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void toggleFeatured(review)}
                    className={
                      review.isFeatured
                        ? "text-clay hover:text-clay-deep"
                        : "text-muted hover:text-ink"
                    }
                  >
                    {review.isFeatured ? "Featured" : "Feature"}
                  </button>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {review.status !== "APPROVED" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setStatus(review, "APPROVED")}
                      className="text-clay hover:text-clay-deep"
                    >
                      Approve
                    </button>
                  ) : null}
                  {review.status !== "REJECTED" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setStatus(review, "REJECTED")}
                      className="text-muted hover:text-clay-deep ml-3"
                    >
                      Reject
                    </button>
                  ) : null}
                  {review.status !== "SPAM" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setStatus(review, "SPAM")}
                      className="text-muted hover:text-clay-deep ml-3"
                    >
                      Spam
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void editNote(review)}
                    className="text-clay hover:text-clay-deep ml-3"
                  >
                    Note
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(review)}
                    className="text-muted hover:text-clay-deep ml-3"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted px-4 py-6 text-center">
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
