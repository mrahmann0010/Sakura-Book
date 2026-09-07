"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { CollapsibleOrderRecap, OrderRecap, SummaryRow, type RecapLine } from "@/components/domain";
import { CheckoutProgress, PageHeader, RailLayout, Shell, StickyBar } from "@/components/layout";
import {
  Button,
  Card,
  CopyButton,
  LinkButton,
  Notice,
  OrderId,
  Skeleton,
  Stepper,
  Toast,
} from "@/components/ui";
import type { Locale } from "@/i18n/settings";
import { trackPurchase } from "@/lib/analytics";
import { ApiError } from "@/lib/api/client";
import { quoteCart } from "@/lib/api/cart";
import { placeOrder as placeOrderRequest } from "@/lib/api/orders";
import {
  checkoutDefaults,
  checkoutSchema,
  type AcceptedPaymentMethod,
  type CheckoutValues,
} from "@/lib/checkout";
import { cartFromQuote, priceCart, summaryLines, FREE_DELIVERY_THRESHOLD } from "@/lib/cart";
import { formatMoney, intlLocale } from "@/lib/money";
import { routes } from "@/lib/routes";

import { PaymentSection } from "./payment-section";
import {
  PaymentVerificationModal,
  type PaymentVerificationStatus,
} from "./payment-verification-modal";
import { ShippingFields } from "./shipping-fields";

/* --------------------------------------------------------------------------
   Checkout for a LOCKED waitlist invite — one reserved book, up to the
   number of copies it held, that cannot become a different order.

   Deliberately its own component rather than CheckoutView plus branches: the
   two share the delivery/payment form (ShippingFields, PaymentSection) and
   the recap presentation, but not the thing underneath it. CheckoutView's
   "cart" is Redux state a shopper edits; this one is the single book the
   invite reserved — no add, no remove, nothing here reads or writes the cart
   slice. An OPEN invite doesn't need any of this: it renders the ordinary
   CheckoutView with contact fields pre-filled instead.

   The one thing that does move is quantity, and it only moves downwards.
   `quantity` on the invite is a ceiling: someone who joined the waitlist for
   three copies and now wants two is still ordering what they were invited
   for, and refusing that sends them to place the smaller order without the
   invite — a sale kept, an entry that never closes as converted. Upwards is
   what the reservation exists to prevent, so the stepper's max is the
   reserved figure and its min is one. The API enforces the same window
   itself (CheckoutService.consumeInvite); this is the affordance, not the
   rule.

   `token` travels with the order and is spent by
   WaitlistInviteService.consume() in the same transaction that creates it —
   see CheckoutService.writeOrder.
   -------------------------------------------------------------------------- */

