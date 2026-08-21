import type { PreOrderBook } from "@sakura/contracts";
import type { InferSelectModel } from "drizzle-orm";
import type { preOrderBooks } from "../db/schema";

export type PreOrderBookRow = InferSelectModel<typeof preOrderBooks>;

export function toPreOrderBookResponse(row: PreOrderBookRow): PreOrderBook {
  return {
    id: row.id,
    title: row.title,
    authorName: row.authorName,
    description: row.description,
    pageCount: row.pageCount,
    priceCents: row.priceCents,
    coverImageUrl: row.coverImageUrl,
    coverImageAlt: row.coverImageAlt,
    isActive: row.isActive,
  };
}
