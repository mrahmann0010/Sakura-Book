import { z } from "zod";

/* --------------------------------------------------------------------------
   The pre-order book — the single title the storefront is taking pre-orders
   for. Deliberately smaller than `books` in ./catalog: no ISBN, no publisher,
   no gallery, no stock — a pre-order book is announced, not stocked.
   -------------------------------------------------------------------------- */

export const preOrderBookSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  authorName: z.string(),
  description: z.string(),
  pageCount: z.number().int().positive().nullable(),
  priceCents: z.number().int().nonnegative(),
  coverImageUrl: z.string(),
  coverImageAlt: z.string().nullable(),
  isActive: z.boolean(),
});

export type PreOrderBook = z.infer<typeof preOrderBookSchema>;
