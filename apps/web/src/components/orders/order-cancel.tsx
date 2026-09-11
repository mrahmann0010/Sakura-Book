"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Order } from "@sakura/contracts";

import { Button, Input, Modal, Notice, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { cancelOrder } from "@/lib/api/orders";

/* --------------------------------------------------------------------------
   Self-service cancellation.

   BUILT BUT NOT MOUNTED. Nothing renders this yet, on purpose — the shop is
   not ready to take cancellations without a person in the loop, so the entry
   point stays off until someone decides otherwise. Everything below is real:
   `POST /orders/cancel` is live, the state machine already refuses a shipped
   order with a 422 naming what was allowed, and cancelling returns stock to
   the shelf. Switching it on is a matter of rendering <OrderCancel> from
   OrderDetailCard when `cancellable(order)`, and adding nothing else.

   Two-factor by design, unlike lookup: this one *writes*, so it needs the
   order number the customer is already looking at plus the email they ordered
   with. A guessed order number alone must not be able to cancel a stranger's
   parcel — see the comment on orderCancelRequestSchema. A mismatch comes back
   as a 404, never a 403, so it cannot be used to confirm an order exists.
   -------------------------------------------------------------------------- */

/**
 * Whether an order can still be stopped. Mirrors the server's state machine
 * (CANCELLABLE_STATUSES in order-status.machine.ts) — once it is with the
 * courier the answer is a refund, which moves money and is not self-service.
 *
 * The server is the authority; this only decides whether to offer the button,
 * so a drift here shows a button that fails politely rather than one that
 * cancels something it should not.
 */
export function cancellable(order: Order): boolean {
  return (
    order.status === "PENDING" ||
    order.status === "PAYMENT_CONFIRMED" ||
    order.status === "PROCESSING"
  );
}

export function OrderCancel({
  order,
  onCancelled,
}: {
  order: Order;
  /** Hands back the order in its cancelled state, so the page re-renders from
      the response rather than guessing and refetching. */
  onCancelled: (cancelled: Order) => void;
}) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);

    try {
      const cancelled = await cancelOrder({
        orderNumber: order.orderNumber,
        email: email.trim(),
        reason: reason.trim() || undefined,
      });

      onCancelled(cancelled);
      setOpen(false);
    } catch (err) {
      /* A wrong email and a non-existent order are the same 404 by design, so
         there is one message for both. Anything else falls through to the
         server's own wording. */
      setError(
        err instanceof ApiError && err.status === 404
          ? t("orders.cancel.mismatch")
          : err instanceof ApiError
            ? err.message
            : t("orders.cancel.failed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
        {t("orders.cancel.action")}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={t("orders.cancel.title")}>
        <p className="text-body">{t("orders.cancel.description")}</p>

        <div className="mt-6 flex flex-col gap-5">
          <Input
            label={t("checkout.shipping.email")}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            hint={t("orders.cancel.emailHint")}
          />
          <Textarea
            label={t("orders.cancel.reasonLabel")}
            value={reason}
            maxLength={280}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            hint={t("orders.cancel.reasonHint")}
          />
        </div>

        {error ? (
          <Notice tone="error" className="mt-5">
            {error}
          </Notice>
        ) : null}

        <div className="mt-7 flex flex-wrap gap-3">
          <Button
            type="button"
            variant="destructive"
            disabled={!email.trim()}
            loading={submitting}
            loadingLabel={t("orders.cancel.submitting")}
            onClick={() => void submit()}
          >
            {t("orders.cancel.confirm")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t("orders.cancel.keep")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
