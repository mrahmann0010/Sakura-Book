"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminOrderDetail, AdminOrderVerifyPaymentResult, OrderStatus } from "@sakura/contracts";

import { AdminShell } from "@/components/admin/admin-shell";
import { ReceiptBadge, VerificationBadge } from "@/components/admin/payment-safety";
import { Button, Notice, Textarea } from "@/components/ui";
import {
  AdminApiError,
  confirmAdminOrderPayment,
  getAdminOrder,
  recordAdminOrderRefund,
  setAdminOrderNote,
  transitionAdminOrder,
  verifyAdminOrderPayment,
} from "@/lib/api/admin";
import { formatMoney } from "@/lib/money";
import { useAdminGate } from "@/lib/use-admin-gate";

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pending",
  PAYMENT_CONFIRMED: "Payment confirmed",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export default function AdminOrderDetailPage() {
  const { checking } = useAdminGate();
  const { orderNumber, locale } = useParams<{ orderNumber: string; locale: string }>();

  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [note, setNote] = useState("");

  /**
   * The typed justification for confirming a duplicate receipt.
   *
   * Sent with the grant rather than saved separately, so the reason and the
   * thing it justifies are one request — the API refuses the grant if it
   * cannot record the reason.
   */
  const [overrideReason, setOverrideReason] = useState("");

  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<AdminOrderVerifyPaymentResult | null>(null);

  const [internalNote, setInternalNote] = useState("");
  const [internalNoteSaved, setInternalNoteSaved] = useState(false);

  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

  useEffect(() => {
    if (checking) return;
    let cancelled = false;

    getAdminOrder(orderNumber)
      .then((detail) => {
        if (cancelled) return;
        setOrder(detail);
        setInternalNote(detail.internalNote ?? "");
        setVerifyResult(null);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err, "Could not load this order."));
      });

    return () => {
      cancelled = true;
    };
  }, [checking, orderNumber]);

  async function run(action: () => Promise<AdminOrderDetail>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      setOrder(updated);
      setNote("");
    } catch (err) {
      setError(messageOf(err, "That action failed."));
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!order) return;

    // Sent only when there is a duplicate to override. Passing it otherwise
    // would put a justification on the audit log for a block that never fired.
    const duplicateReceiptOverride =
      order.receipt.state === "DUPLICATE" ? overrideReason.trim() || undefined : undefined;

    if (order.paymentMethod === "manual-transfer") {
      await run(() =>
        confirmAdminOrderPayment(orderNumber, {
          amountCents: order.totalCents,
          reference: order.transactionId ?? undefined,
          note: note || undefined,
          duplicateReceiptOverride,
        }),
      );
    } else {
      await run(() =>
        transitionAdminOrder(orderNumber, {
          status: "PAYMENT_CONFIRMED",
          note: note || "Accepted by admin",
          duplicateReceiptOverride,
        }),
      );
    }
  }

  async function reject() {
    await run(() =>
      transitionAdminOrder(orderNumber, { status: "CANCELLED", note: note || undefined }),
    );
  }

  async function moveTo(status: OrderStatus) {
    await run(() =>
      transitionAdminOrder(orderNumber, {
        status,
        note: note || undefined,
        // Same guard as Accept: a transition to PAYMENT_CONFIRMED is a grant,
        // and the API now refuses it on a duplicate receipt just as it refuses
        // confirmPayment.
        duplicateReceiptOverride:
          status === "PAYMENT_CONFIRMED" && order?.receipt.state === "DUPLICATE"
            ? overrideReason.trim() || undefined
            : undefined,
      }),
    );
  }

  async function verify() {
    setVerifying(true);
    setError(null);
    // Cleared before the call, not after: a second check that lands on a
    // different outcome must not leave the first one on screen while it runs.
    setVerifyResult(null);
    try {
      setVerifyResult(await verifyAdminOrderPayment(orderNumber));
    } catch (err) {
      setError(messageOf(err, "Could not verify this transaction."));
    } finally {
      setVerifying(false);
    }
  }

  async function saveInternalNote() {
    setError(null);
    try {
      const updated = await setAdminOrderNote(orderNumber, { note: internalNote || null });
      setOrder(updated);
      setInternalNoteSaved(true);
    } catch (err) {
      setError(messageOf(err, "Could not save the note."));
    }
  }

  async function refund() {
    const amountCents = Math.round(Number(refundAmount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError("Enter a valid refund amount.");
      return;
    }
    if (!refundReason.trim()) {
      setError("Say why this was refunded.");
      return;
    }
    await run(() => recordAdminOrderRefund(orderNumber, { amountCents, reason: refundReason }));
    setRefundAmount("");
    setRefundReason("");
  }

  if (error && !order) {
    return (
      <AdminShell checking={checking}>
        <p className="text-13.5 text-clay-deep">{error}</p>
      </AdminShell>
    );
  }

  if (!order) {
    return <AdminShell checking={checking}>{null}</AdminShell>;
  }

  const canRefund = order.allowedTransitions.includes("REFUNDED");
  const otherTransitions = order.allowedTransitions.filter(
    (status) => status !== "REFUNDED" && !(order.status === "PENDING" && status === "CANCELLED"),
  );

  return (
    <AdminShell checking={checking}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-h2 text-ink font-serif">{order.orderNumber}</h1>
            <p className="text-13.5 text-secondary mt-1">
              {STATUS_LABELS[order.status]} · Placed {new Date(order.placedAt).toLocaleString()}
            </p>
          </div>
        </div>

        {error ? <p className="text-13.5 text-clay-deep">{error}</p> : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-container border-rule bg-surface p-card border">
            <h2 className="text-h4 text-ink font-serif">Customer</h2>
            <dl className="text-13.5 mt-4 flex flex-col gap-2">
              <Row label="Name" value={order.shipping.fullName} />
              <Row label="Email" value={order.customerEmail} />
              <Row label="Phone" value={order.shipping.phone} />
              <Row
                label="Address"
                value={`${order.shipping.address}, ${order.shipping.city}, ${order.shipping.region}`}
              />
              {order.customerNote ? <Row label="Customer note" value={order.customerNote} /> : null}
            </dl>
          </section>

          <section className="rounded-container border-rule bg-surface p-card border">
            <h2 className="text-h4 text-ink font-serif">Payment</h2>
            <dl className="text-13.5 mt-4 flex flex-col gap-2">
              <Row label="Method" value={order.paymentMethod} />
              {order.paymentProvider ? <Row label="Wallet" value={order.paymentProvider} /> : null}
              <Row label="Total" value={formatMoney(order.totalCents, "en-GB", order.currency)} />
              {order.senderNumber ? <Row label="Sent from" value={order.senderNumber} /> : null}
              <Row label="Transaction ID" value={order.transactionId ?? "No receipt on file"} />
            </dl>

            {/* Present on load, before anyone presses anything. The old panel
                said nothing about a receipt until an admin ran a check, which
                meant the duplicate case — the one that needs no gateway to
                detect — was invisible right up to the moment of confirming. */}
            {order.paymentMethod === "manual-transfer" ? (
              <div className="border-rule mt-4 flex flex-col gap-2 border-t pt-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-13.5 text-muted">Receipt</span>
                  <ReceiptBadge receipt={order.receipt} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-13.5 text-muted">Gateway</span>
                  <VerificationBadge verification={order.verification} />
                </div>

                {order.receipt.claimedByOrderNumber ? (
                  <Notice tone="error" className="mt-1">
                    <p>
                      <strong className="text-clay font-semibold">Duplicate receipt.</strong> This
                      transaction ID is already recorded against order{" "}
                      <Link
                        href={`/${locale}/admin/orders/${order.receipt.claimedByOrderNumber}`}
                        className="text-clay hover:text-clay-deep underline"
                      >
                        {order.receipt.claimedByOrderNumber}
                      </Link>
                      . Confirming payment here is blocked unless you give a reason to override.
                    </p>
                  </Notice>
                ) : null}
              </div>
            ) : null}

            {order.paymentMethod === "manual-transfer" ? (
              <div className="mt-4">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={verifying}
                  onClick={() => void verify()}
                >
                  Verify transaction
                </Button>
                <div aria-live="polite" aria-busy={verifying}>
                  {verifying ? (
                    <p className="text-13.5 text-secondary mt-2">Checking the gateway…</p>
                  ) : verifyResult ? (
                    <VerifyResult result={verifyResult} currency={order.currency} />
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* The sequence, not just the latest. A receipt that was NOT_FOUND
                at 09:12 and MATCHED at 11:40 is an SMS that arrived late —
                which is normal, and looks like nothing at all if only the last
                check is kept. */}
            {order.verifications.length > 0 ? (
              <details className="mt-4">
                <summary className="text-13.5 text-secondary hover:text-ink cursor-pointer">
                  Verification history ({order.verifications.length})
                </summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {order.verifications.map((record, index) => (
                    <li key={index} className="text-13.5 text-secondary">
                      {new Date(record.checkedAt).toLocaleString()} · {record.outcome}
                      {record.paidCents !== undefined
                        ? ` · ${formatMoney(record.paidCents, "en-GB", order.currency)}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {order.payments.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-1">
                {order.payments.map((payment, index) => (
                  <li key={index} className="text-13.5 text-secondary">
                    {payment.provider} · {formatMoney(payment.amountCents, "en-GB", order.currency)} ·{" "}
                    {payment.status} · {new Date(payment.recordedAt).toLocaleString()}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        <section className="rounded-container border-rule bg-surface overflow-x-auto border">
          <table className="text-13.5 w-full min-w-[560px] text-left">
            <thead>
              <tr className="border-rule text-caption text-muted border-b uppercase">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Qty</th>
                <th className="px-4 py-3 font-medium">Unit price</th>
                <th className="px-4 py-3 font-medium">Line total</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line, index) => (
                <tr key={index} className="border-rule/60 border-b">
                  <td className="text-ink px-4 py-3">{line.title}</td>
                  <td className="text-secondary px-4 py-3">{line.quantity}</td>
                  <td className="text-secondary px-4 py-3">
                    {formatMoney(line.unitPriceCents, "en-GB", order.currency)}
                  </td>
                  <td className="text-ink px-4 py-3">
                    {formatMoney(line.lineTotalCents, "en-GB", order.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {order.status !== "CANCELLED" && order.status !== "REFUNDED" ? (
          <section className="rounded-container border-rule bg-surface p-card border">
            <h2 className="text-h4 text-ink font-serif">
              {order.status === "PENDING" ? "Review" : "Update status"}
            </h2>

            <Textarea
              label="Note (shows on the customer's tracking page)"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              className="mt-3"
            />

            {/* Only rendered when there is actually a duplicate to override.
                An always-present "override" box is an invitation to fill it
                in, and this is a control that should be awkward to reach for. */}
            {order.receipt.state === "DUPLICATE" ? (
              <Textarea
                label={`Reason for overriding the duplicate receipt (also on ${order.receipt.claimedByOrderNumber})`}
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                rows={2}
                className="mt-3"
                error={
                  overrideReason.trim().length > 0 && overrideReason.trim().length < 15
                    ? "Explain why this duplicate receipt is legitimate."
                    : undefined
                }
              />
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {order.status === "PENDING" ? (
                <>
                  <Button type="button" loading={busy} onClick={() => void accept()}>
                    Accept
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    loading={busy}
                    onClick={() => void reject()}
                  >
                    Reject
                  </Button>
                </>
              ) : (
                otherTransitions.map((status) => (
                  <Button
                    key={status}
                    type="button"
                    variant="secondary"
                    loading={busy}
                    onClick={() => void moveTo(status)}
                  >
                    Mark as {STATUS_LABELS[status]}
                  </Button>
                ))
              )}
            </div>
          </section>
        ) : null}

        {canRefund ? (
          <section className="rounded-container border-rule bg-surface p-card border">
            <h2 className="text-h4 text-ink font-serif">Refund</h2>
            <p className="text-13.5 text-secondary mt-1">
              Records a refund issued out of band. Does not move money.
              {order.releasesStockOnCancel ? " Returns stock to the shelf." : ""}
            </p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
              <input
                type="number"
                min="0"
                step="0.01"
                value={refundAmount}
                onChange={(event) => setRefundAmount(event.target.value)}
                placeholder="Amount"
                className="rounded-control border-rule bg-page text-13.5 text-ink w-32 border px-3 py-2"
              />
              <input
                value={refundReason}
                onChange={(event) => setRefundReason(event.target.value)}
                placeholder="Reason"
                className="rounded-control border-rule bg-page text-13.5 text-ink flex-1 border px-3 py-2"
              />
              <Button type="button" variant="secondary" loading={busy} onClick={() => void refund()}>
                Record refund
              </Button>
            </div>
          </section>
        ) : null}

        <section className="rounded-container border-rule bg-surface p-card border">
          <h2 className="text-h4 text-ink font-serif">Internal note</h2>
          <p className="text-13.5 text-secondary mt-1">Staff-only — never shown to the customer.</p>
          <Textarea
            value={internalNote}
            onChange={(event) => {
              setInternalNote(event.target.value);
              setInternalNoteSaved(false);
            }}
            rows={3}
            className="mt-3"
          />
          <div className="mt-3 flex items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => void saveInternalNote()}>
              Save note
            </Button>
            {internalNoteSaved ? <span className="text-13.5 text-secondary">Saved.</span> : null}
          </div>
        </section>

        <section className="rounded-container border-rule bg-surface p-card border">
          <h2 className="text-h4 text-ink font-serif">Timeline</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {order.timeline.map((event, index) => (
              <li key={index} className="border-rule/60 text-13.5 border-b pb-3 last:border-0">
                <span className="text-ink font-medium">{STATUS_LABELS[event.status]}</span>
                <span className="text-caption text-muted ml-2">
                  {new Date(event.occurredAt).toLocaleString()}
                </span>
                {event.note ? <p className="text-secondary mt-1">{event.note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AdminShell>
  );
}

/**
 * How each outcome is presented. The gateway's verdict is the heading, the
 * server's sentence is the body, and the evidence follows as rows — because
 * "Underpaid" alone is not actionable, but "৳900 received, ৳1,200 expected"
 * is. Tone follows the design system: no green, success is ink, only a real
 * problem with the money gets the clay rule.
 */
const VERIFY_OUTCOMES = {
  MATCHED: { label: "Matched", tone: "info", heading: "text-ink" },
  UNDERPAID: { label: "Underpaid", tone: "error", heading: "text-clay" },
  NOT_FOUND: { label: "Not found yet", tone: "info", heading: "text-clay-deep" },
  UNAVAILABLE: { label: "Could not check", tone: "info", heading: "text-clay-deep" },
  NO_RECEIPT: { label: "No receipt on file", tone: "info", heading: "text-clay-deep" },
} as const satisfies Record<string, { label: string; tone: "info" | "error"; heading: string }>;

function VerifyResult({
  result,
  currency,
}: {
  result: AdminOrderVerifyPaymentResult;
  currency: string;
}) {
  const { record, summary } = result;
  const outcome = VERIFY_OUTCOMES[record.outcome];

  return (
    <Notice tone={outcome.tone} className="mt-3">
      <p>
        <strong className={`${outcome.heading} font-semibold`}>{outcome.label}.</strong> {summary}
      </p>

      {record.outcome !== "NO_RECEIPT" ? (
        <dl className="text-13.5 border-rule mt-3 flex flex-col gap-2 border-t pt-3">
          <Row label="Transaction ID" value={record.transactionId} />
          {record.provider ? <Row label="Wallet" value={record.provider} /> : null}
          {record.paidCents !== undefined ? (
            <Row label="Received" value={formatMoney(record.paidCents, "en-GB", currency)} />
          ) : null}
          {record.expectedCents !== undefined ? (
            <Row label="Expected" value={formatMoney(record.expectedCents, "en-GB", currency)} />
          ) : null}
          {record.receivedAt ? (
            <Row label="Paid at" value={new Date(record.receivedAt).toLocaleString()} />
          ) : null}
          <Row label="Checked at" value={new Date(record.checkedAt).toLocaleString()} />
        </dl>
      ) : null}
    </Notice>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink text-right">{value}</dd>
    </div>
  );
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof AdminApiError ? error.message : fallback;
}
