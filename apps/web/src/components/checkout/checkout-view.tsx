"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { useTranslation } from "react-i18next";

import {
  CollapsibleOrderRecap,
  EmptyState,
  OrderRecap,
  SummaryRow,
  type RecapLine,
} from "@/components/domain";
import { CheckoutProgress, PageHeader, RailLayout, Shell, StickyBar } from "@/components/layout";
import {
  Button,
  Card,
  CopyButton,
  LinkButton,
  Notice,
  OrderId,
  Skeleton,
  Toast,
} from "@/components/ui";
import { useCart } from "@/hooks/use-cart";
import type { Locale } from "@/i18n/settings";
import { ApiError } from "@/lib/api/client";
import { placeOrder as placeOrderRequest } from "@/lib/api/orders";
import { titlesInStock } from "@/lib/books";
import {
  checkoutDefaults,
  checkoutSchema,
  type CheckoutValues,
  type AcceptedPaymentMethod,
} from "@/lib/checkout";
import { FREE_DELIVERY_THRESHOLD, summaryLines } from "@/lib/cart";
import { formatMoney, intlLocale } from "@/lib/money";
import { routes } from "@/lib/routes";

import { PaymentSection } from "./payment-section";
import {
  PaymentVerificationModal,
  type PaymentVerificationStatus,
} from "./payment-verification-modal";
import { ShippingFields } from "./shipping-fields";

/* --------------------------------------------------------------------------
   The checkout page's one job: say where the books go and how they are paid
   for.

   It cannot change the order. The cart's contents appear here as a read-only
   recap with a single link back — quantity as "×n", no steppers, no remove.
   That separation is the whole reason these are two pages: one is for deciding
   what to buy, this one is for committing to it, and mixing them gives a page
   where the shopper edits and commits in the same breath.
   -------------------------------------------------------------------------- */

