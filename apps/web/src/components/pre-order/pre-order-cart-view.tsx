"use client";

import { useState } from "react";

import { BookCover } from "@/components/domain";
import { PageHeader, Shell } from "@/components/layout";
import { LinkButton, Stepper } from "@/components/ui";
import type { Locale } from "@/i18n/settings";
import { formatMoney, intlLocale } from "@/lib/money";
import { routes } from "@/lib/routes";
import type { PreOrderBook } from "@sakura/contracts";

/**
 * The pre-order cart: a single book, a quantity stepper, and one way forward.
 *
 * Local component state rather than the Redux cart slice — deliberately.
 * `cart-slice.ts` models a multi-title basket keyed by book id; a pre-order is
 * always exactly one title, so a `useState<number>` is the whole cart, and
 * routing it through Redux would add persistence and cross-tab sync that this
 * page has no use for. The quantity travels to /pre-order/checkout as a query
 * param, since that is the only handoff a single number needs.
 */
export function PreOrderCartView({ locale, book }: { locale: Locale; book: PreOrderBook }) {
  const [quantity, setQuantity] = useState(1);
  const path = routes(locale);
  const money = intlLocale(locale);

  const unitPrice = formatMoney(book.priceCents, money);
  const total = formatMoney(book.priceCents * quantity, money);

  return (
    <Shell className="py-14 lg:py-20">
      <PageHeader size="lg" title="Pre-order" description={`${book.title} — reserve your copy.`} />

      <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-[200px_1fr]">
        <BookCover src={book.coverImageUrl} title={book.title} author={book.authorName} radius="md" />

        <div>
          <h2 className="font-serif text-24 text-ink">{book.title}</h2>
          <p className="text-secondary mt-1.5">{book.authorName}</p>
          <p className="text-body mt-3">{book.description}</p>
          {book.pageCount ? (
            <p className="text-caption text-secondary mt-2">{book.pageCount} pages</p>
          ) : null}

          <p className="text-19 text-ink mt-6">{unitPrice}</p>

          <div className="mt-4 flex items-center gap-3.5">
            <Stepper
              value={quantity}
              onChange={setQuantity}
              label={`Quantity, ${book.title}`}
              engaged
            />
          </div>

          <p className="text-caption text-secondary mt-4">Total: {total}</p>

          <div className="mt-8">
            <LinkButton href={`${path.preorder}/checkout?quantity=${quantity}`}>
              Continue to checkout
            </LinkButton>
          </div>
        </div>
      </div>
    </Shell>
  );
}
