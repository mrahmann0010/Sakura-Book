"use client";

import { useTranslation } from "react-i18next";
import { COD_CONFIRMATION_HOURS, type Order } from "@sakura/contracts";

import { Card, LinkButton, MessengerIcon } from "@/components/ui";
import { messengerDraftUrl } from "@/lib/contact";

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
 * order is not going anywhere yet has been told too late. The draft message
 * carries the order number, so nobody has to copy it across.
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
  const draft = t("checkout.placed.cod.draft", { orderNumber: order.orderNumber });

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
      <LinkButton
        href={messengerDraftUrl(draft)}
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