export function CheckoutView({ locale }: { locale: Locale }) {
  const { t } = useTranslation();
  const path = routes(locale);

  const [placedOrder, setPlacedOrder] = useState<{ id: string; email: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [verification, setVerification] = useState<PaymentVerificationStatus | null>(null);
  /* Holds the just-placed order between the modal resolving and the shopper
     clicking "See order info" — the modal's result is the only thing on
     screen until then, so the confirmation page and the cart clear wait for
     that click rather than firing themselves. */
  const [pendingOrder, setPendingOrder] = useState<{ id: string; email: string } | null>(null);

  const [step, setStep] = useState<"delivery" | "payment">("delivery");

  /* A missed field is currently silent where it matters most: "Next" simply
     does not advance, and the error it set may be off-screen on a phone. The
     toast names what is missing so the shopper is not left tapping a button
     that appears dead. Local to this page rather than an app-wide host —
     Toast is presentational by design, and checkout is the only caller. */
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
    defaultValues: checkoutDefaults,
    mode: "onBlur",
  });

  /* Only the delivery fields — `region` is derived from the address picker
     rather than typed, so it validates along with the rest of the address
     but never blocks Next on its own before a division is chosen. */
  const deliveryFields = ["fullName", "email", "phone", "address", "city", "region"] as const;

  /* Which form field each name points at on screen. `city` and `region` are
     never typed — the district and division pickers write them — so the toast
     names the control the shopper has to touch, not the schema field behind
     it, which they would look for and never find. */
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
    /* Intl rather than join(", ") — the separator and the final conjunction
       differ per locale, and this string is read in three. */
    const list = new Intl.ListFormat(intlLocale(locale), {
      style: "long",
      type: "conjunction",
    }).format(labels);
    setToast(t("checkout.missing", { fields: list }));
  }

  async function goToPayment() {
    /* Validated one field at a time rather than as an array: `trigger(fields)`
       answers only whether all of them passed, and the toast has to name the
       ones that did not. Reading `errors` straight after would race the
       formState update this same call triggers. */
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

  /* The submit's failure path. react-hook-form hands the errors straight in,
     so unlike goToPayment there is nothing to re-derive. */
  function onInvalid(formErrors: FieldErrors<CheckoutValues>) {
    missingToast(Object.keys(formErrors) as (keyof CheckoutValues)[]);
  }

  /* useWatch rather than `watch()`: watch returns a fresh function each render,
     which opts the whole component out of the React Compiler's memoisation. */
  const method = useWatch({ control, name: "method" }) as AcceptedPaymentMethod;
  /* The region the address form derived from the chosen division. */
  const region = useWatch({ control, name: "region" });
  /* Whether the shopper has actually chosen a division. Not derivable from
     `region`: checkoutDefaults seeds it to "inside-dhaka", so it is a real
     zone from the first render and would price delivery before anyone said
     where the books are going. ShippingFields reports the choice up. */
  const [divisionChosen, setDivisionChosen] = useState(false);
  const cart = useCart(divisionChosen ? region || undefined : undefined);

  async function placeOrder(values: CheckoutValues) {
    setSubmitError(null);
    setVerification("verifying");

    try {
      const order = await placeOrderRequest(
        { items: cart.entries, customer: values },
        crypto.randomUUID(),
      );

      /* The auto-verify check already ran server-side, inside the same
         request — a manual-transfer order comes back PAYMENT_CONFIRMED when
         the transaction was matched against the gateway, PENDING otherwise.
         This is just reading that result, not triggering a second check. */
      setPendingOrder({ id: order.orderNumber, email: values.email });
      setVerification(order.status === "PAYMENT_CONFIRMED" ? "verified" : "unverified");
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
    cart.clear();
  }

  if (!cart.hydrated || cart.quoting) return <CheckoutSkeleton />;

  /* The order is in. The cart is now empty by design, so this state has to be
     checked before the empty-cart guard below or placing an order would bounce
     the shopper straight to "there is nothing to check out". */
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

  if (cart.isEmpty) {
    return (
      <Shell className="py-14 lg:py-20">
        <PageHeader size="lg" title={t("checkout.title")} />
        <EmptyState
          className="mt-10"
          eyebrow={t("checkout.empty.eyebrow")}
          title={t("checkout.empty.title")}
          description={t("checkout.empty.description", { count: titlesInStock })}
          action={<LinkButton href={path.catalog}>{t("checkout.empty.action")}</LinkButton>}
        />
      </Shell>
    );
  }

  /* One BCP 47 tag for every amount on the page. Derived once so a row
     cannot end up formatted for a different locale than the total below it. */
  const money = intlLocale(locale);

  /* Delivery is priced per zone, and the zone comes from the division the
     address picker resolves. Until that happens the quote is still carrying
     the flat placeholder rate, so the rail says so instead of showing a
     figure the shopper would read as final — and the total, which cannot be
     known without it, waits with it. Both fill in together the moment a
     division is chosen. */
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

  const editCart = (
    <Link href={path.cart} className="text-clay hover:text-clay-deep">
      {t("checkout.recap.edit")}
    </Link>
  );

  /* One primary action node, placed in the form on desktop and in the docked
     bar on mobile. `form="checkout"` lets the mobile copy live outside the
     <form> and still submit it. On the delivery step this is "Next" (advances
     local step state, no submit); on the payment step it becomes the one real
     submit button for the whole order. */
  const primaryAction =
    step === "delivery" ? (
      <Button type="button" block onClick={goToPayment}>
        {t("checkout.next")}
      </Button>
    ) : (
      <Button
        type="submit"
        form="checkout"
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
            { id: "cart", label: t("checkout.steps.cart"), href: path.cart },
            { id: "checkout", label: t("checkout.steps.checkout") },
            { id: "confirmation", label: t("checkout.steps.confirmation") },
          ]}
        />

        {/* Mobile keeps the recap collapsed above the form: the form is the job
            here, and the recap is reassurance the shopper asks for. */}
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
            <p className="text-13 mt-2">{editCart}</p>
          </div>
        </CollapsibleOrderRecap>

        <RailLayout
          className="mt-10"
          stickyRail
          rail={
            <OrderRecap
              className="hidden lg:block"
              title={t("checkout.recap.title")}
              editAction={editCart}
              lines={recapLines}
              note={t("checkout.recap.note")}
              rows={rows}
              totalLabel={t("cart.summary.total")}
              totalValue={total}
            />
          }
        >
          <PageHeader size="md" title={t("checkout.title")} />

          <form
            id="checkout"
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

            {/* Errors are already stated under each field; this only points at
                them, and only once a submit has actually failed. */}
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
        /* The total only earns its line once there is one. Before a division
           the figure is "—", so on the address step the bar was spending a
           row, a gap and a hairline to say nothing while sitting on top of
           the form being typed into. It collapses to just the button there,
           and grows as the order becomes known. */
        label={deliveryKnown ? t("cart.summary.total") : undefined}
        value={deliveryKnown ? total : undefined}
        /* The same rows the desktop rail draws, from the same derivation — but
           only on the payment step. On a phone the docked bar sits on top of
           whatever is being typed, and three extra rows plus a hairline left
           the address form almost no room to work in. There is also nothing
           to read yet: delivery has no figure until a division is chosen, so
           on the delivery step the breakdown costs a third of the screen to
           say "not known". By the payment step it is priced, and it is the
           figure being typed into a banking app. */
        breakdown={
          step === "payment"
            ? rows.map((row) => (
                <SummaryRow key={row.key} label={row.label} value={row.value} tone={row.tone} />
              ))
            : undefined
        }
        action={primaryAction}
      />

      {/* Above the docked bar rather than under it: the bar is the thing the
          shopper just tapped, and a message hidden behind it would be the
          same silence this replaces. */}
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

function CheckoutSkeleton() {
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
