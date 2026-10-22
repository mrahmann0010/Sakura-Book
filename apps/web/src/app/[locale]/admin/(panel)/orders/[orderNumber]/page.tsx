"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type {
  AdminOrderDetail,
  AdminOrderVerifyPaymentResult,
  OrderStatus,
} from "@sakura/contracts";

import { ReceiptBadge, VerificationBadge } from "@/components/admin/payment-safety";
import { AdminDetailSkeleton } from "@/components/admin/skeletons";
import { Button, Input, Notice, Textarea } from "@/components/ui";
import {
  AdminApiError,
  confirmAdminOrderPayment,
  editAdminOrderTransactionId,
  getAdminOrder,
  recordAdminOrderRefund,
  reopenAdminOrder,
  revertAdminOrderPayment,
  setAdminOrderNote,
  transitionAdminOrder,
  verifyAdminOrderPayment,
} from "@/lib/api/admin";
import { useAdminRole } from "@/lib/admin-role";
import { formatMoney } from "@/lib/money";

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
  /* A packer's copy of this page shows what the parcel needs and leaves out
     the payment desk: the API has already blanked those fields and refuses
     those actions for them, so drawing the controls would only draw errors. */
  const isPacker = useAdminRole() === "FULFILLMENT";
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

  /**
   * The gateway could not claim the payment (SMS not in, gateway down, or a
   * refusal staff can judge) and the API asked for a reason before granting.
   * Holds the API's sentence; the reason box only appears once this is set,
   * for the same reason the duplicate box only appears on a duplicate.
   */
  const [gatewayBlock, setGatewayBlock] = useState<string | null>(null);
  const [gatewayReason, setGatewayReason] = useState("");

  /**
   * The payment is short of the total and the API asked for a reason before
   * taking it. Same shape as the gateway block: the box appears only once the
   * API has said the payment is short.
   */
  const [shortfallBlock, setShortfallBlock] = useState<string | null>(null);
  const [shortfallReason, setShortfallReason] = useState("");

  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<AdminOrderVerifyPaymentResult | null>(null);

  const [internalNote, setInternalNote] = useState("");
  const [internalNoteSaved, setInternalNoteSaved] = useState(false);

  /**
   * The reason for withdrawing a confirmation, and whether the control is
   * open at all.
   *
   * Collapsed behind a link rather than sitting on the page as a button, for
   * the same reason the duplicate-receipt box only appears when there is a
   * duplicate: this walks an order backwards, and it should take a deliberate
   * two steps to reach rather than sitting one mis-click away from "Mark as
   * Processing".
   */
  const [reverting, setReverting] = useState(false);
  const [revertReason, setRevertReason] = useState("");

  /** The reason for reopening a rejected order — collapsed the same way. */
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  /** Correcting the transaction ID the customer typed — collapsed until asked for. */
  const [editingTrx, setEditingTrx] = useState(false);
  const [trxValue, setTrxValue] = useState("");
  const [trxReason, setTrxReason] = useState("");
  const [savingTrx, setSavingTrx] = useState(false);

  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

  useEffect(() => {
    let cancelled = false;

    getAdminOrder(orderNumber)
      .then((detail) => {
        if (cancelled) return;
        setOrder(detail);
        setInternalNote(detail.internalNote ?? "");
        setVerifyResult(null);
        setGatewayBlock(null);
        setGatewayReason("");
        setShortfallBlock(null);
        setShortfallReason("");
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err, "Could not load this order."));
      });

    return () => {
      cancelled = true;
    };
  }, [orderNumber]);

  /** @returns whether the action succeeded, for callers with their own form to clear. */
  async function run(action: () => Promise<AdminOrderDetail>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      setOrder(updated);
      setNote("");
      setGatewayBlock(null);
      setGatewayReason("");
      setShortfallBlock(null);
      setShortfallReason("");
      return true;
    } catch (err) {
      if (err instanceof AdminApiError && err.code === "PAYMENT_NOT_CLAIMED") {
        // Not a failure to show in red: the next step is the reason box.
        setGatewayBlock(err.message);
        return false;
      }
      if (err instanceof AdminApiError && err.code === "PAYMENT_UNDERPAID") {
        setShortfallBlock(err.message);
        return false;
      }
      setError(messageOf(err, "That action failed."));
      return false;
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
    const gatewayClaimOverride = gatewayBlock ? gatewayReason.trim() || undefined : undefined;
    const shortfallOverride = shortfallBlock ? shortfallReason.trim() || undefined : undefined;

    if (order.paymentMethod === "manual-transfer") {
      await run(() =>
        confirmAdminOrderPayment(orderNumber, {
          // The order total even when a shortfall is accepted: the payment
          // row always equals its order, and the shortfall is recorded beside it.
          amountCents: order.totalCents,
          reference: order.transactionId ?? undefined,
          note: note || undefined,
          duplicateReceiptOverride,
          gatewayClaimOverride,
          shortfallOverride,
        }),
      );
    } else {
      await run(() =>
        transitionAdminOrder(orderNumber, {
          status: "PAYMENT_CONFIRMED",
          note: note || "Accepted by admin",
          duplicateReceiptOverride,
          gatewayClaimOverride,
          shortfallOverride,
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
        gatewayClaimOverride:
          status === "PAYMENT_CONFIRMED" && gatewayBlock
            ? gatewayReason.trim() || undefined
            : undefined,
        shortfallOverride:
          status === "PAYMENT_CONFIRMED" && shortfallBlock
            ? shortfallReason.trim() || undefined
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
      const result = await verifyAdminOrderPayment(orderNumber);
      setVerifyResult(result);
      // A successful claim on a pending order confirms it; show the new status.
      if (result.confirmed) {
        setOrder(await getAdminOrder(orderNumber));
        setGatewayBlock(null);
        setShortfallBlock(null);
      }
    } catch (err) {
      setError(messageOf(err, "Could not check this payment."));
    } finally {
      setVerifying(false);
    }
  }

  async function saveTransactionId() {
    if (trxValue.trim().length < 4) {
      setError("Enter the transaction ID from the payment SMS.");
      return;
    }
    if (trxReason.trim().length < 10) {
      setError("Say why the transaction ID is being changed.");
      return;
    }

    setSavingTrx(true);
    setError(null);
    setVerifyResult(null);
    try {
      const { order: updated, check } = await editAdminOrderTransactionId(orderNumber, {
        transactionId: trxValue,
        reason: trxReason,
      });
      setOrder(updated);
      setGatewayBlock(null);
      setVerifyResult(check);
      setEditingTrx(false);
      setTrxValue("");
      setTrxReason("");
    } catch (err) {
      // The typed values stay, so a refusal can be fixed rather than retyped.
      setError(messageOf(err, "Could not change the transaction ID."));
    } finally {
      setSavingTrx(false);
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

  async function revertPayment() {
    const reason = revertReason.trim();
    if (reason.length < 15) {
      setError("Explain why this payment confirmation is being withdrawn.");
      return;
    }

    const ok = await run(() => revertAdminOrderPayment(orderNumber, { reason }));

    // Closed and cleared only on success. A failed revert that also threw away
    // the typed reason would mean writing it out again just to find out it
    // still fails — and the likeliest failure here is a STAFF token being told
    // this is ADMIN-only, where the reason is still wanted, by someone else.
    if (!ok) return;

    setReverting(false);
    setRevertReason("");
  }

  async function reopen() {
    const reason = reopenReason.trim();
    if (reason.length < 10) {
      setError("Say why this order is being reopened.");
      return;
    }

    const ok = await run(() => reopenAdminOrder(orderNumber, { reason }));
    if (!ok) return;

    setReopening(false);
    setReopenReason("");
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
    return <p className="text-13.5 text-clay-deep">{error}</p>;
  }

  /* Not `null`: this is the whole content area, and an empty one for the
     length of a round trip is the exact failure this replaces. */
  if (!order) {
    return <AdminDetailSkeleton />;
  }

  const canRefund = order.allowedTransitions.includes("REFUNDED");
  const otherTransitions = order.allowedTransitions.filter(
    (status) =>
      status !== "REFUNDED" &&
      !(order.status === "PENDING" && status === "CANCELLED") &&
      // The machine allows PAYMENT_CONFIRMED → PENDING, but it is not an
      // ordinary "mark as" move: it withdraws the payment record too, and the
      // API refuses it through the transition endpoint. It has its own control
      // below, which asks for the reason that one requires.
      status !== "PENDING",
  );

  /** Only from a standing confirmation — see the machine's one backward edge. */
  const canRevertPayment = order.allowedTransitions.includes("PENDING");

  return (
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
            {order.customerEmail ? <Row label="Email" value={order.customerEmail} /> : null}
            <Row label="Phone" value={order.shipping.phone} />
            {order.shipping.secondaryPhone ? (
              <Row label="Secondary phone" value={order.shipping.secondaryPhone} />
            ) : null}
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
            {/* Labelled for the packer by what they do with it: on a cash order
                it is the figure the courier collects and the label must carry. */}
            <Row
              label={
                isPacker && order.paymentMethod === "cash-on-delivery"
                  ? "Collect on delivery"
                  : "Total"
              }
              value={formatMoney(order.totalCents, "en-GB", order.currency)}
            />
            {order.senderNumber ? <Row label="Sent from" value={order.senderNumber} /> : null}
            {isPacker ? null : (
              <Row label="Transaction ID" value={order.transactionId ?? "No receipt on file"} />
            )}
          </dl>

          {/* For a customer who typed "TrxID" in front of the ID, or mistyped
                it, and messaged the shop. Pending only, and not once the order
                holds a payment at the gateway — the API refuses both anyway. */}
          {order.paymentMethod === "manual-transfer" &&
          order.status === "PENDING" &&
          !order.gatewayClaim &&
          !isPacker ? (
            editingTrx ? (
              <div className="border-rule mt-4 flex flex-col gap-3 border-t pt-4">
                <Input
                  label="Correct transaction ID"
                  hint="As it appears in the payment SMS. A leading “TrxID” is removed."
                  value={trxValue}
                  onChange={(event) => setTrxValue(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
                <Textarea
                  label="Why is it being changed? (staff-only, goes to the audit log)"
                  value={trxReason}
                  onChange={(event) => setTrxReason(event.target.value)}
                  rows={2}
                  error={
                    trxReason.trim().length > 0 && trxReason.trim().length < 10
                      ? "Say why the transaction ID is being changed."
                      : undefined
                  }
                />
                <p className="text-caption text-muted">
                  Saving claims the payment under the new ID and confirms the order if it is there.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    loading={savingTrx}
                    onClick={() => void saveTransactionId()}
                  >
                    Save & check
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setEditingTrx(false);
                      setTrxValue("");
                      setTrxReason("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="text-13.5 text-secondary hover:text-ink mt-2 underline"
                onClick={() => {
                  setEditingTrx(true);
                  setTrxValue(order.transactionId ?? "");
                }}
              >
                Edit transaction ID
              </button>
            )
          ) : null}

          {/* Present on load, before anyone presses anything. The old panel
                said nothing about a receipt until an admin ran a check, which
                meant the duplicate case — the one that needs no gateway to
                detect — was invisible right up to the moment of confirming. */}
          {order.paymentMethod === "manual-transfer" && !isPacker ? (
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

          {order.gatewayClaim && order.gatewayClaim.underpaidCents > 0 && !isPacker ? (
            <Notice tone="info" className="mt-4">
              <p>
                <strong className="text-ink font-semibold">Accepted short.</strong> The customer
                sent {formatMoney(order.gatewayClaim.underpaidCents, "en-GB", order.currency)} less
                than the total, and staff accepted it. The reason is in the audit log.
              </p>
            </Notice>
          ) : null}

          {order.gatewayClaim && order.gatewayClaim.overpaidCents > 0 && !isPacker ? (
            <Notice tone="info" className="mt-4">
              <p>
                <strong className="text-ink font-semibold">Overpaid.</strong> The customer sent{" "}
                {formatMoney(order.gatewayClaim.overpaidCents, "en-GB", order.currency)} more than
                the total. Refund or credit the difference.
              </p>
            </Notice>
          ) : null}

          {/* Only a gateway admin can release a claim; this app cannot. Until
                someone does, the customer cannot use this receipt again. */}
          {order.gatewayClaim &&
          (order.status === "CANCELLED" || order.status === "REFUNDED") &&
          !isPacker ? (
            <Notice tone="error" className="mt-4">
              <p>
                <strong className="text-clay font-semibold">Release the payment.</strong> This order
                still holds payment{" "}
                <span className="font-mono">{order.gatewayClaim.transactionId}</span> at the payment
                gateway. Release it there (Claims → Release) so the customer can use the receipt
                again.
              </p>
            </Notice>
          ) : null}

          {order.paymentMethod === "manual-transfer" &&
          order.status !== "CANCELLED" &&
          order.status !== "REFUNDED" &&
          !isPacker ? (
            <div className="mt-4">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={verifying}
                onClick={() => void verify()}
              >
                {order.status === "PENDING" ? "Check & confirm" : "Check payment"}
              </Button>
              <p className="text-caption text-muted mt-1">
                Claims the payment at the gateway
                {order.status === "PENDING" ? " and confirms the order if it is there" : ""}.
              </p>
              <div aria-live="polite" aria-busy={verifying}>
                {verifying ? (
                  <p className="text-13.5 text-secondary mt-2">Asking the gateway…</p>
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
                    {record.claimKey ? (
                      <span className="text-muted font-mono"> · {record.claimKey}</span>
                    ) : null}
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
            <tr className="border-rule-strong text-caption text-muted border-b uppercase">
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Qty</th>
              <th className="px-4 py-3 font-medium">Unit price</th>
              <th className="px-4 py-3 font-medium">Line total</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line, index) => (
              <tr key={index} className="border-rule border-b last:border-0">
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
          {gatewayBlock ? (
            <>
              <Notice tone="info" className="mt-3">
                <p>{gatewayBlock}</p>
              </Notice>
              <Textarea
                label="How do you know this payment arrived? (staff-only, goes to the audit log)"
                value={gatewayReason}
                onChange={(event) => setGatewayReason(event.target.value)}
                rows={2}
                className="mt-3"
                error={
                  gatewayReason.trim().length > 0 && gatewayReason.trim().length < 15
                    ? "Explain how you know this payment arrived."
                    : undefined
                }
              />
            </>
          ) : null}

          {shortfallBlock ? (
            <>
              <Notice tone="info" className="mt-3">
                <p>{shortfallBlock}</p>
              </Notice>
              <Textarea
                label="Why accept less than the order total? (staff-only, goes to the audit log)"
                value={shortfallReason}
                onChange={(event) => setShortfallReason(event.target.value)}
                rows={2}
                className="mt-3"
                error={
                  shortfallReason.trim().length > 0 && shortfallReason.trim().length < 15
                    ? "Explain why you are accepting less than the order total."
                    : undefined
                }
              />
            </>
          ) : null}

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
                  {shortfallBlock
                    ? "Accept short payment"
                    : gatewayBlock
                      ? "Accept anyway"
                      : "Accept"}
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

      {order.status === "CANCELLED" ? (
        <section className="rounded-container border-rule bg-surface p-card border">
          <h2 className="text-h4 text-ink font-serif">Rejected by mistake?</h2>
          {order.reopen.allowed ? (
            <>
              <p className="text-13.5 text-secondary mt-1">
                Puts the order back to Pending so the payment can be checked again. The copies are
                taken off the shelf again, and the transaction ID is claimed again for this order.
              </p>

              {reopening ? (
                <>
                  <Textarea
                    label="Why is this being reopened? (staff-only, goes to the audit log)"
                    value={reopenReason}
                    onChange={(event) => setReopenReason(event.target.value)}
                    rows={2}
                    className="mt-3"
                    error={
                      reopenReason.trim().length > 0 && reopenReason.trim().length < 10
                        ? "Say why this order is being reopened."
                        : undefined
                    }
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" loading={busy} onClick={() => void reopen()}>
                      Reopen order
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setReopening(false);
                        setReopenReason("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <div className="mt-3">
                  <Button type="button" variant="secondary" onClick={() => setReopening(true)}>
                    Reopen order
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="text-13.5 text-secondary mt-1">
              This order cannot be reopened. {order.reopen.blockedReason}
            </p>
          )}
        </section>
      ) : null}

      {canRevertPayment ? (
        <section className="rounded-container border-rule bg-surface p-card border">
          <h2 className="text-h4 text-ink font-serif">Confirmed by mistake?</h2>
          <p className="text-13.5 text-secondary mt-1">
            Withdraws the confirmation and puts the order back to Pending. The payment record is
            voided so a real payment can be confirmed later, and the sale comes back off the books.
            Stock stays reserved for this customer.
          </p>
          {/* Said plainly, because it is the one consequence the button
                cannot undo and the one an operator will not think of. */}
          <p className="text-13.5 text-clay-deep mt-2">
            The customer was emailed when this order was confirmed. That email cannot be unsent —
            call them.
          </p>

          {reverting ? (
            <>
              <Textarea
                label="Why is this being withdrawn? (staff-only, goes to the audit log)"
                value={revertReason}
                onChange={(event) => setRevertReason(event.target.value)}
                rows={2}
                className="mt-3"
                error={
                  revertReason.trim().length > 0 && revertReason.trim().length < 15
                    ? "Explain why this payment confirmation is being withdrawn."
                    : undefined
                }
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  loading={busy}
                  onClick={() => void revertPayment()}
                >
                  Withdraw confirmation
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setReverting(false);
                    setRevertReason("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="mt-3">
              <Button type="button" variant="secondary" onClick={() => setReverting(true)}>
                Revert payment confirmation
              </Button>
            </div>
          )}
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
            <li key={index} className="border-rule text-13.5 border-b pb-3 last:border-0">
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
  CLAIMED: { label: "Claimed", tone: "info", heading: "text-ink" },
  PENDING_ARRIVAL: { label: "Payment SMS not in yet", tone: "info", heading: "text-clay-deep" },
  UNDERPAID: { label: "Underpaid", tone: "error", heading: "text-clay" },
  ALREADY_CLAIMED: { label: "Already spent elsewhere", tone: "error", heading: "text-clay" },
  RELEASED: { label: "Claim released", tone: "info", heading: "text-clay-deep" },
  REJECTED: { label: "Rejected by the gateway", tone: "error", heading: "text-clay" },
  MISCONFIGURED: { label: "Gateway setup error", tone: "error", heading: "text-clay" },
  UNAVAILABLE: { label: "Could not check", tone: "info", heading: "text-clay-deep" },
  MATCHED: { label: "Matched", tone: "info", heading: "text-ink" },
  NOT_FOUND: { label: "Not found yet", tone: "info", heading: "text-clay-deep" },
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
          {record.overpaidCents ? (
            <Row label="Overpaid" value={formatMoney(record.overpaidCents, "en-GB", currency)} />
          ) : null}
          {record.underpaidCents ? (
            <Row
              label="Short (accepted)"
              value={formatMoney(record.underpaidCents, "en-GB", currency)}
            />
          ) : null}
          {record.receivedAt ? (
            <Row label="Paid at" value={new Date(record.receivedAt).toLocaleString()} />
          ) : null}
          {record.claimedAt ? (
            <Row label="Claimed at" value={new Date(record.claimedAt).toLocaleString()} />
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
