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
import { cartFromQuote, emptyCart, summaryLines } from "@/lib/cart";
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
   number of copies it held, plus anything else the shop can ship today.

   Deliberately its own component rather than CheckoutView plus branches: the
   two share the delivery/payment form (ShippingFields, PaymentSection) and
   the recap presentation, but not the thing underneath it. CheckoutView's
   "cart" is Redux state a shopper edits and a session accumulates; this one
   is a basket that exists for the length of this page and nothing here reads
   or writes the cart slice. An OPEN invite doesn't need any of this: it
   renders the ordinary CheckoutView with contact fields pre-filled instead.

   The invite constrains its own book and nothing else. Other in-stock titles
   (`alsoAvailable`, drawn from the public shelf, so already net of everyone
   else's holds) may travel in the same order, because the alternative was the
   shop refusing money: an invited customer who also wanted a title sitting in
   stock could not have both in one box — this page refused the second book,
   and the ordinary cart refused the *first*, since public availability
   subtracts every live reservation including their own. Two orders and two
   delivery fees, for one customer, on purpose. See
   CheckoutService.consumeInvite, which enforces the same division server-side.

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

/** One title the invited customer may add — see the page's `offerable()`. */
export type AlsoAvailableBook = {
  id: string;
  title: string;
  author: string;
  priceCents: number;
  /** Public stock, already net of every live invite. The stepper's ceiling. */
  maxQuantity: number;
};

export function InviteCheckoutView({
  locale,
  token,
  bookId,
  quantity,
  prefill,
  alsoAvailable = [],
}: {
  locale: Locale;
  token: string;
  bookId: string;
  /** What the entry reserved — the most this order may contain, not the only figure. */
  quantity: number;
  prefill: Pick<CheckoutValues, "fullName" | "email" | "phone">;
  /** Other titles that may ride along. Empty is a normal state, not a failure. */
  alsoAvailable?: AlsoAvailableBook[];
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
  /* Extra titles, by id, at zero until someone asks for one. Local state and
     not the cart slice: this basket belongs to the link, and merging it into
     the shopper's saved cart would leave a book sitting there after they close
     the tab, waiting to surprise them on a later visit. */
  const [extras, setExtras] = useState<Record<string, number>>({});
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

  /* The reserved book first, then whatever was added to it. One list, built
     once: the quote and the order must be the same basket, and two places
     assembling it is how a customer is shown one total and charged another. */
  const items = [
    { bookId, quantity: orderQuantity },
    ...alsoAvailable
      .filter((book) => (extras[book.id] ?? 0) > 0)
      .map((book) => ({ bookId: book.id, quantity: extras[book.id]! })),
  ];

  /* Priced the same way the ordinary cart is — through the real quote
     endpoint, so this page never shows a price it made up itself. Keyed on the
     basket and region exactly like useCart's own quote query; `items` is
     serialised into the key because its identity changes on every render. */
  const { data: quote, isLoading } = useQuery({
    queryKey: ["invite-quote", JSON.stringify(items), divisionChosen ? region : undefined],
    queryFn: () =>
      quoteCart(items, {
        region: divisionChosen ? region : undefined,
        inviteToken: token,
      }),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  const cart = quote ? cartFromQuote(quote) : emptyCart;

  async function placeOrder(values: CheckoutValues) {
    setSubmitError(null);
    setVerification("verifying");

    try {
      const order = await placeOrderRequest(
        { items, customer: values, inviteToken: token },
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
      deliveryFree:
        cart.freeDeliveryThreshold === null
          ? null
          : t("cart.summary.deliveryFree", {
              threshold: formatMoney(cart.freeDeliveryThreshold, money),
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

        {/*
          The title is lifted out of the sentence rather than interpolated into
          it. Inline, it was one more clause in a line of reserve-and-restrict
          copy and readers skimmed past the one thing they need to check before
          paying — which book this is. The sentence now points at it ("the book
          below") and the title carries the display face on its own line.
        */}
        <Notice tone="info" className="mt-6 text-center">
          {t(quantity > 1 ? "waitlistInvite.lockedNoticeUpTo" : "waitlistInvite.lockedNotice", {
            quantity,
          })}
          {/* 500, not `strong`'s default bold: Lora is loaded at 400/500 only,
              so anything heavier is a synthesised smear rather than a weight. */}
          {/* Found by id, never by position: the basket may now hold other
              titles and the quote is under no obligation to return the
              reserved one first. */}
          <strong className="text-h3 text-ink mt-2 block font-serif font-medium">
            {recapLines.find((line) => line.book.id === bookId)?.book.title ?? ""}
          </strong>
        </Notice>

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

        {/* Offered under the reserved book rather than above it: the invite is
            what the customer came for, and a shelf between them and it reads
            as an upsell gate. Absent entirely when there is nothing to show —
            an empty "also available" heading is worse than silence. */}
        {alsoAvailable.length > 0 ? (
          <section className="border-rule mt-6 border-b pb-6">
            <p className="text-13.5 text-ink">{t("waitlistInvite.alsoAvailable.title")}</p>
            <p className="text-caption text-secondary mt-1">
              {t("waitlistInvite.alsoAvailable.hint")}
            </p>

            <ul className="mt-4 flex flex-col gap-3.5">
              {alsoAvailable.map((book) => (
                <li key={book.id} className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-13.5 text-ink truncate">{book.title}</p>
                    <p className="text-caption text-secondary mt-0.5 truncate">
                      {book.author} · {formatMoney(book.priceCents, money)}
                    </p>
                  </div>
                  <Stepper
                    label={book.title}
                    value={extras[book.id] ?? 0}
                    /* Zero is a real value here, unlike the reserved book's
                       stepper: taking none of an extra title is the default,
                       and stepping down to it is how a book is removed. */
                    min={0}
                    max={book.maxQuantity}
                    onChange={(next) => setExtras((current) => ({ ...current, [book.id]: next }))}
                    engaged={(extras[book.id] ?? 0) > 0}
                  />
                </li>
              ))}
            </ul>
          </section>
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
