"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Order, OrderStatus } from "@sakura/contracts";

import { Button, Card, Input, Notice, OrderId } from "@/components/ui";
import { Shell } from "@/components/layout";
import type { Locale } from "@/i18n/settings";
import { formatDate } from "@/lib/dates";
import { formatMoney, intlLocale } from "@/lib/money";
import { lookupOrder } from "@/lib/api/orders";
import { routes } from "@/lib/routes";

import { toOrderProgressStep } from "./order-status";

/* --------------------------------------------------------------------------
   Track order — no accounts, and no order-ID-plus-email pairing either. Any
   one of order ID, email, or phone is enough: an order ID goes straight to
   that one order, while email/phone return every order matching either one,
   since a returning customer may have placed more than one.

   A match — the single result, or one picked from several — is a redirect to
   /orders/[orderNumber], not an inline card. That gives a returning shopper a
   real, sharable/bookmarkable/back-button-able URL for the one order they
   care about, and keeps this page doing one job: finding the order number.
   -------------------------------------------------------------------------- */

/** Short status word for the picker list. */
function pickerStatusKey(status: OrderStatus): string {
  const step = toOrderProgressStep(status);
  if (step)
    return `orders.progress.${step === "shipped" && status === "DELIVERED" ? "delivered" : step}`;
  return `orders.status.${status === "CANCELLED" ? "cancelled" : "refunded"}`;
}

export function TrackOrderView() {
  const { t } = useTranslation();
  const router = useRouter();
  const { locale: localeParam } = useParams<{ locale: string }>();
  const locale = (localeParam ?? "en") as Locale;
  const path = routes(locale);
  const money = intlLocale(locale);

  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [results, setResults] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = orderId.trim() || email.trim() || phone.trim();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setResults(null);
    setLoading(true);

    try {
      const orders = await lookupOrder({ orderNumber: orderId, email, phone });

      if (orders.length === 1) {
        router.push(path.order(orders[0].orderNumber));
        return;
      }

      setResults(orders);
    } catch {
      setError(t("orders.track.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell className="max-w-measure py-14 lg:py-20">
      <p className="eyebrow">{t("orders.track.eyebrow")}</p>
      <h1 className="text-36 lg:text-44 text-ink mt-4 font-serif leading-tight">
        {t("orders.track.title")}
      </h1>
      <p className="text-body mt-5">{t("orders.track.description")}</p>

      <form onSubmit={(event) => void handleSubmit(event)} className="mt-8 flex flex-col gap-5">
        <Input
          label={t("orders.track.orderId")}
          placeholder={t("orders.track.orderIdPlaceholder")}
          value={orderId}
          onChange={(event) => setOrderId(event.target.value)}
        />
        <Input
          label={t("checkout.shipping.email")}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label={t("checkout.shipping.phone")}
          type="tel"
          placeholder="01XXXXXXXXX"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        <Button
          type="submit"
          className="self-start"
          disabled={!canSubmit}
          loading={loading}
          loadingLabel={t("orders.track.searching")}
        >
          {t("orders.track.submit")}
        </Button>
      </form>

      {error ? (
        <Notice tone="error" className="mt-8">
          {error}
        </Notice>
      ) : null}

      {results && results.length === 0 ? (
        <Notice tone="error" className="mt-8">
          {t("orders.track.noMatch")}
        </Notice>
      ) : null}

      {results && results.length > 1 ? (
        <Card variant="tint" padding="roomy" className="mt-10">
          <p className="eyebrow">{t("orders.track.found", { count: results.length })}</p>
          <ul className="mt-4 flex flex-col gap-1">
            {results.map((order) => (
              <li key={order.orderNumber}>
                <button
                  type="button"
                  onClick={() => router.push(path.order(order.orderNumber))}
                  className="hairline text-secondary hover:text-ink flex w-full items-center justify-between gap-4 py-3 text-left transition-colors"
                >
                  <span>
                    <OrderId>{order.orderNumber}</OrderId>
                    <span className="text-caption text-muted ml-3">
                      {formatDate(order.placedAt, locale)}
                    </span>
                  </span>
                  <span className="text-13.5 flex items-center gap-4">
                    {t(pickerStatusKey(order.status))}
                    <span>{formatMoney(order.totalCents, money, order.currency)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Shell>
  );
}
