"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { ShippingFields } from "@/components/checkout/shipping-fields";
import { PageHeader, Shell } from "@/components/layout";
import { Button, Card, Notice, OrderId } from "@/components/ui";
import type { Locale } from "@/i18n/settings";
import { checkoutDefaults, checkoutSchema, type CheckoutValues } from "@/lib/checkout";
import { placePreOrder } from "@/lib/api/pre-order";
import { formatMoney, intlLocale } from "@/lib/money";
import { routes } from "@/lib/routes";
import { ApiError } from "@/lib/api/client";
import type { PreOrderBook } from "@sakura/contracts";

/**
 * The pre-order checkout step.
 *
 * A parallel component to CheckoutView rather than a shared one: this form
 * has no payment step (`pre_order_orders` carries no paymentMethod column —
 * see the API schema) and posts to a different, simpler endpoint. It still
 * borrows `checkoutSchema`/`ShippingFields` wholesale for the address half,
 * since that half — name, email, phone, BD address — is identical to the
 * real checkout's and re-deriving it would be the copy the shared schema
 * exists to prevent. `method`/`senderNumber`/`transactionId` ride along on
 * the form only because `checkoutSchema` still validates them; they are never
 * read when building the pre-order request below.
 */
export function PreOrderCheckoutView({ locale, book }: { locale: Locale; book: PreOrderBook }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const path = routes(locale);
  const money = intlLocale(locale);

  const quantity = Math.max(1, Math.min(99, Number(searchParams.get("quantity")) || 1));

  const [placed, setPlaced] = useState<{ orderNumber: string; email: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CheckoutValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: checkoutDefaults,
    mode: "onBlur",
  });

  async function submit(values: CheckoutValues) {
    setSubmitError(null);

    try {
      const idempotencyKey = crypto.randomUUID();

      const result = await placePreOrder(
        {
          preOrderBookId: book.id,
          quantity,
          customer: {
            fullName: values.fullName,
            email: values.email,
            phone: values.phone,
            address: values.address,
            city: values.city,
            region: values.region,
          },
          note: values.notes,
        },
        idempotencyKey,
      );

      setPlaced({ orderNumber: result.orderNumber, email: result.customerEmail });
    } catch (error) {
      setSubmitError(
        error instanceof ApiError ? error.message : "Something went wrong placing your pre-order.",
      );
    }
  }

  if (placed) {
    return (
      <Shell className="py-14 lg:py-20">
        <div className="max-w-measure">
          <p className="eyebrow">Pre-order placed</p>
          <h1 className="text-36 lg:text-44 text-ink mt-4 font-serif leading-tight">
            Thanks — your pre-order is in.
          </h1>
          <p className="text-body mt-5">We&apos;ll email {placed.email} when it ships.</p>

          <Card variant="tint" padding="roomy" className="mt-8">
            <p className="eyebrow">Pre-order ID</p>
            <OrderId className="mt-2.5 block">{placed.orderNumber}</OrderId>
          </Card>

          <div className="mt-8">
            <Button onClick={() => router.push(path.catalog)}>Back to catalogue</Button>
          </div>
        </div>
      </Shell>
    );
  }

  const total = formatMoney(book.priceCents * quantity, money);

  return (
    <Shell className="py-10 lg:py-16">
      <PageHeader size="md" title="Pre-order checkout" description={`${book.title} × ${quantity} — ${total}`} />

      <form
        noValidate
        onSubmit={handleSubmit(submit)}
        className="mt-9 flex max-w-measure flex-col gap-10"
      >
        <ShippingFields register={register} errors={errors} setValue={setValue} />

        {submitError ? <Notice tone="error">{submitError}</Notice> : null}

        <Button type="submit" loading={isSubmitting} loadingLabel="Placing pre-order…">
          Place pre-order
        </Button>
      </form>
    </Shell>
  );
}
