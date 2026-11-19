"use client";

import { useTranslation } from "react-i18next";
import { COD_CONFIRMATION_HOURS, type Order } from "@sakura/contracts";

import { Card, CopyButton, LinkButton, MessengerIcon } from "@/components/ui";
import { messengerDraftUrl } from "@/lib/contact";

/**
 * The message a COD customer sends the shop to confirm their order.
 *
 * Always Bangla, whatever language the site is in: it is addressed to the
 * shop's team, who work the Messenger inbox in Bangla, not to the customer.
 * One fixed sentence with the order number in it, so every confirmation in
 * the inbox looks the same and the number is in the same place to search for.
 * Shown with a copy button as well as sent as the Messenger draft, because
 * the draft does not appear in every version of the app.
 */
export function codConfirmationMessage(orderNumber: string): string {
  return `আমি আমার ক্যাশ অন ডেলিভারি অর্ডার ${orderNumber} নিশ্চিত করতে চাই। অনুগ্রহ করে অনুমোদন দিন।`;
}

/** A cash-on-delivery order still waiting for the customer to get in touch. */
export function awaitingCodConfirmation(order: Order): boolean {
  return order.paymentMethod === "cash-on-delivery" && order.status === "PENDING";
}

/**
 * The one thing a COD shopper still has to do: message the shop's Facebook
 * page, so staff can check the order and start packing it.
 *
 * Above the receipt, not under it, because it is an instruction and the
 * receipt is a record — a shopper who scrolls past a receipt to find out the
 * order is not going anywhere yet has been told too late. The message to send
 * is written out with a copy button, and also typed into the Messenger draft.
 *
 * Shared with the tracking page, which shows the same step for as long as the
 * order is waiting.
 */
export function ConfirmCodOrder({
  order,
  nested = false,
  className,
}: {
  order: Order;
  /** Inside another tinted card (the tracking page): drawn on white so it reads as its own block. */
  nested?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const message = codConfirmationMessage(order.orderNumber);

  return (
    <Card variant={nested ? "surface" : "tint"} padding="roomy" className={className}>
      <p className="eyebrow">{t("checkout.placed.cod.eyebrow")}</p>
      <p className="text-h3 text-ink mt-3 font-serif leading-snug">
        {t("checkout.placed.cod.title")}
      </p>
      <p className="text-body mt-3">
        {t("checkout.placed.cod.body", {
          orderNumber: order.orderNumber,
          hours: COD_CONFIRMATION_HOURS,
        })}
      </p>
      <div className="border-rule bg-page mt-5 rounded-md border p-4">
        <div className="flex items-baseline justify-between gap-4">
          <p className="eyebrow">{t("checkout.placed.cod.messageLabel")}</p>
          <CopyButton value={message} />
        </div>
        <p lang="bn" className="text-body text-ink mt-2.5 select-all">
          {message}
        </p>
      </div>

      <LinkButton
        href={messengerDraftUrl(message)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5"
      >
        <MessengerIcon />
        {t("checkout.placed.cod.action")}
      </LinkButton>
    </Card>
  );
}