export function InviteCheckoutView({
  locale,
  token,
  bookId,
  quantity,
  prefill,
}: {
  locale: Locale;
  token: string;
  bookId: string;
  /** What the entry reserved — the most this order may contain, not the only figure. */
  quantity: number;
  prefill: Pick<CheckoutValues, "fullName" | "email" | "phone">;
}) {
  const { t } = useTranslation();
  const path = routes(locale);

  const [placedOrder, setPlacedOrder] = useState<{ id: string; email: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [verification, setVerification] = useState<PaymentVerificationStatus | null>(null);
  const [pendingOrder, setPendingOrder] = useState<{ id: string; email: string } | null>(null);
  const [step, setStep] = useState<"delivery" | "payment">("delivery");
  /* Starts at everything the invite held — the common case is ordering all of
     it, so the shopper only touches this to take fewer. */
  const [orderQuantity, setOrderQuantity] = useState(quantity);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    trigger,
    formState: { errors, isSubmitting, isSubmitted, isValid },
  } = useForm<CheckoutValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: { ...checkoutDefaults, ...prefill },
    mode: "onBlur",
  });

  const deliveryFields = ["fullName", "email", "phone", "address", "city", "region"] as const;

  const fieldLabels: Partial<Record<keyof CheckoutValues, string>> = {
    fullName: t("checkout.shipping.fullName"),
    email: t("checkout.shipping.email"),
    phone: t("checkout.shipping.phone"),
    address: t("checkout.shipping.address"),
    city: t("checkout.shipping.district"),
    region: t("checkout.shipping.division"),
    provider: t("checkout.payment.mobileMoneyLegend"),
    senderNumber: t("checkout.payment.senderNumber"),
    transactionId: t("checkout.payment.transactionId"),
  };

  function missingToast(names: readonly (keyof CheckoutValues)[]) {
    const labels = names.map((name) => fieldLabels[name] ?? name);
    if (labels.length === 0) return;
    const list = new Intl.ListFormat(intlLocale(locale), {
      style: "long",
      type: "conjunction",
    }).format(labels);
    setToast(t("checkout.missing", { fields: list }));
  }

  async function goToPayment() {
    const results = await Promise.all(
      deliveryFields.map(async (name) => [name, await trigger(name)] as const),
    );
    const missing = results.filter(([, ok]) => !ok).map(([name]) => name);

    if (missing.length === 0) {
      setToast(null);
      setStep("payment");
      return;
    }

    missingToast(missing);
  }

  function onInvalid(formErrors: FieldErrors<CheckoutValues>) {
    missingToast(Object.keys(formErrors) as (keyof CheckoutValues)[]);
  }

  const method = useWatch({ control, name: "method" }) as AcceptedPaymentMethod;
  const region = useWatch({ control, name: "region" });
  const [divisionChosen, setDivisionChosen] = useState(false);

  /* One fixed entry, priced the same way the ordinary cart is — through the
     real quote endpoint, so this page never shows a price it made up itself.
     Keyed on the entry and region exactly like useCart's own quote query. */
  const { data: quote, isLoading } = useQuery({
    queryKey: ["invite-quote", bookId, orderQuantity, divisionChosen ? region : undefined],
    queryFn: () =>
      quoteCart([{ bookId, quantity: orderQuantity }], {
        region: divisionChosen ? region : undefined,
      }),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  const cart = quote ? cartFromQuote(quote) : { lines: [], isEmpty: true, ...priceCart([]) };

  async function placeOrder(values: CheckoutValues) {
    setSubmitError(null);
    setVerification("verifying");

    try {
      const order = await placeOrderRequest(
        { items: [{ bookId, quantity: orderQuantity }], customer: values, inviteToken: token },
        crypto.randomUUID(),
      );

      setPendingOrder({ id: order.orderNumber, email: values.email });
      setVerification(order.status === "PAYMENT_CONFIRMED" ? "verified" : "unverified");
      trackPurchase(order);
    } catch (err) {
      setVerification(null);
      setSubmitError(err instanceof ApiError ? err.message : t("checkout.submitError"));
    }
  }

  function seeOrder() {
    if (!pendingOrder) return;
    setVerification(null);
    setPlacedOrder(pendingOrder);
    setPendingOrder(null);
  }

  if (isLoading && !quote) return <InviteCheckoutSkeleton />;

  if (placedOrder) {
    return (
      <Shell className="py-14 lg:py-20">
        <div className="max-w-measure">
          <p className="eyebrow">{t("checkout.placed.eyebrow")}</p>
          <h1 className="text-36 lg:text-44 text-ink mt-4 font-serif leading-tight">
            {t("checkout.placed.title")}
          </h1>
          <p className="text-body mt-5">
            {t("checkout.placed.description", { email: placedOrder.email })}
          </p>

          <Card variant="tint" padding="roomy" className="mt-8">
            <div className="flex items-baseline justify-between gap-4">
              <p className="eyebrow">{t("checkout.placed.orderId")}</p>
              <CopyButton value={placedOrder.id} />
            </div>
            <OrderId className="mt-2.5 block">{placedOrder.id}</OrderId>
            <p className="text-caption text-secondary mt-2.5">{t("checkout.placed.copyPrompt")}</p>
          </Card>

          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href={path.catalog}>{t("checkout.placed.action")}</LinkButton>
            <LinkButton href={path.order(placedOrder.id)} variant="secondary">
              {t("checkout.placed.track")}
            </LinkButton>
          </div>
        </div>
      </Shell>
    );
  }

  const money = intlLocale(locale);
  const deliveryKnown = divisionChosen;

  const rows = summaryLines(
    cart,
    {
      subtotal: (count) => t("cart.summary.subtotal", { count }),
      delivery: t("cart.summary.delivery"),
      deliveryFree: t("cart.summary.deliveryFree", {
        threshold: formatMoney(FREE_DELIVERY_THRESHOLD, money),
      }),
      deliveryUnknown: deliveryKnown ? undefined : t("cart.summary.deliveryPending"),
    },
    money,
  );
  const total = deliveryKnown ? formatMoney(cart.total, money) : t("cart.summary.totalPending");

  const recapLines: RecapLine[] = cart.lines.map((line) => ({
    book: line.book,
    quantity: line.quantity,
    amount: formatMoney(line.lineTotal, money),
  }));

  const primaryAction =
    step === "delivery" ? (
      <Button type="button" block onClick={goToPayment}>
        {t("checkout.next")}
      </Button>
    ) : (
      <Button
        type="submit"
        form="invite-checkout"
        block
        loading={isSubmitting}
        loadingLabel={t("checkout.placing")}
      >
        {t("checkout.place")}
      </Button>
    );

  return (
    <>
      <Shell className="py-10 lg:py-16">
        <CheckoutProgress
          label={t("checkout.steps.label")}
          current={1}
          steps={[
            { id: "checkout", label: t("checkout.steps.checkout") },
            { id: "confirmation", label: t("checkout.steps.confirmation") },
          ]}
        />

        <Notice tone="info" className="mt-6">
          {t(quantity > 1 ? "waitlistInvite.lockedNoticeUpTo" : "waitlistInvite.lockedNotice", {
            bookTitle: recapLines[0]?.book.title ?? "",
            quantity,
          })}
        </Notice>

        {/* Only worth a control when there is something to choose. A one-copy
            invite renders the notice above and nothing else — a stepper with
            both arrows dead is a worse way to say "one". */}
        {quantity > 1 ? (
          <div className="border-rule mt-6 flex flex-wrap items-center justify-between gap-3 border-b pb-6">
            <div>
              <p className="text-13.5 text-ink">{t("waitlistInvite.quantityLabel")}</p>
              <p className="text-caption text-secondary mt-1">
                {t("waitlistInvite.quantityHint", { quantity })}
              </p>
            </div>
            <Stepper
              label={t("waitlistInvite.quantityLabel")}
              value={orderQuantity}
              min={1}
              max={quantity}
              onChange={setOrderQuantity}
              engaged
            />
          </div>
        ) : null}

        <CollapsibleOrderRecap
          className="mt-6 lg:hidden"
          summaryLabel={t("checkout.recap.mobile", { count: cart.itemCount })}
          totalValue={total}
        >
          <div className="flex flex-col gap-3.5">
            {recapLines.map((line) => (
              <SummaryRow
                key={line.book.id}
                label={`${line.book.title} × ${line.quantity}`}
                value={line.amount}
              />
            ))}
            {rows.map((row) => (
              <SummaryRow key={row.key} label={row.label} value={row.value} tone={row.tone} />
            ))}
            <SummaryRow tone="total" label={t("cart.summary.total")} value={total} />
          </div>
        </CollapsibleOrderRecap>

        <RailLayout
          className="mt-10"
          stickyRail
          rail={
            <OrderRecap
              className="hidden lg:block"
              title={t("checkout.recap.title")}
              lines={recapLines}
              rows={rows}
              totalLabel={t("cart.summary.total")}
              totalValue={total}
            />
          }
        >
          <PageHeader size="md" title={t("waitlistInvite.title")} />

          <form
            id="invite-checkout"
            noValidate
            onSubmit={handleSubmit(placeOrder, onInvalid)}
            className="mt-9 flex flex-col gap-10"
          >
            <div className={step === "delivery" ? undefined : "hidden"}>
              <ShippingFields
                register={register}
                errors={errors}
                setValue={setValue}
                onDivisionChange={(division) => setDivisionChosen(Boolean(division))}
              />
            </div>

            {step === "payment" ? (
              <>
                <button
                  type="button"
                  onClick={() => setStep("delivery")}
                  className="text-caption text-secondary hover:text-ink -mt-6 underline underline-offset-2"
                >
                  {t("checkout.back")}
                </button>

                <PaymentSection
                  register={register}
                  setValue={setValue}
                  errors={errors}
                  method={method}
                  amount={total}
                  breakdown={rows.map((row) => (
                    <SummaryRow key={row.key} label={row.label} value={row.value} tone={row.tone} />
                  ))}
                  onMethodChange={(next) =>
                    setValue("method", next, { shouldValidate: true, shouldDirty: true })
                  }
                />
              </>
            ) : null}

            {isSubmitted && !isValid ? (
              <Notice tone="error">{t("checkout.errorSummary")}</Notice>
            ) : null}
            {submitError ? <Notice tone="error">{submitError}</Notice> : null}

            <div className="hidden lg:block">
              {primaryAction}
              {step === "payment" ? (
                <p className="text-caption text-secondary mt-2.5">{t("checkout.reassurance")}</p>
              ) : null}
            </div>
          </form>
        </RailLayout>
      </Shell>

      <StickyBar
        label={deliveryKnown ? t("cart.summary.total") : undefined}
        value={deliveryKnown ? total : undefined}
        breakdown={
          step === "payment"
            ? rows.map((row) => (
                <SummaryRow key={row.key} label={row.label} value={row.value} tone={row.tone} />
              ))
            : undefined
        }
        action={primaryAction}
      />

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 pb-40 lg:pb-8">
          <div className="shell flex justify-center">
            <Toast className="max-w-measure pointer-events-auto shadow-lg">{toast}</Toast>
          </div>
        </div>
      ) : null}

      <PaymentVerificationModal status={verification} onSeeOrder={seeOrder} />
    </>
  );
}

function InviteCheckoutSkeleton() {
  return (
    <Shell className="py-10 lg:py-16" aria-busy="true">
      <Skeleton className="h-4 w-64" />
      <RailLayout className="mt-10" rail={<Skeleton className="rounded-container h-80" />}>
        <Skeleton className="h-10 w-48" />
        <div className="mt-9 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, field) => (
            <Skeleton key={field} index={field} className="h-16" />
          ))}
        </div>
      </RailLayout>
    </Shell>
  );
}
