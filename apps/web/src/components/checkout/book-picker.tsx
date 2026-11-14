"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CartItem } from "@sakura/contracts";

import { BookCover } from "@/components/domain";
import { Button, Modal, Notice, Skeleton } from "@/components/ui";
import { listBooks } from "@/lib/api/catalog";
import { formatMoney } from "@/lib/money";
import { fileUrl } from "@/lib/storage-url";

/* --------------------------------------------------------------------------
   TEMPORARY — the coupon checkout's book picker.

   The coupon link is opened with an empty cart, and sending the customer off
   to the catalog is how they got lost: they came back through the ordinary
   cart to the ordinary checkout, with no coupon box. So the shelf comes to
   them instead, in a sheet over the checkout, and adding a book is the same
   cart dispatch the catalog's own button makes.

   Every active title the catalog lists, by the catalog's own rules (see
   toBookSummary in lib/book-view.ts): `in_stock` and `pre_order` are both
   ordinary orderable books through the same cart and checkout — `pre_order`
   just ships later, and is not the retired pre-order stream. `coming_soon`
   is listed but cannot be added, and anything with no copies left is sold
   out.
   -------------------------------------------------------------------------- */

/** The whole shelf in one page — the shop carries dozens of titles. */
const PICKER_PAGE_SIZE = 100;

export function BookPicker({
  open,
  onClose,
  entries,
  money,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  /** What is in the cart now — drives the "Added" state without waiting for a quote. */
  entries: CartItem[];
  money: string;
  onAdd: (bookId: string, item: { title: string; priceCents: number }) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["coupon-checkout-shelf"],
    queryFn: () =>
      listBooks({ q: "", genres: [], sort: "recent", page: 1 }, { pageSize: PICKER_PAGE_SIZE }),
    enabled: open,
    staleTime: 60_000,
  });

  const inCart = new Set(entries.map((entry) => entry.bookId));
  const needle = search.trim().toLowerCase();
  /* No availability filter: the API already returns only active titles,
     orderable ones first. Which of them can be added is decided per row. */
  const books = (data?.items ?? []).filter(
    (book) =>
      !needle ||
      book.title.toLowerCase().includes(needle) ||
      book.authors.some((author) => author.toLowerCase().includes(needle)),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={t("checkout.coupon.pickerTitle")}
      description={t("checkout.coupon.pickerDescription")}
    >
      <div className="flex flex-col gap-4">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("checkout.coupon.pickerSearch")}
          aria-label={t("checkout.coupon.pickerSearch")}
          className="rounded-control border-rule bg-surface text-13.5 text-ink w-full border px-3 py-2"
        />

        <div className="-mx-1 max-h-[55vh] overflow-y-auto px-1">
          {isLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} index={index} className="h-20" />
              ))}
            </div>
          ) : null}

          {isError ? (
            <Notice tone="error">
              {t("checkout.coupon.pickerFailed")}{" "}
              <button
                type="button"
                onClick={() => void refetch()}
                className="text-clay hover:text-clay-deep font-semibold"
              >
                {t("checkout.coupon.pickerRetry")}
              </button>
            </Notice>
          ) : null}

          {!isLoading && !isError && books.length === 0 ? (
            <p className="text-13.5 text-secondary py-6 text-center">
              {t("checkout.coupon.pickerEmpty")}
            </p>
          ) : null}

          <ul className="hairline">
            {books.map((book) => {
              const added = inCart.has(book.id);
              const comingSoon = book.availability === "coming_soon";
              /* Same rule as the catalog card: zero copies is sold out for
                 any title that could otherwise be ordered. */
              const soldOut = !comingSoon && book.stockQuantity === 0;
              const preOrder = book.availability === "pre_order";

              return (
                <li
                  key={book.id}
                  className="grid-line-sm border-rule items-center gap-4 border-b py-3"
                >
                  <BookCover
                    src={fileUrl(book.coverImageUrl) ?? undefined}
                    title={book.title}
                    author={book.authors.join(", ")}
                    radius="xs"
                    sizes="64px"
                  />

                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-15 text-ink font-serif leading-[1.3]">{book.title}</p>
                      <p className="text-caption text-secondary mt-1">
                        {formatMoney(book.priceCents, money)}
                        {preOrder ? ` · ${t("checkout.coupon.pickerPreOrder")}` : null}
                      </p>
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      variant={added ? "ghost" : "secondary"}
                      disabled={comingSoon || soldOut || added}
                      onClick={() =>
                        onAdd(book.id, { title: book.title, priceCents: book.priceCents })
                      }
                    >
                      {comingSoon
                        ? t("checkout.coupon.pickerComingSoon")
                        : soldOut
                          ? t("checkout.coupon.pickerSoldOut")
                          : added
                            ? t("checkout.coupon.pickerAdded")
                            : t("checkout.coupon.pickerAdd")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <Button type="button" block onClick={onClose}>
          {t("checkout.coupon.pickerDone", { count: entries.length })}
        </Button>
      </div>
    </Modal>
  );
}
