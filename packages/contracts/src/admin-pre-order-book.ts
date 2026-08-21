import { z } from "zod";
import { preOrderBookSchema } from "./pre-order-book";
import { paginated } from "./pagination";

/* --------------------------------------------------------------------------
   Admin CRUD over the pre-order book. Same split as admin-order.ts: the
   storefront's PreOrderBook is what a shopper may see, this file adds only
   what staff need to write it.
   -------------------------------------------------------------------------- */

const required = (fix: string) => z.string().trim().min(1, fix);

export const adminPreOrderBookUpsertRequestSchema = z
  .object({
    title: required("Add a title."),
    authorName: required("Add the author's name."),
    description: required("Add a description."),
    pageCount: z.number().int().positive().nullable().optional(),
    priceCents: z.number().int().nonnegative("Price cannot be negative."),
    compareAtPriceCents: z.number().int().nonnegative().nullable().optional(),
    coverImageUrl: required("Add a cover image URL."),
    coverImageAlt: z.string().trim().optional(),
    isActive: z.boolean().default(true),
  })
  .refine(
    (value) => !value.compareAtPriceCents || value.compareAtPriceCents > value.priceCents,
    {
      message: "The original price must be higher than the sale price.",
      path: ["compareAtPriceCents"],
    },
  );

export type AdminPreOrderBookUpsertRequest = z.infer<typeof adminPreOrderBookUpsertRequestSchema>;

export const adminPreOrderBookListSchema = paginated(preOrderBookSchema);
export type AdminPreOrderBookList = z.infer<typeof adminPreOrderBookListSchema>;
