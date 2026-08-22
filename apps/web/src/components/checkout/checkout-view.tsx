"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import {
  CollapsibleOrderRecap,
  EmptyState,
  OrderRecap,
  SummaryRow,
  type RecapLine,
} from "@/components/domain";
import { CheckoutProgress, PageHeader, RailLayout, Shell, StickyBar } from "@/components/layout";
import { Button, Card, CopyButton, LinkButton, Notice, OrderId, Skeleton } from "@/components/ui";
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

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting, isSubmitted, isValid },
  } = useForm<CheckoutValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: checkoutDefaults,
    mode: "onBlur",
  });

  /* useWatch rather than `watch()`: watch returns a fresh function each render,
     which opts the whole component out of the React Compiler's memoisation. */
  const method = useWatch({ control, name: "method" }) as AcceptedPaymentMethod;
  /* The region the address form derived from the chosen division — undefined
     until then, so the cart quotes at the flat rate exactly as it did before
     an address existed, and only re-quotes once there is a real zone to price. */
  const region = useWatch({ control, name: "region" });
  const cart = useCart(region || undefined);

  async function placeOrder(values: CheckoutValues) {
    setSubmitError(null);

    try {
      const order = await placeOrderRequest(
        { items: cart.entries, customer: values },
        crypto.randomUUID(),
      );
      setPlacedOrder({ id: order.orderNumber, email: values.email });
      cart.clear();
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : t("checkout.submitError"),
      );
    }
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

  const rows = summaryLines(
    cart,
    {
      subtotal: (count) => t("cart.summary.subtotal", { count }),
      delivery: t("cart.summary.delivery"),
      deliveryFree: t("cart.summary.deliveryFree", {
        threshold: formatMoney(FREE_DELIVERY_THRESHOLD, money),
      }),
    },
    money,
  );

  const total = formatMoney(cart.total, money);

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

  /* One submit button node, placed in the form on desktop and in the docked bar
     on mobile. `form="checkout"` lets the mobile copy live outside the <form>
     and still submit it. */
  const submitAction = (
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
            onSubmit={handleSubmit(placeOrder)}
            className="mt-9 flex flex-col gap-10"
          >
            <ShippingFields register={register} errors={errors} setValue={setValue} />

            <PaymentSection
              register={register}
              setValue={setValue}
              errors={errors}
              method={method}
              onMethodChange={(next) =>
                setValue("method", next, { shouldValidate: true, shouldDirty: true })
              }
            />

            {/* Errors are already stated under each field; this only points at
                them, and only once a submit has actually failed. */}
            {isSubmitted && !isValid ? (
              <Notice tone="error">{t("checkout.errorSummary")}</Notice>
            ) : null}

            {submitError ? <Notice tone="error">{submitError}</Notice> : null}

            <div className="hidden lg:block">
              {submitAction}
              <p className="text-caption text-secondary mt-2.5">{t("checkout.reassurance")}</p>
            </div>
          </form>
        </RailLayout>
      </Shell>

      <StickyBar label={t("cart.summary.total")} value={total} action={submitAction} />
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
