import { listBooks } from "@/lib/api/catalog";
import { parseSearchParams } from "@/lib/catalog";

/* --------------------------------------------------------------------------
   The shelf a checkout page may offer alongside what the shopper is already
   buying — "take more in the same parcel".

   Two pages ask for it, for the same reason and with the same rules, so the
   rules live here rather than twice: /checkout, where the cart is the
   shopper's own, and /invite/[token], where the basket belongs to the link.
   Both are pages where a second delivery fee is the only thing standing
   between the customer and a second book.
   -------------------------------------------------------------------------- */

/** One title that may ride along in the same order. */
export type AlsoAvailableBook = {
  id: string;
  title: string;
  author: string;
  priceCents: number;
  /** Public stock, already net of every live invite. The stepper's ceiling. */
  maxQuantity: number;
};

/**
 * Titles that could be added to an order being placed right now.
 *
 * Only what the shop can actually ship today: `stockQuantity` on the public
 * contract is already net of every live invite, so a book held for somebody
 * else's link never appears here, and the stepper's ceiling is the same number
 * checkout will enforce. Coming-soon and pre-order titles are excluded by the
 * same filter — offering a customer a book that ships in March, on the page
 * where they are paying for one that ships today, is how a whole order ends up
 * waiting.
 *
 * `exclude` is what the order already holds. On the invite page that is the
 * reserved book; on checkout it is whatever is in the cart, which is not known
 * until the browser says so — so that page fetches a few extra and filters
 * client-side. Hence `limit` being the caller's to choose.
 *
 * A failure here is not a failure of the page. The thing the customer came for
 * is the order, and losing the shelf to a slow catalog call must not cost the
 * sale, so this degrades to an empty list.
 */
export async function offerableBooks(
  exclude: readonly string[],
  limit: number,
): Promise<AlsoAvailableBook[]> {
  const list = await listBooks(parseSearchParams({})).catch(() => null);

  return (list?.items ?? [])
    .filter(
      (book) =>
        !exclude.includes(book.id) && book.availability === "in_stock" && book.stockQuantity > 0,
    )
    .slice(0, limit)
    .map((book) => ({
      id: book.id,
      title: book.title,
      author: book.authors.join(", "),
      priceCents: book.priceCents,
      maxQuantity: book.stockQuantity,
    }));
}
